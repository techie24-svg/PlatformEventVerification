import { NextRequest, NextResponse } from "next/server";

import { exchangeAuthorizationCode } from "@/lib/salesforce";
import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  cookieOptions,
  seal,
  unseal,
  type OAuthState,
} from "@/lib/session";

export async function GET(request: NextRequest) {
  const home = new URL("/", request.url);
  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) {
    home.searchParams.set(
      "error",
      request.nextUrl.searchParams.get("error_description") || oauthError,
    );
    return NextResponse.redirect(home);
  }

  const oauth = await unseal<OAuthState>(
    request.cookies.get(OAUTH_COOKIE)?.value,
  );
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!oauth || !code || !state || state !== oauth.state) {
    home.searchParams.set("error", "The OAuth request expired or its state did not match.");
    return NextResponse.redirect(home);
  }

  try {
    const session = await exchangeAuthorizationCode({
      code,
      verifier: oauth.verifier,
      redirectUri: oauth.redirectUri,
      myDomainUrl: oauth.myDomainUrl,
      clientId: oauth.clientId,
    });
    const response = NextResponse.redirect(home);
    response.cookies.set(SESSION_COOKIE, await seal(session, "8h"), {
      ...cookieOptions,
      maxAge: 8 * 60 * 60,
    });
    response.cookies.delete(OAUTH_COOKIE);
    return response;
  } catch (error) {
    home.searchParams.set(
      "error",
      error instanceof Error ? error.message : "Salesforce login failed.",
    );
    return NextResponse.redirect(home);
  }
}
