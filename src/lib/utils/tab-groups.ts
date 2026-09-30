/**
 * Tab groups, the way Chrome does them: a named, coloured run of tabs that
 * can be folded away. A group's tabs always sit next to each other in the tab
 * order, so the bar can draw each group as one block while everything else
 * (Ctrl+Tab, closing, the saved session) keeps working on one flat list.
 *
 * These helpers are pure: they take the tab list and return a new one.
 */

/** In the order a new group picks them: blue first, grey last. */
export const GROUP_COLORS = ["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange", "grey"] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export interface TabGroup {
  id: string;
  name: string;
  color: GroupColor;
  collapsed: boolean;
}

interface Groupable {
  id: string;
  groupId: string | null;
}

export function isGroupColor(value: unknown): value is GroupColor {
  return typeof value === "string" && (GROUP_COLORS as readonly string[]).includes(value);
}

function lastIndexWhere<T>(items: T[], test: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (test(items[i])) return i;
  }
  return -1;
}

/** Gathers each group's tabs right after its first tab, keeping every other order. */
export function keepGroupsTogether<T extends Groupable>(tabs: T[]): T[] {
  const placed = new Set<string>();
  const out: T[] = [];
  for (const tab of tabs) {
    if (!tab.groupId) {
      out.push(tab);
    } else if (!placed.has(tab.groupId)) {
      placed.add(tab.groupId);
      out.push(...tabs.filter((t) => t.groupId === tab.groupId));
    }
  }
  return out;
}

/**
 * Drag and drop: moves the tab at `from` to `to`. Dropped between two tabs of
 * one group, the tab joins that group; dropped next to its own group, it stays
 * in it; anywhere else it leaves it. A tab alone in its group is the whole
 * group, so it keeps it wherever it lands outside another group.
 */
export function moveTab<T extends Groupable>(tabs: T[], from: number, to: number): T[] {
  if (from === to || !tabs[from] || !tabs[to]) return tabs;
  const arr = [...tabs];
  const [moved] = arr.splice(from, 1);
  arr.splice(to, 0, moved);

  const before = arr[to - 1]?.groupId ?? null;
  const after = arr[to + 1]?.groupId ?? null;
  const own = moved.groupId;
  const aloneInGroup = !!own && !tabs.some((t) => t !== moved && t.groupId === own);
  let groupId: string | null;
  if (before && before === after) groupId = before;
  else if (own && (aloneInGroup || before === own || after === own)) groupId = own;
  else groupId = null;

  if (groupId !== own) arr[to] = { ...moved, groupId };
  return keepGroupsTogether(arr);
}

/**
 * Puts a tab in a group (`null` takes it out of its group). A tab joining a
 * group that has tabs lands after the last of them. Otherwise it stays where
 * it is, unless that is inside the group it leaves: then it moves just past
 * that group, so the group stays in one piece.
 */
export function setTabGroup<T extends Groupable>(tabs: T[], tabId: string, groupId: string | null): T[] {
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx === -1 || tabs[idx].groupId === groupId) return tabs;
  const tab = tabs[idx];
  const rest = tabs.filter((_, i) => i !== idx);

  const lastOfTarget = groupId ? lastIndexWhere(rest, (t) => t.groupId === groupId) : -1;
  let at: number;
  if (lastOfTarget !== -1) {
    at = lastOfTarget + 1;
  } else {
    const lastOfOld = tab.groupId ? lastIndexWhere(rest, (t) => t.groupId === tab.groupId) : -1;
    at = Math.max(idx, lastOfOld + 1);
  }
  rest.splice(at, 0, { ...tab, groupId });
  return rest;
}

/** The groups that still hold a tab. */
export function liveGroups(groups: TabGroup[], tabs: Groupable[]): TabGroup[] {
  const used = new Set(tabs.map((t) => t.groupId));
  return groups.filter((g) => used.has(g.id));
}

/** The first colour no group uses yet; once all are taken, round again. */
export function nextGroupColor(groups: TabGroup[]): GroupColor {
  const used = new Set(groups.map((g) => g.color));
  return GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[groups.length % GROUP_COLORS.length];
}

export function collapsedGroupIds(groups: TabGroup[]): Set<string> {
  return new Set(groups.filter((g) => g.collapsed).map((g) => g.id));
}

/** A tab is out of sight when its group is folded. */
export function isTabHidden(tab: Groupable, collapsed: Set<string>): boolean {
  return !!tab.groupId && collapsed.has(tab.groupId);
}

/**
 * The tab to show when the one at `start` goes away (closed, or folded into
 * its group): the first shown tab from `start` on, else the nearest one
 * before it. `null` when every tab is folded away (the caller goes Home).
 */
export function nearestShownTab<T extends Groupable>(tabs: T[], collapsed: Set<string>, start: number): T | null {
  for (let i = Math.max(start, 0); i < tabs.length; i++) {
    if (!isTabHidden(tabs[i], collapsed)) return tabs[i];
  }
  for (let i = Math.min(start, tabs.length) - 1; i >= 0; i--) {
    if (!isTabHidden(tabs[i], collapsed)) return tabs[i];
  }
  return null;
}

/** How to call a group in a menu: its name, or its tabs when it has none ("a.md + 2"). */
export function groupLabel(group: TabGroup, tabs: (Groupable & { fileName: string })[]): string {
  const name = group.name.trim();
  if (name) return name;
  const members = tabs.filter((t) => t.groupId === group.id);
  if (members.length === 0) return "";
  return members.length === 1 ? members[0].fileName : `${members[0].fileName} + ${members.length - 1}`;
}

export interface TabRun<T> {
  /** `null` for a run of tabs outside any group. */
  group: TabGroup | null;
  tabs: { tab: T; index: number }[];
}

/** Splits the tab list into what the bar draws: groups, and the loose tabs between them. */
export function tabRuns<T extends Groupable>(tabs: T[], groups: TabGroup[]): TabRun<T>[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const runs: TabRun<T>[] = [];
  tabs.forEach((tab, index) => {
    const group = (tab.groupId && byId.get(tab.groupId)) || null;
    const last = runs[runs.length - 1];
    if (last && last.group?.id === group?.id) {
      last.tabs.push({ tab, index });
    } else {
      runs.push({ group, tabs: [{ tab, index }] });
    }
  });
  return runs;
}
