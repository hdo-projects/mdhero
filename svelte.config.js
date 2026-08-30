// Tauri doesn't have a Node.js server to do proper SSR
// so we use adapter-static with a fallback to index.html to put the site in SPA mode
// See: https://svelte.dev/docs/kit/single-page-apps
// See: https://v2.tauri.app/start/frontend/sveltekit/ for more info
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      fallback: "index.html",
    }),

    // Content-Security-Policy. `tauri.conf.json` had `"csp": null`, so the
    // webview ran with no policy at all — nothing behind DOMPurify if a
    // sanitizer is ever bypassed.
    //
    // It is declared here rather than in tauri.conf.json because SvelteKit
    // boots the app from an inline <script> whose contents include a random
    // per-build identifier: a hash pinned in Tauri's config would be stale on
    // the next build. `mode: "hash"` makes SvelteKit compute that hash during
    // the build and emit the whole policy as a <meta> tag.
    csp: {
      mode: "hash",
      directives: {
        // ipc: / http://ipc.localhost sit in default-src, not just connect-src.
        // That is what the Tauri API's own docs prescribe, and it covers the
        // bridge whichever transport the platform's webview uses — a fetch is
        // governed by connect-src, but anything else would fall back to here
        // and be blocked. These schemes are Tauri's alone; admitting them costs
        // nothing.
        "default-src": ["self", "ipc:", "http://ipc.localhost"],
        // No 'unsafe-inline': that would re-admit exactly the injected
        // handlers this is meant to stop. The boot script is allowed by hash.
        "script-src": ["self"],
        // 'unsafe-inline' is unavoidable for styles: KaTeX and Mermaid inject
        // style blocks, and the reader's font-size / width settings are applied
        // as inline style attributes. Style injection is a display concern, not
        // code execution.
        "style-src": ["self", "unsafe-inline"],
        // asset: (macOS) and http://asset.localhost (Windows/Linux) are how
        // convertFileSrc serves a document's local images. https: keeps remote
        // images in Markdown working — drop it to also stop tracking pixels,
        // at the cost of images in documents that reference the web.
        "img-src": ["self", "data:", "blob:", "asset:", "http://asset.localhost", "https:"],
        "font-src": ["self", "data:"],
        // ipc: / http://ipc.localhost is the Tauri command bridge. https: is
        // required by the "Open from URL" feature, which fetches a URL the user
        // supplies, and by the update check.
        "connect-src": ["self", "ipc:", "http://ipc.localhost", "https:"],
        "object-src": ["none"],
        "base-uri": ["self"],
      },
    },
  },
};

export default config;
