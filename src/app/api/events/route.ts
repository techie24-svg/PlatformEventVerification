import { NextRequest, NextResponse } from "next/server";

import {
  createPubSubClient,
  jsonSafe,
  type StreamMessage,
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
const encoder = new TextEncoder();

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
  let closed = false;
  let timer: ReturnType<typeof setTimeout>;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
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
        clearTimeout(timer);
        client.close();
        controller.close();
      };

      send({ type: "status", message: `Subscribed to ${input.topic}` });

      const callback = (
        _subscription: unknown,
        callbackType: string,
        data?: Record<string, unknown>,
      ) => {
        if (callbackType === "event" && data) {
          const replayId = Number(data.replayId);
          latestReplayId = Number.isFinite(replayId)
            ? replayId
            : latestReplayId;
          send({
            type: "event",
            topic: input.topic,
            replayId: latestReplayId ?? 0,
            receivedAt: new Date().toISOString(),
            payload: jsonSafe(data.payload),
          });
          return;
        }
        if (callbackType === "grpcKeepalive") {
          const replayId = Number(data?.latestReplayId);
          latestReplayId = Number.isFinite(replayId)
            ? replayId
            : latestReplayId;
          send({ type: "keepalive", replayId: latestReplayId });
          return;
        }
        if (callbackType === "error") {
          send({
            type: "error",
            message: errorMessage(data),
          });
          close();
        }
      };

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

      timer = setTimeout(() => {
        send({ type: "end", replayId: latestReplayId });
        close();
      }, WINDOW_MS);

      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      closed = true;
      clearTimeout(timer);
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
