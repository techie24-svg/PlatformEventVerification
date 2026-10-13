import { NextRequest, NextResponse } from "next/server";

import { trackStreamingCalls } from "@/lib/grpc-calls";
import {
  managedFallbackReason,
  managedSubscriptionName,
} from "@/lib/managed-subscription";
import {
  createPubSubClient,
  jsonSafe,
  type StreamMessage,
  type Tracking,
} from "@/lib/salesforce";
import {
  SESSION_COOKIE,
  unseal,
  type SalesforceSession,
} from "@/lib/session";
import { eventRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WINDOW_MS = 50_000;
const COMMIT_DELAY_MS = 250;
const COMMIT_FLUSH_MS = 500;
// Commit responses also arrive as keepalives with an ever-advancing replay ID.
const KEEPALIVE_COMMIT_INTERVAL_MS = 30_000;
const GRPC_ALREADY_EXISTS = 6;
const GRPC_UNAVAILABLE = 14;
const encoder = new TextEncoder();

type SubscriptionInfo = {
  subscriptionId?: string;
  lastReplayId?: number | null;
};

export async function POST(request: NextRequest) {
  const session = await unseal<SalesforceSession>(
    request.cookies.get(SESSION_COOKIE)?.value,
  );
  if (!session) {
    return NextResponse.json(
      { error: "Your Salesforce session has expired. Connect again." },
      { status: 401 },
    );
  }

  let input: ReturnType<typeof eventRequestSchema.parse>;
  try {
    input = eventRequestSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid topic." },
      { status: 400 },
    );
  }

  const client = createPubSubClient(session);
  const calls = trackStreamingCalls();
  try {
    await client.connect();
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not connect to Salesforce Pub/Sub API.",
      },
      { status: 502 },
    );
  }

  let latestReplayId = input.replayId ?? null;
  let deliveredReplayId: number | null = null;
  let committedReplayId: number | null = null;
  let managedSubscriptionId: string | null = null;
  let lastKeepaliveCommitAt = 0;
  let closed = false;
  let commitTimer: ReturnType<typeof setTimeout> | undefined;
  let windowTimer: ReturnType<typeof setTimeout> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (message: StreamMessage) => {
        if (!closed) {
          controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
        }
      };
      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        clearTimeout(commitTimer);
        clearTimeout(windowTimer);
        calls.cancelAll();
        client.close();
        controller.close();
      };
      const commit = (replayId: number | null) => {
        if (
          closed ||
          !managedSubscriptionId ||
          replayId == null ||
          (committedReplayId != null && replayId <= committedReplayId)
        ) {
          return;
        }
        client.commitReplayId(managedSubscriptionId, replayId);
        committedReplayId = replayId;
        send({
          type: "commit",
          replayId,
          committedAt: new Date().toISOString(),
        });
      };

      const callback = (
        info: SubscriptionInfo,
        callbackType: string,
        data?: Record<string, unknown>,
      ) => {
        if (info?.subscriptionId) {
          managedSubscriptionId = info.subscriptionId;
        }
        if (callbackType === "event" && data) {
          const replayId = Number(data.replayId);
          if (Number.isFinite(replayId)) {
            latestReplayId = replayId;
            deliveredReplayId = replayId;
          }
          send({
            type: "event",
            topic: input.topic,
            replayId: latestReplayId ?? 0,
            receivedAt: new Date().toISOString(),
            payload: jsonSafe(data.payload),
          });
          if (managedSubscriptionId && !commitTimer) {
            commitTimer = setTimeout(() => {
              commitTimer = undefined;
              commit(deliveredReplayId);
            }, COMMIT_DELAY_MS);
          }
          return;
        }
        if (callbackType === "grpcKeepAlive") {
          const replayId = Number(info?.lastReplayId);
          if (Number.isFinite(replayId)) {
            latestReplayId = replayId;
          }
          send({ type: "keepalive", replayId: latestReplayId });
          const now = Date.now();
          if (!commitTimer && now - lastKeepaliveCommitAt >= KEEPALIVE_COMMIT_INTERVAL_MS) {
            lastKeepaliveCommitAt = now;
            commit(latestReplayId);
          }
          return;
        }
        if (callbackType === "error") {
          send({
            type: "error",
            message: errorMessage(data),
            retryable:
              data?.code === GRPC_ALREADY_EXISTS ||
              data?.code === GRPC_UNAVAILABLE,
          });
          close();
          return;
        }
        if (callbackType === "end") {
          send({ type: "end", replayId: latestReplayId });
          close();
        }
      };

      const subscription = managedSubscriptionName(input.topic);
      let tracking: Tracking;
      try {
        await calls.run(() =>
          client.subscribeWithManagedSubscription(subscription, callback, null),
        );
        tracking = { mode: "managed", subscription };
      } catch (error) {
        tracking = {
          mode: "unmanaged",
          subscription,
          reason: managedFallbackReason(subscription, error),
        };
        calls.run(() => {
          if (input.replayId == null) {
            client.subscribe(input.topic, callback, null);
          } else {
            client.subscribeFromReplayId(
              input.topic,
              callback,
              null,
              input.replayId,
            );
          }
        });
      }
      send({
        type: "status",
        message: `Subscribed to ${input.topic}`,
        tracking,
      });

      windowTimer = setTimeout(() => {
        clearTimeout(commitTimer);
        commitTimer = undefined;
        commit(deliveredReplayId);
        setTimeout(
          () => {
            send({ type: "end", replayId: latestReplayId });
            close();
          },
          tracking.mode === "managed" ? COMMIT_FLUSH_MS : 0,
        );
      }, WINDOW_MS);

      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      closed = true;
      clearTimeout(commitTimer);
      clearTimeout(windowTimer);
      calls.cancelAll();
      client.close();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-content-type-options": "nosniff",
    },
  });
}

function errorMessage(data?: Record<string, unknown>): string {
  if (!data) {
    return "The Salesforce subscription ended unexpectedly.";
  }
  const message = data.message;
  return typeof message === "string"
    ? message
    : "The Salesforce subscription ended unexpectedly.";
}
