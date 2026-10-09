import { describe, expect, it } from "vitest";

import { externalEventPayload } from "@/lib/external-event";

describe("externalEventPayload", () => {
  it("encodes nullable platform event fields as Avro unions", () => {
    expect(
      externalEventPayload({
        source: "External service",
        message: "Phone changed to 222",
        createdById: "005000000000001AAA",
        createdDate: 1_000,
      }),
    ).toEqual({
      CreatedDate: 1_000,
      CreatedById: "005000000000001AAA",
      Source__c: { string: "External service" },
      Message__c: { string: "Phone changed to 222" },
    });
  });
});
