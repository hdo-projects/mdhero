<script lang="ts">
  import { get } from "svelte/store";
  import { tocEntries, activeHeadingId, tocVisible, setActiveHeading } from "$lib/stores/toc";
  import {
    settings,
    clampTocWidth,
    maxTocWidthFor,
    DEFAULT_TOC_WIDTH,
    MIN_TOC_WIDTH,
  } from "$lib/stores/settings";
  import { chromeTop, sideTabsWidth } from "$lib/utils/layout";
  import PanelResizer from "./PanelResizer.svelte";

  /** The width the ToC shares with the document: the window, less the side
   *  tabs panel when there is one. */
  function availableWidth(): number {
    return window.innerWidth - sideTabsWidth(get(settings));
  }

  function scrollToHeading(id: string) {
    setActiveHeading(id);
    const el = document.getElementById(id);
    if (el) {
      const offset = chromeTop() - 5;
      const y = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  }

  function getIndent(level: number): string {
    return `${(level - 1) * 12}px`;
  }
</script>

{#if $tocVisible && $tocEntries.length > 0}
  <aside class="toc-sidebar">
    <div class="toc-header">
      <span>On this page</span>
    </div>
    <nav class="toc-nav">
      {#each $tocEntries as entry (entry.id)}
        <button
          onclick={() => scrollToHeading(entry.id)}
          class="toc-item"
          class:active={$activeHeadingId === entry.id}
          style="padding-left: calc(12px + {getIndent(entry.level)})"
        >
          {entry.text}
        </button>
      {/each}
    </nav>
  </aside>
  <!-- z-index 14 like the sidebar, not 15: the top tab bar is 15 and renders
       before the handle, so a 15 here would paint the strip across it while
       the sidebar itself correctly tucks underneath. `--toc-w` is owned by
       +page.svelte, which re-publishes it whenever the stored value changes. -->
  <PanelResizer
    width={$settings.tocWidth}
    min={MIN_TOC_WIDTH}
    defaultWidth={DEFAULT_TOC_WIDTH}
    clampWidth={(value) => clampTocWidth(value, availableWidth())}
    maxWidth={() => maxTocWidthFor(availableWidth())}
    cssVar="--toc-w"
    resizingClass="toc-resizing"
    label="Resize table of contents"
    left="calc(var(--tabs-w, 0px) + var(--toc-w, 240px) - 3px)"
    top="calc(var(--chrome-top, 75px) + 5px)"
    zIndex={14}
    onCommit={(width) => settings.update((s) => ({ ...s, tocWidth: width }))}
  />
{/if}

<style>
  .toc-sidebar {
    position: fixed;
    left: var(--tabs-w, 0px);
    top: calc(var(--chrome-top, 75px) + 5px);
    bottom: 0;
    width: var(--toc-w, 240px);
    background: #fafafa;
    border-right: 1px solid #e5e5e5;
    box-shadow: 2px 0 8px rgba(0,0,0,0.04);
    overflow-y: auto;
    z-index: 14;
  }

  :global(html.dark) .toc-sidebar {
    background: #1c1c1e;
    border-right-color: #2c2c2e;
    box-shadow: 2px 0 8px rgba(0,0,0,0.2);
  }

  .toc-header {
    padding: 12px 16px 8px;
    font-size: 11px;
    font-weight: 600;
    color: #aeaeb2;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .toc-nav {
    padding: 0 8px 16px;
  }

  .toc-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 4px 12px;
    font-size: 13px;
    color: #636366;
    background: none;
    border: none;
    border-left: 2px solid transparent;
    border-radius: 0;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.15s, border-color 0.15s;
    line-height: 1.6;
  }

  :global(html.dark) .toc-item {
    color: #8e8e93;
  }

  .toc-item:hover {
    color: #1c1c1e;
  }

  :global(html.dark) .toc-item:hover {
    color: #e5e5e7;
  }

  .toc-item.active {
    color: #0891B2;
    border-left-color: #0891B2;
    border-left-width: 3px;
    font-weight: 500;
    background: rgba(8, 145, 178, 0.06);
    border-radius: 0 4px 4px 0;
  }

  :global(html.dark) .toc-item.active {
    color: #22D3EE;
    border-left-color: #22D3EE;
    background: rgba(34, 211, 238, 0.08);
  }

  @media print {
    .toc-sidebar { display: none !important; }
  }
</style>
