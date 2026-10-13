"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { toDisplayEvent, type DisplayEvent } from "@/lib/event-utils";
import { PUBLISH_TOPIC } from "@/lib/validation";

type Session =
  | { authenticated: false }
  | { authenticated: true; instanceUrl: string; organizationId: string };

type Tracking =
  | { mode: "managed"; subscription: string }
  | { mode: "unmanaged"; subscription: string; reason: string };

type Commit = { replayId: number; committedAt: string };

type WireMessage =
  | { type: "status"; message: string; tracking: Tracking }
  | {
      type: "event";
      topic: string;
      replayId: number;
      receivedAt: string;
      payload: unknown;
    }
  | { type: "keepalive"; replayId: number | null }
  | ({ type: "commit" } & Commit)
  | { type: "end"; replayId: number | null }
  | { type: "error"; message: string; retryable: boolean };

const DEFAULT_TOPIC = "/event/Avantos_Integration__e";
const LISTENING_KEY = "pev:listening";
const OFFLINE_RETRY_MS = 15_000;
// Salesforce takes a few seconds to release a managed subscription after a window closes.
const BUSY_RETRY_MS = 2_000;

class RetryableStreamError extends Error {}

export function EventConsole() {
  const [session, setSession] = useState<Session | null>(null);
  const [myDomainUrl, setMyDomainUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [topic, setTopic] = useState(DEFAULT_TOPIC);
  const [events, setEvents] = useState<DisplayEvent[]>([]);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [listening, setListening] = useState(false);
  const [source, setSource] = useState("External service");
  const [message, setMessage] = useState("Phone changed to (201) 555-0199");
  const [publishing, setPublishing] = useState(false);
  const [publishedReplayId, setPublishedReplayId] = useState<string | null>(null);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [committed, setCommitted] = useState<Commit | null>(null);
  const [receivedCount, setReceivedCount] = useState(0);
  const [offlineCount, setOfflineCount] = useState(0);
  const listeningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const replayIdRef = useRef<number | null>(null);
  const listeningSinceRef = useRef(0);
  const seenReplayIdsRef = useRef(new Set<number>());

  const resumeListening = useEffectEvent((current: Session) => {
    const savedTopic = current.authenticated
      ? window.localStorage.getItem(LISTENING_KEY)
      : null;
    if (savedTopic && !listeningRef.current) {
      setTopic(savedTopic);
      void start(savedTopic);
    }
  });

  useEffect(() => {
    const queryError = new URLSearchParams(window.location.search).get("error");
    if (queryError) {
      queueMicrotask(() => setError(queryError));
      window.history.replaceState({}, "", "/");
    }
    fetch("/api/session", { cache: "no-store" })
      .then((response) => response.json() as Promise<Session>)
      .then((current) => {
        setSession(current);
        resumeListening(current);
      })
      .catch(() => {
        setSession({ authenticated: false });
        setError("Could not read the local session.");
      });
  }, []);

  const disconnect = useCallback(() => {
    listeningRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const stop = useCallback(() => {
    disconnect();
    window.localStorage.removeItem(LISTENING_KEY);
    setListening(false);
    setStatus("Stopped");
  }, [disconnect]);

  useEffect(() => disconnect, [disconnect]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConnecting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ myDomainUrl, clientId }),
      });
      const data = (await response.json()) as {
        authorizeUrl?: string;
        error?: string;
      };
      if (!response.ok || !data.authorizeUrl) {
        throw new Error(data.error || "Could not start Salesforce login.");
      }
      window.location.assign(data.authorizeUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Login failed.");
      setConnecting(false);
    }
  }

  async function signOut() {
    stop();
    await fetch("/api/auth/logout", { method: "POST" });
    setSession({ authenticated: false });
    setEvents([]);
    setTracking(null);
    setCommitted(null);
    replayIdRef.current = null;
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPublishing(true);
    setError(null);
    setPublishedReplayId(null);
    try {
      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, message }),
      });
      const data = (await response.json()) as {
        replayId?: string;
        error?: string;
      };
      if (!response.ok || !data.replayId) {
        if (response.status === 401) {
          setSession({ authenticated: false });
        }
        throw new Error(data.error || "Salesforce did not accept the event.");
      }
      setPublishedReplayId(data.replayId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Publish failed.");
    } finally {
      setPublishing(false);
    }
  }

  async function start(topicToUse = topic) {
    setError(null);
    setEvents([]);
    setTracking(null);
    setCommitted(null);
    setReceivedCount(0);
    setOfflineCount(0);
    replayIdRef.current = null;
    seenReplayIdsRef.current = new Set();
    listeningSinceRef.current = Date.now();
    listeningRef.current = true;
    window.localStorage.setItem(LISTENING_KEY, topicToUse);
    setListening(true);
    setStatus("Connecting");

    while (listeningRef.current) {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const response = await fetch("/api/events", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            topic: topicToUse,
            replayId: replayIdRef.current,
          }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const data = (await response.json()) as { error?: string };
          if (response.status === 401) {
            setSession({ authenticated: false });
          }
          throw new Error(data.error || "Subscription failed.");
        }
        await readMessages(response.body);
        if (listeningRef.current) {
          setStatus("Reconnecting");
          await delay(350);
        }
      } catch (caught) {
        if (controller.signal.aborted) {
          break;
        }
        if (isNetworkFailure(caught)) {
          setStatus("Offline. Resumes when the connection returns");
          await waitForConnection(OFFLINE_RETRY_MS);
          continue;
        }
        if (caught instanceof RetryableStreamError) {
          setStatus("Reconnecting");
          await delay(BUSY_RETRY_MS);
          continue;
        }
        listeningRef.current = false;
        setListening(false);
        setStatus("Error");
        setError(
          caught instanceof Error ? caught.message : "Subscription failed.",
        );
      }
    }
  }

  async function readMessages(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (listeningRef.current) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) {
          handleMessage(JSON.parse(line) as WireMessage);
        }
      }
    }
  }

  function handleMessage(message: WireMessage) {
    if (message.type === "status") {
      setTracking(message.tracking);
      setStatus("Listening");
      return;
    }
    if (message.type === "event") {
      replayIdRef.current = message.replayId;
      if (seenReplayIdsRef.current.has(message.replayId)) {
        return;
      }
      seenReplayIdsRef.current.add(message.replayId);
      const event = toDisplayEvent({
        ...message,
        listeningSince: listeningSinceRef.current,
      });
      setEvents((current) => [event, ...current].slice(0, 100));
      setReceivedCount((count) => count + 1);
      if (event.publishedWhileOffline) {
        setOfflineCount((count) => count + 1);
      }
      setStatus("Event received");
      return;
    }
    if (message.type === "commit") {
      setCommitted({
        replayId: message.replayId,
        committedAt: message.committedAt,
      });
      return;
    }
    if (message.type === "keepalive" || message.type === "end") {
      if (message.replayId != null) {
        replayIdRef.current = message.replayId;
      }
      return;
    }
    throw message.retryable
      ? new RetryableStreamError(message.message)
      : new Error(message.message);
  }

  if (session === null) {
    return <LoadingScreen />;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            PE
          </span>
          <div>
            <strong>Platform Event Verification</strong>
            <span>Salesforce Pub/Sub demo console</span>
          </div>
        </div>
        {session.authenticated && (
          <button className="button ghost" onClick={signOut}>
            Disconnect
          </button>
        )}
      </header>

      {!session.authenticated ? (
        <LoginPanel
          clientId={clientId}
          connecting={connecting}
          error={error}
          myDomainUrl={myDomainUrl}
          onClientIdChange={setClientId}
          onDomainChange={setMyDomainUrl}
          onSubmit={signIn}
        />
      ) : (
        <section className="workspace">
          <aside className="sidebar">
            <div className="eyebrow">Connected org</div>
            <div className="org-card">
              <span className="signal-dot" aria-hidden="true" />
              <div>
                <strong>{new URL(session.instanceUrl).hostname}</strong>
                <span>{session.organizationId}</span>
              </div>
            </div>

            <label className="field-label" htmlFor="topic">
              Event subscription
            </label>
            <input
              id="topic"
              className="input mono"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder={DEFAULT_TOPIC}
              disabled={listening}
            />
            <p className="hint">
              Paste the Salesforce topic path. Platform event topics start with
              <code>/event/</code>.
            </p>

            <button
              className={`button primary ${listening ? "danger" : ""}`}
              onClick={listening ? stop : () => void start()}
            >
              {listening ? "Stop listening" : "Start listening"}
            </button>

            <div className="status-row">
              <span
                className={`status-light ${listening ? "live" : ""}`}
                aria-hidden="true"
              />
              <span>{status}</span>
            </div>

            {tracking && <TrackingNote tracking={tracking} committed={committed} />}

            <form className="publish-panel" onSubmit={publish}>
              <div className="eyebrow">External publisher</div>
              <label className="field-label" htmlFor="source">
                Source
              </label>
              <input
                id="source"
                className="input"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                maxLength={255}
                required
              />
              <label className="field-label" htmlFor="message">
                Message
              </label>
              <textarea
                id="message"
                className="input textarea"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                required
              />
              <p className="hint">
                Publishes to <code>{PUBLISH_TOPIC}</code>. Listen on that topic
                to see Salesforce accept it.
              </p>
              <button className="button primary" disabled={publishing}>
                {publishing ? "Publishing…" : "Publish event"}
              </button>
              {!listening && (
                <button
                  className="button ghost listen-topic"
                  type="button"
                  onClick={() => setTopic(PUBLISH_TOPIC)}
                >
                  Listen on this topic
                </button>
              )}
              {publishedReplayId && (
                <p className="publish-result">
                  Salesforce accepted the event. Replay ID {publishedReplayId}.
                </p>
              )}
            </form>
          </aside>

          <section className="feed">
            <div className="feed-heading">
              <div>
                <div className="eyebrow">Live event stream</div>
                <h1>Incoming changes</h1>
              </div>
              <div className="event-counts">
                {offlineCount > 0 && (
                  <span className="event-count offline">
                    {offlineCount} published while offline
                  </span>
                )}
                <span className="event-count">{receivedCount} received</span>
              </div>
            </div>

            {error && <Alert message={error} />}
            {events.length === 0 ? (
              <EmptyState listening={listening} />
            ) : (
              <div className="event-list">
                {events.map((event) => (
                  <EventCard event={event} key={event.id} />
                ))}
              </div>
            )}
          </section>
        </section>
      )}
    </main>
  );
}

