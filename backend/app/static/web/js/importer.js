// Import (browser HTML, JSON, CSV) and JSON export. Parsing happens in the browser; the
// result is written through the normal sync path.
import { openModal } from "./dialogs.js";
import { saveBookmark, saveCategory, state } from "./state.js";
import { h, icon, normalizeTags, normalizeUrl, toast } from "./utils.js";

const OK_URL = /^(https?|ftp):\/\//i;

// ---------- parsers: each returns [{url, title, tags, folder: [..], description, notes, created_at}] ----------
export function parseNetscapeHtml(text) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  const out = [];
  const walk = (dl, path) => {
    for (const child of dl.children) {
      if (child.tagName !== "DT") continue;
      const heading = child.querySelector(":scope > h3");
      const link = child.querySelector(":scope > a");
      if (heading) {
        let sub = child.querySelector(":scope > dl");
        if (!sub && child.nextElementSibling?.tagName === "DL") sub = child.nextElementSibling;
        if (sub) walk(sub, [...path, heading.textContent.trim()]);
      } else if (link) {
        const added = Number(link.getAttribute("add_date"));
        out.push({
          url: link.getAttribute("href") || "", title: link.textContent.trim(), folder: path,
          tags: (link.getAttribute("tags") || "").split(","), description: "", notes: "",
          created_at: added ? added * 1000 : 0,
        });
      }
    }
  };
  const root = doc.querySelector("dl");
  if (root) walk(root, []);
  return out;
}

export function parseJson(text) {
  let data = JSON.parse(text);
  if (!Array.isArray(data)) data = data.bookmarks || data.items || data.links || [];
  return data.map((r) => {
    const folder = Array.isArray(r.folder) ? r.folder : r.folder ? String(r.folder).split("/") : r.category ? String(r.category).split("/") : [];
    return {
      url: r.url || r.href || r.link || "", title: r.title || r.name || "",
      tags: Array.isArray(r.tags) ? r.tags : String(r.tags || "").split(/[,;]/),
      folder: folder.map((s) => s.trim()).filter(Boolean), description: r.description || r.excerpt || "", notes: r.notes || r.note || "",
      created_at: Number(r.created_at) || (r.added ? Date.parse(r.added) : 0) || 0, starred: !!r.starred,
    };
  });
}

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === ";") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((c) => c.trim().toLowerCase());
  const col = (...names) => head.findIndex((c) => names.includes(c));
  const iUrl = col("url", "href", "link"), iTitle = col("title", "name"), iTags = col("tags", "tag", "labels"),
    iFolder = col("folder", "category", "collection"), iDesc = col("description", "excerpt"), iNote = col("notes", "note");
  if (iUrl < 0) throw new Error("The CSV needs a 'url' column.");
  return rows.slice(1).map((r) => ({
    url: r[iUrl] || "", title: iTitle >= 0 ? r[iTitle] || "" : "", tags: iTags >= 0 ? (r[iTags] || "").split(/[,;|]/) : [],
    folder: iFolder >= 0 ? (r[iFolder] || "").split("/").map((s) => s.trim()).filter(Boolean) : [],
    description: iDesc >= 0 ? r[iDesc] || "" : "", notes: iNote >= 0 ? r[iNote] || "" : "", created_at: 0,
  }));
}

export function parseAny(name, text) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) return parseJson(text);
  if (lower.endsWith(".csv")) return parseCsv(text);
  return parseNetscapeHtml(text);
}

// ---------- run ----------
export function runImport(entries) {
  const existing = new Set([...state.bookmarks.values()].map((b) => b.url));
  const cache = new Map(); // "a/b" -> category id
  for (const c of state.categories.values()) {
    if (c.scope === "global") continue;
    const path = [];
    for (let cur = c; cur; cur = state.categories.get(cur.parent_id)) path.unshift(cur.name);
    cache.set(path.join("/"), c.id);
  }
  const categoryFor = (folder) => {
    let parent = null, key = "";
    for (const name of folder) {
      key = key ? `${key}/${name}` : name;
      if (!cache.has(key)) cache.set(key, saveCategory({ name, parent_id: parent }).id);
      parent = cache.get(key);
    }
    return parent;
  };
  let added = 0, skipped = 0, invalid = 0;
  for (const e of entries) {
    if (!OK_URL.test((e.url || "").trim())) { invalid++; continue; }
    const url = normalizeUrl(e.url.trim());
    if (existing.has(url)) { skipped++; continue; }
    existing.add(url);
    saveBookmark({
      url, title: (e.title || "").trim().slice(0, 300) || url, description: (e.description || "").slice(0, 1000), notes: e.notes || "",
      tags: normalizeTags(e.tags || []), collection_id: categoryFor(e.folder || []), status: "read", starred: !!e.starred,
      ...(e.created_at ? { created_at: e.created_at } : {}),
    });
    added++;
  }
  return { added, skipped, invalid };
}

export function exportJson() {
  const bookmarks = [...state.bookmarks.values()]
    .filter((b) => b.owner_id === state.user.id)
    .map((b) => ({
      url: b.url, title: b.title, description: b.description, notes: b.notes, tags: b.tags, starred: b.starred, status: b.status,
      folder: folderPath(b.collection_id), created_at: b.created_at,
    }));
  const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), bookmarks }, null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `bookmarks-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  toast(`Exported ${bookmarks.length} bookmarks`);
}

function folderPath(id) {
  const path = [];
  for (let c = state.categories.get(id); c; c = state.categories.get(c.parent_id)) path.unshift(c.name);
  return path;
}

// ---------- dialog ----------
export function openImporter() {
  return openModal((close) => {
    let entries = [];
    const info = h("div", { class: "muted" }, "Choose a bookmarks export: HTML (Chrome, Edge, Firefox, Safari), JSON or CSV.");
    const err = h("div", { class: "err" });
    const go = h("button", { class: "btn primary", type: "button", disabled: true }, "Import");
    const file = h("input", { type: "file", accept: ".html,.htm,.json,.csv,text/html,application/json,text/csv", onchange: async () => {
      err.textContent = "";
      go.disabled = true;
      const f = file.files[0];
      if (!f) return;
      try {
        entries = parseAny(f.name, await f.text());
        const valid = entries.filter((e) => OK_URL.test((e.url || "").trim()));
        const folders = new Set(valid.map((e) => (e.folder || []).join("/")).filter(Boolean));
        info.textContent = `${valid.length} bookmarks found in ${folders.size} folders` + (entries.length - valid.length ? ` (${entries.length - valid.length} skipped: not a web link)` : "") + ". Bookmarks you already have are skipped.";
        go.disabled = !valid.length;
      } catch (e) {
        err.textContent = "Could not read this file: " + e.message;
      }
    } });
    go.addEventListener("click", () => {
      const r = runImport(entries);
      toast(`Imported ${r.added} bookmarks` + (r.skipped ? `, ${r.skipped} duplicates skipped` : ""));
      close(true);
    });
    return h("div", { class: "modal-body" },
      h("h3", {}, "Import bookmarks"),
      file, info, err,
      h("div", { class: "modal-actions" },
        h("button", { class: "btn", type: "button", onclick: () => { exportJson(); } }, icon("download"), "Export my bookmarks (JSON)"),
        h("span", { class: "spacer" }),
        h("button", { class: "btn", type: "button", onclick: () => close() }, "Cancel"), go));
  });
}
