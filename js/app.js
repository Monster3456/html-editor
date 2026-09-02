window.HTMLEditor = window.HTMLEditor || {};

(function (ns) {

  const app = {
    state: {
      source: '',
      originalHTML: '',
      fileName: '未命名.html',
      dirty: false,
      scriptsEnabled: false,
      selected: null
    }
  };

  const $ = function (id) { return document.getElementById(id); };

  let dom = {};
  let msgTimer = null;
  let pickerResolve = null;

  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const clsList = (typeof el.className === 'string' ? el.className.trim().split(/\s+/) : [])
      .filter(function (c) {
        return c && c !== ns.preview.CLS_SELECTED && c !== ns.preview.CLS_HOVER;
      });
    const cls = clsList.length ? '.' + clsList.slice(0, 3).join('.') : '';
    return tag + id + cls;
  }

  function updateTitle() {
    document.title = (app.state.dirty ? '● ' : '') +
      (app.state.fileName || '未命名') + ' - HTML 可视化编辑器';
  }

  function updateDirty() {
    app.state.dirty = app.state.source !== app.state.originalHTML;
    dom.dirtyDot.hidden = !app.state.dirty;
    updateTitle();
  }

  function formatSize(n) {
    return n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(1) + ' KB';
  }

  function updateStatusSize() {
    const bytes = new Blob([app.state.source]).size;
    dom.statusSize.textContent = formatSize(bytes);
    dom.codeSize.textContent = formatSize(bytes);
  }

  function refreshToolbar() {
    dom.btnUndo.disabled = !ns.history.canUndo();
    dom.btnRedo.disabled = !ns.history.canRedo();
  }

  app.statusMsg = function (text) {
    dom.statusMsg.textContent = text || '';
    clearTimeout(msgTimer);
    if (text) {
      msgTimer = setTimeout(function () { dom.statusMsg.textContent = ''; }, 4000);
    }
  };

  app.setWarn = function (text) {
    dom.statusWarn.textContent = text || '';
  };

  app.onSelect = function (el) {
    app.state.selected = el;
    if (el && el.isConnected) {
      dom.statusSel.textContent = '选中：' + describe(el);
      ns.props.showFor(el);
    } else {
      dom.statusSel.textContent = '';
      ns.props.hide();
    }
  };

  app.deselect = function () {
    ns.preview.clearSelection();
    app.onSelect(null);
  };

  app.flushCodeCommit = function () {
    return ns.codeEditor.flushPending();
  };

  app.onCodeCommit = function (text) {
    if (text === app.state.source) return;
    app.state.source = text;
    ns.preview.render(text);
    ns.history.commit(text, '编辑代码');
    updateDirty();
    refreshToolbar();
    updateStatusSize();
  };

  app.onPreviewCommit = function (label) {
    const str = ns.preview.serialize();
    if (str === app.state.source) return;
    app.state.source = str;
    ns.codeEditor.setValue(str);
    ns.history.commit(str, label || '预览编辑');
    updateDirty();
    refreshToolbar();
    updateStatusSize();
  };

  app.onRendered = function (doc) {
    if (!doc.body) {
      dom.hintTitle.textContent = '该页面使用 frameset 框架';
      dom.hintSub.textContent = '可视化编辑受限，仍可在左侧编辑源码并导出';
      dom.hint.hidden = false;
    } else {
      dom.hint.hidden = true;
    }
    const rel = ns.preview.detectRelativeUrls(doc);
    app.setWarn(rel > 0
      ? '页面包含 ' + rel + ' 个未解析的相对路径资源，预览中可能无法显示（导出时会尝试内联）'
      : '');
  };

  app.loadDocument = function (doc, opts) {
    app.state.originalHTML = opts && opts.original !== undefined ? opts.original : doc.html;
    app.state.source = doc.html;
    app.state.fileName = doc.name || '未命名.html';
    dom.filename.value = app.state.fileName;
    ns.history.reset(doc.html, '打开文件');
    ns.codeEditor.setValue(doc.html);
    ns.preview.render(doc.html);
    updateDirty();
    refreshToolbar();
    updateStatusSize();
  };

  app.enterEditor = function () {
    dom.welcome.hidden = true;
    try {
      if (!localStorage.getItem('he:coach')) {
        dom.coach.hidden = false;
        localStorage.setItem('he:coach', '1');
      }
    } catch (e) { }
  };

  function hideCoach() {
    dom.coach.hidden = true;
  }

  function updateProjectStatus() {
    const n = ns.project.fileCount();
    const p = ns.project.getHtmlPath();
    dom.statusProj.textContent = n > 1 ? '项目 · ' + n + ' 个文件 · ' + p : '';
  }

  app.openProject = function (fileArray) {
    return ns.project.ingest(fileArray).then(function (res) {
      if (!res.htmlPaths.length) {
        ns.project.clearFiles();
        app.statusMsg('未找到 HTML 文件，请选择包含 .html 的文件或文件夹');
        return null;
      }
      if (res.htmlPaths.length === 1) {
        return loadHtmlFromProject(res.htmlPaths[0]).then(function () {
          app.statusMsg('已打开：' + res.htmlPaths[0]);
          return res.htmlPaths[0];
        });
      }
      return showPicker(res.htmlPaths, res.fileCount).then(function (chosen) {
        if (!chosen) return null;
        return loadHtmlFromProject(chosen).then(function () {
          app.statusMsg('已打开：' + chosen);
          return chosen;
        });
      });
    });
  };

  function loadHtmlFromProject(path) {
    ns.project.stashCurrent(app.state.source);
    ns.project.setHtmlPath(path);
    return Promise.all([
      ns.project.getHtml(path),
      ns.project.originalHtml(path)
    ]).then(function (r) {
      app.loadDocument({
        name: ns.project.basename(path),
        html: r[0]
      }, { original: r[1] });
      app.enterEditor();
      updateProjectStatus();
    });
  }

  function showPicker(paths, fileCount) {
    return new Promise(function (resolve) {
      dom.pickerSub.textContent = '共 ' + fileCount + ' 个文件，其中 ' + paths.length + ' 个 HTML 页面';
      dom.pickerList.textContent = '';
      paths.forEach(function (p, i) {
        const item = document.createElement('label');
        item.className = 'pick-item' + (i === 0 ? ' sel' : '');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'htmlpick';
        radio.value = p;
        radio.checked = i === 0;
        const pathEl = document.createElement('span');
        pathEl.className = 'pi-path';
        pathEl.textContent = p;
        const sizeEl = document.createElement('span');
        sizeEl.className = 'pi-size';
        sizeEl.textContent = formatSize(0);
        item.appendChild(radio);
        item.appendChild(pathEl);
        item.appendChild(sizeEl);
        item.addEventListener('click', function () {
          dom.pickerList.querySelectorAll('.pick-item').forEach(function (n) {
            n.classList.remove('sel');
          });
          item.classList.add('sel');
        });
        dom.pickerList.appendChild(item);
        ns.project.originalHtml(p).then(function (html) {
          if (html) sizeEl.textContent = formatSize(new Blob([html]).size);
        });
      });
      dom.picker.hidden = false;
      pickerResolve = resolve;
    });
  }

  function hidePicker() {
    dom.picker.hidden = true;
    pickerResolve = null;
  }

  function handleFiles(fileList) {
    const arr = Array.prototype.slice.call(fileList || []);
    if (!arr.length) return;
    const hasHtml = arr.some(function (f) {
      return /\.(html?|xhtml)$/i.test(f.name) || f.type === 'text/html';
    });
    if (!hasHtml) {
      app.statusMsg('请选择包含 HTML 文件的文件或文件夹');
      return;
    }
    app.openProject(arr);
  }

  app.openDropped = function (files) {
    handleFiles(files);
  };

  app.export = function () {
    app.flushCodeCommit();
    const str = ns.preview.serialize();
    if (str !== app.state.source) {
      app.state.source = str;
      ns.codeEditor.setValue(str);
      ns.history.commit(str, '导出前同步');
      updateDirty();
      refreshToolbar();
    }
    let name = (app.state.fileName || '未命名.html').trim();
    if (!/\.(html?|xhtml)$/i.test(name)) name += '.html';
    const finish = function (result) {
      ns.io.exportFile(name, result.html);
      app.statusMsg(result.inlined > 0
        ? '已导出：' + name + '（已内联 ' + result.inlined + ' 个外部资源）'
        : '已导出：' + name);
    };
    ns.project.selfContain(str).then(finish, function () {
      ns.io.exportFile(name, str);
      app.statusMsg('已导出：' + name);
    });
  };

  app.undo = function () {
    if (ns.preview.isInlineEditing()) return;
    app.flushCodeCommit();
    const entry = ns.history.undo();
    if (!entry) {
      app.statusMsg('没有可撤销的操作');
      return;
    }
    app.state.source = entry.html;
    ns.codeEditor.setValue(entry.html);
    ns.preview.render(entry.html);
    updateDirty();
    refreshToolbar();
    app.statusMsg('已撤销：' + entry.label);
  };

  app.redo = function () {
    if (ns.preview.isInlineEditing()) return;
    app.flushCodeCommit();
    const entry = ns.history.redo();
    if (!entry) {
      app.statusMsg('没有可重做的操作');
      return;
    }
    app.state.source = entry.html;
    ns.codeEditor.setValue(entry.html);
    ns.preview.render(entry.html);
    updateDirty();
    refreshToolbar();
    app.statusMsg('已重做：' + entry.label);
  };

  app.resetDoc = function () {
    if (!window.confirm('确定要恢复为打开时的原始内容吗？\n（之后的修改仍可用“撤销”找回）')) return;
    app.flushCodeCommit();
    app.state.source = app.state.originalHTML;
    ns.codeEditor.setValue(app.state.originalHTML);
    ns.preview.render(app.state.originalHTML);
    ns.history.commit(app.state.originalHTML, '重置');
    updateDirty();
    refreshToolbar();
    app.statusMsg('已恢复原始内容');
  };

  app.refreshPreview = function () {
    ns.preview.refresh();
  };

  function wireToolbar() {
    dom.btnOpen.addEventListener('click', function (e) {
      e.stopPropagation();
      dom.openMenuList.hidden = !dom.openMenuList.hidden;
    });
    document.addEventListener('click', function (e) {
      if (!dom.openMenu.contains(e.target)) dom.openMenuList.hidden = true;
    });
    dom.miOpenFile.addEventListener('click', function () {
      dom.openMenuList.hidden = true;
      dom.fileInput.click();
    });
    dom.miOpenDir.addEventListener('click', function () {
      dom.openMenuList.hidden = true;
      dom.dirInput.click();
    });

    dom.fileInput.addEventListener('change', function () {
      const fs = dom.fileInput.files;
      dom.fileInput.value = '';
      if (fs && fs.length) handleFiles(fs);
    });
    dom.dirInput.addEventListener('change', function () {
      const fs = dom.dirInput.files;
      dom.dirInput.value = '';
      if (fs && fs.length) handleFiles(fs);
    });

    dom.wcOpenFile.addEventListener('click', function () { dom.fileInput.click(); });
    dom.wcOpenDir.addEventListener('click', function () { dom.dirInput.click(); });
    dom.wcSample.addEventListener('click', function () {
      app.loadDocument({ name: '示例页面.html', html: ns.sampleHTML });
      app.enterEditor();
      app.statusMsg('已载入示例页面，试试点击预览中的元素');
    });

    dom.btnExport.addEventListener('click', app.export);
    dom.btnUndo.addEventListener('click', app.undo);
    dom.btnRedo.addEventListener('click', app.redo);
    dom.btnReset.addEventListener('click', app.resetDoc);
    dom.btnRefresh.addEventListener('click', function () {
      app.refreshPreview();
      app.statusMsg('预览已刷新');
    });

    dom.chkScripts.addEventListener('change', function (e) {
      app.state.scriptsEnabled = e.target.checked;
      app.refreshPreview();
      app.statusMsg(app.state.scriptsEnabled
        ? '已允许页面脚本执行（已重新渲染）'
        : '已禁用页面脚本（已重新渲染）');
    });

    dom.btnNewwin.addEventListener('click', function () {
      const ok = ns.io.openInNewWindow(ns.preview.serialize());
      if (!ok) app.statusMsg('弹出窗口被浏览器拦截，请允许弹窗后重试');
    });

    dom.filename.addEventListener('change', function () {
      app.state.fileName = dom.filename.value.trim() || '未命名.html';
      updateTitle();
    });

    dom.pickerOk.addEventListener('click', function () {
      const sel = dom.pickerList.querySelector('input[type="radio"]:checked');
      const chosen = sel ? sel.value : null;
      const resolve = pickerResolve;
      hidePicker();
      if (resolve) resolve(chosen);
    });
    dom.pickerCancel.addEventListener('click', function () {
      const resolve = pickerResolve;
      hidePicker();
      if (resolve) resolve(null);
    });

    dom.coachX.addEventListener('click', hideCoach);
    setTimeout(hideCoach, 15000);
  }

  function wireShortcuts() {
    document.addEventListener('keydown', function (e) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod) {
        const k = (e.key || '').toLowerCase();
        if (k === 's') {
          e.preventDefault();
          app.export();
        } else if (k === 'o') {
          const t = e.target;
          if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
          e.preventDefault();
          dom.fileInput.click();
        } else if (k === 'z' && !e.shiftKey) {
          if (e.target && (e.target.isContentEditable || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
          e.preventDefault();
          app.undo();
        } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
          if (e.target && (e.target.isContentEditable || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
          e.preventDefault();
          app.redo();
        }
      } else if (e.key === 'Escape') {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        if (!dom.picker.hidden) {
          const resolve = pickerResolve;
          hidePicker();
          if (resolve) resolve(null);
          return;
        }
        app.deselect();
      }
    });

    window.addEventListener('beforeunload', function (e) {
      app.flushCodeCommit();
      if (app.state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  function wireSplitter() {
    let dragging = false;
    dom.divider.addEventListener('mousedown', function (e) {
      dragging = true;
      e.preventDefault();
      dom.divider.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      const rect = dom.main.getBoundingClientRect();
      let px = e.clientX - rect.left;
      px = Math.max(240, Math.min(rect.width - 260, px));
      dom.codePane.style.width = px + 'px';
    });
    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      dom.divider.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem('he:split', dom.codePane.style.width); } catch (e) { }
    });
    try {
      const saved = localStorage.getItem('he:split');
      if (saved) dom.codePane.style.width = saved;
    } catch (e) { }
  }

  function wireDrop() {
    ns.io.enableDropTarget(document.body, function (files) {
      app.openDropped(files);
    });
  }

  function wireCursorStatus() {
    ['keyup', 'click', 'input', 'select'].forEach(function (ev) {
      dom.code.addEventListener(ev, function () {
        const p = ns.codeEditor.getCursorPosition();
        dom.statusPos.textContent = '行 ' + p.line + ', 列 ' + p.col;
      });
    });
  }

  app.init = function () {
    dom = {
      btnOpen: $('btn-open'),
      openMenu: $('open-menu'),
      openMenuList: $('open-menu-list'),
      miOpenFile: $('mi-open-file'),
      miOpenDir: $('mi-open-dir'),
      fileInput: $('file-input'),
      dirInput: $('dir-input'),
      btnExport: $('btn-export'),
      btnUndo: $('btn-undo'),
      btnRedo: $('btn-redo'),
      btnReset: $('btn-reset'),
      btnRefresh: $('btn-refresh'),
      chkScripts: $('chk-scripts'),
      btnNewwin: $('btn-newwin'),
      filename: $('filename'),
      dirtyDot: $('dirty-dot'),
      welcome: $('welcome'),
      wcOpenFile: $('wc-open-file'),
      wcOpenDir: $('wc-open-dir'),
      wcSample: $('wc-sample'),
      picker: $('picker'),
      pickerSub: $('picker-sub'),
      pickerList: $('picker-list'),
      pickerOk: $('picker-ok'),
      pickerCancel: $('picker-cancel'),
      coach: $('coach'),
      coachX: $('coach-x'),
      code: $('code'),
      codeSize: $('code-size'),
      codePane: $('code-pane'),
      divider: $('divider'),
      main: $('main'),
      hint: $('preview-hint'),
      hintTitle: $('preview-hint-title'),
      hintSub: $('preview-hint-sub'),
      statusMsg: $('status-msg'),
      statusWarn: $('status-warn'),
      statusProj: $('status-proj'),
      statusSel: $('status-sel'),
      statusPos: $('status-pos'),
      statusSize: $('status-size')
    };

    ns.preview.init($('preview'), {
      getScriptsEnabled: function () { return app.state.scriptsEnabled; },
      getSource: function () { return app.state.source; },
      getProject: function () { return ns.project.hasFiles() ? ns.project : null; },
      flushCodeCommit: function () { return app.flushCodeCommit(); },
      onSelect: function (el) { app.onSelect(el); },
      onInlineEditStart: function () {
        app.statusMsg('内联编辑中：直接输入文字，按 Esc 或点击其他位置结束');
      },
      onInlineEditCommit: function () { app.onPreviewCommit('内联编辑文本'); },
      onRendered: function (d) { app.onRendered(d); },
      onRenderError: function () { app.statusMsg('渲染预览失败，请检查源码'); },
      onShortcut: function (k) {
        if (k === 'save') app.export();
        else if (k === 'undo') app.undo();
        else if (k === 'redo') app.redo();
      },
      onDropFiles: function (files) { app.openDropped(files); }
    });

    ns.codeEditor.init($('code'), $('hl'), $('gutter-inner'), {
      onCommit: function (text) { app.onCodeCommit(text); }
    });

    ns.props.init($('props-panel'), {
      getEl: function () { return app.state.selected; },
      commit: function (label) { app.onPreviewCommit(label); },
      status: function (m) { app.statusMsg(m); },
      deselect: function () { app.deselect(); }
    });

    wireToolbar();
    wireShortcuts();
    wireSplitter();
    wireDrop();
    wireCursorStatus();

    if (!ns.preview.isSandboxUsable()) {
      app.setWarn('当前环境（file://）下浏览器沙箱受限，已自动改用脚本禁用方案，功能不受影响');
    }

    updateTitle();
    updateStatusSize();
  };

  ns.app = app;
  ns.app.init();

})(window.HTMLEditor);
