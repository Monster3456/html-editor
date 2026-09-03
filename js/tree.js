window.HTMLEditor = window.HTMLEditor || {};

(function (ns) {

  const LS_KEY = 'he:treecol';
  const NODE_BUDGET = 250;

  let root = null;
  let hooks = null;
  let rowMap = new WeakMap();
  let selectedEl = null;
  let dragEl = null;
  let dragRow = null;
  let dropMark = null;
  let rebuildScheduled = false;
  let maxDepth = 2;
  let userCollapsed = new Set();
  let userExpanded = new Set();

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (obj && Array.isArray(obj.col)) userCollapsed = new Set(obj.col);
      if (obj && Array.isArray(obj.exp)) userExpanded = new Set(obj.exp);
    } catch (e) { }
  }

  function saveState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        col: Array.from(userCollapsed),
        exp: Array.from(userExpanded)
      }));
    } catch (e) { }
  }

  function skipEl(el) {
    return el.id === ns.preview.EDITOR_STYLE_ID || el.hasAttribute('data-editor-css');
  }

  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const clsList = (typeof el.className === 'string' ? el.className.trim().split(/\s+/) : [])
      .filter(function (c) {
        return c && c !== ns.preview.CLS_SELECTED && c !== ns.preview.CLS_HOVER;
      });
    const cls = clsList.length ? '.' + clsList.slice(0, 2).join('.') : '';
    return tag + id + cls;
  }

  function summary(el) {
    let t = '';
    if (el.tagName === 'IMG') t = el.getAttribute('alt') || '';
    if (!t) {
      let out = '';
      el.childNodes.forEach(function (n) {
        if (n.nodeType === 3) out += n.nodeValue;
        else if (out && /\S$/.test(out)) out += ' ';
      });
      t = out.replace(/\s+/g, ' ').trim();
    }
    return t.length > 26 ? t.slice(0, 25) + '…' : t;
  }

  function kidsOf(el) {
    const out = [];
    Array.prototype.forEach.call(el.children, function (c) {
      if (!skipEl(c)) out.push(c);
    });
    return out;
  }

  function computeMaxDepth(doc) {
    const counts = [];
    (function walk(el, depth) {
      if (skipEl(el)) return;
      counts[depth] = (counts[depth] || 0) + 1;
      Array.prototype.forEach.call(el.children, function (c) { walk(c, depth + 1); });
    })(doc.documentElement, 0);
    let total = 0;
    let d = 0;
    while (d < counts.length) {
      const next = total + (counts[d] || 0);
      if (d >= 2 && next > NODE_BUDGET) break;
      total = next;
      d++;
    }
    return Math.max(2, d - 1);
  }

  function isExpanded(pathStr, depth) {
    if (userCollapsed.has(pathStr)) return false;
    if (userExpanded.has(pathStr)) return true;
    return depth <= maxDepth;
  }

  function buildNode(el, depth, pathArr) {
    const wrap = document.createElement('div');
    const kids = kidsOf(el);
    const pathStr = pathArr.join('/');
    const expanded = isExpanded(pathStr, depth);

    const row = document.createElement('div');
    row.className = 'tn';
    row.draggable = !/^(HTML|HEAD|BODY)$/.test(el.tagName);
    row.__el = el;
    row.__depth = depth;
    row.__path = pathStr;

    const tw = document.createElement('span');
    tw.className = 'tn-tw' + (kids.length ? '' : ' leaf');
    tw.textContent = kids.length ? (expanded ? '▾' : '▸') : '';

    const tag = document.createElement('span');
    tag.className = 'tn-tag';
    tag.textContent = describe(el);

    const desc = document.createElement('span');
    desc.className = 'tn-desc';
    desc.textContent = summary(el);

    row.appendChild(tw);
    row.appendChild(tag);
    row.appendChild(desc);
    wrap.appendChild(row);
    rowMap.set(el, row);

    if (kids.length && expanded) {
      const box = document.createElement('div');
      box.className = 'tn-kids';
      kids.forEach(function (c, i) {
        box.appendChild(buildNode(c, depth + 1, pathArr.concat(i)));
      });
      wrap.appendChild(box);
    }
    return wrap;
  }

  function toggleNode(row) {
    const pathStr = row.__path;
    const expanded = !!row.querySelector('.tn-tw').textContent;
    if (expanded) {
      userCollapsed.add(pathStr);
      userExpanded.delete(pathStr);
    } else {
      userExpanded.add(pathStr);
      userCollapsed.delete(pathStr);
    }
    saveState();
    const el = row.__el;
    const wrap = row.parentNode;
    if (!wrap || !el) return;
    const fresh = buildNode(el, row.__depth, pathStr.split('/').map(Number));
    wrap.parentNode.replaceChild(fresh, wrap);
    markSelected(selectedEl);
  }

  function markSelected(el) {
    if (!root) return;
    selectedEl = el || null;
    root.querySelectorAll('.tn.sel').forEach(function (n) {
      n.classList.remove('sel');
    });
    if (!el) return;
    const row = rowMap.get(el);
    if (row) {
      row.classList.add('sel');
      try { row.scrollIntoView({ block: 'nearest' }); } catch (e) { }
    }
  }

  function clearDropMark() {
    if (dropMark) {
      dropMark.row.classList.remove('drop-target', 'drop-before', 'drop-after');
      dropMark = null;
    }
  }

  function rebuild() {
    if (!root) return;
    const doc = hooks.getDoc();
    root.textContent = '';
    rowMap = new WeakMap();
    if (!doc || !doc.documentElement) return;
    maxDepth = computeMaxDepth(doc);
    root.appendChild(buildNode(doc.documentElement, 0, [0]));
    markSelected(ns.preview.getSelected());
  }

  function scheduleRebuild() {
    if (rebuildScheduled) return;
    rebuildScheduled = true;
    requestAnimationFrame(function () {
      rebuildScheduled = false;
      rebuild();
    });
  }

  function performDrop(mode, targetEl) {
    if (!dragEl || !targetEl || targetEl === dragEl) return;
    if (dragEl.contains(targetEl)) return;
    try {
      if (mode === 'before') targetEl.parentNode.insertBefore(dragEl, targetEl);
      else if (mode === 'after') targetEl.parentNode.insertBefore(dragEl, targetEl.nextSibling);
      else targetEl.appendChild(dragEl);
    } catch (e) {
      return;
    }
    hooks.commit('移动元素');
    if (hooks.feedback) hooks.feedback('元素已移动');
    else hooks.status('元素已移动');
    scheduleRebuild();
  }

  function initEvents() {
    root.addEventListener('click', function (e) {
      if (e.target.classList && e.target.classList.contains('tn-tw')) {
        const row = e.target.closest('.tn');
        if (row) toggleNode(row);
        return;
      }
      const row = e.target.closest('.tn');
      if (!row) return;
      const el = row.__el;
      if (el && el.isConnected) hooks.onSelect(el);
    });

    root.addEventListener('mouseover', function (e) {
      const row = e.target.closest('.tn');
      if (!row || dragRow) return;
      const el = row.__el;
      if (el && el.isConnected && el.tagName !== 'HTML') {
        try { el.classList.add(ns.preview.CLS_HOVER); } catch (err) { }
      }
    });
    root.addEventListener('mouseout', function (e) {
      const row = e.target.closest('.tn');
      if (!row) return;
      const el = row.__el;
      if (el) {
        try { el.classList.remove(ns.preview.CLS_HOVER); } catch (err) { }
        ns.preview.stripEmptyClass(el);
      }
    });

    root.addEventListener('dragstart', function (e) {
      const row = e.target.closest('.tn');
      if (!row || !row.draggable) {
        e.preventDefault();
        return;
      }
      const el = row.__el;
      if (!el || !el.isConnected || /^(HTML|HEAD|BODY)$/.test(el.tagName)) {
        e.preventDefault();
        return;
      }
      dragEl = el;
      dragRow = row;
      row.classList.add('dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
      } catch (err) { }
    });

    root.addEventListener('dragover', function (e) {
      if (!dragEl || !dragRow) return;
      const row = e.target.closest('.tn');
      if (!row || row === dragRow) {
        clearDropMark();
        return;
      }
      const targetEl = row.__el;
      if (!targetEl || !targetEl.isConnected || targetEl === dragEl || dragEl.contains(targetEl)) {
        clearDropMark();
        return;
      }
      if (targetEl.tagName === 'HTML') {
        clearDropMark();
        return;
      }
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (err) { }
      const rect = row.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / Math.max(1, rect.height);
      let mode;
      if (/^(HEAD|BODY)$/.test(targetEl.tagName)) {
        mode = 'inside';
      } else if (ratio < 0.3) {
        mode = 'before';
      } else if (ratio > 0.7) {
        mode = 'after';
      } else {
        mode = 'inside';
      }
      clearDropMark();
      dropMark = { row: row, mode: mode };
      row.classList.add(mode === 'inside' ? 'drop-target'
        : mode === 'before' ? 'drop-before' : 'drop-after');
    });

    root.addEventListener('dragleave', function (e) {
      const row = e.target.closest('.tn');
      if (row && dropMark && dropMark.row === row) clearDropMark();
    });

    root.addEventListener('drop', function (e) {
      if (!dragEl || !dropMark) return;
      e.preventDefault();
      const targetEl = dropMark.row.__el;
      const mode = dropMark.mode;
      clearDropMark();
      performDrop(mode, targetEl);
    });

    root.addEventListener('dragend', function () {
      if (dragRow) dragRow.classList.remove('dragging');
      dragEl = null;
      dragRow = null;
      clearDropMark();
    });
  }

  ns.tree = {
    init: function (rootEl, treeHooks) {
      root = rootEl;
      hooks = treeHooks;
      loadState();
      initEvents();
      rebuild();
    },

    rebuild: rebuild,
    scheduleRebuild: scheduleRebuild,
    markSelected: markSelected
  };

})(window.HTMLEditor);
