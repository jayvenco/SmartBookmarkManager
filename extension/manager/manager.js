import { createChipInput } from "../lib/chips.js";
import { getConfig } from "../lib/config.js";
import {
  allTags, canEdit, deleteBookmark, deleteCollection, domainOf, flattenCollections, listBookmarks,
  listCollections, recordOpen, requestSync, saveBookmark, saveCollection, usageMap,
} from "../lib/store.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
};

const state = { q: "", view: "all", collection: null, tags: new Set(), sort: "recent" };
let data = { bookmarks: [], collections: [], usage: new Map(), user: null };

// ---------- data ----------
async function load() {
  const [bookmarks, collections, usage, cfg] = await Promise.all([listBookmarks(), listCollections(), usageMap(), getConfig()]);
  data = { bookmarks, collections, usage, user: cfg.user || null };
  render();
}

function descendantIds(id) {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of data.collections) if (c.parent_id && ids.has(c.parent_id) && !ids.has(c.id)) { ids.add(c.id); grew = true; }
  }
  return ids;
}

function matchesView(b) {
  switch (state.view) {
    case "unread": return b.status === "unread";
    case "archived": return b.status === "archived";
    case "global": return b.scope === "global";
    case "uncategorized": return !b.collection_id && b.status !== "archived";
    case "collection": return descendantIds(state.collection).has(b.collection_id) && b.status !== "archived";
    default: return b.status !== "archived";
  }
}

