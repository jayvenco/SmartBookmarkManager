// Centre column: filter toolbar, bulk actions and the bookmark cards.
import { favTile, openBookmark, tagChip } from "./bm.js";
import { bookmarkDialog, boardDialog, confirmBox, moveDialog } from "./dialogs.js";
import { openImporter } from "./importer.js";
import { dnd } from "./sidebar.js";
import { canEdit, removeBookmarks, removeFromBoard, saveBookmark, state, usageOf } from "./state.js";
import { fmtDate, h, icon, toast } from "./utils.js";
import { SORT_LABELS, resetFilters, setView, toggleTag, view, visibleBookmarks } from "./view.js";

let els = {};
let shownIds = [];

export function initLibrary(root) {
  const filter = h("input", { placeholder: "Filter by title, URL, notes or tag…   ( / )", autocomplete: "off", oninput: (e) => setView({ q: e.target.value }) });
  const status = h("select", { onchange: (e) => setView({ status: e.target.value }) },
    h("option", { value: "" }, "All statuses"),
    ...["unread", "reading", "read", "archived", "dead"].map((s) => h("option", { value: s }, s === "dead" ? "Dead link" : s[0].toUpperCase() + s.slice(1))));
  const sort = h("select", { onchange: (e) => setView({ sort: e.target.value }) },
    Object.entries(SORT_LABELS).map(([k, v]) => h("option", { value: k }, v)));
  const gridBtn = h("button", { type: "button", title: "Cards", onclick: () => setView({ layout: "grid" }) }, icon("grid"));
  const listBtn = h("button", { type: "button", title: "List", onclick: () => setView({ layout: "list" }) }, icon("list"));
  const selectBtn = h("button", { class: "btn", type: "button", onclick: () => toggleSelectMode() }, icon("select"), "Select");
  const results = h("div", {});

  root.replaceChildren(
    h("div", { class: "toolbar" },
      h("div", { class: "filter" }, icon("search"), filter), status, sort,
      h("div", { class: "seg" }, gridBtn, listBtn)),
    h("div", { class: "actions-row" },
      h("button", { class: "btn primary", type: "button", onclick: () => bookmarkDialog() }, icon("plus"), "New bookmark"),
      selectBtn,
      h("button", { class: "btn", type: "button", onclick: () => openImporter() }, icon("upload"), "Import")),
    results);
  els = { filter, status, sort, gridBtn, listBtn, selectBtn, results };
  renderLibrary();
}

function toggleSelectMode() {
  view.selectMode = !view.selectMode;
  if (!view.selectMode) view.picked.clear();
  setView({});
}

export function renderLibrary() {
  if (!els.results) return;
  // keep controls in sync with the view state without recreating them (keeps focus while typing)
  if (document.activeElement !== els.filter) els.filter.value = view.q;
  els.status.value = view.status;
  els.sort.value = view.sort;
  els.gridBtn.classList.toggle("active", view.layout === "grid");
  els.listBtn.classList.toggle("active", view.layout === "list");
  els.selectBtn.classList.toggle("active", view.selectMode);

  const rows = visibleBookmarks();
  shownIds = rows.map((b) => b.id);
  const page = rows.slice(0, view.limit);

  const summary = h("div", { class: "summary" },
    h("span", {}, `${rows.length} bookmark${rows.length === 1 ? "" : "s"}`),
    [...view.tags].map((t) => h("span", {}, tagChip(t, () => toggleTag(t), true))),
    view.tags.size || view.status || view.q ? h("button", { class: "btn sm", type: "button", onclick: resetFilters }, icon("x", 12), "Clear filters") : null);

  const out = [summary];
  if (view.selectMode) out.push(bulkBar(rows));
  if (!rows.length) {
    out.push(h("div", { class: "empty" },
      icon("book", 36),
      h("strong", {}, state.bookmarks.size ? "Nothing matches these filters" : "No bookmarks yet"),
      h("span", {}, state.bookmarks.size ? "Try a different filter or clear the search." : "Add one with “New bookmark”, press Ctrl+K and paste a URL, or import your browser bookmarks.")));
  } else {
    out.push(h("div", { class: view.layout === "list" ? "list" : "grid" }, page.map(cardEl)));
    if (rows.length > page.length) out.push(h("button", { class: "btn more", type: "button", onclick: () => { view.limit += 240; renderLibrary(); } }, `Show more (${rows.length - page.length})`));
  }
  els.results.replaceChildren(...out);
}

function bulkBar(rows) {
  const ids = [...view.picked];
  const n = ids.length;
  const allPicked = rows.length > 0 && rows.every((b) => view.picked.has(b.id));
  const editable = ids.filter((id) => canEdit(state.bookmarks.get(id)));
  return h("div", { class: "bulkbar" },
    h("strong", {}, `${n} selected`),
    h("button", { class: "btn sm", type: "button", onclick: () => {
      allPicked ? view.picked.clear() : rows.forEach((b) => view.picked.add(b.id));
      renderLibrary();
    } }, allPicked ? "Deselect all" : "Select all"),
    h("span", { class: "grow" }),
    h("button", { class: "btn sm", type: "button", disabled: !editable.length, onclick: async () => { await moveDialog(editable); renderLibrary(); } }, "Move to…"),
    h("button", { class: "btn sm", type: "button", disabled: !n, onclick: async () => { await boardDialog({ ids }); } }, "New collection"),
    view.mode === "board" ? h("button", { class: "btn sm", type: "button", disabled: !editable.length, onclick: () => { removeFromBoard(editable, view.board); view.picked.clear(); } }, "Remove from collection") : null,
    h("button", { class: "btn sm danger", type: "button", disabled: !editable.length, onclick: async () => {
      if (await confirmBox("Delete bookmarks", `${editable.length} bookmark${editable.length === 1 ? "" : "s"} will be deleted.`)) { removeBookmarks(editable); view.picked.clear(); toast("Deleted"); }
    } }, "Delete"));
}

