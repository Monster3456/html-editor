window.HTMLEditor = window.HTMLEditor || {};

(function (ns) {

  // 内联元素：标签内部绝不插入换行（避免引入渲染上有意义的空白）
  const INLINE_TAGS = {
    A: 1, ABBR: 1, B: 1, BDI: 1, BDO: 1, BIG: 1, BR: 1, BUTTON: 1, CITE: 1,
    CODE: 1, DATA: 1, DEL: 1, DFN: 1, EM: 1, FONT: 1, I: 1, INS: 1, KBD: 1,
    LABEL: 1, MAP: 1, MARK: 1, OUTPUT: 1, Q: 1, RP: 1, RT: 1, RUBY: 1, S: 1,
    SAMP: 1, SELECT: 1, SMALL: 1, SPAN: 1, STRIKE: 1, STRONG: 1, SUB: 1,
    SUP: 1, TIME: 1, TT: 1, U: 1, VAR: 1, WBR: 1, IMG: 1, PICTURE: 1,
    AUDIO: 1, VIDEO: 1, SOURCE: 1, TRACK: 1, INPUT: 1, METER: 1, PROGRESS: 1,
    CANVAS: 1, EMBED: 1, OBJECT: 1, IFRAME: 1
  };

  const VOID_TAGS = {
    AREA: 1, BASE: 1, BR: 1, COL: 1, EMBED: 1, HR: 1, IMG: 1, INPUT: 1,
    LINK: 1, META: 1, PARAM: 1, SOURCE: 1, TRACK: 1, WBR: 1
  };

  // 内容逐字保留的元素：原文切片，不做任何缩进处理
  const RAW_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, PRE: 1, SVG: 1, MATH: 1 };

  function isCustom(name) {
    return name.indexOf('-') >= 0;
  }

  function tagOf(raw) {
    const m = /^<\/?\s*([a-zA-Z][\w:.-]*)/.exec(raw);
    return m ? m[1].toUpperCase() : '';
  }

  function tokenize(src) {
    const toks = [];
    const n = src.length;
    let i = 0;
    let textStart = 0;
    function pushText(end) {
      if (end > textStart) toks.push({ kind: 'text', raw: src.slice(textStart, end) });
    }
    while (i < n) {
      if (src[i] === '<') {
        if (src.startsWith('<!--', i)) {
          pushText(i);
          let end = src.indexOf('-->', i + 4);
          end = end < 0 ? n : end + 3;
          toks.push({ kind: 'comment', raw: src.slice(i, end) });
          i = end; textStart = i;
          continue;
        }
        if (/^<!/.test(src.slice(i, i + 2))) {
          pushText(i);
          let end = src.indexOf('>', i);
          end = end < 0 ? n : end + 1;
          toks.push({ kind: 'doctype', raw: src.slice(i, end) });
          i = end; textStart = i;
          continue;
        }
        const c1 = src[i + 1] || '';
        if (/[a-zA-Z\/]/.test(c1)) {
          let j = i + 1;
          let q = null;
          while (j < n) {
            const ch = src[j];
            if (q) { if (ch === q) q = null; }
            else if (ch === '"' || ch === "'") q = ch;
            else if (ch === '>') break;
            j++;
          }
          const end = j < n ? j + 1 : n;
          const raw = src.slice(i, end);
          pushText(i);
          const closing = raw[1] === '/';
          toks.push({
            kind: closing ? 'close' : 'open',
            raw: raw,
            name: tagOf(raw),
            selfClose: /\/>\s*$/.test(raw)
          });
          i = end; textStart = i;
          continue;
        }
      }
      i++;
    }
    pushText(n);
    return toks;
  }

  function buildNodes(toks) {
    const nodes = [];
    const stack = [];
    let top = nodes;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const kids = stack.length ? stack[stack.length - 1].kids : top;

      if (t.kind === 'open') {
        if (t.selfClose || VOID_TAGS[t.name]) {
          kids.push({ kind: 'elem', tok: t, kids: null, voidElem: true });
          continue;
        }
        if (RAW_TAGS[t.name]) {
          let depth = 1;
          let inner = '';
          let j = i + 1;
          while (j < toks.length) {
            const u = toks[j];
            if (u.kind === 'open' && u.name === t.name && !u.selfClose && !VOID_TAGS[u.name]) depth++;
            if (u.kind === 'close' && u.name === t.name) {
              depth--;
              if (depth === 0) break;
            }
            inner += u.raw;
            j++;
          }
          const closeTok = j < toks.length ? toks[j] : null;
          kids.push({ kind: 'raw', tok: t, inner: inner, close: closeTok });
          i = closeTok ? j : toks.length - 1;
          continue;
        }
        const node = { kind: 'elem', tok: t, kids: [], closeTok: null };
        kids.push(node);
        stack.push({ kids: node.kids, name: t.name, node: node });
        continue;
      }

      if (t.kind === 'close') {
        let k = -1;
        for (let s = stack.length - 1; s >= 0; s--) {
          if (stack[s].name === t.name) { k = s; break; }
        }
        if (k >= 0) {
          // 把匹配帧及其上方（未闭合）的元素全部收口；闭合 token 挂回对应节点
          stack[k].node.closeTok = t;
          stack.length = k;
        } else {
          kids.push({ kind: 'stray', tok: t });
        }
        continue;
      }

      kids.push({ kind: t.kind, tok: t });
    }
    return nodes;
  }

  // 决策 A：该节点是否为内联边界（绝不在其两侧加换行）
  function isInlineNode(node) {
    if (node.kind === 'text' || node.kind === 'comment' || node.kind === 'stray') return true;
    if (node.kind === 'raw') return false;
    if (node.kind === 'doctype') return false;
    if (node.voidElem) return !!INLINE_TAGS[node.tok.name] || isCustom(node.tok.name);
    return !!(INLINE_TAGS[node.tok.name] || isCustom(node.tok.name));
  }

  function format(src) {
    if (!src || !src.trim()) return src;
    const nodes = buildNodes(tokenize(src));
    const parts = [];

    function ind(d) {
      let s = '';
      for (let i = 0; i < d; i++) s += '  ';
      return s;
    }

    function emitInline(node) {
      if (node.kind === 'raw') {
        parts.push(node.tok.raw, node.inner, node.close ? node.close.raw : '');
        return;
      }
      if (node.kind === 'elem') {
        parts.push(node.tok.raw);
        if (!node.voidElem) {
          (node.kids || []).forEach(emitInline);
          if (node.closeTok) parts.push(node.closeTok.raw);
        }
        return;
      }
      parts.push(node.tok.raw);
    }

    function emitBlock(node, depth) {
      if (node.kind === 'raw') {
        parts.push(node.tok.raw, node.inner, node.close ? node.close.raw : '');
        return;
      }
      if (node.kind === 'doctype') {
        parts.push(node.tok.raw);
        return;
      }
      parts.push(node.tok.raw);
      if (node.voidElem) return;
      const kids = node.kids || [];
      // 决策 B：存在块级子元素才把内容拆行，否则开闭标签与内容同行
      if (kids.some(function (k) { return !isInlineNode(k); })) {
        emitKids(kids, depth + 1);
        parts.push('\n' + ind(depth));
        if (node.closeTok) parts.push(node.closeTok.raw);
      } else {
        kids.forEach(emitInline);
        if (node.closeTok) parts.push(node.closeTok.raw);
      }
    }

    function prepKids(kids) {
      return kids.filter(function (k, idx) {
        if (k.kind === 'text' && !k.tok.raw.trim()) {
          const prev = kids[idx - 1];
          const next = kids[idx + 1];
          // 两侧都是内联内容时空白有意义（如两个 span 之间的空格），保留
          return !!(prev && next && isInlineNode(prev) && isInlineNode(next));
        }
        return true;
      });
    }

    function emitKids(kids, depth) {
      const list = prepKids(kids);
      let prevBlock = false;
      list.forEach(function (k) {
        if (isInlineNode(k)) {
          if (prevBlock) parts.push('\n' + ind(depth));
          emitInline(k);
          prevBlock = false;
        } else {
          parts.push('\n' + ind(depth));
          emitBlock(k, depth);
          prevBlock = true;
        }
      });
    }

    emitKids(nodes, 0);
    return parts.join('').replace(/^\n+/, '');
  }

  ns.formatHTML = format;

})(window.HTMLEditor);
