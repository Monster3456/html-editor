window.HTMLEditor = window.HTMLEditor || {};

(function (ns) {

  const DB_NAME = 'html-editor';
  const STORE = 'drafts';
  const KEY = 'current';
  const MAX_FILE = 10 * 1024 * 1024;

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      let req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function () {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('db blocked')); };
    });
    dbPromise.catch(function () { dbPromise = null; });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let result;
        try {
          result = fn(store);
        } catch (e) {
          reject(e);
          return;
        }
        t.oncomplete = function () { resolve(result && result.result !== undefined ? result.result : result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('aborted')); };
      });
    });
  }

  ns.draft = {
    available: function () {
      try { return !!window.indexedDB; } catch (e) { return false; }
    },

    save: function (data) {
      if (!ns.draft.available()) return Promise.resolve(false);
      if (data.source && data.source.length > MAX_FILE) return Promise.resolve(false);
      if (data.files) {
        for (let i = 0; i < data.files.length; i++) {
          if (data.files[i].file && data.files[i].file.size > MAX_FILE) return Promise.resolve(false);
        }
      }
      const record = {
        savedAt: Date.now(),
        fileName: data.fileName,
        htmlPath: data.htmlPath || null,
        source: data.source,
        originalHTML: data.originalHTML,
        files: data.files || []
      };
      return tx('readwrite', function (store) {
        store.put(record, KEY);
      }).then(function () { return true; }, function () { return false; });
    },

    load: function () {
      if (!ns.draft.available()) return Promise.resolve(null);
      return tx('readonly', function (store) {
        return store.get(KEY);
      }).then(function (r) { return r || null; }, function () { return null; });
    },

    clear: function () {
      if (!ns.draft.available()) return Promise.resolve(false);
      return tx('readwrite', function (store) {
        store.delete(KEY);
      }).then(function () { return true; }, function () { return false; });
    }
  };

})(window.HTMLEditor);
