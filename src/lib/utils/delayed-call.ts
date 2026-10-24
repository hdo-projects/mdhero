// A call that runs after a delay unless cancelled first. Scheduling again
// replaces the pending call instead of adding a second one.
//
// The tab context menu shows "Copied!" for a moment before it closes. With a
// bare setTimeout, a menu opened again during that moment was closed by the
// first menu's timer.

export interface DelayedCall {
  schedule(): void;
  cancel(): void;
}

export function createDelayedCall(fn: () => void, ms: number): DelayedCall {
  let timer: ReturnType<typeof setTimeout> | undefined;

  function cancel() {
    clearTimeout(timer);
    timer = undefined;
  }

  return {
    schedule() {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        fn();
      }, ms);
    },
    cancel,
  };
}
