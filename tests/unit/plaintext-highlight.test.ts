import { describe, it, expect, vi } from "vitest";

// Node env, no DOM: DOMPurify only sanitizes, so a passthrough keeps the
// highlighter's output visible to the assertions.
vi.mock("dompurify", () => ({ default: { sanitize: (html: string) => html } }));

const { render } = await import("../../src/lib/renderer/pipeline");

// Prose in a `text` fence (an email draft) came out with its apostrophes
// coloured as string delimiters: `text` was not a registered language, so the
// block fell through to highlightAuto, which guessed a programming language.
const PROSE = "Merci pour l'envoi. Je pense qu'il s'agit du bon fichier, j'ai vérifié.";

describe("plain-text code fences", () => {
  for (const lang of ["text", "txt", "plaintext"]) {
    it(`leaves a \`${lang}\` block uncoloured`, () => {
      const html = render("```" + lang + "\n" + PROSE + "\n```");
      expect(html).toContain(`class="language-${lang}"`);
      expect(html).not.toContain("hljs-");
    });
  }

  it("still highlights a real language", () => {
    const html = render("```js\nconst a = 'x';\n```");
    expect(html).toContain("hljs-string");
  });
});
