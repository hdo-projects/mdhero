import { describe, it, expect, vi } from "vitest";

// The unit env is node (no DOM), so DOMPurify can't run. It only sanitizes, and
// every assertion here is about what markdown-it produced *before* that step, so
// a passthrough stub is faithful. Sanitization itself is covered elsewhere.
vi.mock("dompurify", () => ({ default: { sanitize: (html: string) => html } }));

const { render, renderFull, stripFrontmatter, isMarpDoc } =
  await import("../../src/lib/renderer/pipeline");

// #122: files saved as "UTF-8 with BOM" (Notepad's Save As, and many other
// producers) begin with U+FEFF. It is valid UTF-8, so it survives the read on
// both hosts and reaches markdown-it, where it makes the first line start with
// something other than `#`/`-`/`>`/backtick. The reporter saw a lost heading;
// the damage actually covers every leading block construct plus frontmatter.
// Written as an escape, never as a literal U+FEFF: an invisible character in
// source is unreadable to the next person, and it is what the Trojan Source
// scanner exists to flag. The escape keeps this file ASCII-only.
const BOM = "\uFEFF";

describe("UTF-8 BOM (#122)", () => {
  describe("the first block construct still parses", () => {
    // Single-item bodies on purpose. With two items a BOM'd `- one` degrades to
    // a paragraph but the *second* line still opens a list (a list may interrupt
    // a paragraph in CommonMark), so a two-item body passes without the fix and
    // guards nothing. Each case also asserts equality with the clean render, so
    // the test cannot pass by finding the tag somewhere incidental.
    const constructs: [string, string, RegExp][] = [
      ["ATX heading", "# Heading One\n", /<h1[^>]*>Heading One<\/h1>/],
      ["bullet list", "- only item\n", /<ul[^>]*>/],
      ["ordered list", "1. only item\n", /<ol[^>]*>/],
      ["blockquote", "> quoted\n", /<blockquote[^>]*>/],
      ["fenced code", "```js\nconst a = 1;\n```\n", /<pre><code class="language-js"/],
    ];

    for (const [name, body, expected] of constructs) {
      it(name, () => {
        expect(render(BOM + body)).toMatch(expected);
        expect(render(BOM + body)).toBe(render(body));
      });
    }
  });

  it("renders a BOM'd document identically to a clean one", () => {
    // The strongest form of the assertion: byte-identical output, which also
    // pins that `data-source-line` did not shift. Stripping U+FEFF removes no
    // newline, so every block keeps the line index the scroll-sync logic maps.
    const doc = "# Head\n\nBody text.\n\n## Two\n\n- a\n- b\n";
    expect(render(BOM + doc)).toBe(render(doc));
  });

  it("leaves no U+FEFF in the rendered output", () => {
    expect(render(BOM + "# Head\n")).not.toContain("\uFEFF");
  });

  describe("frontmatter", () => {
    const fm = "---\ntitle: Hi\nmarp: true\n---\n\n# Slide\n";

    it("parses through a BOM", () => {
      expect(renderFull(BOM + fm).frontmatter).toEqual({ title: "Hi", marp: "true" });
    });

    it("does not leak the YAML block into the page", () => {
      // Unparsed frontmatter renders `---\ntitle: Hi` as a setext heading.
      expect(renderFull(BOM + fm).html).not.toContain("title-hi");
    });

    it("keeps Marp detection working", () => {
      const result = renderFull(BOM + fm);
      expect(result.isMarp).toBe(true);
      expect(isMarpDoc(result.frontmatter)).toBe(true);
    });

    it("does not inflate the word count with leaked frontmatter", () => {
      expect(renderFull(BOM + fm).wordCount).toBe(renderFull(fm).wordCount);
    });

    it("is stripped by stripFrontmatter, which PresentationView calls directly", () => {
      // The blank line after the closing `---` is retained; that is existing
      // behaviour and matches the no-BOM path exactly, which is the point here.
      expect(stripFrontmatter(BOM + fm)).toBe(stripFrontmatter(fm));
      expect(stripFrontmatter(BOM + fm)).toBe("\n# Slide\n");
    });
  });

  it("tables were never affected, and still are not", () => {
    // Recorded so nobody later 'fixes' the table path: markdown-it's table rule
    // trims the leading BOM out of the first header cell, so a BOM'd table
    // rendered correctly even before this change. Output is identical either
    // way — this test passes with and without stripBom, by design.
    const table = "| a | b |\n|---|---|\n| 1 | 2 |\n";
    expect(render(BOM + table)).toBe(render(table));
    expect(render(BOM + table)).toMatch(/<table[^>]*>/);
  });

  describe("scope of the strip", () => {
    it("only removes U+FEFF at offset 0", () => {
      // Mid-document U+FEFF is a zero-width no-break space and is content, not
      // a signature. Removing it would silently edit the user's document.
      const doc = "# Head\n\nbefore\uFEFFafter\n";
      expect(render(doc)).toContain("\uFEFF");
    });

    it("removes only one BOM, leaving a second as content", () => {
      expect(render(BOM + BOM + "# Head\n")).toContain("\uFEFF");
    });

    it("keys on U+FEFF exactly, not on 'the first character looks invisible'", () => {
      // A different zero-width character at offset 0 must survive. ZWSP makes
      // the line start with something other than `#`, so this renders as a
      // paragraph — spec-correct CommonMark, and the character is still there.
      // The previous version of this test compared render(doc) to itself, which
      // could not fail; this is the assertion it was meant to be.
      expect(render("\u200B# Head\n")).toContain("\u200B");

      const doc = "# Head\n\ntext\n";
      expect(render(doc)).toMatch(/<h1[^>]*>Head<\/h1>/);
      expect(render(doc)).not.toContain(BOM);
    });
  });

  describe("real-world Notepad shapes", () => {
    it("handles BOM with CRLF line endings", () => {
      // Notepad writes both. CRLF alone was already handled; the combination is
      // what a Windows user actually produces.
      expect(render(BOM + "# Head\r\n\r\n- a\r\n- b\r\n")).toMatch(/<h1[^>]*>Head<\/h1>/);
    });

    it("does not crash on a file containing only a BOM", () => {
      const result = renderFull(BOM);
      expect(result.wordCount).toBe(0);
      expect(result.html).not.toContain("\uFEFF");
    });

    it("treats a BOM-only file as empty, so it opens in the editor (#52)", () => {
      // files.ts drops to the editor when `content.trim() === ""`. JS trim()
      // counts U+FEFF as whitespace, so this already held; pin it.
      expect(BOM.trim()).toBe("");
    });
  });
});
