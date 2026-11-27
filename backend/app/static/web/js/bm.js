// Small pieces shared by the library, detail panel and Spotlight.
import { canEdit, recordOpen, saveBookmark } from "./state.js";
import { domainOf, h, hueOf } from "./utils.js";

export function favTile(b, large = false) {
  const domain = domainOf(b.url) || "?";
  const tile = h("span", { class: "fav" + (large ? " lg" : ""), style: { "--h": hueOf(domain) } }, domain[0].toUpperCase());
  if (b.favicon) {
    const img = h("img", { src: b.favicon, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
    img.addEventListener("load", () => { if (img.naturalWidth > 1) tile.replaceChildren(img); });
  }
  return tile;
}

export function tagChip(tag, onclick, active = false, byAi = false) {
  return h("button", { class: "tag" + (active ? " on" : "") + (byAi ? " ai" : ""), type: "button", title: byAi ? "Added by AI" : undefined, style: { "--h": hueOf(tag) }, onclick }, tag);
}

/** Opens the page in a new tab and counts the visit. */
export function openBookmark(b) {
  if (!/^https?:/i.test(b.url)) return false;
  window.open(b.url, "_blank", "noopener,noreferrer");
  recordOpen(b.id);
  if (b.status === "unread" && canEdit(b)) saveBookmark({ status: "read" }, b);
  return true;
}
