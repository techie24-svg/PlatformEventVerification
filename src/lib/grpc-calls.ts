import { InterceptingCall, status, type Interceptor } from "@grpc/grpc-js";

// salesforce-pubsub-api-client's close() only closes the channel, and grpc-js lets calls that
// already started keep running. A leftover ManagedSubscribe call keeps its managed subscription
// busy (ALREADY_EXISTS) and a leftover Subscribe call keeps consuming event deliveries, so each
// client records the calls it opens and cancels them when its request ends.
export function callTracker() {
  const calls = new Set<InterceptingCall>();
  const interceptor: Interceptor = (options, nextCall) => {
    const call = new InterceptingCall(nextCall(options));
    calls.add(call);
    return call;
  };
  return {
    interceptor,
    cancelAll() {
      for (const call of calls) {
        call.cancelWithStatus(status.CANCELLED, "Subscription window closed");
      }
      calls.clear();
    },
  };
}
