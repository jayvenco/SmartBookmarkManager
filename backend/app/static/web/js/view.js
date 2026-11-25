// View state (what the user is looking at) and the filter/sort logic.
import { categoryAndDescendants, state, usageOf, emit, on } from "./state.js";
import { saveStore, store } from "./utils.js";

export const view = {
  mode: "all", // all | starred | recent | unread | archived | global | category | board
  category: null,
  board: null,
  tags: new Set(),
  status: "",
  q: "",
  sort: store("sort", "recent"),
  layout: store("layout", "grid"),
  sidebar: store("sidebar", true),
  detail: store("detail", true),
  selected: null, // bookmark id shown in the detail panel
  selectMode: false,
  picked: new Set(), // bulk selection
  lastPicked: null,
  limit: 120,
};

export function setView(patch) {
  const filterChanged = ["mode", "category", "board", "q", "status", "sort"].some((k) => k in patch && patch[k] !== view[k]);
  Object.assign(view, patch);
  if (filterChanged) view.limit = 120;
  for (const k of ["sort", "layout", "sidebar", "detail"]) if (k in patch) saveStore(k, view[k]);
  emit("view");
}

export function toggleTag(tag) {
  view.tags.has(tag) ? view.tags.delete(tag) : view.tags.add(tag);
  view.limit = 120;
  emit("view");
}

export function resetFilters() {
  view.tags.clear();
  view.status = "";
  view.q = "";
  view.limit = 120;
  emit("view");
}

const DAY = 86400000;

function inView(b) {
  switch (view.mode) {
    case "starred": return b.starred && b.status !== "archived";
    case "recent": return Date.now() - b.created_at < 7 * DAY && b.status !== "archived";
    case "unread": return b.status === "unread";
    case "archived": return b.status === "archived";
    case "global": return b.scope === "global";
    case "category": return categoryAndDescendants(view.category).has(b.collection_id) && b.status !== "archived";
    case "board": return (b.boards || []).includes(view.board);
    default: return b.status !== "archived";
  }
}

export function matchesQuery(b, q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const cat = state.categories.get(b.collection_id)?.name || "";
  const hay = `${b.title} ${b.url} ${b.description} ${b.notes} ${(b.tags || []).join(" ")} ${cat}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

const SORTS = {
  recent: (a, b) => b.created_at - a.created_at,
  updated: (a, b) => b.updated_at - a.updated_at,
  visited: (a, b) => usageOf(b.id).last - usageOf(a.id).last || b.created_at - a.created_at,
  mostvisited: (a, b) => usageOf(b.id).count - usageOf(a.id).count || b.created_at - a.created_at,
  title: (a, b) => (a.title || a.url).localeCompare(b.title || b.url),
};
export const SORT_LABELS = { recent: "Recently added", updated: "Recently updated", visited: "Recently visited", mostvisited: "Most visited", title: "Title A-Z" };

export function visibleBookmarks() {
  const rows = [];
  for (const b of state.bookmarks.values()) {
    if (view.status) {
      if (b.status !== view.status || !inViewIgnoringStatus(b)) continue;
    } else if (!inView(b)) continue;
    let ok = true;
    for (const t of view.tags) if (!(b.tags || []).includes(t)) { ok = false; break; }
    if (ok && matchesQuery(b, view.q)) rows.push(b);
  }
  rows.sort(SORTS[view.sort] || SORTS.recent);
  // Pinned first, keeping the chosen order inside each group.
  return [...rows.filter((b) => b.pinned), ...rows.filter((b) => !b.pinned)];
}

// With an explicit status filter the "hide archived" part of a view must not apply.
function inViewIgnoringStatus(b) {
  switch (view.mode) {
    case "starred": return b.starred;
    case "recent": return Date.now() - b.created_at < 7 * DAY;
    case "unread": case "archived": return true;
    case "global": return b.scope === "global";
    case "category": return categoryAndDescendants(view.category).has(b.collection_id);
    case "board": return (b.boards || []).includes(view.board);
    default: return true;
  }
}

export function counts() {
  const c = { all: 0, starred: 0, recent: 0, unread: 0, archived: 0, global: 0, byCategory: new Map(), byBoard: new Map(), tags: new Map() };
  const now = Date.now();
  for (const b of state.bookmarks.values()) {
    const archived = b.status === "archived";
    if (archived) c.archived++;
    else {
      c.all++;
      if (b.starred) c.starred++;
      if (now - b.created_at < 7 * DAY) c.recent++;
      if (b.collection_id) c.byCategory.set(b.collection_id, (c.byCategory.get(b.collection_id) || 0) + 1);
    }
    if (b.status === "unread") c.unread++;
    if (b.scope === "global") c.global++;
    for (const id of b.boards || []) c.byBoard.set(id, (c.byBoard.get(id) || 0) + 1);
    for (const t of b.tags || []) c.tags.set(t, (c.tags.get(t) || 0) + 1);
  }
  return c;
}

// Keep the selection valid when data changes.
on("data", () => {
  if (view.selected && !state.bookmarks.has(view.selected)) view.selected = null;
  for (const id of [...view.picked]) if (!state.bookmarks.has(id)) view.picked.delete(id);
});
