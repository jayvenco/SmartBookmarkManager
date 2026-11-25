// Data layer of the web app: in-memory maps, optimistic edits and a write-through sync
// against /ui/sync (the same engine as the extension, so both stay consistent).
import { api, ApiError } from "./api.js";
import { normalizeTags, normalizeUrl } from "./utils.js";

export const state = {
  user: null,
  rev: 0,
  online: true,
  syncing: false,
  bookmarks: new Map(),
  categories: new Map(),
  boards: new Map(),
  usage: new Map(), // bookmark_id -> { count, last } (server totals)
};

const listeners = {};
export const on = (evt, fn) => ((listeners[evt] ||= []).push(fn), fn);
export const emit = (evt, payload) => (listeners[evt] || []).forEach((fn) => fn(payload));

// Changes not yet confirmed by the server.
const dirty = { bookmarks: new Map(), collections: new Map(), boards: new Map(), usage: new Map() };

const B_FIELDS = ["id", "url", "title", "description", "notes", "favicon", "image", "collection_id", "status", "tags", "starred", "pinned", "boards", "scope", "created_at", "updated_at", "deleted"];
const C_FIELDS = ["id", "name", "parent_id", "scope", "created_at", "updated_at", "deleted"];
const D_FIELDS = ["id", "name", "emoji", "color", "scope", "created_at", "updated_at", "deleted"];
const pick = (obj, fields) => Object.fromEntries(fields.map((f) => [f, obj[f]]));

// ---------- loading and pulling ----------
export async function load() {
  const data = await api("GET", "/sync?since=0");
  state.bookmarks.clear();
  state.categories.clear();
  state.boards.clear();
  state.usage.clear();
  applyPull(data);
}

function applyMap(map, records, dirtyMap) {
  for (const r of records) {
    const d = dirtyMap.get(r.id);
    if (d && d.updated_at >= r.updated_at) continue; // newer local edit wins
    if (r.deleted) map.delete(r.id);
    else map.set(r.id, r);
  }
}

function applyPull(data) {
  applyMap(state.bookmarks, data.bookmarks, dirty.bookmarks);
  applyMap(state.categories, data.collections, dirty.collections);
  applyMap(state.boards, data.boards || [], dirty.boards);
  for (const u of data.usage) state.usage.set(u.bookmark_id, { count: u.open_count, last: u.last_opened_at });
  state.rev = data.rev;
  emit("data");
}

let pollTimer;
export function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (!document.hidden) pull(); }, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pull(); });
}

export async function pull() {
  if (state.syncing || hasDirty()) return push();
  try {
    applyPull(await api("GET", `/sync?since=${state.rev}`));
    setOnline(true);
  } catch (e) {
    handleError(e);
  }
}

// ---------- pushing ----------
const hasDirty = () => Object.values(dirty).some((m) => m.size);
let pushTimer;
export const schedulePush = (delay = 250) => { clearTimeout(pushTimer); pushTimer = setTimeout(push, delay); };

function take(map, n) {
  const out = [];
  for (const [k, v] of map) { if (out.length >= n) break; out.push([k, v]); }
  for (const [k] of out) map.delete(k);
  return out;
}

export async function push() {
  if (state.syncing) return;
  state.syncing = true;
  emit("status");
  try {
    while (hasDirty()) {
      const b = take(dirty.bookmarks, 500);
      const c = take(dirty.collections, 300);
      const d = take(dirty.boards, 300);
      const u = take(dirty.usage, 1000);
      try {
        const data = await api("POST", "/sync", {
          since: state.rev,
          collections: c.map(([, r]) => pick(r, C_FIELDS)),
          boards: d.map(([, r]) => pick(r, D_FIELDS)),
          bookmarks: b.map(([, r]) => pick(r, B_FIELDS)),
          usage: u.map(([id, x]) => ({ bookmark_id: id, opens: x.opens, last_opened_at: x.last })),
        });
        applyPull(data);
        if (data.rejected.length) {
          emit("toast", { message: "Some changes were not allowed and were reverted.", kind: "error" });
          await load();
        }
      } catch (e) {
        // Put the batch back (unless it was edited again meanwhile) and retry later.
        for (const [k, v] of b) if (!dirty.bookmarks.has(k)) dirty.bookmarks.set(k, v);
        for (const [k, v] of c) if (!dirty.collections.has(k)) dirty.collections.set(k, v);
        for (const [k, v] of d) if (!dirty.boards.has(k)) dirty.boards.set(k, v);
        for (const [k, v] of u) {
          const cur = dirty.usage.get(k);
          dirty.usage.set(k, cur ? { opens: cur.opens + v.opens, last: Math.max(cur.last, v.last) } : v);
        }
        throw e;
      }
    }
    setOnline(true);
  } catch (e) {
    handleError(e);
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 5000);
  } finally {
    state.syncing = false;
    emit("status");
  }
}

function handleError(e) {
  if (e instanceof ApiError && e.status === 401) return emit("auth-lost");
  setOnline(false);
}

function setOnline(v) {
  if (state.online !== v) { state.online = v; emit("status"); }
}

// ---------- permissions ----------
export function canEdit(record) {
  if (!record) return false;
  return record.scope !== "global" || record.owner_id === state.user.id || state.user.role === "admin";
}

