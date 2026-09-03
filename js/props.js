window.HTMLEditor = window.HTMLEditor || {};

(function (ns) {

  const NO_TEXT_TAGS = {
    IMG: 1, BR: 1, HR: 1, INPUT: 1, TEXTAREA: 1, SELECT: 1, IFRAME: 1, VIDEO: 1,
    AUDIO: 1, CANVAS: 1, EMBED: 1, OBJECT: 1, META: 1, LINK: 1, SCRIPT: 1,
    STYLE: 1, SOURCE: 1, TRACK: 1, AREA: 1, PARAM: 1, COL: 1, COLGROUP: 1, MAP: 1
  };

  let panel, hooks;
  let els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function getEl() {
    const el = hooks.getEl();
    if (!el || !el.isConnected) {
      hide();
      return null;
    }
    return el;
  }

  function rgbToHex(rgb) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb || '');
    if (!m) return '#000000';
    return '#' + [1, 2, 3].map(function (i) {
      return (+m[i]).toString(16).padStart(2, '0');
    }).join('');
  }

  function directText(el) {
    let out = '';
    el.childNodes.forEach(function (n) {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeType === 1 && n.tagName === 'BR') out += '\n';
    });
    return out;
  }

  function applyText(el, text) {
    const kids = Array.prototype.slice.call(el.childNodes);
    const textNodes = kids.filter(function (n) { return n.nodeType === 3; });
    const d = el.ownerDocument;
    const parts = String(text).split('\n');
    const frag = d.createDocumentFragment();
    parts.forEach(function (p, i) {
      if (i > 0) frag.appendChild(d.createElement('br'));
      if (p) frag.appendChild(d.createTextNode(p));
    });
    if (textNodes.length) {
      const firstIdx = kids.indexOf(textNodes[0]);
      textNodes.forEach(function (n) { n.remove(); });
      const ref = el.childNodes[firstIdx] || null;
      el.insertBefore(frag, ref);
    } else {
      el.appendChild(frag);
    }
  }

  function updateVisibilityBtn(el) {
    const btn = panel.querySelector('[data-act="visibility"]');
    if (btn) btn.textContent = el.style.visibility === 'hidden' ? '显示' : '隐藏';
  }

  function updateSizeSection(el, cs) {
    try {
      const rect = el.getBoundingClientRect();
      els.actual.textContent = '实际尺寸 ' + Math.round(rect.width) + ' × ' + Math.round(rect.height);
    } catch (e) {
      els.actual.textContent = '';
    }
    const win = cs ? null : el.ownerDocument.defaultView;
    cs = cs || win.getComputedStyle(el);
    els.w.value = el.style.width !== '' ? pxNum(el.style.width) : pxNum(cs.width);
    els.h.value = el.style.height !== '' ? pxNum(el.style.height) : pxNum(cs.height);
    els.pad.value = el.style.padding !== '' ? pxNum(el.style.padding) : pxNum(cs.paddingTop);
    els.mar.value = el.style.margin !== '' ? pxNum(el.style.margin) : pxNum(cs.marginTop);
    els.radius.value = el.style.borderRadius !== '' ? pxNum(el.style.borderRadius) : pxNum(cs.borderTopLeftRadius);
  }

  function refreshActual() {
    const el = getEl();
    if (!el) return;
    try {
      const rect = el.getBoundingClientRect();
      els.actual.textContent = '实际尺寸 ' + Math.round(rect.width) + ' × ' + Math.round(rect.height);
    } catch (e) { }
  }

  function pxNum(v) {
    const n = parseFloat(v);
    return isNaN(n) ? '' : Math.round(n);
  }

  function showFor(el) {
    if (!el || !el.isConnected) {
      hide();
      return;
    }
    panel.hidden = false;

    buildBreadcrumb(el);
    renderClasses(el);

    const win = el.ownerDocument.defaultView;
    const cs = win.getComputedStyle(el);

    updateSizeSection(el, cs);

    const fs = Math.round(parseFloat(cs.fontSize) || 16);
    els.fsRange.value = Math.max(8, Math.min(72, fs));
    els.fsNum.value = fs;

    const w = parseInt(cs.fontWeight, 10);
    els.weight.value = String(w);
    if (els.weight.value !== String(w)) els.weight.value = '';

    const al = cs.textAlign;
    els.align.value = /^(left|center|right|justify)$/.test(al) ? al : '';

    els.color.value = rgbToHex(cs.color);
    const bg = cs.backgroundColor;
    els.bgcolor.value = /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(bg) ? '#ffffff' : rgbToHex(bg);

    const op = Math.round((parseFloat(cs.opacity) || 1) * 100);
    els.opacity.value = op;
    els.opacityVal.textContent = op + '%';

    els.textSec.hidden = !!NO_TEXT_TAGS[el.tagName];
    if (!els.textSec.hidden) els.text.value = directText(el);

    els.tableSec.hidden = !(el.tagName === 'TD' || el.tagName === 'TH');

    const isFormText = el.tagName === 'TEXTAREA' ||
      (el.tagName === 'INPUT' && /^(text|search|url|tel|email|password|number)$/.test(el.getAttribute('type') || 'text'));
    els.formSec.hidden = !isFormText;
    if (isFormText) {
      els.formPh.value = el.getAttribute('placeholder') || '';
      els.formVal.value = el.tagName === 'TEXTAREA' ? el.textContent : (el.getAttribute('value') || '');
    }

    els.imgSec.hidden = el.tagName !== 'IMG';
    if (el.tagName === 'IMG') {
      els.imgSrc.value = el.getAttribute('data-editor-src') || el.getAttribute('src') || '';
      els.imgAlt.value = el.getAttribute('alt') || '';
    }

    els.linkSec.hidden = el.tagName !== 'A';
    if (el.tagName === 'A') {
      els.linkHref.value = el.getAttribute('href') || '';
      const t = el.getAttribute('target') || '';
      els.linkTarget.value = t === '_blank' ? '_blank' : '';
    }

    els.bw.value = Math.round(parseFloat(cs.borderTopWidth) || 0);
    els.bc.value = rgbToHex(cs.borderTopColor);
    const bs = cs.borderTopStyle;
    els.bs.value = ['solid', 'dashed', 'dotted', 'double'].indexOf(bs) >= 0 ? bs : 'solid';

    updateVisibilityBtn(el);
  }

  function hide() {
    panel.hidden = true;
  }

  function focusImgSection() {
    if (panel.hidden) return;
    if (!els.imgSec.hidden) {
      els.imgSrc.focus();
      els.imgSrc.select();
    }
  }

  function initPanelEvents() {
    panel.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      handleAction(act);
    });

    els.close.addEventListener('click', function () {
      hooks.deselect();
    });

    els.classInput.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      addUserClasses(getEl(), els.classInput.value);
      els.classInput.value = '';
    });

    els.fsRange.addEventListener('input', function () {
      const el = getEl();
      if (!el) return;
      els.fsNum.value = els.fsRange.value;
      el.style.fontSize = els.fsRange.value + 'px';
    });
    els.fsRange.addEventListener('change', function () {
      hooks.commit('修改字号');
    });

    els.fsNum.addEventListener('input', function () {
      const el = getEl();
      if (!el) return;
      const v = parseFloat(els.fsNum.value);
      if (!v || v <= 0) return;
      els.fsRange.value = Math.max(8, Math.min(72, v));
      el.style.fontSize = v + 'px';
    });
    els.fsNum.addEventListener('change', function () {
      hooks.commit('修改字号');
    });

    els.weight.addEventListener('change', function () {
      const el = getEl();
      if (!el) return;
      if (els.weight.value === '') el.style.removeProperty('font-weight');
      else el.style.fontWeight = els.weight.value;
      hooks.commit('修改字重');
    });

    els.align.addEventListener('change', function () {
      const el = getEl();
      if (!el) return;
      if (els.align.value === '') el.style.removeProperty('text-align');
      else el.style.textAlign = els.align.value;
      hooks.commit('修改对齐');
    });

    els.color.addEventListener('input', function () {
      const el = getEl();
      if (!el) return;
      el.style.color = els.color.value;
    });
    els.color.addEventListener('change', function () {
      hooks.commit('修改文字颜色');
    });

    els.bgcolor.addEventListener('input', function () {
      const el = getEl();
      if (!el) return;
      el.style.backgroundColor = els.bgcolor.value;
    });
    els.bgcolor.addEventListener('change', function () {
      hooks.commit('修改背景颜色');
    });

    els.opacity.addEventListener('input', function () {
      const el = getEl();
      if (!el) return;
      const v = +els.opacity.value;
      els.opacityVal.textContent = v + '%';
      el.style.opacity = String(v / 100);
    });
    els.opacity.addEventListener('change', function () {
      hooks.commit('修改透明度');
    });

    function bindSizeInput(input, prop) {
      input.addEventListener('input', function () {
        const el = getEl();
        if (!el) return;
        const v = input.value;
        if (v === '') return;
        const n = parseFloat(v);
        if (isNaN(n) || n < 0) return;
        el.style.setProperty(prop, n + 'px');
        if (ns.resize) ns.resize.refresh();
      });
      input.addEventListener('change', function () {
        const el = getEl();
        if (!el) return;
        if (input.value === '') el.style.removeProperty(prop);
        hooks.commit('修改尺寸间距');
        refreshActual();
      });
    }
    bindSizeInput(els.w, 'width');
    bindSizeInput(els.h, 'height');
    bindSizeInput(els.pad, 'padding');
    bindSizeInput(els.mar, 'margin');
    bindSizeInput(els.radius, 'border-radius');

    els.imgAlt.addEventListener('change', function () {
      const el = getEl();
      if (!el || el.tagName !== 'IMG') return;
      if (els.imgAlt.value) el.setAttribute('alt', els.imgAlt.value);
      else el.removeAttribute('alt');
      hooks.commit('修改图片描述');
    });

    els.imgFile.addEventListener('change', function () {
      const f = els.imgFile.files && els.imgFile.files[0];
      els.imgFile.value = '';
      if (!f) return;
      const el = getEl();
      if (!el || el.tagName !== 'IMG') return;
      const reader = new FileReader();
      reader.onload = function () {
        if (!el.isConnected) return;
        el.removeAttribute('data-editor-src');
        el.setAttribute('src', reader.result);
        els.imgSrc.value = reader.result;
        hooks.commit('上传替换图片');
        feedback('图片已替换');
      };
      reader.readAsDataURL(f);
    });

    els.formPh.addEventListener('change', function () {
      const el = getEl();
      if (!el || els.formSec.hidden) return;
      const v = els.formPh.value;
      if (v) el.setAttribute('placeholder', v);
      else el.removeAttribute('placeholder');
      hooks.commit('修改占位提示');
      feedback('占位提示已更新');
    });

    els.formVal.addEventListener('change', function () {
      const el = getEl();
      if (!el || els.formSec.hidden) return;
      const v = els.formVal.value;
      if (el.tagName === 'TEXTAREA') {
        el.textContent = v;
      } else {
        if (v) el.setAttribute('value', v);
        else el.removeAttribute('value');
        try { el.value = v; } catch (e) { }
      }
      hooks.commit('修改表单默认值');
      feedback('表单默认值已更新');
    });
  }

  function describeShort(el) {
    const tag = el.tagName.toLowerCase();
    const cls = (typeof el.className === 'string' ? el.className.trim().split(/\s+/) : [])
      .filter(function (c) {
        return c && c !== ns.preview.CLS_SELECTED && c !== ns.preview.CLS_HOVER;
      });
    return tag + (el.id ? '#' + el.id : cls.length ? '.' + cls[0] : '');
  }

  function makeCrumbSep() {
    const s = document.createElement('span');
    s.className = 'bc-sep';
    s.textContent = '›';
    return s;
  }

  function makeCrumbItem(node, isCurrent) {
    const s = document.createElement('span');
    s.className = 'bc-item' + (isCurrent ? ' cur' : '');
    s.textContent = describeShort(node);
    if (!isCurrent) {
      s.title = '选中 ' + s.textContent;
      s.addEventListener('click', function () {
        if (node.isConnected) hooks.select(node);
      });
    }
    return s;
  }

  function buildBreadcrumb(el) {
    const bc = els.breadcrumb;
    bc.textContent = '';
    const doc = el.ownerDocument;
    const chain = [];
    let node = el;
    while (node && node.nodeType === 1) {
      chain.push(node);
      if (node === doc.body || node === doc.documentElement) break;
      node = node.parentElement;
    }
    const shown = chain.slice(0, 6);
    const rest = chain.slice(6);
    if (rest.length) {
      const dots = document.createElement('span');
      dots.className = 'bc-dots';
      dots.textContent = '…';
      dots.title = rest.map(describeShort).join(' › ');
      bc.appendChild(dots);
      bc.appendChild(makeCrumbSep());
    }
    for (let i = shown.length - 1; i >= 0; i--) {
      const n = shown[i];
      if (bc.firstChild) bc.appendChild(makeCrumbSep());
      bc.appendChild(makeCrumbItem(n, n === el));
    }
    bc.title = chain.slice().reverse().map(describeShort).join(' › ');
  }

  function isEditorClass(c) {
    return c === ns.preview.CLS_SELECTED || c === ns.preview.CLS_HOVER || c === ns.preview.CLS_DRAGGING;
  }

  function userClasses(el) {
    const out = [];
    for (let i = 0; i < el.classList.length; i++) {
      if (!isEditorClass(el.classList[i])) out.push(el.classList[i]);
    }
    return out;
  }

  function renderClasses(el) {
    const box = els.classChips;
    box.textContent = '';
    const list = el ? userClasses(el) : [];
    if (!list.length) {
      const none = document.createElement('span');
      none.className = 'ppc-none';
      none.textContent = '无 class';
      box.appendChild(none);
      return;
    }
    list.forEach(function (c) {
      const chip = document.createElement('span');
      chip.className = 'ppc-chip';
      const name = document.createElement('span');
      name.className = 'ppc-name';
      name.textContent = c;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'ppc-x';
      x.title = '移除 class "' + c + '"';
      x.textContent = '×';
      x.addEventListener('click', function () { removeUserClass(el, c); });
      chip.appendChild(name);
      chip.appendChild(x);
      box.appendChild(chip);
    });
  }

  function removeUserClass(el, c) {
    if (!el || !el.isConnected || isEditorClass(c) || !el.classList.contains(c)) return;
    el.classList.remove(c);
    ns.preview.stripEmptyClass(el);
    hooks.commit('修改 class');
    renderClasses(el);
    buildBreadcrumb(el);
    feedback('已移除 class "' + c + '"');
  }

  function addUserClasses(el, raw) {
    if (!el || !el.isConnected) return;
    const names = String(raw).trim().split(/\s+/).filter(function (c) {
      return c && !isEditorClass(c) && !el.classList.contains(c);
    });
    if (!names.length) return;
    names.forEach(function (c) { el.classList.add(c); });
    hooks.commit('修改 class');
    renderClasses(el);
    buildBreadcrumb(el);
    feedback('已添加 class ' + names.map(function (c) { return '"' + c + '"'; }).join('、'));
  }

  function cloneCellShallow(c) {
    const nc = c.cloneNode(false);
    nc.textContent = '';
    nc.removeAttribute('id');
    return nc;
  }

  function insertTableRow(cell, below) {
    const tr = cell.closest('tr');
    if (!tr) return false;
    const newRow = cell.ownerDocument.createElement('tr');
    Array.prototype.forEach.call(tr.children, function (c) {
      newRow.appendChild(cloneCellShallow(c));
    });
    if (below) tr.after(newRow);
    else tr.before(newRow);
    return true;
  }

  function insertTableColumn(cell, right) {
    const table = cell.closest('table');
    if (!table) return false;
    const idx = cell.cellIndex;
    let any = false;
    Array.prototype.forEach.call(table.rows, function (tr) {
      if (idx < tr.cells.length) {
        const src = tr.cells[idx];
        const ref = right ? src.nextSibling : src;
        tr.insertBefore(cloneCellShallow(src), ref);
        any = true;
      }
    });
    return any;
  }

  function deleteTableRow(cell) {
    const tr = cell.closest('tr');
    if (!tr) return false;
    tr.remove();
    return true;
  }

  function deleteTableColumn(cell) {
    const table = cell.closest('table');
    if (!table) return false;
    const idx = cell.cellIndex;
    let any = false;
    Array.prototype.forEach.call(table.rows, function (tr) {
      if (idx < tr.cells.length) {
        tr.cells[idx].remove();
        any = true;
      }
    });
    return any;
  }

  function feedback(text) {
    if (hooks.feedback) hooks.feedback(text);
    else hooks.status(text);
  }

  function handleAction(act) {
    const el = getEl();
    if (!el) return;

    switch (act) {
      case 'delete':
        if (/^(HTML|HEAD|BODY)$/.test(el.tagName)) {
          hooks.status('不能删除 html / head / body');
          return;
        }
        el.remove();
        hooks.deselect();
        hooks.commit('删除元素');
        feedback('已删除 ' + describeShort(el));
        return;

      case 'clone': {
        if (/^(HTML|HEAD|BODY)$/.test(el.tagName)) return;
        const c = el.cloneNode(true);
        c.classList.remove(ns.preview.CLS_SELECTED, ns.preview.CLS_HOVER, ns.preview.CLS_DRAGGING);
        if (!c.getAttribute('class')) c.removeAttribute('class');
        c.removeAttribute('id');
        el.after(c);
        if (hooks.select) hooks.select(c);
        hooks.commit('复制元素');
        feedback('已复制 ' + describeShort(el));
        return;
      }

      case 'rowAbove':
      case 'rowBelow': {
        if (el.tagName !== 'TD' && el.tagName !== 'TH') return;
        const below = act === 'rowBelow';
        if (insertTableRow(el, below)) {
          hooks.commit(below ? '下方插入行' : '上方插入行');
          feedback(below ? '已在下方插入行' : '已在上方插入行');
        }
        return;
      }

      case 'colLeft':
      case 'colRight': {
        if (el.tagName !== 'TD' && el.tagName !== 'TH') return;
        const right = act === 'colRight';
        if (insertTableColumn(el, right)) {
          hooks.commit(right ? '右侧插入列' : '左侧插入列');
          feedback(right ? '已在右侧插入列' : '已在左侧插入列');
        } else {
          hooks.status('无法在此插入列');
        }
        return;
      }

      case 'delRow': {
        if (el.tagName !== 'TD' && el.tagName !== 'TH') return;
        if (deleteTableRow(el)) {
          hooks.deselect();
          hooks.commit('删除行');
          feedback('已删除所在行');
        }
        return;
      }

      case 'delCol': {
        if (el.tagName !== 'TD' && el.tagName !== 'TH') return;
        if (deleteTableColumn(el)) {
          hooks.deselect();
          hooks.commit('删除列');
          feedback('已删除所在列');
        } else {
          hooks.status('无法删除该列');
        }
        return;
      }

      case 'up':
      case 'down': {
        if (/^(HTML|HEAD|BODY)$/.test(el.tagName)) {
          hooks.status('该元素不能移动');
          return;
        }
        const dir = act === 'up' ? -1 : 1;
        const sib = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
        if (!sib) return;
        const parent = el.parentNode;
        if (!parent) return;
        if (dir < 0) parent.insertBefore(el, sib);
        else parent.insertBefore(el, sib.nextSibling);
        hooks.commit(dir < 0 ? '上移元素' : '下移元素');
        feedback(dir < 0 ? '已上移 ' + describeShort(el) : '已下移 ' + describeShort(el));
        return;
      }

      case 'visibility':
        if (el.style.visibility === 'hidden') el.style.removeProperty('visibility');
        else el.style.visibility = 'hidden';
        updateVisibilityBtn(el);
        hooks.commit(el.style.visibility === 'hidden' ? '隐藏元素' : '显示元素');
        return;

      case 'clearstyles':
        el.removeAttribute('style');
        hooks.commit('清除内联样式');
        hooks.status('已清除该元素的内联样式');
        return;

      case 'clearSize':
        el.style.removeProperty('width');
        el.style.removeProperty('height');
        hooks.commit('清除宽高');
        feedback('已清除 ' + describeShort(el) + ' 的宽高');
        updateSizeSection(el);
        return;

      case 'clearSpacing':
        el.style.removeProperty('padding');
        el.style.removeProperty('margin');
        el.style.removeProperty('border-radius');
        hooks.commit('清除间距');
        feedback('已清除 ' + describeShort(el) + ' 的间距');
        updateSizeSection(el);
        return;

      case 'applyText':
        applyText(el, els.text.value);
        hooks.commit('替换文本');
        hooks.status('文本已替换');
        return;

      case 'clearColor':
        el.style.removeProperty('color');
        hooks.commit('清除文字颜色');
        return;

      case 'clearBg':
        el.style.removeProperty('background-color');
        hooks.commit('清除背景颜色');
        return;

      case 'applyBorder': {
        const wv = parseFloat(els.bw.value);
        if (!wv || wv < 0) {
          hooks.status('请输入有效的边框宽度');
          return;
        }
        el.style.borderWidth = wv + 'px';
        el.style.borderStyle = els.bs.value;
        el.style.borderColor = els.bc.value;
        hooks.commit('应用边框');
        return;
      }

      case 'clearBorder':
        el.style.removeProperty('border-width');
        el.style.removeProperty('border-style');
        el.style.removeProperty('border-color');
        hooks.commit('清除边框');
        return;

      case 'applyImgSrc': {
        if (el.tagName !== 'IMG') return;
        const v = els.imgSrc.value.trim();
        if (!v) {
          hooks.status('请输入图片地址');
          return;
        }
        el.removeAttribute('data-editor-src');
        el.setAttribute('src', v);
        hooks.commit('替换图片地址');
        hooks.status('图片地址已应用');
        return;
      }

      case 'uploadImg':
        els.imgFile.click();
        return;

      case 'applyLink': {
        if (el.tagName !== 'A') return;
        const href = els.linkHref.value.trim();
        if (href) el.setAttribute('href', href);
        else el.removeAttribute('href');
        if (els.linkTarget.value) el.setAttribute('target', els.linkTarget.value);
        else el.removeAttribute('target');
        hooks.commit('修改链接');
        hooks.status('链接已应用');
        return;
      }
    }
  }

  ns.props = {
    init: function (panelEl, panelHooks) {
      panel = panelEl;
      hooks = panelHooks;

      els = {
        breadcrumb: $('pp-breadcrumb'),
        close: $('pp-close'),
        classChips: $('ppc-chips'),
        classInput: $('ppc-input'),
        text: $('pp-text'),
        textSec: $('pp-sec-text'),
        tableSec: $('pp-sec-table'),
        formSec: $('pp-sec-form'),
        formPh: $('pp-form-ph'),
        formVal: $('pp-form-val'),
        actual: $('pp-actual'),
        w: $('pp-w'),
        h: $('pp-h'),
        pad: $('pp-pad'),
        mar: $('pp-mar'),
        radius: $('pp-radius'),
        fsRange: $('pp-fs-range'),
        fsNum: $('pp-fs-num'),
        weight: $('pp-weight'),
        align: $('pp-align'),
        color: $('pp-color'),
        bgcolor: $('pp-bgcolor'),
        opacity: $('pp-opacity'),
        opacityVal: $('pp-opacity-val'),
        bw: $('pp-bw'),
        bs: $('pp-bs'),
        bc: $('pp-bc'),
        imgSec: $('pp-sec-img'),
        imgSrc: $('pp-img-src'),
        imgAlt: $('pp-img-alt'),
        imgFile: $('pp-img-file'),
        linkSec: $('pp-sec-link'),
        linkHref: $('pp-link-href'),
        linkTarget: $('pp-link-target')
      };

      initPanelEvents();
    },

    showFor: showFor,
    hide: hide,
    focusImgSection: focusImgSection,
    handleAction: handleAction
  };

})(window.HTMLEditor);
