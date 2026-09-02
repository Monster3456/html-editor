window.HTMLEditor = window.HTMLEditor || {};

(function (ns) {

  let hooks = null;

  const PLACEHOLDER_IMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">' +
    '<rect width="640" height="360" fill="#e2e8f0"/>' +
    '<rect x="236" y="120" width="168" height="98" rx="8" fill="#cbd5e1"/>' +
    '<circle cx="282" cy="152" r="12" fill="#94a3b8"/>' +
    '<path d="m252 200 34-30 26 22 30-34 28 42z" fill="#94a3b8"/>' +
    '<text x="320" y="252" font-family="sans-serif" font-size="19" fill="#64748b" text-anchor="middle">点击右侧面板替换图片</text>' +
    '</svg>'
  );

  const DEFS = {
    h2: { label: '标题' },
    h3: { label: '副标题' },
    p: { label: '段落' },
    img: { label: '图片' },
    button: { label: '按钮' },
    a: { label: '链接' },
    hr: { label: '分隔线' },
    div: { label: '容器' },
    ul: { label: '列表' },
    blockquote: { label: '引用块' },
    video: { label: '视频' }
  };

  function build(doc, type) {
    const el = doc.createElement(type);
    switch (type) {
      case 'h2':
        el.textContent = '新标题';
        break;
      case 'h3':
        el.textContent = '新副标题';
        break;
      case 'p':
        el.textContent = '这是一段新插入的文字，双击可以直接编辑。';
        break;
      case 'img':
        el.setAttribute('src', PLACEHOLDER_IMG);
        el.setAttribute('alt', '示例图片');
        el.style.maxWidth = '100%';
        break;
      case 'button':
        el.textContent = '按钮文字';
        el.style.padding = '8px 20px';
        break;
      case 'a':
        el.setAttribute('href', 'https://example.com');
        el.textContent = '链接文字';
        break;
      case 'hr':
        break;
      case 'div':
        el.textContent = '容器内容';
        el.style.padding = '12px';
        el.style.minHeight = '44px';
        break;
      case 'ul':
        ['列表项 1', '列表项 2', '列表项 3'].forEach(function (t) {
          const li = doc.createElement('li');
          li.textContent = t;
          el.appendChild(li);
        });
        break;
      case 'blockquote':
        el.textContent = '这是一段引用文字。';
        el.style.padding = '8px 16px';
        el.style.borderLeft = '3px solid #cbd5e1';
        break;
      case 'video':
        el.setAttribute('controls', '');
        el.style.maxWidth = '100%';
        el.style.minHeight = '48px';
        break;
    }
    return el;
  }

  function insert(type) {
    if (!DEFS[type]) return;
    const sel = ns.preview.getSelected();
    const anchorPath = (sel && sel.isConnected && !/^(HTML|HEAD|BODY)$/.test(sel.tagName))
      ? ns.preview.getPath(sel)
      : null;
    hooks.flushCodeCommit();
    const doc = ns.preview.getDoc();
    if (!doc || !doc.body) {
      hooks.status('当前页面无法插入元素');
      return;
    }
    let anchor = null;
    if (anchorPath) {
      const el2 = ns.preview.resolvePath(doc, anchorPath);
      if (el2 && el2.nodeType === 1 && !/^(HTML|HEAD|BODY)$/.test(el2.tagName)) anchor = el2;
    }
    const el = build(doc, type);
    if (anchor) anchor.after(el);
    else doc.body.appendChild(el);
    hooks.commit('插入' + DEFS[type].label);
    ns.preview.select(el);
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { }
    hooks.status('已插入' + DEFS[type].label + (type === 'video' ? '，请在源代码中为其填写视频地址' : ''));
  }

  ns.insert = {
    init: function (insertHooks) {
      hooks = insertHooks;
    },
    insert: insert,
    DEFS: DEFS
  };

})(window.HTMLEditor);
