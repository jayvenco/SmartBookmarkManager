// Connection settings live in chrome.storage.local: { serverUrl, token, user, lastSync, lastError }
export async function getConfig() {
  return (await chrome.storage.local.get(["serverUrl", "token", "user", "lastSync", "lastError", "lastCollection"])) || {};
}

export async function setConfig(patch) {
  await chrome.storage.local.set(patch);
}

export async function clearConnection() {
  await chrome.storage.local.remove(["token", "user", "lastSync", "lastError"]);
}

export function normalizeServerUrl(input) {
  const url = new URL(input.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Use an http(s) address.");
  return url.origin;
}
