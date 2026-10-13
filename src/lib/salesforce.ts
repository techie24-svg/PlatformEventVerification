import type { Interceptor } from "@grpc/grpc-js";
import PubSubApiClient from "salesforce-pubsub-api-client";

import {
  EXTERNAL_EVENT_TOPIC,
  externalEventPayload,
} from "@/lib/external-event";
import type { SalesforceSession } from "@/lib/session";

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  instance_url: string;
  id: string;
};

export type Tracking =
  | { mode: "managed"; subscription: string }
  | { mode: "unmanaged"; subscription: string; reason: string };

export type StreamMessage =
  | { type: "status"; message: string; tracking: Tracking }
  | { type: "event"; topic: string; replayId: number; receivedAt: string; payload: unknown }
  | { type: "keepalive"; replayId: number | null }
  | { type: "commit"; replayId: number; committedAt: string }
  | { type: "error"; message: string; retryable: boolean }
  | { type: "end"; replayId: number | null };

export async function exchangeAuthorizationCode(input: {
  code: string;
  verifier: string;
  redirectUri: string;
  myDomainUrl: string;
  clientId: string;
}): Promise<SalesforceSession> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
  });
  const response = await fetch(
    `${input.myDomainUrl}/services/oauth2/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    },
  );
  const data = (await response.json()) as TokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Salesforce login failed.");
  }

  const organizationId = organizationIdFromIdentityUrl(data.id);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    instanceUrl: data.instance_url,
    organizationId,
    myDomainUrl: input.myDomainUrl,
    clientId: input.clientId,
  };
}

function organizationIdFromIdentityUrl(identityUrl: string): string {
  const parts = new URL(identityUrl).pathname.split("/").filter(Boolean);
  const idIndex = parts.indexOf("id");
  const organizationId = idIndex >= 0 ? parts[idIndex + 1] : undefined;
  if (!organizationId) {
    throw new Error("Salesforce did not return an organization ID.");
  }
  return organizationId;
}

export function createPubSubClient(
  session: SalesforceSession,
  interceptors: Interceptor[] = [],
): PubSubApiClient {
  return new PubSubApiClient(
    {
      authType: "user-supplied",
      accessToken: session.accessToken,
      instanceUrl: session.instanceUrl,
      organizationId: session.organizationId,
      grpcChannelOptions: {
        "grpc.keepalive_time_ms": 30_000,
        "grpc.keepalive_timeout_ms": 10_000,
        "grpc.keepalive_permit_without_calls": 1,
        interceptors,
      },
    },
    {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  );
}

export async function publishExternalEvent(
  session: SalesforceSession,
  input: { source: string; message: string },
): Promise<string> {
  const createdById = await salesforceUserId(session);
  const client = createPubSubClient(session);
  try {
    await client.connect();
    const result = await client.publish(
      EXTERNAL_EVENT_TOPIC,
      externalEventPayload({ ...input, createdById }),
    );
    return String(result.replayId);
  } finally {
    client.close();
  }
}

async function salesforceUserId(session: SalesforceSession): Promise<string> {
  const response = await fetch(`${session.instanceUrl}/services/oauth2/userinfo`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });
  const data = (await response.json()) as { user_id?: string; error?: string };
  if (!response.ok || !data.user_id) {
    throw new Error(data.error || "Salesforce did not return the signed-in user.");
  }
  return data.user_id;
}

export function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(jsonSafe);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, jsonSafe(nested)]),
    );
  }
  return value;
}
