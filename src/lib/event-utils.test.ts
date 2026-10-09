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
    expect(event.source).toBeNull();
    expect(event.message).toBeNull();
    expect(event.changes).toEqual({
      changeType: "UPDATE",
      fields: { Phone: "222" },
    });
  });

  it("shows the external publisher and message when those fields are present", () => {
    const event = toDisplayEvent({
      topic: "/event/External_Demo__e",
      replayId: 7,
      receivedAt: "2026-10-09T21:00:00.000Z",
      payload: {
        Source__c: { string: "External service" },
        Message__c: { string: "Phone changed to 222" },
      },
    });

    expect(event.objectName).toBe("External service");
    expect(event.source).toBe("External service");
    expect(event.message).toBe("Phone changed to 222");
  });
});
