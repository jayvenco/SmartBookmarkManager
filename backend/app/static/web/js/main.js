import { loadAi } from "./ai.js";
import { api } from "./api.js";
import { showAuth } from "./auth.js";
import { bookmarkDialog } from "./dialogs.js";
import { renderDetail } from "./detail.js";
import { initLibrary, renderLibrary } from "./library.js";
import { openSettings } from "./settings.js";
import { renderSidebar } from "./sidebar.js";
import { closeSpotlight, openSpotlight } from "./spotlight.js";
import { load, on, startPolling, state } from "./state.js";
import { h, icon, toast } from "./utils.js";
import { resetFilters, setView, view } from "./view.js";

const root = document.getElementById("root");
let booted = false;

async function boot() {
  let me = null;
  try { me = await api("GET", "/me"); } catch (_) {}
  if (!me) me = await showAuth(root);
  else if (me.must_change_password) me = await showAuth(root, { forcedChange: true });
  state.user = me;
  if (window.innerWidth < 1180 && !booted) view.detail = false; // detail is an overlay on narrow screens
  try {
    await Promise.all([load(), loadAi()]);
  } catch (e) {
    root.replaceChildren(h("div", { class: "auth" }, h("div", { class: "auth-card" }, h("h1", {}, "Cannot load your bookmarks"), h("div", { class: "err" }, e.message), h("button", { class: "btn primary", onclick: () => location.reload() }, "Retry"))));
    return;
  }
  buildShell();
  startPolling();
}

let shell, sidebarEl, libraryEl, detailEl, statusEl;

function buildShell() {
  statusEl = h("span", { class: "status-pill" });
  sidebarEl = h("aside", { id: "sidebar" });
  libraryEl = h("main", { id: "main" });
  detailEl = h("aside", { id: "detail" });
  shell = h("div", { class: "shell" },
    h("header", { class: "topbar" },
      h("button", { class: "icon-btn", type: "button", title: "Toggle sidebar", onclick: () => setView({ sidebar: !view.sidebar }) }, icon("sideLeft")),
      h("div", { class: "brand" }, h("img", { src: "/static/web/icon.svg", alt: "" }), "Bookmarks", h("small", {}, "Smart library")),
      h("span", { class: "grow" }),
      statusEl,
      h("button", { class: "search-trigger", type: "button", onclick: openSpotlight }, icon("search"), h("span", { class: "label grow", style: { textAlign: "left" } }, "Search"), h("kbd", {}, navigator.platform.includes("Mac") ? "⌘K" : "Ctrl K")),
      h("button", { class: "btn", type: "button", onclick: () => bookmarkDialog() }, icon("plus"), "New"),
      h("button", { class: "icon-btn", type: "button", title: "Settings", onclick: () => openSettings({ onLogout: () => { state.user = null; boot(); } }) }, icon("settings")),
      h("button", { class: "icon-btn", type: "button", title: "Toggle details", onclick: () => setView({ detail: !view.detail }) }, icon("sideRight"))),
    sidebarEl, libraryEl, detailEl);
  root.replaceChildren(shell);
  initLibrary(libraryEl);
  booted = true;
  render();
}

let queued = false;
function render() {
  if (!booted || queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    shell.classList.toggle("no-sidebar", !view.sidebar);
    shell.classList.toggle("no-detail", !view.detail);
    renderSidebar(sidebarEl);
    renderLibrary();
    if (!detailEl.contains(document.activeElement)) renderDetail(detailEl); // never wipe a note being typed
    renderStatus();
  });
}

function renderStatus() {
  statusEl.className = "status-pill" + (state.online ? "" : " bad");
  statusEl.textContent = !state.online ? "Offline: changes sync later" : state.syncing ? "Syncing…" : "Synced";
}

on("data", render);
on("view", render);
on("status", () => booted && renderStatus());
on("toast", ({ message, kind }) => toast(message, kind));
on("auth-lost", () => { if (booted) { booted = false; toast("Your session expired. Please sign in again.", "error"); boot(); } });

// ---------- keyboard ----------
const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.querySelector("dialog[open]");
document.addEventListener("keydown", (e) => {
  if (!booted) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSpotlight(); return; }
  if (e.key === "Escape") {
    closeSpotlight();
    if (!typing() && view.selectMode) { view.selectMode = false; view.picked.clear(); setView({}); }
    return;
  }
  if (typing() || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "/") { e.preventDefault(); document.querySelector(".toolbar .filter input")?.focus(); }
  else if (e.key === "n") { e.preventDefault(); bookmarkDialog(); }
  else if (e.key === "x") { resetFilters(); }
});

boot();
