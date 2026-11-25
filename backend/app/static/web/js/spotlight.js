// Ctrl/Cmd+K: search everything, or paste a URL to capture it.
import { favTile, openBookmark } from "./bm.js";
import { bookmarkDialog } from "./dialogs.js";
import { state } from "./state.js";
import { domainOf, h, icon, looksLikeUrl } from "./utils.js";
import { matchesQuery, setView } from "./view.js";

let overlay = null;

function score(b, q) {
  const t = q.toLowerCase();
  const title = (b.title || "").toLowerCase();
  if (title.startsWith(t)) return 0;
  if (title.includes(t)) return 1;
  if (domainOf(b.url).includes(t)) return 2;
  return 3;
}

export function openSpotlight() {
  if (overlay) return closeSpotlight();
  let active = 0;
  let items = [];
  const input = h("input", { placeholder: "Search title, domain, notes… or paste a URL to save it", autocomplete: "off" });
  const results = h("div", { class: "spot-results" });
  const modes = h("div", { class: "spot-modes" },
    h("button", { type: "button", class: "active" }, "Keyword"),
    h("button", { type: "button", disabled: true, title: "Semantic search arrives with the AI features" }, "Semantic"));

  function compute() {
    const q = input.value.trim();
    items = [];
    const url = q && looksLikeUrl(q);
    if (url) items.push({ kind: "add", url });
    const rows = [...state.bookmarks.values()].filter((b) => !q || matchesQuery(b, q));
    rows.sort((a, b) => (q ? score(a, q) - score(b, q) : 0) || b.updated_at - a.updated_at);
    for (const b of rows.slice(0, 30)) items.push({ kind: "bm", b });
    active = Math.min(active, Math.max(items.length - 1, 0));
    paint();
  }

  function paint() {
    results.replaceChildren(...(items.length ? items.map((it, i) => {
      const body = it.kind === "add"
        ? [h("span", { class: "fav" }, icon("plus")), h("div", { class: "grow" }, h("div", {}, "Save this link"), h("div", { class: "muted ellipsis" }, it.url))]
        : [favTile(it.b), h("div", { class: "grow" }, h("div", { class: "ellipsis" }, it.b.title || it.b.url), h("div", { class: "muted ellipsis" }, domainOf(it.b.url)))];
      const el = h("button", { type: "button", class: "spot-item" + (i === active ? " active" : ""), onclick: () => choose(it, false), onmousemove: () => { if (active !== i) { active = i; paint(); } } }, body);
      return el;
    }) : [h("div", { class: "empty" }, "No results")]));
    results.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }

  function choose(it, reveal) {
    closeSpotlight();
    if (it.kind === "add") return bookmarkDialog({ url: it.url });
    if (reveal || !openBookmark(it.b)) setView({ selected: it.b.id, detail: true, mode: "all", q: "" });
    else setView({ selected: it.b.id });
  }

  input.addEventListener("input", () => { active = 0; compute(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, items.length - 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); paint(); }
    else if (e.key === "Enter" && items[active]) { e.preventDefault(); choose(items[active], e.metaKey || e.ctrlKey); }
    else if (e.key === "Escape") { e.preventDefault(); closeSpotlight(); }
  });

  overlay = h("div", { id: "spotlight", onmousedown: (e) => { if (e.target === overlay) closeSpotlight(); } },
    h("div", { class: "spot-box" },
      h("div", { class: "spot-input" }, icon("search", 18), input, modes),
      results,
      h("div", { class: "spot-foot" },
        h("span", {}, h("kbd", {}, "↑"), " ", h("kbd", {}, "↓"), " select"),
        h("span", {}, h("kbd", {}, "↵"), " open"),
        h("span", {}, h("kbd", {}, "Ctrl/⌘ ↵"), " show details"),
        h("span", {}, h("kbd", {}, "esc"), " close"))));
  document.body.append(overlay);
  compute();
  input.focus();
}

export function closeSpotlight() {
  overlay?.remove();
  overlay = null;
}