function cardEl(b) {
  const picked = view.picked.has(b.id);
  const usage = usageOf(b.id);
  const catName = state.categories.get(b.collection_id)?.name;
  const editable = canEdit(b);
  const star = h("button", { class: "icon-btn" + (b.starred ? " on" : ""), type: "button", title: "Star", disabled: !editable,
    onclick: (e) => { e.stopPropagation(); saveBookmark({ starred: !b.starred }, b); } }, icon("star"));
  const pin = h("button", { class: "icon-btn pin" + (b.pinned ? " on" : ""), type: "button", title: "Pin to top", disabled: !editable,
    onclick: (e) => { e.stopPropagation(); saveBookmark({ pinned: !b.pinned }, b); } }, icon("pin"));
  const tags = (b.tags || []).slice(0, 4);

  const card = h("div", { class: "card" + (view.selected === b.id ? " sel" : "") + (picked ? " picked" : ""), draggable: true, dataset: { id: b.id } },
    h("div", { class: "card-head" },
      favTile(b),
      h("div", { class: "grow" },
        h("div", { class: "card-title", title: b.title }, b.status === "unread" ? h("span", { class: "unread-dot", style: { display: "inline-block", marginRight: "6px", verticalAlign: "middle" } }) : null, b.title || b.url),
        h("div", { class: "card-domain ellipsis" }, b.url.replace(/^https?:\/\/(www\.)?/, ""))),
      view.selectMode ? h("input", { class: "pickbox", type: "checkbox", checked: picked, tabindex: "-1" }) : h("span", { style: { display: "flex" } }, pin, star)),
    b.description ? h("div", { class: "card-desc" }, b.description) : null,
    tags.length ? h("div", { class: "card-tags" }, tags.map((t) => tagChip(t, (e) => { e.stopPropagation(); toggleTag(t); }, view.tags.has(t))), b.tags.length > 4 ? h("span", { class: "muted" }, `+${b.tags.length - 4}`) : null) : null,
    h("div", { class: "card-foot" },
      catName ? h("span", { class: "ellipsis", style: { maxWidth: "90px" }, title: catName }, icon("folder", 12), " ", catName) : null,
      b.scope === "global" ? h("span", { title: "Global" }, icon("globe", 12)) : null,
      h("span", {}, fmtDate(b.created_at)),
      usage.count ? h("span", { title: "Times opened" }, `${usage.count}×`) : null,
      h("span", { class: "acts" },
        h("button", { class: "btn sm", type: "button", title: "Open", onclick: (e) => { e.stopPropagation(); openBookmark(b) || toast("This link type cannot be opened from the web app", "error"); } }, icon("link", 13)),
        editable ? h("button", { class: "btn sm", type: "button", onclick: (e) => { e.stopPropagation(); bookmarkDialog({ existing: b }); } }, "Edit") : null,
        editable ? h("button", { class: "btn sm", type: "button", onclick: (e) => { e.stopPropagation(); moveDialog([b.id]); } }, "Move") : null,
        editable ? h("button", { class: "btn sm danger", type: "button", onclick: async (e) => {
          e.stopPropagation();
          if (await confirmBox("Delete bookmark", `"${b.title || b.url}" will be deleted.`)) removeBookmarks([b.id]);
        } }, "Delete") : null)));

  card.addEventListener("click", (e) => {
    if (view.selectMode) {
      if (e.shiftKey && view.lastPicked && shownIds.includes(view.lastPicked)) {
        const a = shownIds.indexOf(view.lastPicked), z = shownIds.indexOf(b.id);
        for (const id of shownIds.slice(Math.min(a, z), Math.max(a, z) + 1)) view.picked.add(id);
      } else {
        picked ? view.picked.delete(b.id) : view.picked.add(b.id);
      }
      view.lastPicked = b.id;
      renderLibrary();
      return;
    }
    if (e.metaKey || e.ctrlKey) { view.selectMode = true; view.picked.add(b.id); view.lastPicked = b.id; setView({}); return; }
    setView({ selected: b.id, detail: true });
  });
  card.addEventListener("dblclick", () => { if (!view.selectMode) openBookmark(b); });
  card.addEventListener("dragstart", (e) => {
    dnd.ids = view.picked.has(b.id) && view.picked.size ? [...view.picked] : [b.id];
    e.dataTransfer.setData("text/plain", b.url);
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => { card.classList.remove("dragging"); setTimeout(() => (dnd.ids = []), 50); });
  return card;
}