function LoginPanel(props: {
  clientId: string;
  connecting: boolean;
  error: string | null;
  myDomainUrl: string;
  onClientIdChange: (value: string) => void;
  onDomainChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="login-wrap">
      <div className="login-copy">
        <div className="eyebrow">Live integration demo</div>
        <h1>See Salesforce events the moment they happen.</h1>
        <p>
          Connect an org, subscribe to a platform event topic, and inspect each
          decoded payload in real time.
        </p>
        <ol className="steps">
          <li><span>1</span>Authenticate with Salesforce OAuth</li>
          <li><span>2</span>Paste an event topic</li>
          <li><span>3</span>Change a record and watch the event arrive</li>
        </ol>
      </div>

      <form className="login-card" onSubmit={props.onSubmit}>
        <div>
          <div className="eyebrow">Connect your org</div>
          <h2>Salesforce authentication</h2>
          <p>Uses Authorization Code with PKCE. No client secret is required.</p>
        </div>
        {props.error && <Alert message={props.error} />}
        <label className="field-label" htmlFor="domain">My Domain URL</label>
        <input
          id="domain"
          className="input"
          type="url"
          required
          value={props.myDomainUrl}
          onChange={(event) => props.onDomainChange(event.target.value)}
          placeholder="https://example--sandbox.sandbox.my.salesforce.com"
        />
        <label className="field-label" htmlFor="client-id">Consumer key</label>
        <input
          id="client-id"
          className="input mono"
          required
          value={props.clientId}
          onChange={(event) => props.onClientIdChange(event.target.value)}
          placeholder="3MVG9..."
          autoComplete="off"
        />
        <button className="button primary" disabled={props.connecting}>
          {props.connecting ? "Opening Salesforce…" : "Connect Salesforce"}
        </button>
        <p className="security-note">
          Tokens are encrypted in an HTTP-only cookie and are never exposed to
          browser JavaScript.
        </p>
      </form>
    </section>
  );
}

