const PREFIX = "PEV_";

/**
 * Developer name of the ManagedEventSubscription that tracks a topic for this app,
 * for example /event/Avantos_Integration__e -> PEV_Avantos_Integration.
 */
export function managedSubscriptionName(topic: string): string {
  const eventName = topic.replace(/^\/event\//, "").replace(/__e$/, "");
  return `${PREFIX}${eventName.replace(/_{2,}/g, "_")}`;
}

export function managedFallbackReason(subscription: string, error: unknown): string {
  const message = errorText(error);
  if (/Failed to retrieve managed event subscription/i.test(message)) {
    return `No managed subscription named ${subscription} exists for this topic.`;
  }
  return message || `Managed subscription ${subscription} could not be started.`;
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) {
    return "";
  }
  const cause = error.cause instanceof Error ? ` ${error.cause.message}` : "";
  return `${error.message}${cause}`.trim();
}
