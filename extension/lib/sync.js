import { apiFetch, ApiError } from "./api.js";
import { getConfig, setConfig } from "./config.js";
import { del, get, getAll, put, putMany } from "./db.js";

// Fields the server accepts (everything else is local bookkeeping).
const B_FIELDS = ["id", "url", "title", "description", "notes", "favicon", "collection_id", "status", "tags", "scope", "created_at", "updated_at", "deleted"];
const C_FIELDS = ["id", "name", "parent_id", "scope", "created_at", "updated_at", "deleted"];
const pick = (obj, fields) => Object.fromEntries(fields.map((f) => [f, obj[f] ?? (f === "tags" ? [] : f === "deleted" ? false : undefined)]));

let running = null;

/** Push local changes and pull remote ones in one round trip. Safe to call often. */
export function syncNow() {
  if (!running) running = runSync().finally(() => (running = null));
  return running;
}

async function runSync() {
  const cfg = await getConfig();
  if (!cfg.token || !cfg.serverUrl) return { skipped: true };
  try {
    const result = await doSync();
    await setConfig({ lastSync: Date.now(), lastError: "" });
    return result;
  } catch (e) {
    const detail = e instanceof ApiError ? e.detail || e.message : String(e);
    await setConfig({ lastError: detail });
    return { error: detail };
  }
}

async function doSync() {
  const since = (await get("meta", "rev"))?.value ?? 0;
  const [bookmarks, collections, pending] = await Promise.all([getAll("bookmarks"), getAll("collections"), getAll("usage_pending")]);
  const dirtyB = bookmarks.filter((b) => b.dirty);
  const dirtyC = collections.filter((c) => c.dirty);

  const data = await apiFetch("/sync", {
    method: "POST",
    body: {
      since,
      bookmarks: dirtyB.map((b) => pick(b, B_FIELDS)),
      collections: dirtyC.map((c) => pick(c, C_FIELDS)),
      usage: pending.map((p) => ({ bookmark_id: p.bookmark_id, opens: p.opens, last_opened_at: p.last_opened_at })),
    },
  });

  const sentB = new Map(dirtyB.map((b) => [b.id, b.updated_at]));
  const sentC = new Map(dirtyC.map((c) => [c.id, c.updated_at]));
  const rejected = new Set(data.rejected.map((r) => r.id));

  await applyRecords("bookmarks", data.bookmarks, sentB);
  await applyRecords("collections", data.collections, sentC);

  // Rejected pushes (e.g. a non-admin publishing a global bookmark): stop retrying.
  for (const [store, sent] of [["bookmarks", sentB], ["collections", sentC]]) {
    for (const id of sent.keys()) {
      if (!rejected.has(id)) continue;
      const local = await get(store, id);
      if (local && local.dirty && local.updated_at === sent.get(id)) await put(store, { ...local, dirty: 0, sync_error: "rejected" });
    }
  }

  // Usage: server totals replace local totals; only the part we sent leaves the pending queue.
  await putMany("usage", data.usage);
  for (const p of pending) {
    const now = await get("usage_pending", p.bookmark_id);
    if (!now) continue;
    const left = now.opens - p.opens;
    if (left > 0) await put("usage_pending", { ...now, opens: left });
    else await del("usage_pending", p.bookmark_id);
  }

  await put("meta", { key: "rev", value: data.rev });
  return { rev: data.rev, pushed: dirtyB.length + dirtyC.length, pulled: data.bookmarks.length + data.collections.length };
}

async function applyRecords(store, records, sent) {
  for (const rec of records) {
    const local = await get(store, rec.id);
    // Local edit made while the request was in flight: keep it, it syncs next time.
    if (local && local.dirty && local.updated_at !== sent.get(rec.id)) continue;
    if (rec.deleted) await del(store, rec.id);
    else await put(store, { ...rec, dirty: 0 });
  }
}
