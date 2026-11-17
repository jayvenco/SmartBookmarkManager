import { syncNow } from "../lib/sync.js";

const MENU_PAGE = "sbm-page";
const MENU_LINK = "sbm-link";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_PAGE, title: "Bookmark this page", contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU_LINK, title: "Bookmark this link", contexts: ["link"] });
  });
  chrome.alarms.create("sync", { periodInMinutes: 5 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("sync", { periodInMinutes: 5 });
  syncNow();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "sync") syncNow();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "sync") {
    syncNow().then(sendResponse, (e) => sendResponse({ error: String(e) }));
    return true; // async response
  }
  return false;
});

// A context-menu click cannot open the toolbar popup, so open the same page in a small window.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.menuItemId === MENU_LINK ? info.linkUrl : info.pageUrl;
  const title = info.menuItemId === MENU_LINK ? info.selectionText || info.linkUrl : tab?.title || url;
  if (!url) return;
  const query = new URLSearchParams({ url, title });
  chrome.windows.create({
    url: chrome.runtime.getURL(`popup/popup.html?${query}`),
    type: "popup",
    width: 440,
    height: 620,
  });
});
