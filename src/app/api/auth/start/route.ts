import { NextResponse } from "next/server";

import {
  OAUTH_COOKIE,
  codeChallenge,
  cookieOptions,
  randomUrlSafe,
  seal,
} from "@/lib/session";
import { authStartSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const input = authStartSchema.parse(await request.json());
    const state = randomUrlSafe();
    const verifier = randomUrlSafe(48);
    const redirectUri = `${new URL(request.url).origin}/api/auth/callback`;
    const authorizeUrl = new URL(
      `${input.myDomainUrl}/services/oauth2/authorize`,
    );
    authorizeUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: input.clientId,
      redirect_uri: redirectUri,
      scope: "api refresh_token",
      state,
      code_challenge: codeChallenge(verifier),
      code_challenge_method: "S256",
    }).toString();

    const response = NextResponse.json({
      authorizeUrl: authorizeUrl.toString(),
    });
    response.cookies.set(
      OAUTH_COOKIE,
      await seal(
        {
          state,
          verifier,
          myDomainUrl: input.myDomainUrl,
          clientId: input.clientId,
          redirectUri,
        },
        "10m",
      ),
      { ...cookieOptions, maxAge: 10 * 60 },
    );
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid login request." },
      { status: 400 },
    );
  }
}
