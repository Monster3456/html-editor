window.HTMLEditor = window.HTMLEditor || {};

(function (ns) {

  const ALLOWED_EXT = /^(html?|xhtml|css|js|mjs|json|png|jpe?g|gif|svg|webp|ico|bmp|avif|woff2?|ttf|otf|eot|txt|md)$/;

  let files = new Map();
  let htmlPath = null;
  let editedHtml = new Map();
  let blobCache = new Map();
  let dataUrlCache = new Map();

  function normPath(p) {
    const parts = String(p).split('/');
    const out = [];
    for (const part of parts) {
      if (part === '' || part === '.') continue;
      if (part === '..') out.pop();
      else out.push(part);
    }
    return out.join('/');
  }

  function isExternal(v) {
    return !v || /^(https?:|data:|blob:|mailto:|tel:|javascript:|#|\/\/)/i.test(v);
  }

  function dirOf(p) {
    const i = String(p).lastIndexOf('/');
    return i < 0 ? '' : String(p).slice(0, i);
  }

  function basename(p) {
    return String(p).replace(/\\/g, '/').split('/').pop();
  }

  function stripQuery(v) {
    return String(v).split('#')[0].split('?')[0];
  }

  function isSafeCssUrl(v) {
    return v && v.length <= 300 && !/[<>\s]/.test(v);
  }

  function resolveRef(href, baseDir) {
    if (isExternal(href)) return null;
    const h = normPath(stripQuery(href));
    if (!h) return null;
    const base = baseDir !== undefined ? baseDir : dirOf(htmlPath || '');
    const direct = files.get(normPath(base + '/' + h));
    if (direct) return direct;
    const flat = files.get(h);
    if (flat) return flat;
    const bn = h.split('/').pop();
    for (const e of files.values()) {
      if (e.path === bn || e.path.endsWith('/' + bn)) return e;
    }
    return null;
  }

  function blobUrlFor(entry) {
    if (!blobCache.has(entry.path)) {
      blobCache.set(entry.path, URL.createObjectURL(entry.file));
    }
    return blobCache.get(entry.path);
  }

  function dataUrlFor(entry) {
    if (!dataUrlCache.has(entry.path)) {
      dataUrlCache.set(entry.path, new Promise(function (resolve) {
        const reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { resolve(null); };
        reader.readAsDataURL(entry.file);
      }));
    }
    return dataUrlCache.get(entry.path);
  }

  function cssUrlReplacer(text, baseDir, syncResolver) {
    return text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, function (full, q, raw) {
      if (isExternal(raw) || !isSafeCssUrl(raw)) return full;
      const entry = resolveRef(raw, baseDir);
      if (!entry) return full;
      const url = syncResolver(entry);
      return url ? 'url("' + url + '")' : full;
    });
  }

  ns.project = {
    ingest: function (fileArray) {
      return Promise.resolve().then(async function () {
        const arr = Array.prototype.slice.call(fileArray);
        const htmlPaths = [];
        const newEntries = [];
        for (const f of arr) {
          const rel = normPath((f.webkitRelativePath || f.name).replace(/\\/g, '/'));
          if (!rel) continue;
          const ext = (rel.split('.').pop() || '').toLowerCase();
          if (!ALLOWED_EXT.test(ext)) continue;
          const entry = {
            path: rel,
            file: f,
            ext: ext,
            isImage: /^(png|jpe?g|gif|svg|webp|ico|bmp|avif)$/.test(ext)
          };
          if (ext === 'css') {
            try { entry.cssText = await f.text(); } catch (e) { }
          }
          newEntries.push(entry);
          if (/^(html?|xhtml)$/.test(ext)) htmlPaths.push(rel);
        }

        const sameSet = files.size > 0 && newEntries.length === files.size &&
          newEntries.every(function (e) { return files.has(e.path); });
        if (!sameSet) {
          blobCache.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { } });
          blobCache.clear();
          dataUrlCache.clear();
          files.clear();
          editedHtml.clear();
          htmlPath = null;
        }
        for (const e of newEntries) files.set(e.path, e);

        htmlPaths.sort(function (a, b) {
          const ai = /index\.html?$/i.test(a) ? 0 : 1;
          const bi = /index\.html?$/i.test(b) ? 0 : 1;
          return ai - bi || a.localeCompare(b);
        });
        return { htmlPaths: htmlPaths, fileCount: files.size };
      });
    },

    clearFiles: function () {
      blobCache.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { } });
      blobCache.clear();
      dataUrlCache.clear();
      files.clear();
      editedHtml.clear();
      htmlPath = null;
    },

    hasFiles: function () {
      return files.size > 0;
    },

    fileCount: function () {
      return files.size;
    },

    getHtmlPath: function () {
      return htmlPath;
    },

    setHtmlPath: function (p) {
      htmlPath = p;
    },

    getHtml: function (path) {
      if (editedHtml.has(path)) return Promise.resolve(editedHtml.get(path));
      const entry = files.get(path);
      if (!entry) return Promise.resolve(null);
      if (entry.htmlText === undefined) {
        entry.htmlText = ns.io.decodeText(entry.file);
      }
      return entry.htmlText;
    },

    originalHtml: function (path) {
      const entry = files.get(path);
      if (!entry) return Promise.resolve(null);
      if (entry.htmlText === undefined) {
        entry.htmlText = ns.io.decodeText(entry.file);
      }
      return entry.htmlText;
    },

    stashCurrent: function (html) {
      if (htmlPath && html != null) editedHtml.set(htmlPath, html);
    },

    resolveRef: resolveRef,

    isExternal: isExternal,

    cssPreviewText: function (entry) {
      if (!entry.cssText) return '';
      return cssUrlReplacer(entry.cssText, dirOf(entry.path), blobUrlFor);
    },

    cssExportText: function (entry) {
      if (!entry.cssText) return Promise.resolve('');
      const baseDir = dirOf(entry.path);
      const replacements = [];
      const promises = [];
      const text = entry.cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, function (full, q, raw) {
        if (isExternal(raw) || !isSafeCssUrl(raw)) return full;
        const e = resolveRef(raw, baseDir);
        if (!e) return full;
        promises.push(dataUrlFor(e).then(function (du) {
          replacements.push({ full: full, du: du });
        }));
        return full;
      });
      return Promise.all(promises).then(function () {
        let out = text;
        for (const r of replacements) {
          if (r.du) out = out.split(r.full).join('url("' + r.du + '")');
        }
        return out;
      });
    },

    blobUrlFor: blobUrlFor,
    dataUrlFor: dataUrlFor,
    basename: basename,

    selfContain: function (htmlStr) {
      return Promise.resolve().then(async function () {
        if (!files.size) return { html: htmlStr, inlined: 0 };
        let doc;
        try {
          doc = new DOMParser().parseFromString(htmlStr, 'text/html');
        } catch (e) {
          return { html: htmlStr, inlined: 0 };
        }
        let inlined = 0;

        const links = Array.prototype.slice.call(doc.querySelectorAll('link'));
        for (const link of links) {
          const rel = link.getAttribute('rel') || '';
          if (!/\bstylesheet\b/i.test(rel)) continue;
          const href = link.getAttribute('href') || '';
          const entry = resolveRef(href, dirOf(htmlPath || ''));
          if (!entry || entry.cssText === undefined) continue;
          const css = await ns.project.cssExportText(entry);
          if (css === null || css === '') continue;
          const style = doc.createElement('style');
          const media = link.getAttribute('media');
          if (media) style.setAttribute('media', media);
          style.textContent = css;
          link.replaceWith(style);
          inlined++;
        }

        const mediaEls = Array.prototype.slice.call(
          doc.querySelectorAll('img[src], source[src], video[poster]'));
        for (const el of mediaEls) {
          const attr = el.tagName === 'VIDEO' ? 'poster' : 'src';
          const v = el.getAttribute(attr) || '';
          const entry = resolveRef(v, dirOf(htmlPath || ''));
          if (!entry || !entry.isImage) continue;
          const du = await dataUrlFor(entry);
          if (du) {
            el.setAttribute(attr, du);
            inlined++;
          }
        }

        if (!inlined) return { html: htmlStr, inlined: 0 };
        const dt = (htmlStr.match(/<!DOCTYPE[^>]*>/i) || [''])[0];
        return {
          html: (dt ? dt + '\n' : '') + doc.documentElement.outerHTML,
          inlined: inlined
        };
      });
    }
  };

})(window.HTMLEditor);
