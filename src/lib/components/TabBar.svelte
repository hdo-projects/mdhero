<script lang="ts">
  import { tick } from "svelte";
  import { get } from "svelte/store";
  import { ChevronRight, PanelLeft, PanelTop } from "@lucide/svelte";
  import { tabStore, HOME_TAB_ID, type Tab } from "$lib/stores/tabs";
  import {
    settings,
    clampTabsWidth,
    maxTabsWidthFor,
    DEFAULT_TABS_WIDTH,
    MIN_TABS_WIDTH,
  } from "$lib/stores/settings";
  import { tocVisible, tocEntries } from "$lib/stores/toc";
  import { newDocument } from "$lib/tauri/files";
  import { copyFileName, copyPath } from "$lib/utils/clipboard";
  import { stripVerbatimPrefix, tabFolderLabel, tabsNeedingFolder } from "$lib/utils/path";
  import { GROUP_COLORS, groupLabel, tabRuns, type GroupColor } from "$lib/utils/tab-groups";
  import PanelResizer from "./PanelResizer.svelte";

  let {
    onCloseTab = (id: string) => tabStore.closeTab(id),
  }: {
    /** Returns `false` when the user chose to keep the tab (unsaved changes). */
    onCloseTab?: (id: string) => void | boolean | Promise<void | boolean>;
  } = $props();

  const { tabs, activeTabId, groups } = tabStore;
  let dragIndex = $state(-1);
  let overIndex = $state(-1);
  let contextMenuTab = $state<Tab | null>(null);
  let contextMenuPos = $state({ x: 0, y: 0 });
  let contextMenuEl = $state<HTMLElement | null>(null);
  // Result of the last copy, shown in place of the label of the entry clicked.
  let copyFeedback = $state<{ item: "path" | "name"; text: string } | null>(null);

  // Tabs in a row across the top, or in a resizable panel on the left.
  let side = $derived($settings.tabsPosition === "side");
  // Side tabs whose folder goes under their name, to tell same-named files apart.
  let withFolder = $derived(tabsNeedingFolder($tabs));
  // What the bar draws: tab groups, and the loose tabs between them.
  let runs = $derived(tabRuns($tabs, $groups));
  // The group whose editor (name, colour, actions) is open, from a right-click
  // on its chip or right after it was created.
  let groupMenuId = $state<string | null>(null);
  let menuGroup = $derived(groupMenuId ? $groups.find((g) => g.id === groupMenuId) ?? null : null);
  let groupNameInput = $state<HTMLInputElement | null>(null);

  const COLOR_NAMES: Record<GroupColor, string> = {
    blue: "Blue",
    red: "Red",
    yellow: "Yellow",
    green: "Green",
    pink: "Pink",
    purple: "Purple",
    cyan: "Cyan",
    orange: "Orange",
    grey: "Grey",
  };

  function toggleTabsPosition() {
    settings.update((s) => ({ ...s, tabsPosition: s.tabsPosition === "side" ? "top" : "side" }));
  }

  /** The width the side panel shares with the document: the window, less the
   *  table of contents when it is showing. */
  function availableWidth(): number {
    const toc = get(tocVisible) && get(tocEntries).length > 0 ? get(settings).tocWidth : 0;
    return window.innerWidth - toc;
  }

  function handleClose(e: MouseEvent, id: string) {
    e.stopPropagation();
    onCloseTab(id);
  }

  // Middle-click anywhere on a tab closes it, matching browsers/VS Code (#46).
  // Only clean tabs: a dirty tab needs the unsaved-changes dialog, and opening
  // that native modal from an auxclick handler wedges it in WKWebView (the modal
  // becomes unresponsive). So middle-click skips dirty tabs — the X button (a
  // plain click) still closes them with the prompt.
  function handleAuxClick(e: MouseEvent, id: string) {
    if (e.button !== 1) return;
    e.preventDefault();
    if ($tabs.find((t) => t.id === id)?.dirty) return;
    onCloseTab(id);
  }

  function handleMouseDown(e: MouseEvent, idx: number) {
    // Suppress the middle-button default (autoscroll) so the tab close on
    // auxclick fires cleanly on the first click (#46) — but don't close here;
    // closing on mousedown mis-fires as the row re-renders. Don't start a drag.
    if (e.button === 1) {
      e.preventDefault();
      return;
    }
    // Only the left button starts a drag.
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".tab-close") || (e.target as HTMLElement).closest(".dropdown")) return;
    e.preventDefault();
    dragIndex = idx;

    // Tabs are found by their `data-index` (their place in the tab list), since
    // group chips sit between them and folded groups hide some of them.
    function handleMouseMove(ev: MouseEvent) {
      const items = document.querySelectorAll<HTMLElement>(".tabbar-files .tab[data-index]");
      for (const item of items) {
        const rect = item.getBoundingClientRect();
        const inside = side
          ? ev.clientY >= rect.top && ev.clientY < rect.bottom
          : ev.clientX >= rect.left && ev.clientX < rect.right;
        if (inside) {
          overIndex = Number(item.dataset.index);
          break;
        }
      }
    }

    function handleMouseUp() {
      if (dragIndex >= 0 && overIndex >= 0 && dragIndex !== overIndex) {
        tabStore.reorderTabs(dragIndex, overIndex);
      }
      dragIndex = -1;
      overIndex = -1;
      (window as any).__mdhero_tab_dragging = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }

    (window as any).__mdhero_tab_dragging = true;
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  function handleNewTab() {
    newDocument();
  }

  // A tab backed by a real file has a canonical absolute path to copy; paste://,
  // url://, and not-yet-saved new:// tabs don't.
  function isFileTab(tab: Tab): boolean {
    return !!tab.filePath
      && !tab.filePath.startsWith("paste://")
      && !tab.filePath.startsWith("url://")
      && !tab.filePath.startsWith("new://");
  }

  // Every document tab gets the menu, since any of them can be closed and the
  // tabs can be moved from any of them; the copy entries only show for tabs
  // backed by a file.
  async function handleContextMenu(e: MouseEvent, tab: Tab) {
    e.preventDefault();
    groupMenuId = null;
    contextMenuTab = tab;
    copyFeedback = null;
    await placeMenu(e.currentTarget as HTMLElement);
  }

  // Shared by the tab menu and the group editor: only one is open at a time.
  async function placeMenu(anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    const menuWidth = 160;
    const maxX = window.innerWidth - menuWidth - 8;
    // Beside a side tab rather than under it, where the menu would cover the
    // next tab down.
    contextMenuPos = side
      ? { x: Math.min(rect.right + 4, maxX), y: rect.top }
      : { x: Math.min(rect.left, maxX), y: rect.bottom + 4 };
    // Beside a side tab near the bottom of the window, the menu would run past
    // the bottom edge, and a translated menu wider than 160px can run past the
    // right edge: move it back inside.
    await tick();
    if (!contextMenuEl) return;
    const box = contextMenuEl.getBoundingClientRect();
    const overflowX = box.right - (window.innerWidth - 8);
    const overflowY = box.bottom - (window.innerHeight - 8);
    if (overflowX > 0 || overflowY > 0) {
      contextMenuPos = {
        x: Math.max(8, contextMenuPos.x - Math.max(0, overflowX)),
        y: Math.max(8, contextMenuPos.y - Math.max(0, overflowY)),
      };
    }
  }

  function closeContextMenu() {
    contextMenuTab = null;
    copyFeedback = null;
    groupMenuId = null;
  }

  // The group editor opens with its name field focused, as in Chrome, so a
  // new group can be named right away.
  async function openGroupMenu(anchor: HTMLElement, groupId: string) {
    contextMenuTab = null;
    copyFeedback = null;
    groupMenuId = groupId;
    await placeMenu(anchor);
    groupNameInput?.focus();
    groupNameInput?.select();
  }

  function handleGroupContextMenu(e: MouseEvent, groupId: string) {
    e.preventDefault();
    openGroupMenu(e.currentTarget as HTMLElement, groupId);
  }

  function handleGroupChipKeydown(e: KeyboardEvent, groupId: string) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    tabStore.toggleGroup(groupId);
  }

  async function handleNewGroupFromMenu() {
    if (!contextMenuTab) return;
    const groupId = tabStore.createGroup(contextMenuTab.id);
    closeContextMenu();
    await tick();
    const chip = document.querySelector<HTMLElement>(`[data-group-chip="${groupId}"]`);
    if (chip) await openGroupMenu(chip, groupId);
  }

  function handleMoveToGroupFromMenu(groupId: string) {
    if (!contextMenuTab) return;
    tabStore.moveToGroup(contextMenuTab.id, groupId);
    closeContextMenu();
  }

  function handleRemoveFromGroupFromMenu() {
    if (!contextMenuTab) return;
    tabStore.removeFromGroup(contextMenuTab.id);
    closeContextMenu();
  }

  function handleToggleGroupFromMenu() {
    if (!groupMenuId) return;
    const id = groupMenuId;
    closeContextMenu();
    tabStore.toggleGroup(id);
  }

  function handleUngroupFromMenu() {
    if (!groupMenuId) return;
    const id = groupMenuId;
    closeContextMenu();
    tabStore.ungroup(id);
  }

  // One tab at a time through the same close as the X, so each tab with
  // unsaved changes asks first, and "Keep Editing" stops there. The active tab
  // goes last, so the tabs shown in between are not other tabs of the group.
  async function handleCloseGroupFromMenu() {
    if (!groupMenuId) return;
    const id = groupMenuId;
    closeContextMenu();
    const members = get(tabs).filter((t) => t.groupId === id);
    members.sort((a, b) => Number(a.id === get(activeTabId)) - Number(b.id === get(activeTabId)));
    for (const tab of members) {
      if ((await onCloseTab(tab.id)) === false) break;
    }
  }

  async function handleCopy(item: "path" | "name") {
    if (!contextMenuTab) return;
    const copy = item === "path" ? copyPath : copyFileName;
    const success = await copy(contextMenuTab.filePath);
    copyFeedback = { item, text: success ? "Copied!" : "Failed" };
    setTimeout(closeContextMenu, 900);
  }

  // Escape dismisses the menu and nothing else. The page's own Escape handler
  // listens on window too, but in the bubble phase, so without this it would
  // also close the active tab (close-on-Escape setting).
  function handleMenuKeydown(e: KeyboardEvent) {
    if (e.key !== "Escape" || (!contextMenuTab && !groupMenuId)) return;
    e.preventDefault();
    e.stopPropagation();
    closeContextMenu();
  }

  function handleCloseFromMenu() {
    if (!contextMenuTab) return;
    const id = contextMenuTab.id;
    closeContextMenu();
    onCloseTab(id);
  }

  function handleTogglePositionFromMenu() {
    closeContextMenu();
    toggleTabsPosition();
  }
