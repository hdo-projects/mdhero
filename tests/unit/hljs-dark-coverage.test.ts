import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Regression guard for #67 — dark-mode syntax highlighting.
 *
 * The bug: the dark override in MarkdownRenderer.svelte listed only a hand-picked
 * subset of highlight.js token classes. Every class the light `github` theme
 * coloured but the dark override missed kept its LIGHT colour against the forced
 * #0d1117 background. `.hljs-subst` / `.hljs-emphasis` / `.hljs-strong` are
 * #24292e — a contrast ratio of 1.29:1, i.e. invisible.
 *
 * Two independent assertions, because either alone can pass while the bug is live:
 *   1. Coverage — every class the light theme styles has a dark-mode rule. Catches
 *      a highlight.js upgrade introducing a class we don't override.
 *   2. Contrast — every dark-mode text colour clears WCAG AA (4.5:1) against the
 *      code-block background. Catches a rule that exists but is unreadable, which
 *      is the actual user-visible defect.
 */

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

const COMPONENT = resolve(here, "../../src/lib/components/MarkdownRenderer.svelte");
const LIGHT_THEME = require.resolve("highlight.js/styles/github.min.css");

const CODE_BG = "#0d1117";
const WCAG_AA_NORMAL_TEXT = 4.5;

function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Every `hljs-*` class name mentioned in a chunk of CSS.
 *
 * The character class must include `-`, or compound names collapse:
 * `hljs-selector-attr` would truncate to `hljs-selector` and the comparison
 * would run at a coarser granularity than it appears to, letting a partially
 * covered group (say `selector-attr` but not `selector-class`) pass.
 */
function hljsClasses(css: string): Set<string> {
  return new Set(css.match(/hljs-[a-zA-Z0-9_-]+/g) ?? []);
}

/** The component's dark-mode block: from the override comment to the Mermaid section. */
function darkModeBlock(): string {
  const source = readFileSync(COMPONENT, "utf8");
  const start = source.indexOf("/* Code block dark mode override");
  const end = source.indexOf("/* Mermaid */");
  expect(start, "dark-mode override block not found in MarkdownRenderer.svelte").toBeGreaterThan(-1);
  expect(end, "Mermaid section not found — block boundary changed").toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("#67 — dark-mode highlight.js coverage", () => {
  it("overrides every token class the light theme colours", () => {
    const light = hljsClasses(readFileSync(LIGHT_THEME, "utf8"));
    const dark = hljsClasses(darkModeBlock());

    // Sanity-check the extraction itself, so a regex that silently matches
    // nothing can't make this test vacuously pass.
    expect(light.size).toBeGreaterThan(20);

    const missing = [...light].filter((c) => !dark.has(c)).sort();
    expect(
      missing,
      `these classes are styled by the light theme but have no dark-mode rule, so ` +
        `they keep their light colour on ${CODE_BG}: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("gives every dark-mode token colour readable contrast on the code background", () => {
    const block = darkModeBlock();

    // `color:` only. background-color values (.hljs-addition / .hljs-deletion)
    // are deliberately dark and are not text.
    const colours = [...block.matchAll(/(?<!background-)color:\s*(#[0-9a-fA-F]{6})/g)].map(
      (m) => m[1].toLowerCase()
    );
    expect(colours.length).toBeGreaterThan(10);

    const failures = [...new Set(colours)]
      .map((c) => ({ colour: c, ratio: contrastRatio(c, CODE_BG) }))
      .filter(({ ratio }) => ratio < WCAG_AA_NORMAL_TEXT)
      .map(({ colour, ratio }) => `${colour} (${ratio.toFixed(2)}:1)`);

    expect(
      failures,
      `these dark-mode colours fall below WCAG AA ${WCAG_AA_NORMAL_TEXT}:1 against ` +
        `${CODE_BG}: ${failures.join(", ")}`
    ).toEqual([]);
  });

  it("detects the specific colours that made #67 invisible", () => {
    // Guards the guard: if these light-theme values ever reappear as dark-mode
    // text colours, the contrast assertion above must fail. #24292e is the one
    // from the bug report (.hljs-subst on a near-black background).
    const leakedLightColours = ["#24292e", "#032f62", "#735c0f"];
    for (const leaked of leakedLightColours) {
      expect(contrastRatio(leaked, CODE_BG)).toBeLessThan(WCAG_AA_NORMAL_TEXT);
    }

    // Match declarations, not raw text — the block's own comment cites #24292e
    // as the offending value, and that documentation should not fail the test.
    const declared = [...darkModeBlock().matchAll(/color:\s*(#[0-9a-fA-F]{6})/g)].map((m) =>
      m[1].toLowerCase()
    );
    expect(declared.filter((c) => leakedLightColours.includes(c))).toEqual([]);
  });
});