function EventCard({ event }: { event: DisplayEvent }) {
  const fields =
    event.changes && typeof event.changes.fields === "object"
      ? (event.changes.fields as Record<string, unknown>)
      : null;
  return (
    <article className={`event-card ${event.publishedWhileOffline ? "offline" : ""}`}>
      <div className="event-meta">
        <div>
          <span className="object-pill">{event.objectName}</span>
          <strong>{event.changes?.changeType?.toString() || "EVENT"}</strong>
          {event.publishedWhileOffline && (
            <span className="offline-pill">Published while offline</span>
          )}
        </div>
        <time dateTime={event.receivedAt}>
          {event.publishedAt && `Published ${clockTime(event.publishedAt)} · `}
          Received {clockTime(event.receivedAt)}
        </time>
      </div>

      {event.changes && (
        <div className="identity-grid">
          <Identity label="Salesforce ID" value={event.changes.salesforceId} />
          <Identity label="External ID" value={event.changes.externalId} />
        </div>
      )}

      {event.message && <p className="external-message">{event.message}</p>}

      {fields && Object.keys(fields).length > 0 && (
        <div className="changes">
          {Object.entries(fields).map(([name, value]) => (
            <div className="change-row" key={name}>
              <code>{name}</code>
              <span>{displayValue(value)}</span>
            </div>
          ))}
        </div>
      )}

      <details>
        <summary>Raw event payload</summary>
        <pre>{JSON.stringify(event.payload, null, 2)}</pre>
      </details>
      <div className="replay">Replay ID {event.replayId}</div>
    </article>
  );
}

