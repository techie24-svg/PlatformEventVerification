import PubSubApiClient from "salesforce-pubsub-api-client";

import type { SalesforceSession } from "@/lib/session";
import { PUBLISH_TOPIC } from "@/lib/validation";

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  instance_url: string;
  id: string;
};

export type StreamMessage =
  | { type: "status"; message: string }
  | { type: "event"; topic: string; replayId: number; receivedAt: string; payload: unknown }
  | { type: "keepalive"; replayId: number | null }
  | { type: "error"; message: string }
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

export function createPubSubClient(session: SalesforceSession): PubSubApiClient {
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
  const client = createPubSubClient(session);
  try {
    await client.connect();
    const result = await client.publish(PUBLISH_TOPIC, {
      Source__c: input.source,
      Message__c: input.message,
    });
    return String(result.replayId);
  } finally {
    client.close();
  }
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
