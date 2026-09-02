window.HTMLEditor = window.HTMLEditor || {};

(function (ns) {

  const HL_LIMIT = 500000;
  let ta = null, codeEl = null, gutterInner = null, cb = null;
  let hlTimer = null, commitTimer = null;
  let lastCommitted = '';
  let lastLineCount = 0;

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
        updateGutter();
        clearTimeout(hlTimer);
        hlTimer = setTimeout(renderHighlight, 150);
        scheduleCommit();
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

    refresh: syncScroll
  };

})(window.HTMLEditor);
