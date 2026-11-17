// Local data layer used by the popup and manager. Every write marks the record dirty and
// asks the service worker to sync.
import { byUrl, del, get, getAll, put } from "./db.js";
import { getConfig } from "./config.js";

export const now = () => Date.now();

export function requestSync() {
  try {
    chrome.runtime.sendMessage({ type: "sync" }).catch(() => {});
  } catch (_) {}
}

export function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = "";
    let s = u.href;
    if (u.pathname === "/" && !u.search && s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch (_) {
    return raw;
  }
}

export function normalizeTags(tags) {
  const seen = new Set();
  const out = [];
  for (const t of tags) {
    const v = String(t).trim().toLowerCase().replace(/\s+/g, " ").slice(0, 64);
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export async function listBookmarks() {
  return (await getAll("bookmarks")).filter((b) => !b.deleted);
}

export async function listCollections() {
  return (await getAll("collections")).filter((c) => !c.deleted);
}

export async function findByUrl(url) {
  const norm = normalizeUrl(url);
  const rows = await byUrl(norm);
  return rows.find((b) => !b.deleted) || null;
}

export async function usageMap() {
  const [totals, pending] = await Promise.all([getAll("usage"), getAll("usage_pending")]);
  const map = new Map(totals.map((u) => [u.bookmark_id, { count: u.open_count, last: u.last_opened_at }]));
  for (const p of pending) {
    const cur = map.get(p.bookmark_id) || { count: 0, last: 0 };
    map.set(p.bookmark_id, { count: cur.count + p.opens, last: Math.max(cur.last, p.last_opened_at) });
  }
  return map;
}

export async function canEdit(bookmark) {
  const { user } = await getConfig();
  if (!user) return true;
  return bookmark.scope !== "global" || bookmark.owner_id === user.id || user.role === "admin";
}

/** Create or update a bookmark. `fields`: title, url, tags, collection_id, notes, status, scope. */
export async function saveBookmark(fields, existing = null) {
  const { user } = await getConfig();
  const t = now();
  const rec = existing
    ? { ...existing }
    : { id: crypto.randomUUID(), owner_id: user?.id, scope: "private", status: "unread", description: "", notes: "", favicon: "", created_at: t };
  Object.assign(rec, fields);
  if (fields.url) rec.url = normalizeUrl(fields.url);
  rec.tags = normalizeTags(rec.tags || []);
  rec.collection_id = rec.collection_id || null;
  rec.deleted = false;
  rec.updated_at = Math.max(t, (existing?.updated_at || 0) + 1);
  rec.dirty = 1;
  await put("bookmarks", rec);
  requestSync();
  return rec;
}

export async function deleteBookmark(bookmark) {
  await put("bookmarks", { ...bookmark, deleted: true, updated_at: Math.max(now(), bookmark.updated_at + 1), dirty: 1 });
  requestSync();
}

export async function saveCollection(fields, existing = null) {
  const t = now();
  const rec = existing ? { ...existing } : { id: crypto.randomUUID(), scope: "private", parent_id: null, created_at: t };
  Object.assign(rec, fields);
  rec.deleted = false;
  rec.updated_at = Math.max(t, (existing?.updated_at || 0) + 1);
  rec.dirty = 1;
  await put("collections", rec);
  requestSync();
  return rec;
}

export async function deleteCollection(collection) {
  // Move bookmarks and child collections up one level instead of orphaning them.
  const [bookmarks, collections] = await Promise.all([listBookmarks(), listCollections()]);
  for (const b of bookmarks) if (b.collection_id === collection.id && (await canEdit(b))) await saveBookmark({ collection_id: collection.parent_id }, b);
  for (const c of collections) if (c.parent_id === collection.id) await saveCollection({ parent_id: collection.parent_id }, c);
  await put("collections", { ...collection, deleted: true, updated_at: Math.max(now(), collection.updated_at + 1), dirty: 1 });
  requestSync();
}

/** Count an open locally (works offline); the sync adds it to the server total. */
export async function recordOpen(bookmarkId) {
  const cur = (await get("usage_pending", bookmarkId)) || { bookmark_id: bookmarkId, opens: 0, last_opened_at: 0 };
  await put("usage_pending", { bookmark_id: bookmarkId, opens: cur.opens + 1, last_opened_at: now() });
}

export function allTags(bookmarks) {
  const counts = new Map();
  for (const b of bookmarks) for (const t of b.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Collections as a flat, depth-annotated, alphabetically sorted tree. */
export function flattenCollections(collections) {
  const byParent = new Map();
  const ids = new Set(collections.map((c) => c.id));
  for (const c of collections) {
    const p = c.parent_id && ids.has(c.parent_id) ? c.parent_id : null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(c);
  }
  const out = [];
  const walk = (parent, depth) => {
    for (const c of (byParent.get(parent) || []).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ ...c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_) {
    return "";
  }
}
