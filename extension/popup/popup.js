import { createChipInput } from "../lib/chips.js";
import { getConfig, setConfig } from "../lib/config.js";
import { allTags, canEdit, deleteBookmark, findByUrl, flattenCollections, listBookmarks, listCollections, normalizeUrl, saveBookmark, saveCollection } from "../lib/store.js";

const $ = (id) => document.getElementById(id);
const NEW = "__new__";
const params = new URLSearchParams(location.search);
const isWindow = params.has("url"); // opened from the context menu instead of the toolbar

let existing = null;
let editable = true;
let chips;

async function currentPage() {
  if (isWindow) return { url: params.get("url"), title: params.get("title") || params.get("url") };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { url: tab?.url || "", title: tab?.title || tab?.url || "" };
}

function fillCollections(collections, selected) {
  const sel = $("collection");
  sel.replaceChildren(new Option("— No category —", ""));
  for (const c of flattenCollections(collections)) sel.append(new Option("  ".repeat(c.depth) + c.name, c.id));
  sel.append(new Option("+ New category…", NEW));
  sel.value = selected && collections.some((c) => c.id === selected) ? selected : "";
}

async function init() {
  const cfg = await getConfig();
  if (!cfg.token) {
    $("setup").classList.remove("hidden");
    $("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
    return;
  }
  $("form").classList.remove("hidden");

  const page = await currentPage();
  const [bookmarks, collections] = await Promise.all([listBookmarks(), listCollections()]);
  chips = createChipInput($("tags"), { suggestions: allTags(bookmarks).map(([t]) => t), onEnterEmpty: save });

  existing = page.url ? await findByUrl(page.url) : null;
  editable = existing ? await canEdit(existing) : true;

  $("title").value = existing?.title || page.title;
  $("url").textContent = normalizeUrl(page.url);
  $("notes").value = existing?.notes || "";
  chips.set(existing?.tags || []);
  fillCollections(collections, existing ? existing.collection_id : cfg.lastCollection);

  if (existing) {
    $("existing-note").classList.remove("hidden");
    if (editable) $("delete").classList.remove("hidden");
  }
  if (!editable) {
    $("readonly-note").classList.remove("hidden");
    for (const el of $("form").querySelectorAll("input, select, textarea, #save")) el.disabled = true;
  }
  $("title").focus();
  $("title").select();
}

$("collection").addEventListener("change", (e) => {
  const isNew = e.target.value === NEW;
  $("new-collection").classList.toggle("hidden", !isNew);
  if (isNew) $("new-collection").focus();
});

async function save() {
  $("error").textContent = "";
  const page = await currentPage();
  const url = existing?.url || page.url;
  if (!/^(https?|ftp|file|edge|chrome):/i.test(url)) {
    $("error").textContent = "This page cannot be bookmarked.";
    return;
  }
  try {
    let collectionId = $("collection").value || null;
    if (collectionId === NEW) {
      const name = $("new-collection").value.trim();
      if (!name) {
        $("error").textContent = "Enter a name for the new category.";
        $("new-collection").focus();
        return;
      }
      collectionId = (await saveCollection({ name })).id;
    }
    await saveBookmark(
      { url, title: $("title").value.trim() || url, tags: chips.get(), collection_id: collectionId, notes: $("notes").value.trim() },
      existing
    );
    await setConfig({ lastCollection: collectionId });
    close();
  } catch (e) {
    $("error").textContent = String(e.message || e);
  }
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  save();
});
$("form").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    save();
  } else if (e.key === "Enter" && e.target.id === "title") {
    e.preventDefault();
    save();
  }
});
$("delete").addEventListener("click", async () => {
  if (existing && editable) {
    await deleteBookmark(existing);
    close();
  }
});
$("manager").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("manager/manager.html") });
  close();
});

init();
