window.HTMLEditor = window.HTMLEditor || {};

(function (ns) {

  let menu = null;
  let hooks = null;
  let hookedDoc = null;
  let docHandlers = null;

  const INSERT_ITEMS = [
    ['h2', 'H2'], ['h3', 'H3'], ['p', 'P'], ['img', '图片'], ['button', '按钮'],
    ['a', '链接'], ['hr', 'HR'], ['div', 'DIV'], ['ul', '列表'], ['blockquote', '引用'],
    ['video', '视频']
  ];

  function item(act, text, cls) {
    const b = document.createElement('button');
    b.className = 'ctx-item' + (cls ? ' ' + cls : '');
    b.setAttribute('data-act', act);
    b.textContent = text;
    return b;
  }

  function build(el) {
    menu.textContent = '';

    const label = document.createElement('div');
    label.className = 'ctx-label';
    label.textContent = hooks.describe(el);
    menu.appendChild(label);

    const structural = !/^(HTML|HEAD|BODY)$/.test(el.tagName);
    if (structural) {
      menu.appendChild(item('clone', '复制元素'));
      menu.appendChild(item('delete', '删除', 'danger'));
      const sep1 = document.createElement('div');
      sep1.className = 'ctx-sep';
      menu.appendChild(sep1);
      menu.appendChild(item('up', '上移一位'));
      menu.appendChild(item('down', '下移一位'));
      const sep2 = document.createElement('div');
      sep2.className = 'ctx-sep';
      menu.appendChild(sep2);
    }

    const insLabel = document.createElement('div');
    insLabel.className = 'ctx-label';
    insLabel.textContent = structural ? '在此元素后插入' : '插入到页面末尾';
    menu.appendChild(insLabel);

    const grid = document.createElement('div');
    grid.className = 'ctx-insert-grid';
    INSERT_ITEMS.forEach(function (pair) {
      const b = document.createElement('button');
      b.className = 'ctx-item';
      b.setAttribute('data-insert', pair[0]);
      b.textContent = pair[1];
      grid.appendChild(b);
    });
    menu.appendChild(grid);
  }

  function close() {
    menu.hidden = true;
  }

  function open(el, e) {
    build(el);
    menu.hidden = false;
    const paneRect = hooks.pane().getBoundingClientRect();
    const frame = document.getElementById('preview');
    const frameRect = frame ? frame.getBoundingClientRect() : paneRect;
    let x = frameRect.left + e.clientX - paneRect.left + 2;
    let y = frameRect.top + e.clientY - paneRect.top + 2;
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const pw = paneRect.width;
    const ph = paneRect.height;
    if (x + mw > pw - 6) x = Math.max(6, pw - mw - 6);
    if (y + mh > ph - 6) y = Math.max(6, ph - mh - 6);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  }

  function attachDoc(d) {
    detachDoc();
    if (!d || !menu) return;
    hookedDoc = d;
    docHandlers = {
      mousedown: function (e) {
        if (menu.hidden) return;
        const path = e.composedPath ? e.composedPath() : [];
        if (path.indexOf(menu) >= 0) return;
        close();
      },
      scroll: function () {
        if (!menu.hidden) close();
      },
      contextmenu: function (e) {
        if (!menu.hidden) close();
      },
      keydown: function (e) {
        if (e.key === 'Escape' && !menu.hidden) close();
      }
    };
    Object.keys(docHandlers).forEach(function (k) {
      d.addEventListener(k, docHandlers[k], true);
    });
  }

  function detachDoc() {
    if (hookedDoc && docHandlers) {
      Object.keys(docHandlers).forEach(function (k) {
        hookedDoc.removeEventListener(k, docHandlers[k], true);
      });
    }
    hookedDoc = null;
    docHandlers = null;
  }

  ns.contextmenu = {
    init: function (menuEl, menuHooks) {
      menu = menuEl;
      hooks = menuHooks;

      menu.addEventListener('click', function (e) {
        const btn = e.target.closest('button');
        if (!btn) return;
        const act = btn.getAttribute('data-act');
        const ins = btn.getAttribute('data-insert');
        close();
        if (act) hooks.action(act);
        else if (ins) hooks.insert(ins);
      });

      document.addEventListener('mousedown', function (e) {
        if (menu.hidden) return;
        if (!menu.contains(e.target)) close();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !menu.hidden) close();
      });
      window.addEventListener('blur', close);
    },

    attachDoc: attachDoc,
    open: open,
    close: close
  };

})(window.HTMLEditor);
