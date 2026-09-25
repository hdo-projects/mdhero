import { describe, expect, it } from "vitest";
import { isWindows, modifierKeyLabel } from "../../src/lib/utils/platform";

// Every shortcut label used to be hardcoded "Cmd" (#62's Ubuntu screenshot
// shows `Cmd+O` on the Linux home screen). The label is now derived from the
// platform string, which is what these pin down.
describe("modifierKeyLabel", () => {
  it("is Cmd on macOS", () => {
    expect(modifierKeyLabel("MacIntel")).toBe("Cmd");
    expect(modifierKeyLabel("macOS")).toBe("Cmd");
  });

  it("is Ctrl on Windows and Linux", () => {
    expect(modifierKeyLabel("Win32")).toBe("Ctrl");
    expect(modifierKeyLabel("Linux x86_64")).toBe("Ctrl");
    expect(modifierKeyLabel("Linux aarch64")).toBe("Ctrl");
  });

  it("falls back to Ctrl when the platform is unknown", () => {
    // An unknown platform must not claim a Command key it may not have.
    expect(modifierKeyLabel("")).toBe("Ctrl");
  });
});

// Only Windows offers to hide the menu bar from the toolbar's right-click: the
// macOS menu is the system's, and GTK drops a hidden menu bar's shortcuts.
describe("isWindows", () => {
  it("is true on Windows", () => {
    expect(isWindows("Win32")).toBe(true);
    expect(isWindows("Win64")).toBe(true);
  });

  it("is false on macOS, Linux and an unknown platform", () => {
    expect(isWindows("MacIntel")).toBe(false);
    expect(isWindows("Linux x86_64")).toBe(false);
    expect(isWindows("")).toBe(false);
  });
});