</script>

{#snippet tabName(tab: Tab)}
  {#if tab.diskChanged}<span class="tab-disk" title="Changed on disk while you were editing">⟳</span>{:else if tab.dirty}<span class="tab-dirty" title="Unsaved changes">•</span>{/if}{tab.fileName}
{/snippet}

<!-- `idx` is the tab's place in the whole tab list, which drag and drop works on. -->
{#snippet fileTab(tab: Tab, idx: number)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    data-index={idx}
    onmousedown={(e) => handleMouseDown(e, idx)}
    onauxclick={(e) => handleAuxClick(e, tab.id)}
    onclick={() => tabStore.switchTab(tab.id)}
    oncontextmenu={(e) => handleContextMenu(e, tab)}
    class="tab"
    class:active={$activeTabId === tab.id}
    class:drag-over={overIndex === idx && dragIndex !== idx && dragIndex >= 0}
    title={side && isFileTab(tab) ? stripVerbatimPrefix(tab.filePath) : undefined}
  >
    {#if side && withFolder.has(tab.id)}
      <span class="tab-text">
        <span class="tab-label">{@render tabName(tab)}</span>
        <span class="tab-folder">{tabFolderLabel(tab.filePath)}</span>
      </span>
    {:else}
      <span class="tab-label">{@render tabName(tab)}</span>
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      role="button"
      tabindex="-1"
      onclick={(e) => handleClose(e, tab.id)}
      onkeydown={() => {}}
      class="tab-close"
    >
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><line x1="1.5" y1="1.5" x2="7.5" y2="7.5"/><line x1="7.5" y1="1.5" x2="1.5" y2="7.5"/></svg>
    </span>
  </div>
{/snippet}

<svelte:window onkeydowncapture={handleMenuKeydown} />

<div class="tabbar" class:side>
  <div class="tabbar-inner">
    <!-- Home tab -->
    <div
      class="tab home-tab"
      class:active={$activeTabId === HOME_TAB_ID}
      onclick={() => tabStore.goHome()}
      role="button"
      tabindex="0"
      onkeydown={(e) => e.key === 'Enter' && tabStore.goHome()}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 6.5L7 2l5 4.5V12H9V9H5v3H2V6.5z"/>
      </svg>
      {#if side}<span class="tab-label">Home</span>{/if}
    </div>

    <!-- File tabs, and the groups some of them are in -->
    <div class="tabbar-files">
      {#each runs as run (run.tabs[0].tab.id)}
        {#if run.group}
          {@const group = run.group}
          <div
            class="tab-group"
            class:collapsed={group.collapsed}
            style="--group-color: var(--tab-group-{group.color})"
          >
            <!-- Click folds or unfolds the group; right-click edits it. -->
            <div
              class="group-chip"
              data-group-chip={group.id}
              role="button"
              tabindex="0"
              aria-expanded={!group.collapsed}
              title={groupLabel(group, $tabs)}
              onclick={() => tabStore.toggleGroup(group.id)}
              onkeydown={(e) => handleGroupChipKeydown(e, group.id)}
              oncontextmenu={(e) => handleGroupContextMenu(e, group.id)}
            >
              {#if side}
                <span class="group-chevron"><ChevronRight size={12} /></span>
                <span class="group-dot"></span>
                <span class="group-name" class:unnamed={!group.name.trim()}>{groupLabel(group, $tabs)}</span>
                {#if group.collapsed}<span class="group-count">{run.tabs.length}</span>{/if}
              {:else}
                <span
                  class="group-pill"
                  class:dot={!group.name.trim() && !group.collapsed}
                  class:ink-dark={group.color === "yellow" || group.color === "orange"}
                >
                  {group.name.trim()}{#if group.collapsed}<span class="group-count" class:alone={!group.name.trim()}>{run.tabs.length}</span>{/if}
                </span>
              {/if}
            </div>
            {#if !group.collapsed}
              {#each run.tabs as { tab, index } (tab.id)}
                {@render fileTab(tab, index)}
              {/each}
            {/if}
          </div>
        {:else}
          {#each run.tabs as { tab, index } (tab.id)}
            {@render fileTab(tab, index)}
          {/each}
        {/if}
      {/each}
    </div>

    <!-- New tab button -->
    <button class="new-tab-btn" onclick={handleNewTab} title="New tab">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <line x1="6" y1="2" x2="6" y2="10"/>
        <line x1="2" y1="6" x2="10" y2="6"/>
      </svg>
      {#if side}<span>New tab</span>{/if}
    </button>
    <button
      class="layout-btn"
      onclick={toggleTabsPosition}
      title={side ? "Show tabs at the top" : "Show tabs on the side"}
      aria-label={side ? "Show tabs at the top" : "Show tabs on the side"}
    >
      {#if side}<PanelTop size={14} />{:else}<PanelLeft size={14} />{/if}
    </button>
  </div>
</div>
{#if side}
  <!-- z-index 15 like the panel itself. `--tabs-w` is owned by +page.svelte,
       which re-publishes it whenever the stored value changes. -->
  <PanelResizer
    width={$settings.tabsWidth}
    min={MIN_TABS_WIDTH}
    defaultWidth={DEFAULT_TABS_WIDTH}
    clampWidth={(value) => clampTabsWidth(value, availableWidth())}
    maxWidth={() => maxTabsWidthFor(availableWidth())}
    cssVar="--tabs-w"
    resizingClass="tabs-resizing"
    label="Resize tabs panel"
    left="calc(var(--tabs-w, 220px) - 3px)"
    top="var(--chrome-top, 44px)"
    zIndex={15}
    onCommit={(width) => settings.update((s) => ({ ...s, tabsWidth: width }))}
  />
{/if}

{#if contextMenuTab}
  {@const inGroup = contextMenuTab.groupId}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-[9]" onclick={closeContextMenu} onkeydown={() => {}}></div>
  <div bind:this={contextMenuEl} class="dropdown" style="left: {contextMenuPos.x}px; top: {contextMenuPos.y}px;">
    {#if isFileTab(contextMenuTab)}
      <button onclick={() => handleCopy("path")} class="dropdown-item">
        <span>{copyFeedback?.item === "path" ? copyFeedback.text : "Copy Path"}</span>
      </button>
      <button onclick={() => handleCopy("name")} class="dropdown-item">
        <span>{copyFeedback?.item === "name" ? copyFeedback.text : "Copy File Name"}</span>
      </button>
      <div class="dropdown-separator"></div>
    {/if}
    <button onclick={handleNewGroupFromMenu} class="dropdown-item">
      <span>{inGroup ? "Move to New Group" : "Add Tab to New Group"}</span>
    </button>
    {#each $groups.filter((g) => g.id !== inGroup) as group (group.id)}
      <button onclick={() => handleMoveToGroupFromMenu(group.id)} class="dropdown-item">
        <span class="group-swatch-dot" style="--group-color: var(--tab-group-{group.color})"></span>
        <span class="menu-group-label">{inGroup ? "Move to" : "Add to"} {groupLabel(group, $tabs)}</span>
      </button>
    {/each}
    {#if inGroup}
      <button onclick={handleRemoveFromGroupFromMenu} class="dropdown-item">
        <span>Remove from Group</span>
      </button>
    {/if}
    <div class="dropdown-separator"></div>
    <button onclick={handleCloseFromMenu} class="dropdown-item">
      <span>Close Tab</span>
    </button>
    <div class="dropdown-separator"></div>
    <button onclick={handleTogglePositionFromMenu} class="dropdown-item">
      <span>{side ? "Show Tabs at the Top" : "Show Tabs on the Side"}</span>
    </button>
  </div>
{:else if menuGroup}
  {@const group = menuGroup}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-[9]" onclick={closeContextMenu} onkeydown={() => {}}></div>
  <div bind:this={contextMenuEl} class="dropdown group-editor" style="left: {contextMenuPos.x}px; top: {contextMenuPos.y}px;">
    <input
      bind:this={groupNameInput}
      class="group-name-input"
      type="text"
      value={group.name}
      placeholder="Name this group"
      aria-label="Group name"
      spellcheck="false"
      oninput={(e) => tabStore.updateGroup(group.id, { name: e.currentTarget.value })}
      onkeydown={(e) => e.key === "Enter" && closeContextMenu()}
    />
    <div class="group-swatches" role="radiogroup" aria-label="Group color">
      {#each GROUP_COLORS as color (color)}
        <button
          class="group-swatch"
          class:selected={group.color === color}
          style="--group-color: var(--tab-group-{color})"
          role="radio"
          aria-checked={group.color === color}
          aria-label={COLOR_NAMES[color]}
          title={COLOR_NAMES[color]}
          onclick={() => tabStore.updateGroup(group.id, { color })}
        ></button>
      {/each}
    </div>
    <div class="dropdown-separator"></div>
    <button onclick={handleToggleGroupFromMenu} class="dropdown-item">
      <span>{group.collapsed ? "Expand Group" : "Collapse Group"}</span>
    </button>
    <button onclick={handleUngroupFromMenu} class="dropdown-item">
      <span>Ungroup</span>
    </button>
    <button onclick={handleCloseGroupFromMenu} class="dropdown-item">
      <span>Close Group</span>
    </button>
  </div>
{/if}

<style>
  .tabbar {
    position: sticky;
    top: 37px;
    z-index: 15;
    background: #dee1e6;
    padding: 6px 8px 0;
    overflow-x: auto;
  }

  :global(html.dark) .tabbar {
    background: #111113;
  }

  .tabbar::-webkit-scrollbar {
    height: 0;
  }

  .tabbar-inner {
    display: flex;
    align-items: flex-end;
    gap: 2px;
  }

  .tabbar-files {
    display: flex;
    align-items: flex-end;
    gap: 2px;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    font-size: 12px;
    color: #5f6368;
    background: transparent;
    border: none;
    border-radius: 8px 8px 0 0;
    cursor: pointer;
    white-space: nowrap;
    max-width: 200px;
    min-width: 80px;
    transition: background 0.12s, color 0.12s;
    position: relative;
    user-select: none;
  }

  .tab:hover {
    background: rgba(255, 255, 255, 0.5);
  }

  :global(html.dark) .tab {
    color: #8e8e93;
  }

  :global(html.dark) .tab:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .tab.active {
    background: #fafafa;
    color: #1c1c1e;
    font-weight: 600;
    box-shadow: 0 -1px 3px rgba(0,0,0,0.06);
    border-bottom: 2px solid #0891B2;
  }

  :global(html.dark) .tab.active {
    background: #1e1e20;
    color: #e5e5e7;
    font-weight: 600;
    box-shadow: 0 -1px 3px rgba(0,0,0,0.2);
    border-bottom: 2px solid #22D3EE;
  }

  .tab.drag-over {
    border-left: 2px solid #0891B2;
  }

  :global(html.dark) .tab.drag-over {
    border-left-color: #22D3EE;
  }

  /* Home tab */
  .home-tab {
    min-width: auto;
    padding: 7px 10px;
    flex-shrink: 0;
  }

  .home-tab svg {
    flex-shrink: 0;
  }

  .tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    text-align: left;
  }

  .tab-disk {
    color: #d97706;
    margin-right: 4px;
    font-size: 0.9em;
  }

  .tab-dirty {
    color: #0891B2;
    font-weight: 700;
    margin-right: 4px;
  }

  :global(html.dark) .tab-dirty {
    color: #22D3EE;
  }

  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    color: #999;
    opacity: 0;
    transition: opacity 0.12s, background 0.12s, color 0.12s;
    flex-shrink: 0;
  }

  .tab:hover .tab-close {
    opacity: 1;
  }

  .tab-close:hover {
    background: rgba(0, 0, 0, 0.08);
    color: #333;
  }

  :global(html.dark) .tab-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #e5e5e7;
  }

  /* New tab button */
  .new-tab-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    margin-left: 2px;
    margin-bottom: 2px;
    background: none;
    border: none;
    border-radius: 6px;
    color: #8e8e93;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.12s, color 0.12s;
  }

  .new-tab-btn:hover {
    background: rgba(255, 255, 255, 0.5);
    color: #0891B2;
  }

  :global(html.dark) .new-tab-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #22D3EE;
  }

  /* Moves the tabs between the top row and the side panel. At the far end of
     the row; in the panel, on a header line of its own above Home. */
  .layout-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    margin-left: auto;
    margin-bottom: 2px;
    background: none;
    border: none;
    border-radius: 6px;
    color: #8e8e93;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.12s, color 0.12s;
  }

  .layout-btn:hover {
    background: rgba(255, 255, 255, 0.5);
    color: #0891B2;
  }

  :global(html.dark) .layout-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #22D3EE;
  }

  /* Side tabs: a fixed panel under the toolbar, as wide as `--tabs-w`. */
  .tabbar.side {
    position: fixed;
    top: var(--chrome-top, 44px);
    left: 0;
    bottom: 0;
    width: var(--tabs-w, 220px);
    padding: 4px 6px 12px;
    overflow-x: hidden;
    overflow-y: auto;
    border-right: 1px solid #d2d5da;
  }

  :global(html.dark) .tabbar.side {
    border-right-color: #2c2c2e;
  }

  .tabbar.side .tabbar-inner,
  .tabbar.side .tabbar-files {
    flex-direction: column;
    align-items: stretch;
  }

  .tabbar.side .layout-btn {
    order: -1;
    align-self: flex-end;
    margin: 0 0 2px;
  }

  .tabbar.side .tab {
    max-width: none;
    min-width: 0;
    padding: 6px 6px 6px 10px;
    border-radius: 8px;
  }

  .tabbar.side .home-tab {
    padding: 7px 10px;
    margin-bottom: 4px;
  }

  /* The accent moves from under the tab to its leading edge. */
  .tabbar.side .tab.active {
    border-bottom: none;
    box-shadow: inset 3px 0 0 #0891B2, 0 1px 3px rgba(0,0,0,0.06);
  }

  :global(html.dark) .tabbar.side .tab.active {
    box-shadow: inset 3px 0 0 #22D3EE, 0 1px 3px rgba(0,0,0,0.2);
  }

  .tabbar.side .tab.drag-over {
    border-left: none;
    border-top: 2px solid #0891B2;
  }

  :global(html.dark) .tabbar.side .tab.drag-over {
    border-top-color: #22D3EE;
  }

  .tab-text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .tab-folder {
    font-size: 11px;
    font-weight: 400;
    color: #8e8e93;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  :global(html.dark) .tab-folder {
    color: #6e6e73;
  }

  .tabbar.side .new-tab-btn {
    width: auto;
    justify-content: flex-start;
    gap: 8px;
    margin: 4px 0 0;
    padding: 0 10px;
    font-size: 12px;
  }

  /* Tab group colours, Chrome's: deeper on the light interface, lighter on
     the dark one. On `html` because the group editor sits outside the bar. */
  :global(html) {
    --tab-group-grey: #5f6368;
    --tab-group-blue: #1a73e8;
    --tab-group-red: #d93025;
    --tab-group-yellow: #f9ab00;
    --tab-group-green: #1e8e3e;
    --tab-group-pink: #d01884;
    --tab-group-purple: #9334e6;
    --tab-group-cyan: #007b83;
    --tab-group-orange: #fa903e;
  }

  :global(html.dark) {
    --tab-group-grey: #dadce0;
    --tab-group-blue: #8ab4f8;
    --tab-group-red: #f28b82;
    --tab-group-yellow: #fdd663;
    --tab-group-green: #81c995;
    --tab-group-pink: #ff8bcb;
    --tab-group-purple: #c58af9;
    --tab-group-cyan: #78d9ec;
    --tab-group-orange: #fcad70;
  }

  /* A tab group at the top: its chip, then its tabs over a line in its colour. */
  .tab-group {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    position: relative;
  }

  .tab-group::after {
    content: "";
    position: absolute;
    left: 4px;
    right: 0;
    bottom: 0;
    height: 2px;
    border-radius: 1px;
    background: var(--group-color);
    pointer-events: none;
  }

  .tab-group.collapsed {
    align-self: stretch;
  }

  .tab-group.collapsed::after {
    display: none;
  }

  .group-chip {
    display: flex;
    align-items: center;
    align-self: center;
    flex-shrink: 0;
    margin: 0 2px 0 4px;
    cursor: pointer;
    user-select: none;
    border-radius: 6px;
  }

  .group-chip:focus-visible {
    outline: 2px solid var(--group-color);
    outline-offset: 2px;
  }

  .group-pill {
    display: inline-block;
    max-width: 140px;
    padding: 2px 8px;
    border-radius: 6px;
    background: var(--group-color);
    color: #fff;
    font-size: 11.5px;
    font-weight: 600;
    line-height: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .group-pill.ink-dark,
  :global(html.dark) .group-pill {
    color: #202124;
  }

  /* An unnamed, open group shows as a dot, as in Chrome. */
  .group-pill.dot {
    width: 12px;
    height: 12px;
    padding: 0;
    border-radius: 50%;
  }

  .group-pill .group-count {
    margin-left: 5px;
    font-weight: 500;
    opacity: 0.85;
  }

  .group-pill .group-count.alone {
    margin-left: 0;
  }

  /* On the side: a header line (chevron, colour, name), then the tabs,
     indented along a rail in the group's colour. */
  .tabbar.side .tab-group,
  .tabbar.side .tab-group.collapsed {
    flex-direction: column;
    align-items: stretch;
  }

  .tabbar.side .tab-group::after {
    left: 9px;
    right: auto;
    top: 28px;
    bottom: 4px;
    width: 2px;
    height: auto;
  }

  .tabbar.side .tab-group > .tab {
    margin-left: 16px;
  }

  .tabbar.side .group-chip {
    align-self: stretch;
    gap: 6px;
    margin: 0;
    padding: 5px 6px 5px 4px;
    font-size: 12px;
    font-weight: 600;
    color: #3c4043;
    border-radius: 8px;
    transition: background 0.12s;
  }

  .tabbar.side .group-chip:hover {
    background: rgba(255, 255, 255, 0.5);
  }

  :global(html.dark) .tabbar.side .group-chip {
    color: #c7c7cc;
  }

  :global(html.dark) .tabbar.side .group-chip:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .group-chevron {
    display: flex;
    flex-shrink: 0;
    width: 12px;
    color: #8e8e93;
    transform: rotate(90deg);
    transition: transform 0.12s;
  }

  .tab-group.collapsed .group-chevron {
    transform: none;
  }

  .group-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--group-color);
    flex-shrink: 0;
  }

  .group-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* No name: the header shows its tabs instead ("a.md + 2"), dimmed. */
  .group-name.unnamed {
    font-weight: 400;
    color: #8e8e93;
  }

  .tabbar.side .group-count {
    margin-left: auto;
    font-size: 11px;
    font-weight: 400;
    color: #8e8e93;
  }

  /* The group editor: name, colour, then the actions. */
  .group-editor {
    padding-top: 8px;
  }

  .group-name-input {
    display: block;
    width: calc(100% - 12px);
    margin: 0 6px 8px;
    padding: 5px 8px;
    font-size: 12px;
    color: #1c1c1e;
    background: #fff;
    border: 1px solid #d2d5da;
    border-radius: 6px;
    outline: none;
  }

  .group-name-input:focus {
    border-color: #0891B2;
    box-shadow: 0 0 0 2px rgba(8, 145, 178, 0.2);
  }

  :global(html.dark) .group-name-input {
    color: #e5e5e7;
    background: #1e1e20;
    border-color: #3a3a3c;
  }

  :global(html.dark) .group-name-input:focus {
    border-color: #22D3EE;
    box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.2);
  }

  .group-swatches {
    display: flex;
    gap: 6px;
    padding: 0 6px 6px;
  }

  .group-swatch {
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--group-color);
    cursor: pointer;
    flex-shrink: 0;
  }

  .group-swatch.selected {
    box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--group-color);
  }

  :global(html.dark) .group-swatch.selected {
    box-shadow: 0 0 0 2px #2c2c2e, 0 0 0 4px var(--group-color);
  }

  .group-swatch:focus-visible {
    outline: 2px solid #0891B2;
    outline-offset: 4px;
  }

  /* The colour of a group named in the tab menu. */
  .group-swatch-dot {
    width: 10px;
    height: 10px;
    margin-right: 8px;
    border-radius: 50%;
    background: var(--group-color);
    flex-shrink: 0;
  }

  .menu-group-label {
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dropdown {
    position: fixed;
    /* As wide as the longest entry, so translated labels stay on one line. */
    min-width: 160px;
    width: max-content;
    background: white;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06);
    z-index: 50;
    padding: 4px;
    overflow: hidden;
  }

  :global(html.dark) .dropdown {
    background: #2c2c2e;
    border-color: #3a3a3c;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 7px 10px;
    font-size: 12px;
    color: #1c1c1e;
    background: none;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    text-align: left;
  }

  :global(html.dark) .dropdown-item {
    color: #e5e5e7;
  }

  .dropdown-item:hover {
    background: #f2f2f7;
  }

  :global(html.dark) .dropdown-item:hover {
    background: #3a3a3c;
  }

  .dropdown-separator {
    height: 1px;
    margin: 4px 6px;
    background: #e5e5e5;
  }

  :global(html.dark) .dropdown-separator {
    background: #3a3a3c;
  }

  @media print {
    .tabbar { display: none !important; }
  }
</style>
