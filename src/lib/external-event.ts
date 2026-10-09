export const EXTERNAL_EVENT_TOPIC = "/event/External_Demo__e";

export function externalEventPayload(input: {
  source: string;
  message: string;
  createdById: string;
  createdDate?: number;
}): Record<string, unknown> {
  return {
    CreatedDate: input.createdDate ?? Date.now(),
    CreatedById: input.createdById,
    Source__c: { string: input.source },
    Message__c: { string: input.message },
  };
}

export function errorText(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }
  const cause = error.cause instanceof Error ? error.cause.message : undefined;
  return cause ? `${error.message}: ${cause}` : error.message;
}