function Identity({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <span>{label}</span>
      <code>{displayValue(value)}</code>
    </div>
  );
}

function EmptyState({ listening }: { listening: boolean }) {
  return (
    <div className="empty-state">
      <div className="pulse-rings" aria-hidden="true"><span /></div>
      <h2>{listening ? "Listening for changes" : "No events yet"}</h2>
      <p>
        {listening
          ? "Update an Account in Salesforce. The event will appear here."
          : "Start the listener, then make a Salesforce change."}
      </p>
    </div>
  );
}

function TrackingNote({
  tracking,
  committed,
}: {
  tracking: Tracking;
  committed: Commit | null;
}) {
  if (tracking.mode === "unmanaged") {
    return (
      <div className="demo-note">
        <strong>Not tracked by Salesforce</strong>
        <p>
          {tracking.reason} Events published while this app is offline are
          skipped. Deploy a managed subscription named
          <code>{tracking.subscription}</code> to keep them.
        </p>
      </div>
    );
  }
  return (
    <div className="demo-note">
      <strong>Salesforce tracks what this app consumed</strong>
      <p>
        Managed subscription <code>{tracking.subscription}</code>. When the app
        comes back online, Salesforce sends every event published after the
        last one the app committed, for up to 72 hours.
      </p>
      <p>
        {committed
          ? `Last commit: replay ID ${committed.replayId} at ${clockTime(committed.committedAt)}.`
          : "Nothing committed in this session yet."}
      </p>
    </div>
  );
}

function Alert({ message }: { message: string }) {
  return <div className="alert" role="alert">{message}</div>;
}

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <span className="spinner" aria-label="Loading" />
    </main>
  );
}

function displayValue(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function clockTime(isoTime: string): string {
  return new Date(isoTime).toLocaleTimeString();
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isNetworkFailure(error: unknown): boolean {
  return !navigator.onLine || error instanceof TypeError;
}

function waitForConnection(timeoutMilliseconds: number) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("online", done);
      resolve();
    };
    const timer = setTimeout(
      done,
      navigator.onLine ? 2_000 : timeoutMilliseconds,
    );
    window.addEventListener("online", done, { once: true });
  });
}
