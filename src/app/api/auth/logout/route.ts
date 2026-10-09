import { NextResponse } from "next/server";

import { OAUTH_COOKIE, SESSION_COOKIE } from "@/lib/session";

export async function POST() {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(OAUTH_COOKIE);
  return response;
}
