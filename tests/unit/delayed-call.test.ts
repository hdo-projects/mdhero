import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDelayedCall } from "../../src/lib/utils/delayed-call";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createDelayedCall", () => {
  it("runs the call once the delay has passed", () => {
    const fn = vi.fn();
    createDelayedCall(fn, 900).schedule();
    vi.advanceTimersByTime(899);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("does not run a cancelled call", () => {
    const fn = vi.fn();
    const call = createDelayedCall(fn, 900);
    call.schedule();
    call.cancel();
    vi.advanceTimersByTime(2000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("replaces the pending call when scheduled again", () => {
    const fn = vi.fn();
    const call = createDelayedCall(fn, 900);
    call.schedule();
    vi.advanceTimersByTime(500);
    call.schedule();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("can be scheduled again after it has run", () => {
    const fn = vi.fn();
    const call = createDelayedCall(fn, 900);
    call.schedule();
    vi.advanceTimersByTime(900);
    call.schedule();
    vi.advanceTimersByTime(900);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

/**
 * After Copy Path, the tab menu showed "Copied!" and closed 900ms later. A menu
 * opened again within those 900ms (right-click on the same or another tab) was
 * closed by that timer.
 */
describe("tab context menu", () => {
  const tabBar = readFileSync(resolve(process.cwd(), "src/lib/components/TabBar.svelte"), "utf8")
    .replace(/\r\n/g, "\n");

  it("closes after feedback through the cancellable call, not a bare setTimeout", () => {
    expect(tabBar).not.toMatch(/setTimeout\(\s*closeContextMenu/);
    expect(tabBar).toContain("closeAfterFeedback.schedule()");
  });

  it("cancels the pending close when a menu opens", () => {
    const start = tabBar.indexOf("function handleContextMenu");
    expect(start, "handleContextMenu not found").toBeGreaterThan(-1);
    const end = tabBar.indexOf("\n  }\n", start);
    expect(end, "end of handleContextMenu not found").toBeGreaterThan(start);
    expect(tabBar.slice(start, end)).toContain("closeAfterFeedback.cancel()");
  });
});
