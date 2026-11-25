import { api } from "./api.js";
import { chipInput } from "./chips.js";
import {
  addToBoard, canEdit, categoryAndDescendants, categoryTree, findByUrl, removeBookmarks, removeBoard,
  removeCategory, saveBoard, saveBookmark, saveCategory, state, updateBookmarks,
} from "./state.js";
import { h, looksLikeUrl, normalizeUrl, toast } from "./utils.js";

/** Opens a modal built by `build(close)`. Resolves with whatever `close(value)` is called with. */
export function openModal(build) {
  return new Promise((resolve) => {
    const dlg = h("dialog", { class: "modal" });
    const close = (value) => { if (dlg.open) dlg.close(); resolve(value); };
    dlg.append(build(close));
    dlg.addEventListener("close", () => { dlg.remove(); resolve(undefined); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function confirmBox(title, text, okLabel = "Delete") {
  return openModal((close) =>
    h("div", { class: "modal-body" },
      h("h3", {}, title),
      h("div", { class: "muted" }, text),
      h("div", { class: "modal-actions" },
        h("span", { class: "spacer" }),
        h("button", { class: "btn", type: "button", onclick: () => close(false) }, "Cancel"),
        h("button", { class: "btn primary", type: "button", onclick: () => close(true) }, okLabel)))
  ).then((v) => v === true);
}

// ---------- shared pieces ----------
export function categoryOptions(select, selected, { excludeTree = null, none = "No category" } = {}) {
  const banned = excludeTree ? categoryAndDescendants(excludeTree) : new Set();
  select.replaceChildren(h("option", { value: "" }, none));
  for (const c of categoryTree()) {
    if (banned.has(c.id)) continue;
    select.append(h("option", { value: c.id }, "  ".repeat(c.depth) + c.name + (c.scope === "global" ? " (global)" : "")));
  }
  select.value = selected && state.categories.has(selected) ? selected : "";
}

const field = (label, control) => h("label", { class: "field" }, label, control);
const isAdmin = () => state.user.role === "admin";

export function allTagNames() {
  const counts = new Map();
  for (const b of state.bookmarks.values()) for (const t of b.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

// ---------- bookmark ----------
export function bookmarkDialog({ existing = null, url = "" } = {}) {
  return openModal((close) => {
    const editable = existing ? canEdit(existing) : true;
    let image = existing?.image || "";
    let favicon = existing?.favicon || "";

    const urlIn = h("input", { value: existing?.url || url, placeholder: "https://…", required: true });
    const title = h("input", { value: existing?.title || "", placeholder: "Title" });
    const desc = h("textarea", { rows: 2, placeholder: "Short description" }, existing?.description || "");
    const notes = h("textarea", { rows: 3, placeholder: "Your notes" }, existing?.notes || "");
    const chips = chipInput({ initial: existing?.tags || [], suggestions: allTagNames(), onEnterEmpty: () => form.requestSubmit() });
    const cat = h("select", {});
    categoryOptions(cat, existing?.collection_id);
    const status = h("select", {}, ["unread", "reading", "read", "archived"].map((s) => h("option", { value: s }, s[0].toUpperCase() + s.slice(1))));
    status.value = existing?.status === "dead" ? "dead" : existing?.status || "unread";
    if (existing?.status === "dead") status.append(h("option", { value: "dead" }, "Dead link"));
    const starred = h("input", { type: "checkbox", checked: !!existing?.starred });
    const pinned = h("input", { type: "checkbox", checked: !!existing?.pinned });
    const global = h("input", { type: "checkbox", checked: existing?.scope === "global" });
    const boardChecks = [...state.boards.values()].sort((a, b) => a.name.localeCompare(b.name)).map((b) => ({
      id: b.id,
      box: h("input", { type: "checkbox", checked: (existing?.boards || []).includes(b.id) }),
      el: null,
    }));
    for (const bc of boardChecks) {
      const b = state.boards.get(bc.id);
      bc.el = h("label", { class: "check" }, bc.box, `${b.emoji || ""} ${b.name}`.trim());
    }
    const err = h("div", { class: "err" });
    const dupe = h("div", { class: "note hidden" });
    const fetchBtn = h("button", { class: "btn sm", type: "button", onclick: () => fetchMeta(true) }, "Fetch details");

    async function fetchMeta(force) {
      const raw = looksLikeUrl(urlIn.value) || urlIn.value.trim();
      if (!/^https?:\/\//i.test(raw)) return;
      fetchBtn.disabled = true;
      fetchBtn.textContent = "Fetching…";
      try {
        const r = await api("POST", "/fetch-meta", { url: raw });
        if (r.ok) {
          if (force || !title.value.trim()) title.value = r.title || title.value;
          if (force || !desc.value.trim()) desc.value = r.description || desc.value;
          image = r.image || image;
          favicon = r.favicon || favicon;
        } else if (force) {
          err.textContent = "Could not read that page (" + r.error.replace(/_/g, " ") + "). You can still fill the details in yourself.";
        }
      } catch (_) {
        if (force) err.textContent = "Could not fetch details right now.";
      } finally {
        fetchBtn.disabled = false;
        fetchBtn.textContent = "Fetch details";
      }
    }

    function checkDupe() {
      const found = urlIn.value.trim() && findByUrl(urlIn.value.trim());
      const other = found && found.id !== existing?.id ? found : null;
      dupe.classList.toggle("hidden", !other);
      dupe.textContent = other ? `Already saved as "${other.title || other.url}".` : "";
    }
    urlIn.addEventListener("input", checkDupe);
    urlIn.addEventListener("blur", () => { urlIn.value = looksLikeUrl(urlIn.value) || urlIn.value; if (!existing) fetchMeta(false); });
    if (!existing && urlIn.value) setTimeout(() => { checkDupe(); fetchMeta(false); }, 0);

    const form = h("form", { class: "modal-body", onsubmit: (e) => {
      e.preventDefault();
      const raw = looksLikeUrl(urlIn.value) || urlIn.value.trim();
      if (!/^(https?|ftp|file|edge|chrome):\/\/\S+/i.test(raw)) { err.textContent = "Enter a valid URL."; return; }
      const patch = {
        url: raw, title: title.value.trim() || raw, description: desc.value.trim(), notes: notes.value.trim(),
        tags: chips.get(), collection_id: cat.value || null, status: status.value, starred: starred.checked, pinned: pinned.checked,
        boards: boardChecks.filter((b) => b.box.checked).map((b) => b.id), image, favicon,
      };
      if (isAdmin() && (!existing || existing.owner_id === state.user.id)) patch.scope = global.checked ? "global" : "private";
      close(saveBookmark(patch, existing));
    } },
      h("h3", {}, existing ? (editable ? "Edit bookmark" : "Bookmark (read-only)") : "New bookmark"),
      field("URL", h("div", { class: "row2", style: { gridTemplateColumns: "1fr auto" } }, urlIn, fetchBtn)),
      dupe,
      field("Title", title),
      field("Description", desc),
      field("Tags", chips.el),
      h("div", { class: "row2" }, field("Category", cat), field("Status", status)),
      boardChecks.length ? field("Collections", h("div", { class: "checklist" }, boardChecks.map((b) => b.el))) : null,
      field("Notes", notes),
      h("div", { class: "row2" },
        h("label", { class: "check" }, starred, "Starred"),
        h("label", { class: "check" }, pinned, "Pinned")),
      isAdmin() && (!existing || existing.owner_id === state.user.id)
        ? h("label", { class: "check" }, global, "Global: visible to all users (read-only for them)") : null,
      err,
      h("div", { class: "modal-actions" },
        existing && editable ? h("button", { class: "btn danger", type: "button", onclick: async () => {
          if (await confirmBox("Delete bookmark", `"${existing.title || existing.url}" will be deleted.`)) { removeBookmarks([existing.id]); close(null); }
        } }, "Delete") : null,
        h("span", { class: "spacer" }),
        h("button", { class: "btn", type: "button", onclick: () => close() }, "Cancel"),
        editable ? h("button", { class: "btn primary", type: "submit" }, "Save") : null));
    if (!editable) form.querySelectorAll("input, select, textarea, button:not(.btn)").forEach((el) => (el.disabled = true));
    setTimeout(() => (existing ? title : urlIn.value ? title : urlIn).focus(), 30);
    return form;
  });
}

// ---------- category ----------
export function categoryDialog({ existing = null, parent = null } = {}) {
  return openModal((close) => {
    const editable = existing ? canEdit(existing) : true;
    const name = h("input", { value: existing?.name || "", required: true, placeholder: "Name" });
    const par = h("select", {});
    categoryOptions(par, existing ? existing.parent_id : parent, { excludeTree: existing?.id, none: "Top level" });
    const global = h("input", { type: "checkbox", checked: existing?.scope === "global" });
    const form = h("form", { class: "modal-body", onsubmit: (e) => {
      e.preventDefault();
      const patch = { name: name.value.trim(), parent_id: par.value || null };
      if (isAdmin() && (!existing || existing.owner_id === state.user.id)) patch.scope = global.checked ? "global" : "private";
      close(saveCategory(patch, existing));
    } },
      h("h3", {}, existing ? "Edit category" : "New category"),
      field("Name", name),
      field("Parent", par),
      isAdmin() && (!existing || existing.owner_id === state.user.id) ? h("label", { class: "check" }, global, "Global: visible to all users") : null,
      h("div", { class: "modal-actions" },
        existing && editable ? h("button", { class: "btn danger", type: "button", onclick: async () => {
          if (await confirmBox("Delete category", "Its bookmarks and subcategories move up one level.")) { removeCategory(existing); close(null); }
        } }, "Delete") : null,
        h("span", { class: "spacer" }),
        h("button", { class: "btn", type: "button", onclick: () => close() }, "Cancel"),
        editable ? h("button", { class: "btn primary", type: "submit" }, "Save") : null));
    if (!editable) form.querySelectorAll("input, select").forEach((el) => (el.disabled = true));
    setTimeout(() => name.focus(), 30);
    return form;
  });
}

// ---------- collection (board) ----------
const BOARD_COLORS = ["", "#3b82f6", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b", "#10b981", "#06b6d4"];

export function boardDialog({ existing = null, ids = [] } = {}) {
  return openModal((close) => {
    const editable = existing ? canEdit(existing) : true;
    let color = existing?.color || "";
    const name = h("input", { value: existing?.name || "", required: true, placeholder: "Collection name" });
    const emoji = h("input", { value: existing?.emoji || "", maxlength: "4", placeholder: "🎨" });
    const global = h("input", { type: "checkbox", checked: existing?.scope === "global" });
    const sw = h("div", { class: "swatches" });
    const paint = () => sw.replaceChildren(...BOARD_COLORS.map((c) =>
      h("button", { type: "button", class: "swatch" + (c === color ? " on" : ""), title: c || "none",
        style: { background: c || "transparent", borderColor: c === color ? "var(--text)" : "var(--border)" },
        onclick: () => { color = c; paint(); } })));
    paint();
    const form = h("form", { class: "modal-body", onsubmit: (e) => {
      e.preventDefault();
      const patch = { name: name.value.trim(), emoji: emoji.value.trim(), color };
      if (isAdmin() && (!existing || existing.owner_id === state.user.id)) patch.scope = global.checked ? "global" : "private";
      const board = saveBoard(patch, existing);
      if (ids.length) addToBoard(ids, board.id);
      close(board);
    } },
      h("h3", {}, existing ? "Edit collection" : ids.length ? `New collection from ${ids.length} bookmark${ids.length === 1 ? "" : "s"}` : "New collection"),
      h("div", { class: "row2", style: { gridTemplateColumns: "90px 1fr" } }, field("Emoji", emoji), field("Name", name)),
      field("Color", sw),
      isAdmin() && (!existing || existing.owner_id === state.user.id) ? h("label", { class: "check" }, global, "Global: visible to all users") : null,
      h("div", { class: "modal-actions" },
        existing && editable ? h("button", { class: "btn danger", type: "button", onclick: async () => {
          if (await confirmBox("Delete collection", "The bookmarks stay; they are only removed from this collection.")) { removeBoard(existing); close(null); }
        } }, "Delete") : null,
        h("span", { class: "spacer" }),
        h("button", { class: "btn", type: "button", onclick: () => close() }, "Cancel"),
        editable ? h("button", { class: "btn primary", type: "submit" }, "Save") : null));
    if (!editable) form.querySelectorAll("input, button.swatch").forEach((el) => (el.disabled = true));
    setTimeout(() => name.focus(), 30);
    return form;
  });
}

// ---------- move ----------
export function moveDialog(ids) {
  return openModal((close) => {
    const sel = h("select", {});
    categoryOptions(sel, null, { none: "No category" });
    const first = state.bookmarks.get(ids[0]);
    if (ids.length === 1 && first) sel.value = first.collection_id && state.categories.has(first.collection_id) ? first.collection_id : "";
    return h("form", { class: "modal-body", onsubmit: (e) => {
      e.preventDefault();
      updateBookmarks(ids, () => ({ collection_id: sel.value || null }));
      toast(`Moved ${ids.length} bookmark${ids.length === 1 ? "" : "s"}`);
      close(true);
    } },
      h("h3", {}, `Move ${ids.length} bookmark${ids.length === 1 ? "" : "s"}`),
      field("Category", sel),
      h("div", { class: "modal-actions" },
        h("span", { class: "spacer" }),
        h("button", { class: "btn", type: "button", onclick: () => close() }, "Cancel"),
        h("button", { class: "btn primary", type: "submit" }, "Move")));
  });
}

export { normalizeUrl };
