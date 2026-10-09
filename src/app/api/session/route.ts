import { NextRequest, NextResponse } from "next/server";

import {
  SESSION_COOKIE,
  unseal,
  type SalesforceSession,
} from "@/lib/session";

export async function GET(request: NextRequest) {
  const session = await unseal<SalesforceSession>(
    request.cookies.get(SESSION_COOKIE)?.value,
  );
  if (!session) {
    return NextResponse.json({ authenticated: false });
  }
  return NextResponse.json({
    authenticated: true,
    instanceUrl: session.instanceUrl,
    organizationId: session.organizationId,
  });
}
