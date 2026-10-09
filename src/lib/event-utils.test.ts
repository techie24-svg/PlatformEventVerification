import { describe, expect, it } from "vitest";

import { parseChanges, toDisplayEvent } from "@/lib/event-utils";

describe("parseChanges", () => {
  it("parses the JSON stored in Changes__c", () => {
    expect(
      parseChanges(
        '{"salesforceId":"001xx","fields":{"Name":"New name","Phone":"222"}}',
      ),
    ).toEqual({
      salesforceId: "001xx",
      fields: { Name: "New name", Phone: "222" },
    });
  });

  it("unwraps nullable Avro unions", () => {
    expect(parseChanges({ string: '{"fields":{"Phone":"222"}}' })).toEqual({
      fields: { Phone: "222" },
    });
  });
});

describe("toDisplayEvent", () => {
  it("extracts object and change details from a decoded platform event", () => {
    const event = toDisplayEvent({
      topic: "/event/Avantos_Integration__e",
      replayId: 42,
      receivedAt: "2026-10-09T20:00:00.000Z",
      payload: {
        Object__c: { string: "Account" },
        Changes__c: {
          string: '{"changeType":"UPDATE","fields":{"Phone":"222"}}',
        },
      },
    });

    expect(event.objectName).toBe("Account");
    expect(event.changes).toEqual({
      changeType: "UPDATE",
      fields: { Phone: "222" },
    });
  });
});
