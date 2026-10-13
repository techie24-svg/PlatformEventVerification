import { AsyncLocalStorage } from "node:async_hooks";

import { Client } from "@grpc/grpc-js";

type StreamingCall = {
  cancel(): void;
  on(event: "error", listener: () => void): unknown;
};
type MakeBidiStreamRequest = (...args: unknown[]) => StreamingCall;

const openedCalls = new AsyncLocalStorage<Set<StreamingCall>>();
const PATCHED = Symbol.for("platform-event-verification.track-streaming-calls");

// salesforce-pubsub-api-client's close() only closes the channel, and grpc-js lets calls that
// already started keep running. A leftover ManagedSubscribe call keeps its managed subscription
// busy (ALREADY_EXISTS) and a leftover Subscribe call keeps consuming event deliveries, so the
// streaming calls a request opens are recorded here and cancelled when the request ends.
const clientPrototype = Client.prototype as unknown as {
  makeBidiStreamRequest: MakeBidiStreamRequest;
  [PATCHED]?: true;
};
if (!clientPrototype[PATCHED]) {
  const makeBidiStreamRequest = clientPrototype.makeBidiStreamRequest;
  clientPrototype.makeBidiStreamRequest = function (this: unknown, ...args: unknown[]) {
    const call = makeBidiStreamRequest.apply(this, args);
    openedCalls.getStore()?.add(call);
    return call;
  };
  clientPrototype[PATCHED] = true;
}

export function trackStreamingCalls() {
  const calls = new Set<StreamingCall>();
  return {
    run<T>(work: () => T): T {
      return openedCalls.run(calls, work);
    },
    cancelAll() {
      for (const call of calls) {
        call.on("error", () => undefined);
        call.cancel();
      }
      calls.clear();
    },
  };
}