const nextStamp = (prev) => Math.max(Date.now(), (prev?.updated_at || 0) + 1);

// ---------- bookmarks ----------
export function newBookmark(fields) {
  const now = Date.now();
  return {
    id: crypto.randomUUID(), owner_id: state.user.id, scope: "private", url: "", title: "", description: "", notes: "",
    favicon: "", image: "", collection_id: null, status: "unread", tags: [], starred: false, pinned: false, boards: [],
    created_at: now, updated_at: now, deleted: false, ...fields,
  };
}

export function saveBookmark(patch, existing = null) {
  const rec = existing ? { ...existing, ...patch } : newBookmark(patch);
  if (patch.url) rec.url = normalizeUrl(patch.url);
  rec.tags = normalizeTags(rec.tags || []);
  rec.updated_at = nextStamp(existing);
  rec.deleted = false;
  state.bookmarks.set(rec.id, rec);
  dirty.bookmarks.set(rec.id, rec);
  emit("data");
  schedulePush();
  return rec;
}

export function updateBookmarks(ids, patchFn) {
  for (const id of ids) {
    const b = state.bookmarks.get(id);
    if (b && canEdit(b)) saveBookmark(patchFn(b), b);
  }
}

export function removeBookmarks(ids) {
  for (const id of ids) {
    const b = state.bookmarks.get(id);
    if (!b || !canEdit(b)) continue;
    state.bookmarks.delete(id);
    dirty.bookmarks.set(id, { ...b, deleted: true, updated_at: nextStamp(b) });
  }
  emit("data");
  schedulePush();
}

export function findByUrl(url) {
  const norm = normalizeUrl(url);
  for (const b of state.bookmarks.values()) if (b.url === norm) return b;
  return null;
}

export function recordOpen(id) {
  const cur = dirty.usage.get(id) || { opens: 0, last: 0 };
  dirty.usage.set(id, { opens: cur.opens + 1, last: Date.now() });
  emit("data");
  schedulePush(1500);
}

export function usageOf(id) {
  const server = state.usage.get(id) || { count: 0, last: 0 };
  const pending = dirty.usage.get(id);
  return pending ? { count: server.count + pending.opens, last: Math.max(server.last, pending.last) } : server;
}

// ---------- categories (tree) ----------
export function saveCategory(patch, existing = null) {
  const now = Date.now();
  const rec = existing
    ? { ...existing, ...patch }
    : { id: crypto.randomUUID(), owner_id: state.user.id, scope: "private", parent_id: null, created_at: now, ...patch };
  rec.updated_at = nextStamp(existing);
  rec.deleted = false;
  state.categories.set(rec.id, rec);
  dirty.collections.set(rec.id, rec);
  emit("data");
  schedulePush();
  return rec;
}

export function removeCategory(cat) {
  // Children and bookmarks move up one level instead of becoming orphans.
  for (const c of [...state.categories.values()]) if (c.parent_id === cat.id && canEdit(c)) saveCategory({ parent_id: cat.parent_id }, c);
  updateBookmarks([...state.bookmarks.values()].filter((b) => b.collection_id === cat.id).map((b) => b.id), () => ({ collection_id: cat.parent_id }));
  state.categories.delete(cat.id);
  dirty.collections.set(cat.id, { ...cat, deleted: true, updated_at: nextStamp(cat) });
  emit("data");
  schedulePush();
}

export function categoryAndDescendants(id) {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of state.categories.values()) if (c.parent_id && ids.has(c.parent_id) && !ids.has(c.id)) { ids.add(c.id); grew = true; }
  }
  return ids;
}

/** Categories as a flat list with depth, children sorted by name. */
export function categoryTree() {
  const byParent = new Map();
  for (const c of state.categories.values()) {
    const p = c.parent_id && state.categories.has(c.parent_id) ? c.parent_id : null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(c);
  }
  const out = [];
  const walk = (parent, depth) => {
    for (const c of (byParent.get(parent) || []).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ ...c, depth, hasChildren: byParent.has(c.id) });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

// ---------- boards (UI: collections) ----------
export function saveBoard(patch, existing = null) {
  const now = Date.now();
  const rec = existing
    ? { ...existing, ...patch }
    : { id: crypto.randomUUID(), owner_id: state.user.id, scope: "private", emoji: "", color: "", created_at: now, ...patch };
  rec.updated_at = nextStamp(existing);
  rec.deleted = false;
  state.boards.set(rec.id, rec);
  dirty.boards.set(rec.id, rec);
  emit("data");
  schedulePush();
  return rec;
}

export function removeBoard(board) {
  updateBookmarks([...state.bookmarks.values()].filter((b) => (b.boards || []).includes(board.id)).map((b) => b.id), (b) => ({ boards: b.boards.filter((x) => x !== board.id) }));
  state.boards.delete(board.id);
  dirty.boards.set(board.id, { ...board, deleted: true, updated_at: nextStamp(board) });
  emit("data");
  schedulePush();
}

export function addToBoard(ids, boardId) {
  updateBookmarks(ids, (b) => ({ boards: [...new Set([...(b.boards || []), boardId])] }));
}

export function removeFromBoard(ids, boardId) {
  updateBookmarks(ids, (b) => ({ boards: (b.boards || []).filter((x) => x !== boardId) }));
}
