// Thin promise wrapper around IndexedDB. Shared by the popup, manager and service worker.
const DB_NAME = "sbm";
const VERSION = 1;
const STORES = ["bookmarks", "collections", "usage", "usage_pending", "meta"];

let dbPromise;

export function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("bookmarks", { keyPath: "id" }).createIndex("url", "url");
        db.createObjectStore("collections", { keyPath: "id" });
        db.createObjectStore("usage", { keyPath: "bookmark_id" }); // server totals
        db.createObjectStore("usage_pending", { keyPath: "bookmark_id" }); // not yet synced
        db.createObjectStore("meta", { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

const wrap = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export async function getAll(store) {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).get(key));
}

export async function put(store, value) {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(value);
  return done(tx);
}

export async function putMany(store, values) {
  if (!values.length) return;
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  for (const v of values) tx.objectStore(store).put(v);
  return done(tx);
}

export async function del(store, key) {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).delete(key);
  return done(tx);
}

export async function byUrl(url) {
  const db = await openDb();
  return wrap(db.transaction("bookmarks").objectStore("bookmarks").index("url").getAll(url));
}

export async function clearAll() {
  const db = await openDb();
  const tx = db.transaction(STORES, "readwrite");
  for (const s of STORES) tx.objectStore(s).clear();
  return done(tx);
}
