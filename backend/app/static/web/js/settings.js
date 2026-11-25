import { api } from "./api.js";
import { openModal } from "./dialogs.js";
import { exportJson, openImporter } from "./importer.js";
import { state } from "./state.js";
import { h, icon, saveStore } from "./utils.js";

export const THEMES = [
  { id: "midnight", label: "Midnight", color: "#3b82f6" },
  { id: "daylight", label: "Daylight", color: "#f1f5f9" },
  { id: "ocean", label: "Ocean", color: "#14b8a6" },
  { id: "graphite", label: "Graphite", color: "#f59e0b" },
];

export function applyTheme(id) {
  document.documentElement.setAttribute("data-theme", id);
  try { localStorage.setItem("sbm.theme", id); } catch (_) {}
}

export function openSettings({ onLogout }) {
  return openModal((close) => {
    const current = document.documentElement.getAttribute("data-theme") || "midnight";
    const themeBox = h("div", { class: "swatches" });
    const paint = (sel) => themeBox.replaceChildren(...THEMES.map((t) =>
      h("button", { class: "theme-opt" + (t.id === sel ? " on" : ""), type: "button", onclick: () => { applyTheme(t.id); paint(t.id); } },
        h("i", { style: { background: t.color, border: "1px solid var(--border)" } }), t.label)));
    paint(current);
    return h("div", { class: "modal-body" },
      h("h3", {}, "Settings"),
      h("div", { class: "muted" }, `Signed in as ${state.user.username} (${state.user.role})`),
      h("label", { class: "field" }, "Theme", themeBox),
      h("div", { class: "modal-actions" },
        h("button", { class: "btn", type: "button", onclick: () => { close(); openImporter(); } }, icon("upload"), "Import"),
        h("button", { class: "btn", type: "button", onclick: exportJson }, icon("download"), "Export JSON")),
      h("div", { class: "note" }, "Tokens for the browser extension, users and server settings are on the account page."),
      h("div", { class: "modal-actions" },
        h("a", { class: "btn", href: "/account" }, "Account & admin"),
        h("span", { class: "spacer" }),
        h("button", { class: "btn danger", type: "button", onclick: async () => { await api("POST", "/logout").catch(() => {}); close(); onLogout(); } }, icon("logout"), "Log out"),
        h("button", { class: "btn primary", type: "button", onclick: () => close() }, "Done")));
  });
}

export { saveStore };
