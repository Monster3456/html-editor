window.HTMLEditor = window.HTMLEditor || {};

(function (ns) {

  const EDITOR_STYLE_ID = '__editor_style';
  const CLS_SELECTED = '__editor_selected';
  const CLS_HOVER = '__editor_hover';

  const EDITOR_CSS = [
    '.' + CLS_HOVER + ' { outline: 1px dashed rgba(37,99,235,.8) !important; outline-offset: 1px !important; cursor: pointer !important; }',
    '.' + CLS_SELECTED + ' { outline: 2px solid #2563eb !important; outline-offset: 1px !important; }',
    '.' + CLS_SELECTED + '.' + CLS_HOVER + ' { outline: 2px solid #2563eb !important; }'
  ].join('\n');

  let iframe = null;
  let hooks = null;
  let hookedDoc = null;
  let handlers = null;
  let selected = null;
  let inlineEditing = null;
  let sandboxWorks = true;
  let pendingRender = null;
  let badgeEl = null;

  function getDoc() {
    try { return iframe.contentDocument; } catch (e) { return null; }
  }

  function getBadge() {
    if (badgeEl) return badgeEl;
    badgeEl = document.getElementById('hover-badge');
    return badgeEl;
  }

  function hideBadge() {
    const b = getBadge();
    if (b) b.hidden = true;
  }

  function describeForBadge(el) {
    const tag = el.tagName.toLowerCase();
    const cls = (typeof el.className === 'string' ? el.className.trim().split(/\s+/) : [])
      .filter(function (c) {
        return c && c !== CLS_SELECTED && c !== CLS_HOVER;
      });
    return tag + (el.id ? '#' + el.id : cls.length ? '.' + cls[0] : '');
  }

  function showBadge(el) {
    const b = getBadge();
    if (!b || !iframe) return;
    let rect;
    try { rect = el.getBoundingClientRect(); } catch (e) { return; }
    if (rect.width < 1 && rect.height < 1) { hideBadge(); return; }
    b.textContent = describeForBadge(el) + ' · ' + Math.round(rect.width) + '×' + Math.round(rect.height);
    b.hidden = false;
    const frameRect = iframe.getBoundingClientRect();
    const paneRect = b.parentNode.getBoundingClientRect();
    const offX = frameRect.left - paneRect.left;
    const offY = frameRect.top - paneRect.top;
    let x = offX + rect.left;
    let y = offY + rect.top - b.offsetHeight - 4;
    if (y < offY + 4) y = offY + rect.bottom + 4;
    if (x < 4) x = 4;
    b.style.left = x + 'px';
    b.style.top = y + 'px';
  }

  function desiredSandbox() {
    if (!sandboxWorks) return null;
    return hooks.getScriptsEnabled() ? 'allow-same-origin allow-scripts' : 'allow-same-origin';
  }

  function testSandboxAccess() {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-same-origin');
    f.style.cssText = 'display:none';
    document.body.appendChild(f);
    let ok = false;
    try {
      const d = f.contentDocument;
      if (d && d.body) {
        d.open();
        d.write('<p>x</p>');
        d.close();
        ok = !!(d.body.firstChild && d.body.firstChild.textContent === 'x');
      }
    } catch (e) {
      ok = false;
    }
    setTimeout(function () { f.remove(); }, 0);
    return ok;
  }

  function detachDocHooks() {
    if (hookedDoc && handlers) {
      Object.keys(handlers).forEach(function (k) {
        hookedDoc.removeEventListener(k, handlers[k], k === 'keydown');
      });
    }
    handlers = null;
    hookedDoc = null;
  }

  function attachDocHooks(d) {
    detachDocHooks();
    hookedDoc = d;
    handlers = {
      mouseover: function (e) {
        if (inlineEditing || !e.target || e.target.nodeType !== 1) return;
        if (e.target === selected) return;
        e.target.classList.add(CLS_HOVER);
        showBadge(e.target);
      },
      mouseout: function (e) {
        if (!e.target || e.target.nodeType !== 1) return;
        e.target.classList.remove(CLS_HOVER);
        if (!e.relatedTarget || e.relatedTarget.nodeType !== 1) hideBadge();
      },
      click: function (e) {
        hideBadge();
        if (inlineEditing) {
          if (!inlineEditing.el.contains(e.target)) e.preventDefault();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const el = e.target;
        if (!el || el.nodeType !== 1 || el === d.documentElement || el === d.head) return;
        const path = getPath(el);
        if (hooks.flushCodeCommit()) {
          render(hooks.getSource(), { preserveScroll: true, tryReselect: false });
        }
        const doc2 = getDoc();
        if (!doc2) return;
        const el2 = path ? resolvePath(doc2, path) : null;
        if (el2 && el2.nodeType === 1 && el2 !== doc2.documentElement) {
          select(el2);
        } else {
          clearSelection();
          hooks.onSelect(null);
        }
      },
      dblclick: function (e) {
        if (inlineEditing) return;
        e.preventDefault();
        e.stopPropagation();
        const el = e.target;
        if (!el || el.nodeType !== 1 || el === d.documentElement || el === d.head || el === d.body) return;
        const path = getPath(el);
        if (hooks.flushCodeCommit()) {
          render(hooks.getSource(), { preserveScroll: true, tryReselect: false });
        }
        const doc2 = getDoc();
        if (!doc2) return;
        const el2 = (path ? resolvePath(doc2, path) : null) || el;
        if (el2.nodeType !== 1) return;
        select(el2);
        beginInlineEdit(el2, e);
      },
      contextmenu: function (e) {
        if (inlineEditing) return;
        const el = e.target;
        if (!el || el.nodeType !== 1) return;
        e.preventDefault();
        const path = getPath(el);
        if (hooks.flushCodeCommit()) {
          render(hooks.getSource(), { preserveScroll: true, tryReselect: false });
        }
        const doc2 = getDoc();
        if (!doc2) return;
        const el2 = (path ? resolvePath(doc2, path) : null) || el;
        if (!el2 || el2.nodeType !== 1) return;
        if (el2 !== doc2.documentElement && el2 !== doc2.head) select(el2);
        if (hooks.onContextMenu) hooks.onContextMenu(el2, e);
      },
      keydown: function (e) {
        const mod = e.ctrlKey || e.metaKey;
        if (inlineEditing) {
          if (e.key === 'Escape') {
            e.preventDefault();
            endInlineEdit({ commit: true });
          } else if (e.key === 'Enter' && e.target && e.target.isContentEditable) {
            e.preventDefault();
            try { d.execCommand('insertLineBreak'); } catch (err) { }
          }
          return;
        }
        if (mod) {
          const k = e.key.toLowerCase();
          if (k === 's') {
            e.preventDefault();
            hooks.onShortcut('save');
          } else if (k === 'z' && !e.shiftKey) {
            e.preventDefault();
            hooks.onShortcut('undo');
          } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
            e.preventDefault();
            hooks.onShortcut('redo');
          }
        } else if (e.key === 'Escape') {
          clearSelection();
          hooks.onSelect(null);
        }
      },
      focusout: function () {
        if (inlineEditing) endInlineEdit({ commit: true });
      },
      dragover: function (e) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      },
      drop: function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          hooks.onDropFiles(e.dataTransfer.files);
        }
      }
    };
    Object.keys(handlers).forEach(function (k) {
      d.addEventListener(k, handlers[k], k === 'keydown');
    });
  }

  function injectEditorStyle(d) {
    try {
      const st = d.createElement('style');
      st.id = EDITOR_STYLE_ID;
      st.textContent = EDITOR_CSS;
      (d.head || d.documentElement).appendChild(st);
    } catch (e) { }
  }

  function resolveProjectRefs(d, project) {
    const htmlDir = (function () {
      const p = project.getHtmlPath() || '';
      const i = p.lastIndexOf('/');
      return i < 0 ? '' : p.slice(0, i);
    })();

    d.querySelectorAll('link').forEach(function (link) {
      const rel = link.getAttribute('rel') || '';
      if (!/\bstylesheet\b/i.test(rel)) return;
      const href = link.getAttribute('href') || '';
      if (project.isExternal(href)) return;
      const entry = project.resolveRef(href, htmlDir);
      if (!entry || entry.cssText === undefined) return;
      link.setAttribute('data-editor-rel', rel);
      link.setAttribute('rel', 'editor-disabled');
      const style = d.createElement('style');
      style.setAttribute('data-editor-css', href);
      const media = link.getAttribute('media');
      if (media) style.setAttribute('media', media);
      style.textContent = project.cssPreviewText(entry);
      link.after(style);
    });

    d.querySelectorAll('img[src], source[src]').forEach(function (el) {
      const v = el.getAttribute('src') || '';
      if (project.isExternal(v)) return;
      const entry = project.resolveRef(v, htmlDir);
      if (!entry || !entry.isImage) return;
      el.setAttribute('data-editor-src', v);
      el.setAttribute('src', project.blobUrlFor(entry));
    });

    d.querySelectorAll('video[poster]').forEach(function (el) {
      const v = el.getAttribute('poster') || '';
      if (project.isExternal(v)) return;
      const entry = project.resolveRef(v, htmlDir);
      if (!entry || !entry.isImage) return;
      el.setAttribute('data-editor-poster', v);
      el.setAttribute('poster', project.blobUrlFor(entry));
    });
  }

  function preWriteTransform(src, opts) {
    const needsMeta = /<meta[^>]+http-equiv\s*=\s*["']?\s*refresh/i.test(src);
    const needsNeuter = !!opts.neuterScripts;
    const project = opts.project;
    const needsResolve = !!(project && project.hasFiles() &&
      /<(link|img|source|video)\b/i.test(src));
    if (!needsMeta && !needsNeuter && !needsResolve) return src;
    let parsed;
    try {
      parsed = new DOMParser().parseFromString(src, 'text/html');
    } catch (e) {
      return src;
    }
    if (needsNeuter) {
      parsed.querySelectorAll('script').forEach(function (s) {
        const type = s.getAttribute('type');
        if (type && !/^(text|application)\/(javascript|ecmascript)$/i.test(type)) return;
        s.setAttribute('data-editor-neutered', type || '');
        s.setAttribute('type', 'editor/plain');
      });
    }
    if (needsMeta) {
      parsed.querySelectorAll('meta[http-equiv]').forEach(function (m) {
        if (/^refresh$/i.test(m.getAttribute('http-equiv') || '')) {
          m.setAttribute('data-editor-httpequiv', 'refresh');
          m.removeAttribute('http-equiv');
        }
      });
    }
    if (needsResolve) {
      try { resolveProjectRefs(parsed, project); } catch (e) { }
    }
    const dt = (src.match(/<!DOCTYPE[^>]*>/i) || [''])[0];
    return (dt ? dt + '\n' : '') + parsed.documentElement.outerHTML;
  }

  function captureScroll() {
    try {
      const w = iframe.contentWindow;
      return { x: w.scrollX || 0, y: w.scrollY || 0 };
    } catch (e) {
      return null;
    }
  }

  function restoreScroll(scroll) {
    if (!scroll) return;
    const apply = function () {
      try { iframe.contentWindow.scrollTo(scroll.x, scroll.y); } catch (e) { }
    };
    apply();
    requestAnimationFrame(apply);
    setTimeout(apply, 300);
  }

  function ensureIframeDoc() {
    const desired = desiredSandbox();
    const cur = iframe.getAttribute('sandbox');
    let d = getDoc();
    if (d && desired === cur && d.documentElement) return d;
    detachDocHooks();
    const fresh = document.createElement('iframe');
    fresh.id = 'preview';
    fresh.title = '预览';
    if (desired) fresh.setAttribute('sandbox', desired);
    iframe.replaceWith(fresh);
    iframe = fresh;
    d = getDoc();
    if (!d || !d.documentElement) return null;
    return d;
  }

  function render(source, opts) {
    opts = opts || {};
    const scroll = opts.preserveScroll === false ? null : captureScroll();
    let path = null;
    if (opts.tryReselect !== false && selected && selected.isConnected) {
      path = getPath(selected);
    }
    abandonInlineEdit();
    clearSelection();
    hideBadge();

    const neuterScripts = !sandboxWorks && !hooks.getScriptsEnabled();
    const project = hooks.getProject ? hooks.getProject() : null;
    const writeStr = preWriteTransform(source, { neuterScripts: neuterScripts, project: project });

    let d = ensureIframeDoc();
    if (!d) {
      pendingRender = { source: source, opts: opts };
      iframe.addEventListener('load', function () {
        const p = pendingRender;
        pendingRender = null;
        if (p) render(p.source, p.opts);
      }, { once: true });
      return;
    }

    try {
      d.open();
      d.write(writeStr);
      d.close();
    } catch (e) {
      hooks.onRenderError && hooks.onRenderError(e);
      return;
    }

    injectEditorStyle(d);
    attachDocHooks(d);
    restoreScroll(scroll);

    if (path) {
      const el = resolvePath(d, path);
      if (el && el.nodeType === 1 && el !== d.documentElement) select(el);
    }
    hooks.onRendered(d);
  }

  function getPath(el) {
    const d = el.ownerDocument;
    const path = [];
    let node = el;
    while (node && node !== d.documentElement) {
      const parent = node.parentElement;
      if (!parent) break;
      let idx = 0;
      let sib = parent.firstElementChild;
      while (sib && sib !== node) {
        idx++;
        sib = sib.nextElementSibling;
      }
      path.unshift(idx);
      node = parent;
    }
    return path;
  }

  function resolvePath(d, path) {
    let node = d.documentElement;
    for (let i = 0; i < path.length; i++) {
      if (!node || !node.children) return null;
      node = node.children[path[i]];
    }
    return node || null;
  }

  function select(el) {
    if (!el || el.nodeType !== 1) return;
    clearSelection();
    hideBadge();
    selected = el;
    el.classList.add(CLS_SELECTED);
    hooks.onSelect(el);
  }

  function clearSelection() {
    if (selected) {
      try { selected.classList.remove(CLS_SELECTED); } catch (e) { }
      selected = null;
    }
  }

  function beginInlineEdit(el, e) {
    if (!el || el.isContentEditable) return;
    if (inlineEditing) endInlineEdit({ commit: true });
    inlineEditing = {
      el: el,
      prevCE: el.getAttribute('contenteditable')
    };
    el.setAttribute('contenteditable', 'true');
    try { el.ownerDocument.execCommand('defaultParagraphSeparator', false, 'br'); } catch (err) { }
    try { el.focus(); } catch (err) { }
    if (e) {
      try {
        const d = el.ownerDocument;
        let range = null;
        if (d.caretRangeFromPoint) {
          range = d.caretRangeFromPoint(e.clientX, e.clientY);
        } else if (d.caretPositionFromPoint) {
          const p = d.caretPositionFromPoint(e.clientX, e.clientY);
          if (p) {
            range = d.createRange();
            range.setStart(p.offsetNode, p.offset);
          }
        }
        if (range) {
          const sel = d.defaultView.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } catch (err) { }
    }
    hooks.onInlineEditStart(el);
  }

  function endInlineEdit(opts) {
    const s = inlineEditing;
    if (!s) return;
    inlineEditing = null;
    const el = s.el;
    if (s.prevCE === null) el.removeAttribute('contenteditable');
    else el.setAttribute('contenteditable', s.prevCE);
    if (opts && opts.commit) hooks.onInlineEditCommit(el);
  }

  function abandonInlineEdit() {
    if (inlineEditing) endInlineEdit({ commit: false });
  }

  function serialize() {
    abandonInlineEdit();
    const d = getDoc();
    if (!d || !d.documentElement) return hooks.getSource();
    const clone = d.documentElement.cloneNode(true);
    clone.querySelectorAll('#' + EDITOR_STYLE_ID).forEach(function (n) { n.remove(); });
    clone.querySelectorAll('.' + CLS_SELECTED + ', .' + CLS_HOVER).forEach(function (n) {
      n.classList.remove(CLS_SELECTED, CLS_HOVER);
      if (!n.getAttribute('class')) n.removeAttribute('class');
    });
    clone.querySelectorAll('script[data-editor-neutered]').forEach(function (s) {
      const orig = s.getAttribute('data-editor-neutered');
      if (orig) s.setAttribute('type', orig);
      else s.removeAttribute('type');
      s.removeAttribute('data-editor-neutered');
    });
    clone.querySelectorAll('meta[data-editor-httpequiv]').forEach(function (m) {
      m.setAttribute('http-equiv', m.getAttribute('data-editor-httpequiv'));
      m.removeAttribute('data-editor-httpequiv');
    });
    clone.querySelectorAll('link[data-editor-rel]').forEach(function (l) {
      l.setAttribute('rel', l.getAttribute('data-editor-rel'));
      l.removeAttribute('data-editor-rel');
    });
    clone.querySelectorAll('style[data-editor-css]').forEach(function (s) { s.remove(); });
    clone.querySelectorAll('[data-editor-src]').forEach(function (el) {
      el.setAttribute('src', el.getAttribute('data-editor-src'));
      el.removeAttribute('data-editor-src');
    });
    clone.querySelectorAll('[data-editor-poster]').forEach(function (el) {
      el.setAttribute('poster', el.getAttribute('data-editor-poster'));
      el.removeAttribute('data-editor-poster');
    });
    const dt = d.doctype;
    let dtStr = '';
    if (dt) {
      dtStr = '<!DOCTYPE ' + dt.name +
        (dt.publicId ? ' PUBLIC "' + dt.publicId + '"' : '') +
        (dt.systemId ? ' "' + dt.systemId + '"' : '') + '>\n';
    }
    return dtStr + clone.outerHTML;
  }

  ns.preview = {
    EDITOR_STYLE_ID: EDITOR_STYLE_ID,
    CLS_SELECTED: CLS_SELECTED,
    CLS_HOVER: CLS_HOVER,

    init: function (iframeEl, appHooks) {
      iframe = iframeEl;
      hooks = appHooks;
      sandboxWorks = testSandboxAccess();
    },

    isSandboxUsable: function () {
      return sandboxWorks;
    },

    render: render,

    serialize: serialize,

    getDoc: getDoc,

    getPath: getPath,

    resolvePath: resolvePath,

    getSelected: function () {
      return selected;
    },

    getSelectedPath: function () {
      return selected && selected.isConnected ? getPath(selected) : null;
    },

    clearSelection: clearSelection,

    select: select,

    endInlineEdit: endInlineEdit,

    isInlineEditing: function () {
      return !!inlineEditing;
    },

    refresh: function () {
      render(hooks.getSource());
    },

    rebuild: function () {
      const d = ensureIframeDoc();
      if (d) {
        attachDocHooks(d);
        injectEditorStyle(d);
      }
    },

    detectRelativeUrls: function (d) {
      let count = 0;
      d.querySelectorAll('img[src], link[href], script[src], source[src]').forEach(function (el) {
        if (el.hasAttribute('data-editor-src') || el.hasAttribute('data-editor-rel')) return;
        const v = el.getAttribute('src') || el.getAttribute('href') || '';
        if (!v) return;
        if (/^(https?:|data:|blob:|mailto:|tel:|javascript:|#|\/\/)/i.test(v)) return;
        count++;
      });
      return count;
    }
  };

})(window.HTMLEditor);
