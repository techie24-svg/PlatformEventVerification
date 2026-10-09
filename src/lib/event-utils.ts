export type DisplayEvent = {
  id: string;
  topic: string;
  replayId: number;
  receivedAt: string;
  objectName: string;
  payload: Record<string, unknown>;
  changes: Record<string, unknown> | null;
};

export function toDisplayEvent(input: {
  topic: string;
  replayId: number;
  receivedAt: string;
  payload: unknown;
}): DisplayEvent {
  const payload = isRecord(input.payload) ? input.payload : {};
  return {
    id: `${input.replayId}-${input.receivedAt}`,
    topic: input.topic,
    replayId: input.replayId,
    receivedAt: input.receivedAt,
    objectName: stringValue(payload.Object__c) || "Platform event",
    payload,
    changes: parseChanges(payload.Changes__c),
  };
}

export function parseChanges(value: unknown): Record<string, unknown> | null {
  const raw = unwrapNullable(value);
  if (typeof raw !== "string") {
    return isRecord(raw) ? raw : null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return { value: raw };
  }
}

function stringValue(value: unknown): string | null {
  const unwrapped = unwrapNullable(value);
  return typeof unwrapped === "string" ? unwrapped : null;
}

function unwrapNullable(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const entries = Object.entries(value);
  return entries.length === 1 ? entries[0][1] : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
