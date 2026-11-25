import { boardDialog, categoryDialog } from "./dialogs.js";
import { addToBoard, canEdit, categoryTree, state, updateBookmarks } from "./state.js";
import { h, hueOf, icon, saveStore, setChildren, store } from "./utils.js";
import { counts, setView, toggleTag, view } from "./view.js";

export const dnd = { ids: [] }; // bookmark ids being dragged

let collapsed = new Set(store("collapsed", []));
let showAllTags = false;

function navItem({ ico, emoji, dot, label, count, active, onclick, onDrop, onEdit, depth = 0, twisty }) {
  const el = h("button", { class: "nav-item" + (active ? " active" : ""), type: "button", style: { paddingLeft: 8 + depth * 14 + "px" }, onclick },
    twisty ? h("span", { class: "twisty", onclick: (e) => { e.stopPropagation(); twisty.toggle(); } }, icon(twisty.open ? "down" : "right", 12)) : depth ? null : null,
    emoji ? h("span", { class: "emoji" }, emoji) : ico ? icon(ico) : null,
    dot ? h("span", { class: "dot", style: { background: dot } }) : null,
    h("span", { class: "ellipsis" }, label),
    h("span", { class: "count" }, count == null ? "" : String(count)),
    onEdit ? h("span", { class: "icon-btn edit", role: "button", title: "Edit", onclick: (e) => { e.stopPropagation(); onEdit(); } }, icon("edit", 13)) : null);
  if (onDrop) {
    el.addEventListener("dragover", (e) => { if (dnd.ids.length) { e.preventDefault(); el.classList.add("drop"); } });
    el.addEventListener("dragleave", () => el.classList.remove("drop"));
    el.addEventListener("drop", (e) => { e.preventDefault(); el.classList.remove("drop"); if (dnd.ids.length) onDrop([...dnd.ids]); dnd.ids = []; });
  }
  return el;
}

export function renderSidebar(root) {
  const c = counts();
  const m = (mode) => view.mode === mode;
  const library = [
    navItem({ ico: "book", label: "All bookmarks", count: c.all, active: m("all"), onclick: () => setView({ mode: "all" }) }),
    navItem({ ico: "star", label: "Starred", count: c.starred, active: m("starred"), onclick: () => setView({ mode: "starred" }) }),
    navItem({ ico: "clock", label: "Recently added", count: c.recent, active: m("recent"), onclick: () => setView({ mode: "recent" }) }),
    navItem({ ico: "check", label: "Unread", count: c.unread, active: m("unread"), onclick: () => setView({ mode: "unread" }) }),
    c.global ? navItem({ ico: "globe", label: "Global", count: c.global, active: m("global"), onclick: () => setView({ mode: "global" }) }) : null,
    navItem({ ico: "archive", label: "Archived", count: c.archived, active: m("archived"), onclick: () => setView({ mode: "archived" }) }),
  ];

  // Categories (tree), honouring collapsed branches.
  const cats = [];
  let skipBelow = Infinity;
  for (const cat of categoryTree()) {
    if (cat.depth > skipBelow) continue;
    skipBelow = Infinity;
    const open = !collapsed.has(cat.id);
    if (cat.hasChildren && !open) skipBelow = cat.depth;
    cats.push(navItem({
      ico: cat.scope === "global" ? "globe" : "folder", label: cat.name, count: c.byCategory.get(cat.id) || 0, depth: cat.depth,
      active: m("category") && view.category === cat.id,
      onclick: () => setView({ mode: "category", category: cat.id }),
      onDrop: (ids) => updateBookmarks(ids, () => ({ collection_id: cat.id })),
      onEdit: () => categoryDialog({ existing: state.categories.get(cat.id) }),
      twisty: cat.hasChildren ? { open, toggle: () => { open ? collapsed.add(cat.id) : collapsed.delete(cat.id); saveStore("collapsed", [...collapsed]); renderSidebar(root); } } : null,
    }));
  }

  const boards = [...state.boards.values()].sort((a, b) => a.name.localeCompare(b.name)).map((b) => navItem({
    emoji: b.emoji || null, ico: b.emoji ? null : "tag", dot: b.color || null, label: b.name, count: c.byBoard.get(b.id) || 0,
    active: m("board") && view.board === b.id,
    onclick: () => setView({ mode: "board", board: b.id }),
    onDrop: (ids) => addToBoard(ids, b.id),
    onEdit: () => boardDialog({ existing: b }),
  }));
  const dropzone = h("div", { class: "dropzone" }, "Drop bookmarks here to create a collection");
  dropzone.addEventListener("dragover", (e) => { if (dnd.ids.length) { e.preventDefault(); dropzone.classList.add("drop"); } });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drop"));
  dropzone.addEventListener("drop", (e) => { e.preventDefault(); dropzone.classList.remove("drop"); const ids = [...dnd.ids]; dnd.ids = []; if (ids.length) boardDialog({ ids }); });

  // Tags
  const allTags = [...c.tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = showAllTags ? allTags : allTags.slice(0, 24);
  const tagCloud = h("div", { class: "tag-cloud" },
    shown.map(([t, n]) => h("button", { class: "tag" + (view.tags.has(t) ? " on" : ""), type: "button", style: { "--h": hueOf(t) }, onclick: () => toggleTag(t) }, t, h("span", { class: "n" }, n))),
    allTags.length > 24 ? h("button", { class: "btn sm", type: "button", onclick: () => { showAllTags = !showAllTags; renderSidebar(root); } }, showAllTags ? "Show fewer" : `+${allTags.length - 24} more`) : null);

  setChildren(root,
    h("div", { class: "side-title" }, h("span", {}, "Library")),
    library,
    h("div", { class: "side-title" }, h("span", {}, "Categories"),
      h("button", { class: "icon-btn", type: "button", title: "New category", onclick: () => categoryDialog() }, icon("plus", 14))),
    cats.length ? cats : h("div", { class: "muted", style: { padding: "4px 8px", fontSize: "12px" } }, "No categories yet"),
    h("div", { class: "side-title" }, h("span", {}, "Collections"),
      h("button", { class: "icon-btn", type: "button", title: "New collection", onclick: () => boardDialog() }, icon("plus", 14))),
    dropzone,
    boards,
    h("div", { class: "side-title" }, h("span", {}, "Tags")),
    allTags.length ? tagCloud : h("div", { class: "muted", style: { padding: "4px 8px", fontSize: "12px" } }, "No tags yet"));
}

export { canEdit };
