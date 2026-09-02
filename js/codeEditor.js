window.HTMLEditor = window.HTMLEditor || {};

(function (ns) {

  const HL_LIMIT = 500000;
  let ta = null, codeEl = null, gutterInner = null, cb = null;
  let hlTimer = null, commitTimer = null;
  let lastCommitted = '';
  let lastLineCount = 0;

  let findBar = null, fInput = null, fCount = null, rInput = null;
  let matches = [];
  let matchIdx = -1;

  function escRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function computeMatches(keepNear) {
    const q = fInput.value;
    matches = [];
    matchIdx = -1;
    if (!q) {
      fCount.textContent = '';
      return;
    }
    const hay = ta.value.toLowerCase();
    const needle = q.toLowerCase();
    let i = hay.indexOf(needle);
    while (i >= 0) {
      matches.push([i, i + q.length]);
      i = hay.indexOf(needle, i + needle.length);
    }
    if (matches.length) {
      if (keepNear !== undefined) {
        matchIdx = 0;
        for (let k = 0; k < matches.length; k++) {
          if (matches[k][0] >= keepNear) { matchIdx = k; break; }
        }
      } else {
        matchIdx = 0;
      }
    }
    updateFindCount();
  }

  function updateFindCount() {
    fCount.textContent = matches.length ? (matchIdx + 1) + '/' + matches.length : '无结果';
  }

  function scrollToPos(pos) {
    const before = ta.value.slice(0, pos).split('\n');
    const line = before.length - 1;
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 19;
    ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 2);
    syncScroll();
  }

  function gotoMatch(step) {
    if (!matches.length) return;
    matchIdx = (matchIdx + step + matches.length) % matches.length;
    const m = matches[matchIdx];
    ta.focus();
    ta.setSelectionRange(m[0], m[1]);
    scrollToPos(m[0]);
    updateFindCount();
  }

  function onEdited() {
    updateGutter();
    clearTimeout(hlTimer);
    hlTimer = setTimeout(renderHighlight, 150);
    scheduleCommit();
  }

  function replaceCurrent() {
    if (!matches.length || matchIdx < 0) return;
    const m = matches[matchIdx];
    const rep = rInput.value;
    ta.focus();
    ta.setSelectionRange(m[0], m[1]);
    let ok = false;
    try { ok = document.execCommand('insertText', false, rep); } catch (e) { }
    if (!ok) {
      const v = ta.value;
      ta.value = v.slice(0, m[0]) + rep + v.slice(m[1]);
      onEdited();
    }
    computeMatches(m[0]);
    if (matches.length) {
      const m2 = matches[Math.min(matchIdx, matches.length - 1)];
      ta.setSelectionRange(m2[0], m2[1]);
      scrollToPos(m2[0]);
    }
    updateFindCount();
  }

  function replaceAll() {
    const q = fInput.value;
    if (!q) return;
    const re = new RegExp(escRe(q), 'gi');
    const n = (ta.value.match(re) || []).length;
    if (!n) return;
    const rep = rInput.value;
    const before = ta.scrollTop;
    ta.value = ta.value.replace(re, function () { return rep; });
    ta.scrollTop = before;
    onEdited();
    computeMatches();
    if (cb.onStatus) cb.onStatus('已替换 ' + n + ' 处');
  }

  function openFind() {
    if (!findBar) return;
    findBar.hidden = false;
    fInput.focus();
    fInput.select();
    computeMatches(ta.selectionStart || 0);
    if (matches.length) {
      const m = matches[matchIdx];
      ta.setSelectionRange(m[0], m[1]);
      scrollToPos(m[0]);
      updateFindCount();
    }
  }

  function closeFind() {
    if (!findBar) return;
    findBar.hidden = true;
    ta.focus();
  }

  function initFind() {
    findBar = document.getElementById('find-bar');
    fInput = document.getElementById('find-input');
    fCount = document.getElementById('find-count');
    rInput = document.getElementById('replace-input');

    fInput.addEventListener('input', function () {
      computeMatches(ta.selectionStart || 0);
      if (matches.length) {
        const m = matches[matchIdx];
        ta.setSelectionRange(m[0], m[1]);
        scrollToPos(m[0]);
      }
    });
    fInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        gotoMatch(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeFind();
      }
    });
    rInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        replaceCurrent();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeFind();
      }
    });
    document.getElementById('find-next').addEventListener('click', function () { gotoMatch(1); });
    document.getElementById('find-prev').addEventListener('click', function () { gotoMatch(-1); });
    document.getElementById('find-replace').addEventListener('click', replaceCurrent);
    document.getElementById('find-replace-all').addEventListener('click', replaceAll);
    document.getElementById('find-close').addEventListener('click', closeFind);
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function highlightTag(t) {
    const m = /^(<\/?)([a-zA-Z][\w:-]*)([\s\S]*?)(\/?>)$/.exec(t);
    if (!m) return '<span class="tk-tag">' + esc(t) + '</span>';
    let attrs = m[3];
    let html = '';
    let last = 0;
    const re = /([^\s=/"'>]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)?/g;
    let am;
    while ((am = re.exec(attrs))) {
      html += esc(attrs.slice(last, am.index));
      html += '<span class="tk-attr">' + esc(am[1]) + '</span>';
      if (am[2]) html += esc(am[2]);
      if (am[3] !== undefined) html += '<span class="tk-str">' + esc(am[3]) + '</span>';
      last = re.lastIndex;
    }
    html += esc(attrs.slice(last));
    return '<span class="tk-pun">' + esc(m[1]) + '</span>' +
      '<span class="tk-tag">' + esc(m[2]) + '</span>' + html +
      '<span class="tk-pun">' + esc(m[4]) + '</span>';
  }

  function highlight(raw) {
    const out = [];
    const n = raw.length;
    let i = 0;
    while (i < n) {
      const rest = raw.slice(i, i + 9);
      if (raw.startsWith('<!--', i)) {
        let end = raw.indexOf('-->', i + 4);
        end = end < 0 ? n : end + 3;
        out.push('<span class="tk-com">' + esc(raw.slice(i, end)) + '</span>');
        i = end;
        continue;
      }
      if (/^<!doctype/i.test(rest)) {
        let end = raw.indexOf('>', i);
        end = end < 0 ? n : end + 1;
        out.push('<span class="tk-doc">' + esc(raw.slice(i, end)) + '</span>');
        i = end;
        continue;
      }
      if (raw.startsWith('<![CDATA[', i)) {
        let end = raw.indexOf(']]>', i);
        end = end < 0 ? n : end + 3;
        out.push('<span class="tk-com">' + esc(raw.slice(i, end)) + '</span>');
        i = end;
        continue;
      }
      if (raw[i] === '<' && /[a-zA-Z\/!]/.test(raw[i + 1] || '')) {
        let end = raw.indexOf('>', i);
        end = end < 0 ? n : end + 1;
        out.push(highlightTag(raw.slice(i, end)));
        i = end;
        continue;
      }
      if (raw[i] === '&') {
        const m = /^&#?\w{1,10};/.exec(raw.slice(i, i + 12));
        if (m) {
          out.push('<span class="tk-ent">' + esc(m[0]) + '</span>');
          i += m[0].length;
          continue;
        }
      }
      let next = n;
      for (let j = i + 1; j < n; j++) {
        if (raw[j] === '<' || raw[j] === '&') { next = j; break; }
      }
      out.push(esc(raw.slice(i, next)));
      i = next;
    }
    return out.join('');
  }

  function renderHighlight() {
    const v = ta.value;
    if (v.length > HL_LIMIT) {
      codeEl.textContent = v;
    } else {
      codeEl.innerHTML = highlight(v);
    }
    syncScroll();
  }

  function updateGutter() {
    const lines = ta.value.split('\n').length;
    if (lines === lastLineCount) return;
    lastLineCount = lines;
    const nums = new Array(lines);
    for (let i = 0; i < lines; i++) nums[i] = i + 1;
    gutterInner.textContent = nums.join('\n');
  }

  function syncScroll() {
    codeEl.style.transform = 'translate(' + (-ta.scrollLeft) + 'px,' + (-ta.scrollTop) + 'px)';
    gutterInner.style.transform = 'translateY(' + (-ta.scrollTop) + 'px)';
  }

  function scheduleCommit() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(function () {
      commitTimer = null;
      if (ta.value !== lastCommitted) {
        lastCommitted = ta.value;
        cb.onCommit(ta.value);
      }
    }, 500);
  }

  ns.codeEditor = {
    init: function (textarea, code, gutter, callbacks) {
      ta = textarea;
      codeEl = code;
      gutterInner = gutter;
      cb = callbacks;

      ta.addEventListener('input', function (e) {
        if (e && e.isComposing) return;
        onEdited();
      });
      ta.addEventListener('scroll', syncScroll);
      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          const ok = document.execCommand('insertText', false, '  ');
          if (!ok) {
            const s = ta.selectionStart, epos = ta.selectionEnd;
            ta.setRangeText('  ', s, epos, 'end');
          }
        }
      });
    },

    setValue: function (html) {
      clearTimeout(commitTimer);
      commitTimer = null;
      ta.value = html;
      lastCommitted = html;
      updateGutter();
      renderHighlight();
      if (findBar && !findBar.hidden) computeMatches();
    },

    getValue: function () {
      return ta.value;
    },

    flushPending: function () {
      if (commitTimer === null) return false;
      clearTimeout(commitTimer);
      commitTimer = null;
      if (ta.value !== lastCommitted) {
        lastCommitted = ta.value;
        cb.onCommit(ta.value);
        return true;
      }
      return false;
    },

    getCursorPosition: function () {
      const pos = ta.selectionStart || 0;
      const before = ta.value.slice(0, pos).split('\n');
      return { line: before.length, col: before[before.length - 1].length + 1 };
    },

    initFind: initFind,
    openFind: openFind,
    closeFind: closeFind,
    isFindOpen: function () {
      return !!findBar && !findBar.hidden;
    },

    refresh: syncScroll
  };

})(window.HTMLEditor);
