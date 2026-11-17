import { ApiError, apiFetch, changePassword, login } from "../lib/api.js";
import { clearConnection, getConfig, normalizeServerUrl, setConfig } from "../lib/config.js";
import { clearAll, getAll } from "../lib/db.js";
import { listBookmarks, normalizeUrl, saveBookmark, saveCollection } from "../lib/store.js";

const $ = (id) => document.getElementById(id);
const ERRORS = {
  invalid_credentials: "Wrong username or password.",
  too_many_attempts: "Too many attempts. Try again in a few minutes.",
  wrong_password: "Current password is incorrect.",
  weak_password: "Choose a different password (at least 8 characters, not 'admin').",
  password_change_required: "You must change your password first.",
};
const message = (e) => ERRORS[e.detail] || e.detail || e.message || String(e);

let pending = null; // { serverUrl, token, user, password } while a forced password change is open

async function refresh() {
  const cfg = await getConfig();
  const connected = !!cfg.token && !pending;
  $("login-card").classList.toggle("hidden", connected);
  $("connected-card").classList.toggle("hidden", !connected);
  $("import-card").classList.toggle("hidden", !connected);
  if (connected) {
    $("connected-info").textContent = `${cfg.user?.username} (${cfg.user?.role}) on ${cfg.serverUrl}`;
    $("sync-info").textContent = cfg.lastError ? `Last sync failed: ${cfg.lastError}` : cfg.lastSync ? `Last sync: ${new Date(cfg.lastSync).toLocaleString()}` : "Not synced yet.";
  } else if (cfg.serverUrl) {
    $("server").value = cfg.serverUrl;
  }
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").textContent = "";
  try {
    const serverUrl = normalizeServerUrl($("server").value);
    // Host access to the server is requested at runtime, for this origin only.
    const granted = await chrome.permissions.request({ origins: [serverUrl + "/*"] });
    if (!granted) throw new Error("Permission to contact the server was not granted.");
    const password = $("password").value;
    const res = await login(serverUrl, $("username").value.trim(), password, "Edge extension");
    if (res.user.must_change_password) {
      pending = { serverUrl, token: res.token, user: res.user, password };
      $("login-form").classList.add("hidden");
      $("change-form").classList.remove("hidden");
      return;
    }
    await finishLogin(serverUrl, res.token, res.user);
  } catch (ex) {
    $("login-error").textContent = message(ex);
  }
});

$("change-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("change-error").textContent = "";
  try {
    await changePassword(pending.serverUrl, pending.token, pending.password, $("new-password").value);
    const { serverUrl, token, user } = pending;
    pending = null;
    $("change-form").classList.add("hidden");
    $("login-form").classList.remove("hidden");
    await finishLogin(serverUrl, token, { ...user, must_change_password: false });
  } catch (ex) {
    $("change-error").textContent = message(ex);
  }
});

async function finishLogin(serverUrl, token, user) {
  const previous = await getConfig();
  // Different server or user: the local cache belongs to someone else.
  if (previous.serverUrl !== serverUrl || previous.user?.id !== user.id) await clearAll();
  await setConfig({ serverUrl, token, user, lastError: "" });
  $("password").value = "";
  await chrome.runtime.sendMessage({ type: "sync" }).catch(() => {});
  refresh();
}

$("sync-now").addEventListener("click", async () => {
  $("sync-info").textContent = "Syncing…";
  await chrome.runtime.sendMessage({ type: "sync" }).catch(() => {});
  refresh();
});

$("open-manager").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("manager/manager.html") }));

$("disconnect").addEventListener("click", async () => {
  if (!confirm("Disconnect and remove the local copy of your bookmarks from this browser? Your data stays on the server.")) return;
  try {
    await apiFetch("/auth/logout", { method: "POST" });
  } catch (_) {
    // Server unreachable or token already revoked: still disconnect locally.
  }
  await clearConnection();
  await clearAll();
  refresh();
});

// ---------- one-time import of the browser bookmarks ----------
$("import").addEventListener("click", async () => {
  const out = $("import-result");
  $("import").disabled = true;
  out.textContent = "Importing…";
  try {
    const [tree] = await chrome.bookmarks.getTree();
    const existingUrls = new Set((await listBookmarks()).map((b) => normalizeUrl(b.url)));
    const existingCollections = (await getAll("collections")).filter((c) => !c.deleted && c.scope !== "global");
    let added = 0, skipped = 0, folders = 0;

    async function walk(node, parentId) {
      for (const child of node.children || []) {
        if (child.children) {
          let col = existingCollections.find((c) => c.name === child.title && (c.parent_id || null) === (parentId || null));
          if (!col) {
            col = await saveCollection({ name: child.title || "Untitled", parent_id: parentId || null });
            existingCollections.push(col);
            folders++;
          }
          await walk(child, col.id);
        } else if (child.url && /^(https?|ftp):/i.test(child.url)) {
          const url = normalizeUrl(child.url);
          if (existingUrls.has(url)) { skipped++; continue; }
          existingUrls.add(url);
          await saveBookmark({ url, title: child.title || url, collection_id: parentId || null, tags: [], status: "read" });
          added++;
        }
      }
    }
    await walk(tree, null);
    out.textContent = `Done: ${added} bookmarks imported, ${skipped} duplicates skipped, ${folders} categories created.`;
  } catch (ex) {
    out.textContent = "Import failed: " + (ex.message || ex);
  } finally {
    $("import").disabled = false;
  }
});

chrome.storage.onChanged.addListener(() => refresh());
refresh();
