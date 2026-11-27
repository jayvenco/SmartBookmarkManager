// AI features (server-side): status, auto-tag opt-in and tagging by hand.
import { api } from "./api.js";
import { pull, state } from "./state.js";
import { toast } from "./utils.js";

export const ai = { enabled: false, autoTag: false, provider: "none" };

export async function loadAi() {
  try {
    const s = await api("GET", "/ai-status");
    Object.assign(ai, { enabled: s.enabled, autoTag: s.auto_tag, provider: s.provider });
  } catch (_) {
    ai.enabled = false;
  }
}

export async function setAutoTag(enabled) {
  const r = await api("PUT", "/ai-auto-tag", { enabled });
  ai.autoTag = r.auto_tag;
}

const ERRORS = {
  ai_not_configured: "AI is not set up on this server.",
  no_content: "no page text to work with",
  provider_unreachable: "the AI provider is not reachable",
  provider_bad_response: "the AI answered in an unexpected format",
  not_found: "bookmark not found",
};
const explain = (code) => ERRORS[code] || (code.startsWith("provider_http_") ? `the AI provider refused the request (${code.slice(14)})` : code.replace(/_/g, " "));

/** Tags bookmarks one at a time (each call can take a while), then refreshes the library. */
export async function tagBookmarks(ids, onProgress = () => {}) {
  await pull(); // push unsaved edits first so the server knows the bookmarks
  let done = 0, failed = null;
  for (const id of ids) {
    onProgress(done, ids.length);
    try {
      const { results } = await api("POST", "/ai/tag", { ids: [id] });
      if (!results[0].ok) failed = failed || results[0].error;
    } catch (e) {
      failed = failed || e.detail || "request_failed";
      if (e.status === 429 || e.status === 409) break;
    }
    done++;
  }
  await pull();
  if (failed) toast(`AI tagging: ${explain(failed)}.`, "error");
  else toast(ids.length === 1 ? "Tags updated" : `${ids.length} bookmarks tagged`);
  return !failed;
}

export const hasUnknown = (ids) => ids.some((id) => !state.bookmarks.has(id));
