// db.js — IndexedDB wrapper that ALSO mirrors to chrome.storage.local so
// problems survive extension reloads, Incognito sessions, and storage eviction.

const DB_NAME = "codechef-companion";
const DB_VERSION = 1;
const STORE = "problems";
const LS_KEY = "cc-problems-mirror";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("url", "url", { unique: false });
        store.createIndex("title", "title", { unique: false });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let request;
    try { request = fn(store); } catch (err) { reject(err); return; }
    t.oncomplete = () => resolve(request && "result" in request ? request.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function mirrorRead() {
  try {
    const got = await chrome.storage.local.get(LS_KEY);
    return Array.isArray(got[LS_KEY]) ? got[LS_KEY] : [];
  } catch { return []; }
}
async function mirrorWrite(list) {
  try { await chrome.storage.local.set({ [LS_KEY]: list }); } catch {}
}

async function hydrateFromMirror() {
  const mirror = await mirrorRead();
  if (!mirror.length) return;
  const existing = await DB.all();
  if (existing.length) return;
  for (const rec of mirror) {
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const t = db.transaction(STORE, "readwrite");
        t.objectStore(STORE).put(rec);
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
    } catch {}
  }
}

const DB = {
  async add(problem) {
    const now = Date.now();
    const record = {
      status: "unsolved", tags: [], notes: "", solution: "", language: "",
      samples: [], ...problem, createdAt: now, updatedAt: now
    };
    delete record.id;
    const id = await run("readwrite", (s) => s.add(record));
    const out = { ...record, id };
    const list = await DB.all();
    await mirrorWrite(list);
    return out;
  },
  async put(problem) {
    problem.updatedAt = Date.now();
    await run("readwrite", (s) => s.put(problem));
    const list = await DB.all();
    await mirrorWrite(list);
    return problem;
  },
  async get(id) { return run("readonly", (s) => s.get(id)); },
  async delete(id) {
    await run("readwrite", (s) => s.delete(id));
    const list = await DB.all();
    await mirrorWrite(list);
    return true;
  },
  async all() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readonly");
      const req = t.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },
  async findByUrl(url) {
    if (!url) return null;
    const all = await DB.all();
    return all.find((p) => p.url === url) || null;
  },
  async syncMirror() {
    const all = await DB.all();
    if (all.length) await mirrorWrite(all);
    else await hydrateFromMirror();
    return DB.all();
  }
};

if (typeof window !== "undefined") window.DB = DB;
if (typeof self !== "undefined") self.DB = DB;
