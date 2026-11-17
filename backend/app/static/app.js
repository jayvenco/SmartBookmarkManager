"use strict";

const $app = document.getElementById("app");
const $nav = document.getElementById("nav");
const $who = document.getElementById("whoami");

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}

async function api(method, path, body) {
  const res = await fetch("/ui" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-SBM": "1" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.detail || res.statusText), { status: res.status });
  return data;
}

const MESSAGES = {
  invalid_credentials: "Wrong username or password.",
  too_many_attempts: "Too many attempts. Try again in a few minutes.",
  wrong_password: "Current password is incorrect.",
  weak_password: "Choose a different password (at least 8 characters, not 'admin').",
  username_taken: "That username is already taken.",
  invalid_username: "Use 2-64 characters: a-z, 0-9, dot, dash or underscore.",
  registration_disabled: "Registration is disabled.",
  cannot_delete_self: "You cannot delete your own account.",
  cannot_demote_self: "You cannot remove your own admin role.",
};
const msg = (e) => MESSAGES[e.message] || e.message;

function fields(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function formCard(title, inputs, submitLabel, onSubmit) {
  const err = h("div", { class: "error" });
  const form = h(
    "form",
    {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = "";
        try {
          await onSubmit(fields(form), form);
        } catch (ex) {
          err.textContent = msg(ex);
        }
      },
    },
    inputs.map(([name, label, type, extra]) =>
      h("label", {}, label, h("input", { name, type: type || "text", required: true, autocomplete: extra || "off" }))
    ),
    err,
    h("button", { type: "submit" }, submitLabel)
  );
  return h("section", { class: "card" }, h("h2", {}, title), form);
}

async function boot() {
  let me = null;
  try {
    me = await api("GET", "/me");
  } catch (_) {}
  if (!me) return renderLogin();
  $nav.hidden = false;
  $who.textContent = `${me.username} (${me.role})`;
  if (me.must_change_password) return renderForcedChange();
  renderHome(me);
}

document.getElementById("logout").addEventListener("click", async () => {
  await api("POST", "/logout");
  $nav.hidden = true;
  renderLogin();
});

async function renderLogin() {
  const pub = await api("GET", "/public").catch(() => ({}));
  const cards = [
    formCard(
      "Log in",
      [["username", "Username", "text", "username"], ["password", "Password", "password", "current-password"]],
      "Log in",
      async (f) => {
        await api("POST", "/login", f);
        boot();
      }
    ),
  ];
  if (pub.allow_registration) {
    cards.push(
      formCard(
        "Create an account",
        [["username", "Username", "text", "username"], ["password", "Password (min. 8 characters)", "password", "new-password"]],
        "Register",
        async (f) => {
          await api("POST", "/register", f);
          boot();
        }
      )
    );
  }
  $app.replaceChildren(...cards);
}

function changePasswordCard(onDone) {
  return formCard(
    "Change password",
    [["current_password", "Current password", "password", "current-password"], ["new_password", "New password (min. 8 characters)", "password", "new-password"]],
    "Change password",
    async (f, form) => {
      await api("POST", "/change-password", f);
      form.reset();
      onDone();
    }
  );
}

function renderForcedChange() {
  $app.replaceChildren(
    h("section", { class: "card" }, h("p", {}, "You must choose a new password before you can continue.")),
    changePasswordCard(boot)
  );
}

async function renderHome(me) {
  const blocks = [connectCard(), await tokensCard(), changePasswordCard(() => alert("Password changed."))];
  if (me.role === "admin") blocks.push(await serverCard(), await usersCard(me));
  $app.replaceChildren(...blocks);
}

function connectCard() {
  return h(
    "section",
    { class: "card" },
    h("h2", {}, "Connect the browser extension"),
    h("p", {}, "In the extension options, enter this server address and sign in with your username and password:"),
    h("p", {}, h("code", {}, location.origin))
  );
}

const fmt = (ms) => (ms ? new Date(ms).toLocaleString() : "never");

async function tokensCard() {
  const tokens = await api("GET", "/tokens");
  const out = h("div", { class: "ok" });
  const card = h("section", { class: "card" }, h("h2", {}, "API tokens"));
  card.append(
    h("p", { class: "meta" }, "Every signed-in extension gets its own token. Revoke a token to sign that device out."),
    ...tokens.map((t) =>
      h(
        "div",
        { class: "row" },
        h("div", {}, h("strong", {}, t.name || "token"), h("div", { class: "meta" }, `created ${fmt(t.created_at)} · last used ${fmt(t.last_used_at)}`)),
        h("button", { class: "ghost", onclick: async () => { await api("DELETE", `/tokens/${t.id}`); boot(); } }, "Revoke")
      )
    ),
    h(
      "form",
      {
        class: "inline",
        onsubmit: async (e) => {
          e.preventDefault();
          const name = new FormData(e.target).get("name");
          const r = await api("POST", "/tokens", { name });
          out.replaceChildren("Copy this token now, it is shown only once: ", h("code", {}, r.token));
        },
      },
      h("input", { name: "name", placeholder: "Token name (e.g. script)" }),
      h("button", { type: "submit" }, "Create token")
    ),
    out
  );
  return card;
}

async function serverCard() {
  const s = await api("GET", "/server-settings");
  const box = h("input", {
    type: "checkbox",
    checked: s.allow_registration,
    onchange: async () => { await api("PUT", "/server-settings", { allow_registration: box.checked }); },
  });
  return h("section", { class: "card" }, h("h2", {}, "Server settings"), h("label", {}, h("span", {}, box, " Allow self-registration")));
}

async function usersCard(me) {
  const users = await api("GET", "/users");
  const card = h("section", { class: "card" }, h("h2", {}, "Users"));
  for (const u of users) {
    const actions = h("div", { class: "actions" });
    if (u.id !== me.id) {
      actions.append(
        h("button", { class: "ghost", onclick: async () => {
          await api("PATCH", `/users/${u.id}`, { role: u.role === "admin" ? "user" : "admin" });
          boot();
        } }, u.role === "admin" ? "Make user" : "Make admin"),
        h("button", { class: "ghost", onclick: async () => {
          const pw = prompt(`New temporary password for ${u.username} (min. 8 characters):`);
          if (pw) { try { await api("PATCH", `/users/${u.id}`, { password: pw }); alert("Password reset. The user must change it at next login."); } catch (e) { alert(msg(e)); } }
        } }, "Reset password"),
        h("button", { class: "danger", onclick: async () => {
          if (confirm(`Delete ${u.username} and all of their private bookmarks? Global bookmarks are kept.`)) { await api("DELETE", `/users/${u.id}`); boot(); }
        } }, "Delete")
      );
    }
    card.append(h("div", { class: "row" }, h("div", {}, h("strong", {}, u.username), h("div", { class: "meta" }, u.role)), actions));
  }
  card.append(
    h("h2", { class: "spaced" }, "Add user"),
    formCardInline()
  );
  return card;
}

function formCardInline() {
  const err = h("div", { class: "error" });
  const form = h(
    "form",
    {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = "";
        try {
          await api("POST", "/users", fields(form));
          boot();
        } catch (ex) {
          err.textContent = msg(ex);
        }
      },
    },
    h("label", {}, "Username", h("input", { name: "username", required: true })),
    h("label", {}, "Temporary password (min. 8 characters)", h("input", { name: "password", type: "password", required: true, minlength: "8", autocomplete: "new-password" })),
    h("label", {}, "Role", h("select", { name: "role" }, h("option", { value: "user" }, "user"), h("option", { value: "admin" }, "admin"))),
    err,
    h("button", { type: "submit" }, "Create user")
  );
  return form;
}

boot();
