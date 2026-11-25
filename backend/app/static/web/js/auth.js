import { api, errorText } from "./api.js";
import { h } from "./utils.js";

const logo = () => h("img", { src: "/static/web/icon.svg", alt: "" });

function card(title, ...kids) {
  return h("div", { class: "auth" }, h("div", { class: "auth-card" }, h("h1", {}, logo(), title), ...kids));
}

function form(fields, label, submit) {
  const err = h("div", { class: "err" });
  const f = h("form", { onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = "";
    const data = Object.fromEntries(new FormData(f).entries());
    try { await submit(data); } catch (ex) { err.textContent = errorText(ex); }
  } },
    fields.map(([name, text, type, auto]) => h("label", { class: "field" }, text, h("input", { name, type: type || "text", required: true, autocomplete: auto || "off" }))),
    err,
    h("button", { class: "btn primary", type: "submit", style: { justifyContent: "center" } }, label));
  return f;
}

/** Shows login / register / forced password change. Resolves with the user when signed in. */
export function showAuth(root, { forcedChange = false } = {}) {
  return new Promise(async (resolve) => {
    const pub = await api("GET", "/public").catch(() => ({}));
    const finish = async () => resolve(await api("GET", "/me"));

    const changeView = () => root.replaceChildren(card("Choose a new password",
      h("div", { class: "note" }, "You must change the default password before you continue."),
      form([["current_password", "Current password", "password", "current-password"], ["new_password", "New password (min. 8 characters)", "password", "new-password"]],
        "Change password", async (d) => { await api("POST", "/change-password", d); await finish(); })));

    if (forcedChange) return changeView();

    const loginForm = form([["username", "Username", "text", "username"], ["password", "Password", "password", "current-password"]], "Log in", async (d) => {
      const me = await api("POST", "/login", d);
      if (me.must_change_password) changeView(); else resolve(me);
    });
    const parts = [loginForm];
    if (pub.allow_registration) {
      parts.push(h("hr", { style: { width: "100%", borderColor: "var(--border)" } }), h("div", { class: "muted" }, "New here? Create an account:"),
        form([["username", "Username", "text", "username"], ["password", "Password (min. 8 characters)", "password", "new-password"]], "Register", async (d) => {
          resolve(await api("POST", "/register", d));
        }));
    }
    root.replaceChildren(card("Smart Bookmark Manager", ...parts));
  });
}
