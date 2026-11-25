// Right column: everything about the selected bookmark.
import { api } from "./api.js";
import { favTile, openBookmark, tagChip } from "./bm.js";
import { bookmarkDialog, confirmBox, moveDialog } from "./dialogs.js";
import { canEdit, removeBookmarks, saveBookmark, state, usageOf } from "./state.js";
import { domainOf, fmtDate, fmtDateTime, h, icon, setChildren, toast } from "./utils.js";
import { setView, toggleTag, view } from "./view.js";

export function renderDetail(root) {
  const b = view.selected && state.bookmarks.get(view.selected);
  if (!b) {
    setChildren(root, h("div", { class: "empty" }, icon("book", 32), h("span", {}, "Select a bookmark to see its details."), h("span", { class: "muted" }, "Double-click a card to open it.")));
    return;
  }
  const editable = canEdit(b);
  const usage = usageOf(b.id);
  const cat = state.categories.get(b.collection_id);
  const boards = (b.boards || []).map((id) => state.boards.get(id)).filter(Boolean);
  const owner = b.scope === "global" ? (b.owner_id === state.user.id ? "you" : "an admin") : null;

  const status = h("select", { disabled: !editable, onchange: (e) => saveBookmark({ status: e.target.value }, b) },
    ["unread", "reading", "read", "archived", "dead"].map((s) => h("option", { value: s }, s === "dead" ? "Dead link" : s[0].toUpperCase() + s.slice(1))));
  status.value = b.status;

  const notes = h("textarea", { class: "notes-box", placeholder: editable ? "Write your own notes…" : "", disabled: !editable }, b.notes || "");
  notes.addEventListener("blur", () => { if (editable && notes.value.trim() !== (b.notes || "")) saveBookmark({ notes: notes.value.trim() }, b); });

  const refresh = h("button", { class: "btn sm", type: "button", disabled: !editable, onclick: async () => {
    refresh.disabled = true;
    try {
      const r = await api("POST", "/fetch-meta", { url: b.url });
      if (!r.ok) throw new Error(r.error.replace(/_/g, " "));
      saveBookmark({ description: r.description || b.description, image: r.image || b.image, favicon: r.favicon || b.favicon, title: b.title || r.title }, b);
      toast("Details refreshed");
    } catch (e) {
      toast("Could not refresh: " + e.message, "error");
      refresh.disabled = false;
    }
  } }, icon("refresh", 13), "Refresh details");

  setChildren(root,
    h("div", { class: "detail-head" },
      favTile(b, true),
      h("div", { class: "grow" },
        h("h2", {}, b.title || b.url),
        h("a", { href: b.url, target: "_blank", rel: "noopener noreferrer", class: "ellipsis", style: { display: "block" }, onclick: (e) => { if (/^https?:/i.test(b.url)) { e.preventDefault(); openBookmark(b); } } }, domainOf(b.url) || b.url)),
      h("button", { class: "icon-btn", type: "button", title: "Close", onclick: () => setView({ detail: false }) }, icon("x"))),
    owner ? h("div", { class: "note" }, `Global bookmark shared by ${owner}.` + (editable ? "" : " Read-only.")) : null,
    h("div", { class: "detail-acts" },
      h("button", { class: "btn primary", type: "button", onclick: () => openBookmark(b) || toast("This link type cannot be opened from the web app", "error") }, icon("link"), "Visit"),
      editable ? h("button", { class: "btn", type: "button", onclick: () => bookmarkDialog({ existing: b }) }, icon("edit"), "Edit") : null,
      editable ? h("button", { class: "btn", type: "button", onclick: () => moveDialog([b.id]) }, icon("folder"), "Move") : null,
      h("button", { class: "btn" + (b.starred ? " active" : ""), type: "button", disabled: !editable, onclick: () => saveBookmark({ starred: !b.starred }, b) }, icon("star"), b.starred ? "Starred" : "Star"),
      h("button", { class: "btn" + (b.pinned ? " active" : ""), type: "button", disabled: !editable, onclick: () => saveBookmark({ pinned: !b.pinned }, b) }, icon("pin"), b.pinned ? "Pinned" : "Pin"),
      editable ? h("button", { class: "btn danger", type: "button", onclick: async () => {
        if (await confirmBox("Delete bookmark", `"${b.title || b.url}" will be deleted.`)) removeBookmarks([b.id]);
      } }, icon("trash"), "Delete") : null),
    h("div", { class: "detail-section" }, h("h4", {}, "Read status"), status),
    b.image ? h("div", { class: "detail-section" }, h("img", { class: "preview", src: b.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer", onerror: (e) => e.target.remove() })) : null,
    b.description ? h("div", { class: "detail-section" }, h("h4", {}, "Description"), h("div", {}, b.description)) : null,
    h("div", { class: "detail-section" }, h("h4", {}, "Tags"),
      (b.tags || []).length ? h("div", { class: "card-tags" }, b.tags.map((t) => tagChip(t, () => toggleTag(t), view.tags.has(t)))) : h("span", { class: "muted" }, "No tags")),
    h("div", { class: "detail-section" }, h("h4", {}, "Organisation"),
      h("dl", { class: "kv" },
        h("dt", {}, "Category"), h("dd", {}, cat ? h("a", { href: "#", onclick: (e) => { e.preventDefault(); setView({ mode: "category", category: cat.id }); } }, cat.name) : h("span", { class: "muted" }, "None")),
        h("dt", {}, "Collections"), h("dd", {}, boards.length ? boards.map((x, i) => [i ? ", " : "", h("a", { href: "#", onclick: (e) => { e.preventDefault(); setView({ mode: "board", board: x.id }); } }, `${x.emoji || ""} ${x.name}`.trim())]) : h("span", { class: "muted" }, "None")))),
    h("div", { class: "detail-section" }, h("h4", {}, "Notes"), notes),
    h("div", { class: "detail-section" }, h("h4", {}, "Activity"),
      h("dl", { class: "kv" },
        h("dt", {}, "Opened"), h("dd", {}, usage.count ? `${usage.count}× (last ${fmtDateTime(usage.last)})` : "Not yet"),
        h("dt", {}, "Added"), h("dd", {}, fmtDate(b.created_at)),
        h("dt", {}, "Updated"), h("dd", {}, fmtDateTime(b.updated_at)))),
    h("div", { class: "detail-section" }, refresh));
}
