import { describe, expect, it } from "vitest";

import {
  normalizeMyDomain,
  normalizeTopic,
  publishRequestSchema,
} from "@/lib/validation";

describe("normalizeTopic", () => {
  it("accepts a platform event topic", () => {
    expect(normalizeTopic("/event/Avantos_Integration__e")).toBe(
      "/event/Avantos_Integration__e",
    );
  });

  it("accepts an event path without a leading slash", () => {
    expect(normalizeTopic("event/Avantos_Integration__e")).toBe(
      "/event/Avantos_Integration__e",
    );
  });

  it("rejects a CDC channel for this platform-event demo", () => {
    expect(() => normalizeTopic("/data/AccountChangeEvent")).toThrow(
      "platform event topic",
    );
  });
});

describe("publishRequestSchema", () => {
  it("accepts a source and a message from an external publisher", () => {
    expect(
      publishRequestSchema.parse({
        source: " External service ",
        message: " Account phone changed ",
      }),
    ).toEqual({
      source: "External service",
      message: "Account phone changed",
    });
  });

  it("rejects an empty message", () => {
    expect(() =>
      publishRequestSchema.parse({ source: "External service", message: " " }),
    ).toThrow();
  });
});

describe("normalizeMyDomain", () => {
  it("accepts production and sandbox My Domain URLs", () => {
    expect(normalizeMyDomain("https://example.my.salesforce.com/path")).toBe(
      "https://example.my.salesforce.com",
    );
    expect(
      normalizeMyDomain(
        "https://example--demo.sandbox.my.salesforce.com",
      ),
    ).toBe("https://example--demo.sandbox.my.salesforce.com");
  });

  it("blocks non-Salesforce hosts and insecure URLs", () => {
    expect(() => normalizeMyDomain("https://example.com")).toThrow();
    expect(() =>
      normalizeMyDomain("http://example.my.salesforce.com"),
    ).toThrow();
  });
});
