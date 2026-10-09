import { createHash, randomBytes } from "node:crypto";

import { EncryptJWT, jwtDecrypt } from "jose";

export const SESSION_COOKIE = "pev_session";
export const OAUTH_COOKIE = "pev_oauth";

export type SalesforceSession = {
  accessToken: string;
  refreshToken?: string;
  instanceUrl: string;
  organizationId: string;
  myDomainUrl: string;
  clientId: string;
};

export type OAuthState = {
  state: string;
  verifier: string;
  myDomainUrl: string;
  clientId: string;
  redirectUri: string;
};

function encryptionKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }
  return createHash("sha256").update(secret).digest();
}

export async function seal(
  value: SalesforceSession | OAuthState,
  lifetime: string,
): Promise<string> {
  return new EncryptJWT({ data: value })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(lifetime)
    .encrypt(encryptionKey());
}

export async function unseal<T>(token?: string): Promise<T | null> {
  if (!token) {
    return null;
  }
  try {
    const { payload } = await jwtDecrypt(token, encryptionKey());
    return payload.data as T;
  } catch {
    return null;
  }
}

export function randomUrlSafe(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