function visibleBookmarks() {
  const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = data.bookmarks.filter((b) => {
    if (!matchesView(b)) return false;
    for (const t of state.tags) if (!(b.tags || []).includes(t)) return false;
    if (!terms.length) return true;
    const hay = `${b.title} ${b.url} ${b.notes} ${b.description} ${(b.tags || []).join(" ")}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  const u = (b) => data.usage.get(b.id) || { count: 0, last: 0 };
  const sorters = {
    recent: (a, b) => b.created_at - a.created_at,
    title: (a, b) => (a.title || a.url).localeCompare(b.title || b.url),
    used: (a, b) => u(b).count - u(a).count || b.created_at - a.created_at,
    opened: (a, b) => u(b).last - u(a).last,
  };
  return rows.sort(sorters[state.sort]);
}

// ---------- rendering ----------
function navItem(label, count, active, onClick, extra) {
  const btn = el("button", { className: "item" + (active ? " active" : ""), type: "button" }, el("span", {}, label), el("span", { className: "count" }, extra || "", count != null ? String(count) : ""));
  btn.addEventListener("click", onClick);
  return btn;
}

function setView(view, collection = null) {
  state.view = view;
  state.collection = collection;
  render();
}

function render() {
  const bms = data.bookmarks;
  const smart = $("smart");
  smart.replaceChildren(
    navItem("All bookmarks", bms.filter((b) => b.status !== "archived").length, state.view === "all", () => setView("all")),
    navItem("Unread", bms.filter((b) => b.status === "unread").length, state.view === "unread", () => setView("unread")),
    navItem("Global", bms.filter((b) => b.scope === "global").length, state.view === "global", () => setView("global")),
    navItem("Uncategorized", bms.filter((b) => !b.collection_id && b.status !== "archived").length, state.view === "uncategorized", () => setView("uncategorized")),
    navItem("Archived", bms.filter((b) => b.status === "archived").length, state.view === "archived", () => setView("archived"))
  );

  const cols = $("collections");
  cols.replaceChildren(
    ...flattenCollections(data.collections).map((c) => {
      const count = bms.filter((b) => b.collection_id === c.id && b.status !== "archived").length;
      const btn = navItem(
        "  ".repeat(c.depth) + c.name + (c.scope === "global" ? " 🌐" : ""),
        count,
        state.view === "collection" && state.collection === c.id,
        () => setView("collection", c.id)
      );
      btn.addEventListener("dblclick", () => openCollectionDialog(c));
      btn.title = "Double-click to rename, move or delete";
      return btn;
    })
  );

  const tagBox = $("tags");
  tagBox.replaceChildren(
    ...allTags(bms).map(([tag, count]) => navItem("#" + tag, count, state.tags.has(tag), () => toggleTag(tag)))
  );
  $("clear-tags").classList.toggle("hidden", state.tags.size === 0);

  renderList();
}

function toggleTag(tag) {
  state.tags.has(tag) ? state.tags.delete(tag) : state.tags.add(tag);
  render();
}

function renderList() {
  const rows = visibleBookmarks();
  const colName = new Map(data.collections.map((c) => [c.id, c.name]));
  $("summary").textContent = `${rows.length} bookmark${rows.length === 1 ? "" : "s"}` + (state.tags.size ? ` · tags: ${[...state.tags].join(" + ")}` : "");
  $("empty").classList.toggle("hidden", rows.length > 0);
  $("empty").textContent = data.bookmarks.length ? "No bookmarks match these filters." : "No bookmarks yet. Press Alt+Shift+B on any page to add one.";

  $("list").replaceChildren(
    ...rows.slice(0, 500).map((b) => {
      const usage = data.usage.get(b.id);
      const title = el("button", { className: "title", type: "button", title: b.url }, b.title || b.url);
      title.addEventListener("click", () => openBookmark(b));
      const sub = el(
        "div",
        { className: "sub" },
        el("span", {}, domainOf(b.url) || b.url),
        b.collection_id && colName.get(b.collection_id) ? el("span", {}, "📁 " + colName.get(b.collection_id)) : null,
        ...(b.tags || []).map((t) => {
          const chip = el("button", { className: "chip small" + (state.tags.has(t) ? " on" : ""), type: "button" }, "#" + t);
          chip.addEventListener("click", () => toggleTag(t));
          return chip;
        })
      );
      const edit = el("button", { className: "ghost", type: "button" }, "Edit");
      edit.addEventListener("click", () => openEditDialog(b));
      const side = el(
        "div",
        { className: "side" },
        b.scope === "global" ? el("span", { className: "badge" }, "global") : null,
        usage?.count ? el("span", {}, `${usage.count}× opened`) : null,
        edit
      );
      return el("li", { className: `row ${b.status}` }, el("div", {}, title, sub), side);
    })
  );
}

async function openBookmark(b) {
  await recordOpen(b.id);
  if (b.status === "unread" && (await canEdit(b))) await saveBookmark({ status: "read" }, b);
  chrome.tabs.create({ url: b.url });
  data.usage = await usageMap();
  load();
}

// ---------- bookmark dialog ----------
let editing = null;
let editChips = null;

function fillCollectionSelect(select, selected, excludeId) {
  select.replaceChildren(new Option("— None —", ""));
  const banned = excludeId ? descendantIds(excludeId) : new Set();
  for (const c of flattenCollections(data.collections)) {
    if (!banned.has(c.id)) select.append(new Option("  ".repeat(c.depth) + c.name, c.id));
  }
  select.value = selected || "";
}

async function openEditDialog(b) {
  editing = b;
  const writable = await canEdit(b);
  $("e-title").value = b.title;
  $("e-url").value = b.url;
  $("e-notes").value = b.notes || "";
  $("e-status").value = b.status;
  $("e-error").textContent = "";
  $("e-tags").replaceChildren();
  editChips = createChipInput($("e-tags"), { suggestions: allTags(data.bookmarks).map(([t]) => t) });
  editChips.set(b.tags || []);
  fillCollectionSelect($("e-collection"), b.collection_id);
  const isOwner = data.user && b.owner_id === data.user.id;
  $("e-global-row").classList.toggle("hidden", !(data.user?.role === "admin" && isOwner));
  $("e-global").checked = b.scope === "global";
  for (const e of $("edit-form").querySelectorAll("input, select, textarea, #e-save, #e-delete")) e.disabled = !writable;
  $("edit-title").textContent = writable ? "Edit bookmark" : "Global bookmark (read-only)";
  $("edit").showModal();
}

$("edit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const fields = {
      title: $("e-title").value.trim(),
      url: $("e-url").value.trim(),
      tags: editChips.get(),
      collection_id: $("e-collection").value || null,
      status: $("e-status").value,
      notes: $("e-notes").value.trim(),
    };
    if (!$("e-global-row").classList.contains("hidden")) fields.scope = $("e-global").checked ? "global" : "private";
    await saveBookmark(fields, editing);
    $("edit").close();
    load();
  } catch (ex) {
    $("e-error").textContent = String(ex.message || ex);
  }
});
$("e-cancel").addEventListener("click", () => $("edit").close());
$("e-delete").addEventListener("click", async () => {
  if (!confirm("Delete this bookmark?")) return;
  await deleteBookmark(editing);
  $("edit").close();
  load();
});

// ---------- collection dialog ----------
let editingCollection = null;

function openCollectionDialog(c = null) {
  editingCollection = c;
  $("coll-title").textContent = c ? "Edit category" : "New category";
  $("c-name").value = c?.name || "";
  fillCollectionSelect($("c-parent"), c?.parent_id, c?.id);
  $("c-delete").classList.toggle("hidden", !c);
  const mayPublish = data.user?.role === "admin" && (!c || c.owner_id === data.user.id);
  $("c-global-row").classList.toggle("hidden", !mayPublish);
  $("c-global").checked = c?.scope === "global";
  const readOnly = c && c.scope === "global" && !(data.user?.role === "admin" || c.owner_id === data.user?.id);
  for (const e of $("coll-form").querySelectorAll("input, select, #c-save, #c-delete")) e.disabled = !!readOnly;
  $("coll-dialog").showModal();
}

$("add-collection").addEventListener("click", () => openCollectionDialog());
$("coll-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fields = { name: $("c-name").value.trim(), parent_id: $("c-parent").value || null };
  if (!$("c-global-row").classList.contains("hidden")) fields.scope = $("c-global").checked ? "global" : "private";
  await saveCollection(fields, editingCollection);
  $("coll-dialog").close();
  load();
});
$("c-cancel").addEventListener("click", () => $("coll-dialog").close());
$("c-delete").addEventListener("click", async () => {
  if (!confirm("Delete this category? Its bookmarks move up one level.")) return;
  await deleteCollection(editingCollection);
  if (state.collection === editingCollection.id) setView("all");
  $("coll-dialog").close();
  load();
});

// ---------- header + misc ----------
$("search").addEventListener("input", (e) => { state.q = e.target.value; renderList(); });
$("sort").addEventListener("change", (e) => { state.sort = e.target.value; renderList(); });
$("clear-tags").addEventListener("click", () => { state.tags.clear(); render(); });
$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("sync").addEventListener("click", async () => {
  $("sync-status").textContent = "Syncing…";
  await chrome.runtime.sendMessage({ type: "sync" }).catch(() => {});
  load();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
    e.preventDefault();
    $("search").focus();
  }
});

async function showStatus() {
  const cfg = await getConfig();
  const s = $("sync-status");
  if (!cfg.token) s.textContent = "Not connected";
  else if (cfg.lastError) s.textContent = "Sync problem: " + cfg.lastError;
  else s.textContent = cfg.lastSync ? "Synced " + new Date(cfg.lastSync).toLocaleTimeString() : "";
}

// Reload when a background sync finishes (it writes lastSync).
chrome.storage.onChanged.addListener((changes) => {
  if (changes.lastSync || changes.lastError || changes.user) { showStatus(); load(); }
});

load().then(showStatus);
requestSync();
