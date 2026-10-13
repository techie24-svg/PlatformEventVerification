import { describe, expect, it } from "vitest";

import {
  managedFallbackReason,
  managedSubscriptionName,
} from "@/lib/managed-subscription";

describe("managedSubscriptionName", () => {
  it("names the managed subscription after the platform event", () => {
    expect(managedSubscriptionName("/event/Avantos_Integration__e")).toBe(
      "PEV_Avantos_Integration",
    );
    expect(managedSubscriptionName("/event/External_Demo__e")).toBe(
      "PEV_External_Demo",
    );
  });

  it("collapses a namespace separator so the developer name stays valid", () => {
    expect(managedSubscriptionName("/event/acme__Order__e")).toBe(
      "PEV_acme_Order",
    );
  });
});

describe("managedFallbackReason", () => {
  it("explains a missing managed subscription", () => {
    const error = new Error(
      "Failed to retrieve managed event subscription with DeveloperName='PEV_Other'",
    );
    expect(managedFallbackReason("PEV_Other", error)).toBe(
      "No managed subscription named PEV_Other exists for this topic.",
    );
  });

  it("keeps the underlying cause of any other failure", () => {
    const error = new Error("Failed to subscribe to managed subscription", {
      cause: new Error("subscription is in STOP state"),
    });
    expect(managedFallbackReason("PEV_Other", error)).toBe(
      "Failed to subscribe to managed subscription subscription is in STOP state",
    );
  });
});
