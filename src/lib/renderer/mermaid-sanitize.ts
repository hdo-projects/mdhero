/**
 * #security: the DOMPurify allowlist applied to Mermaid's SVG output.
 *
 * Shared deliberately. Mermaid renders in two places — the app
 * (`MarkdownRenderer.svelte`) and the macOS Quick Look extension
 * (`src/quicklook/preview.ts`) — and both take untrusted diagram source from a
 * document of unknown provenance. A sanitizer allowlist maintained separately
 * in two render paths is exactly the drift that produced the original Mermaid
 * bypass, so there is one copy and both import it.
 *
 * This is defence in depth, not the only gate: `mermaid.initialize` must also
 * keep `securityLevel: "strict"` on every path. DOMPurify's defaults do the
 * security work here — <script>, on* handlers and javascript: URLs are dropped
 * — while the diagram's shapes, text, styles and marker refs survive.
 *
 * DOMPurify is pinned to 3.3.x and must stay there: 3.4 strips HTML out of
 * <foreignObject>, which empties Mermaid `journey` diagrams entirely.
 * `htmlLabels: false` does not cover that renderer. The reasoning, the measured
 * evidence and the partial `textPlacement` workaround are in
 * tests/unit/dompurify-pin.test.ts, which fails if the pin is lifted.
 *
 * See CLAUDE.md's security invariants before changing anything in this file.
 */
export const MERMAID_SANITIZE_CONFIG = {
  ADD_TAGS: [
    "svg", "g", "path", "line", "rect", "circle", "ellipse", "polygon",
    "polyline", "text", "tspan", "defs", "marker", "style", "use",
    "symbol", "clipPath", "pattern", "linearGradient", "radialGradient",
    "stop", "filter", "title", "desc", "foreignObject",
  ],
  ADD_ATTR: [
    "class", "style", "xmlns", "xmlns:xlink", "xlink:href", "viewBox",
    "d", "fill", "stroke", "stroke-width", "stroke-dasharray",
    "transform", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r",
    "rx", "ry", "width", "height", "points", "offset", "stop-color",
    "text-anchor", "dominant-baseline", "font-size", "font-family",
    "font-weight", "marker-end", "marker-start", "id", "aria-hidden",
    "aria-roledescription", "focusable", "role", "preserveAspectRatio",
    "requiredFeatures",
  ],
};
