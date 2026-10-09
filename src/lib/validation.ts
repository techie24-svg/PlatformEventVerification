import { z } from "zod";

const clientId = z
  .string()
  .trim()
  .min(20, "Enter the consumer key from your Salesforce OAuth app.")
  .max(200);

export const authStartSchema = z.object({
  myDomainUrl: z
    .string()
    .trim()
    .url()
    .transform(normalizeMyDomain),
  clientId,
});

export const eventRequestSchema = z.object({
  topic: z.string().trim().transform(normalizeTopic),
  replayId: z.number().int().nonnegative().nullable().optional(),
});

export function normalizeMyDomain(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !url.hostname.toLowerCase().endsWith(".my.salesforce.com")
  ) {
    throw new Error("Use the HTTPS My Domain URL for your Salesforce org.");
  }
  return url.origin;
}

export function normalizeTopic(value: string): string {
  let topic = value.trim();
  try {
    const url = new URL(topic);
    topic = url.pathname;
  } catch {
    // A topic path is expected most of the time, so a URL parse failure is normal.
  }

  if (!topic.startsWith("/")) {
    topic = `/${topic}`;
  }
  if (!/^\/event\/[A-Za-z][A-Za-z0-9_]*__e$/.test(topic)) {
    throw new Error(
      "Use a platform event topic such as /event/Avantos_Integration__e.",
    );
  }
  return topic;
}
