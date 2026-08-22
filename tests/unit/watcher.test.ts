import { beforeEach, describe, expect, it, vi } from "vitest";

const listen = vi.fn();
const invoke = vi.fn();
const reloadCurrentFile = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../../src/lib/tauri/files", () => ({ reloadCurrentFile }));
vi.mock("../../src/lib/stores/tabs", () => ({
  tabStore: { getLastSavedAt: vi.fn(() => 0) },
}));

const { startFileWatcher, stopFileWatcher } = await import("../../src/lib/tauri/watcher");

describe("file watcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listen.mockResolvedValue(vi.fn());
    invoke.mockResolvedValue(undefined);
    stopFileWatcher();
  });

  it("restarts the backend watcher when switching between file tabs", async () => {
    await startFileWatcher("C:/docs/a.md");
    await startFileWatcher("C:/docs/b.md");
    await startFileWatcher("C:/docs/a.md");

    expect(invoke).toHaveBeenNthCalledWith(1, "start_watching", { path: "C:/docs/a.md" });
    expect(invoke).toHaveBeenNthCalledWith(2, "start_watching", { path: "C:/docs/b.md" });
    expect(invoke).toHaveBeenNthCalledWith(3, "start_watching", { path: "C:/docs/a.md" });
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(listen).toHaveBeenCalledTimes(3);
  });

  it("unsubscribes the previous event listener when switching files", async () => {
    const firstUnlisten = vi.fn();
    listen.mockResolvedValueOnce(firstUnlisten).mockResolvedValueOnce(vi.fn());

    await startFileWatcher("C:/docs/a.md");
    await startFileWatcher("C:/docs/b.md");

    expect(firstUnlisten).toHaveBeenCalledOnce();
  });
});
