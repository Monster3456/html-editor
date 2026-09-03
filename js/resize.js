window.HTMLEditor = window.HTMLEditor || {};

(function (ns) {

  const MIN = 8;
  const UNIT_RE = /^(-?[\d.]+)(px|%|em|rem|vw|vh|vmin|vmax)$/;
  const REPLACED = {
    IMG: 1, VIDEO: 1, CANVAS: 1, SVG: 1, INPUT: 1, TEXTAREA: 1, SELECT: 1,
    EMBED: 1, OBJECT: 1, IFRAME: 1, AUDIO: 1
  };

  let pane = null;
  let hooks = null;
  let layer = null;
  let readout = null;
  let capture = null;
  let handles = {};
  let st = null;
  let scrollDoc = null;
  let observedFrame = null;
  let frameRO = null;

  function frame() {
    return document.getElementById('preview');
  }

  function eligible(el) {
    if (!el || !el.isConnected) return false;
    if (/^(HTML|HEAD|BODY)$/.test(el.tagName)) return false;
    if (st) return true;
    if (ns.preview.isInlineEditing()) return false;
    if (ns.preview.isDragging()) return false;
    let cs;
    try { cs = el.ownerDocument.defaultView.getComputedStyle(el); } catch (e) { return false; }
    if (cs.display === 'none') return false;
    if (REPLACED[el.tagName]) return true;
    if (cs.display === 'inline') return false;
    return true;
  }

  function frameOffset() {
    const f = frame();
    if (!f || !pane) return null;
    const fr = f.getBoundingClientRect();
    const pr = pane.getBoundingClientRect();
    return { x: fr.left - pr.left, y: fr.top - pr.top };
  }

  function place(h, x, y) {
    h.style.left = x + 'px';
    h.style.top = y + 'px';
  }

  function refresh() {
    if (!layer || !pane) return;
    const el = ns.preview.getSelected();
    if (!eligible(el)) {
      layer.hidden = true;
      return;
    }
    let rect;
    try { rect = el.getBoundingClientRect(); } catch (e) { layer.hidden = true; return; }
    const off = frameOffset();
    if (!off || (rect.width < 2 && rect.height < 2)) {
      layer.hidden = true;
      return;
    }
    // 元素完全滚出预览视口时不显示手柄，避免钳制后出现脱离元素的悬空手柄
    const f = frame();
    const iw = f ? f.clientWidth : 0;
    const ih = f ? f.clientHeight : 0;
    if (rect.bottom < 0 || rect.top > ih || rect.right < 0 || rect.left > iw) {
      layer.hidden = true;
      return;
    }
    const left = off.x + rect.left;
    const top = off.y + rect.top;
    const right = left + rect.width;
    const bottom = top + rect.height;
    // 手柄钳制在面板内，避免贴边元素的手柄被 overflow:hidden 裁掉一半
    const pw = pane.clientWidth;
    const ph = pane.clientHeight;
    const cx = function (x, s) { return Math.max(0, Math.min(x, pw - s)); };
    const cy = function (y, s) { return Math.max(0, Math.min(y, ph - s)); };
    place(handles.e, cx(right - 5, 10), cy(top + rect.height / 2 - 5, 10));
    place(handles.s, cx(left + rect.width / 2 - 5, 10), cy(bottom - 5, 10));
    place(handles.se, cx(right - 6, 12), cy(bottom - 6, 12));
    layer.hidden = false;
  }

  // 单位策略 B：保留内联样式原有单位（%、em、rem、vw…），
  // factor = 当前计算像素 / 内联数值；无内联尺寸时写 px
  function parseDim(inlineVal, compPx) {
    const m = UNIT_RE.exec(String(inlineVal || '').trim());
    if (m && m[2] !== 'px') {
      const num = parseFloat(m[1]);
      if (num > 0 && compPx > 0) return { unit: m[2], factor: compPx / num };
    }
    return { unit: 'px', factor: 1 };
  }

  function applyDim(el, axis, targetPx, info) {
    let v;
    if (info.unit === 'px') v = Math.round(targetPx) + 'px';
    else v = (Math.round(targetPx / info.factor * 1000) / 1000) + info.unit;
    el.style[axis] = v;
  }

  function cursorFor(dir) {
    return dir === 'e' ? 'ew-resize' : dir === 's' ? 'ns-resize' : 'nwse-resize';
  }

  function updateReadout(e) {
    if (!st || !readout) return;
    let r;
    try { r = st.el.getBoundingClientRect(); } catch (err) { return; }
    readout.textContent = Math.round(r.width) + ' × ' + Math.round(r.height);
    const pr = pane.getBoundingClientRect();
    readout.hidden = false;
    let lx = e.clientX - pr.left + 14;
    let ly = e.clientY - pr.top + 16;
    lx = Math.max(0, Math.min(lx, pr.width - readout.offsetWidth - 4));
    ly = Math.max(0, Math.min(ly, pr.height - readout.offsetHeight - 4));
    readout.style.left = lx + 'px';
    readout.style.top = ly + 'px';
  }

  function onKey(e) {
    if (!st || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    const s = st;
    st = null;
    s.el.style.width = s.origW;
    s.el.style.height = s.origH;
    if (!s.el.style.cssText.trim()) s.el.removeAttribute('style');
    teardown();
    refresh();
  }

  function teardown() {
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('keydown', onKey, true);
    const f = frame();
    try {
      if (f && f.contentDocument) f.contentDocument.removeEventListener('keydown', onKey, true);
    } catch (e) { }
    if (capture) capture.hidden = true;
    if (readout) readout.hidden = true;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  function onMove(e) {
    if (!st) return;
    e.preventDefault();
    if (!st.el.isConnected) {
      st = null;
      teardown();
      return;
    }
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (dx || dy) st.moved = true;
    let tw = null;
    let th = null;
    if (st.dir === 'e') {
      tw = Math.max(MIN, st.startCompW + dx);
    } else if (st.dir === 's') {
      th = Math.max(MIN, st.startCompH + dy);
    } else if (e.shiftKey) {
      tw = Math.max(MIN, st.startCompW + dx);
      th = tw / st.ratio;
      if (th < MIN) { th = MIN; tw = th * st.ratio; }
    } else {
      tw = Math.max(MIN, st.startCompW + dx);
      th = Math.max(MIN, st.startCompH + dy);
    }
    if (tw !== null) applyDim(st.el, 'width', tw, st.wInfo);
    if (th !== null) applyDim(st.el, 'height', th, st.hInfo);
    refresh();
    updateReadout(e);
  }

  function onUp() {
    if (!st) return;
    const s = st;
    st = null;
    teardown();
    refresh();
    const changed = s.el.style.width !== s.origW || s.el.style.height !== s.origH;
    if (s.moved && changed && hooks.commit) {
      hooks.commit('调整尺寸');
      if (hooks.feedback) hooks.feedback('已调整尺寸');
    }
  }

  function onHandleDown(e) {
    if (e.button !== 0 || st) return;
    const dir = e.currentTarget.getAttribute('data-rz');
    const el = ns.preview.getSelected();
    if (!dir || !eligible(el)) return;
    e.preventDefault();
    e.stopPropagation();
    let rect;
    try { rect = el.getBoundingClientRect(); } catch (err) { return; }
    let compW = rect.width;
    let compH = rect.height;
    try {
      const cs = el.ownerDocument.defaultView.getComputedStyle(el);
      compW = parseFloat(cs.width) || compW;
      compH = parseFloat(cs.height) || compH;
    } catch (err) { }
    st = {
      dir: dir,
      el: el,
      startX: e.clientX,
      startY: e.clientY,
      startCompW: compW,
      startCompH: compH,
      ratio: compH > 0 ? compW / compH : 1,
      wInfo: parseDim(el.style.width, compW),
      hInfo: parseDim(el.style.height, compH),
      origW: el.style.width,
      origH: el.style.height,
      moved: false
    };
    document.body.style.cursor = cursorFor(dir);
    document.body.style.userSelect = 'none';
    if (capture) {
      capture.style.cursor = cursorFor(dir);
      capture.hidden = false;
    }
    const f = frame();
    try {
      if (f && f.contentDocument) f.contentDocument.addEventListener('keydown', onKey, true);
    } catch (err) { }
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('keydown', onKey, true);
    updateReadout(e);
  }

  function onScroll() {
    if (!st) refresh();
  }

  function syncDoc(d) {
    try {
      // 每次渲染后 Document/Window 对象不变但其监听器被清空，故无条件重绑
      if (d) {
        d.removeEventListener('scroll', onScroll, true);
        d.addEventListener('scroll', onScroll, true);
        scrollDoc = d;
      }
    } catch (e) { }
    const f = frame();
    if (f && frameRO && f !== observedFrame) {
      if (observedFrame) {
        try { frameRO.unobserve(observedFrame); } catch (e) { }
      }
      frameRO.observe(f);
      observedFrame = f;
    }
    refresh();
  }

  ns.resize = {
    init: function (paneEl, h) {
      pane = paneEl;
      hooks = h || {};
      layer = document.getElementById('resize-layer');
      readout = document.getElementById('rz-readout');
      capture = document.getElementById('rz-capture');
      handles.e = layer.querySelector('[data-rz="e"]');
      handles.s = layer.querySelector('[data-rz="s"]');
      handles.se = layer.querySelector('[data-rz="se"]');
      Object.keys(handles).forEach(function (k) {
        handles[k].addEventListener('mousedown', onHandleDown);
      });
      window.addEventListener('resize', function () { if (!st) refresh(); });
      if (window.ResizeObserver) {
        frameRO = new ResizeObserver(function () { if (!st) refresh(); });
        const f = frame();
        if (f) {
          frameRO.observe(f);
          observedFrame = f;
        }
      }
    },

    refresh: refresh,
    syncDoc: syncDoc,

    isResizing: function () {
      return !!st;
    }
  };

})(window.HTMLEditor);
