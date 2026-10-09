import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { publishExternalEvent } from "@/lib/salesforce";
import {
  SESSION_COOKIE,
  unseal,
  type SalesforceSession,
} from "@/lib/session";
import { PUBLISH_TOPIC, publishRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

  let input: ReturnType<typeof publishRequestSchema.parse>;
  try {
    input = publishRequestSchema.parse(await request.json());
  } catch (error) {
    const zodMessage = error instanceof ZodError ? error.issues[0]?.message : undefined;
    return NextResponse.json(
      {
        error:
          zodMessage ||
          (error instanceof Error ? error.message : "Invalid event."),
      },
      { status: 400 },
    );
  }

  try {
    const replayId = await publishExternalEvent(session, input);
    return NextResponse.json({ topic: PUBLISH_TOPIC, replayId });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Salesforce did not accept the event.",
      },
      { status: 502 },
    );
  }
}
