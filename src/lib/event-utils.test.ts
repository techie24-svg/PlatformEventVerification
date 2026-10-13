import { describe, expect, it } from "vitest";

import { createdDate, parseChanges, toDisplayEvent } from "@/lib/event-utils";

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

  it("flags an event Salesforce published before the app started listening", () => {
    const listeningSince = Date.parse("2026-10-13T15:30:00.000Z");
    const missed = toDisplayEvent({
      topic: "/event/Avantos_Integration__e",
      replayId: 8,
      receivedAt: "2026-10-13T15:30:02.000Z",
      payload: { CreatedDate: Date.parse("2026-10-13T15:15:01.217Z") },
      listeningSince,
    });
    const live = toDisplayEvent({
      topic: "/event/Avantos_Integration__e",
      replayId: 9,
      receivedAt: "2026-10-13T15:31:00.500Z",
      payload: { CreatedDate: String(Date.parse("2026-10-13T15:31:00.000Z")) },
      listeningSince,
    });

    expect(missed.publishedAt).toBe("2026-10-13T15:15:01.217Z");
    expect(missed.publishedWhileOffline).toBe(true);
    expect(live.publishedWhileOffline).toBe(false);
  });
});

describe("createdDate", () => {
  it("reads the event's CreatedDate as milliseconds, numeric or text", () => {
    const milliseconds = Date.parse("2026-10-13T15:15:01.217Z");
    expect(createdDate(milliseconds)).toBe("2026-10-13T15:15:01.217Z");
    expect(createdDate(String(milliseconds))).toBe("2026-10-13T15:15:01.217Z");
  });

  it("returns null when the payload has no usable CreatedDate", () => {
    expect(createdDate(undefined)).toBeNull();
    expect(createdDate("not a date")).toBeNull();
  });
});
