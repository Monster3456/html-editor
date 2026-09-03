window.HTMLEditor = window.HTMLEditor || {};

(function (ns) {

  const app = {
    state: {
      source: '',
      originalHTML: '',
      fileName: '未命名.html',
      dirty: false,
      scriptsEnabled: false,
      selected: null,
      deviceW: 0
    }
  };

  const $ = function (id) { return document.getElementById(id); };

  let dom = {};
  let msgTimer = null;
  let pickerResolve = null;
  let draftTimer = null;
  let draftRecord = null;
  let toastTimer = null;

  app.toast = function (text, duration) {
    if (!dom.toast) return;
    dom.toastText.textContent = text;
    dom.toast.hidden = false;
    requestAnimationFrame(function () {
      dom.toast.classList.add('show');
    });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      dom.toast.classList.remove('show');
      setTimeout(function () { dom.toast.hidden = true; }, 220);
    }, duration || 2500);
  };

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
    ns.tree.markSelected(el);
    ns.resize.refresh();
  };

  app.deselect = function () {
    ns.preview.clearSelection();
    app.onSelect(null);
  };

  app.navigateSelection = function (key) {
    const el = ns.preview.getSelected();
    if (!el || !el.isConnected) return false;
    let next = null;
    if (key === 'ArrowRight') next = el.nextElementSibling;
    else if (key === 'ArrowLeft') next = el.previousElementSibling;
    else if (key === 'ArrowDown') next = el.firstElementChild;
    else if (key === 'ArrowUp') {
      const p = el.parentElement;
      if (p && p.tagName !== 'HTML') next = p;
    }
    if (!next || next.nodeType !== 1) return false;
    ns.preview.select(next);
    try { next.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { }
    return true;
  };

  app.deleteSelected = function () {
    const el = ns.preview.getSelected();
    if (!el || !el.isConnected) return;
    ns.props.handleAction('delete');
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
    scheduleDraftSave();
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
    ns.tree.scheduleRebuild();
    ns.resize.refresh();
    scheduleDraftSave();
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
    ns.tree.rebuild();
    ns.contextmenu.attachDoc(doc);
    applyDeviceToFrame();
    ns.resize.syncDoc(doc);
  };

  app.loadDocument = function (doc, opts) {
    app.state.originalHTML = opts && opts.original !== undefined ? opts.original : doc.html;
    app.state.source = doc.html;
    app.state.fileName = doc.name || '未命名.html';
    dom.filename.value = app.state.fileName;
    ns.history.reset(doc.html, '打开文件');
    ns.codeEditor.setValue(doc.html);
    app.deselect();
    ns.preview.render(doc.html);
    updateDirty();
    refreshToolbar();
    updateStatusSize();
    scheduleDraftSave();
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

  function openKeysDialog() {
    dom.keysOverlay.hidden = false;
  }

  function closeKeysDialog() {
    dom.keysOverlay.hidden = true;
  }

  function updateProjectStatus() {
    const n = ns.project.fileCount();
    const p = ns.project.getHtmlPath();
    dom.statusProj.textContent = n > 1 ? '项目 · ' + n + ' 个文件 · ' + p : '';
    buildPageMenu();
  }

  function buildPageMenu() {
    const pages = ns.project.pages();
    const cur = ns.project.getHtmlPath();
    dom.pageMenu.hidden = pages.length < 2;
    if (pages.length < 2) {
      dom.pageMenuList.hidden = true;
      return;
    }
    dom.pageMenuList.textContent = '';
    pages.forEach(function (p) {
      const isCur = p === cur;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'menu-item mi-page' + (isCur ? ' cur' : '');
      item.title = p;
      const check = document.createElement('span');
      check.className = 'mi-check';
      check.textContent = isCur ? '✓' : '';
      const label = document.createElement('span');
      label.className = 'mi-page-path';
      label.textContent = p;
      item.appendChild(check);
      item.appendChild(label);
      item.addEventListener('click', function () {
        dom.pageMenuList.hidden = true;
        if (p === ns.project.getHtmlPath()) return;
        loadHtmlFromProject(p).then(function () {
          app.statusMsg('已切换页面：' + p);
        });
      });
      dom.pageMenuList.appendChild(item);
    });
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
      const size = formatSize(new Blob([result.html]).size);
      app.toast(result.inlined > 0
        ? '已导出 ' + name + ' · ' + size + '（已内联 ' + result.inlined + ' 个资源）'
        : '已导出 ' + name + ' · ' + size, 4000);
    };
    ns.project.selfContain(str).then(finish, function () {
      ns.io.exportFile(name, str);
      app.toast('已导出 ' + name + ' · ' + formatSize(new Blob([str]).size), 4000);
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
    app.toast('已撤销：' + entry.label);
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
    app.toast('已重做：' + entry.label);
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

  app.formatSource = function () {
    app.flushCodeCommit();
    const src = app.state.source;
    const out = ns.formatHTML(src);
    if (out === src) {
      app.statusMsg('源码已是格式化状态，无需调整');
      return;
    }
    app.state.source = out;
    ns.codeEditor.setValue(out);
    ns.history.commit(out, '格式化源码');
    ns.preview.render(out);
    updateDirty();
    refreshToolbar();
    updateStatusSize();
    scheduleDraftSave();
    app.toast('源码已格式化');
  };

  app.duplicateSelected = function () {
    if (ns.preview.isInlineEditing()) return;
    app.flushCodeCommit();
    ns.props.handleAction('clone');
  };

  app.refreshPreview = function () {
    ns.preview.refresh();
  };

  function applyDeviceToFrame() {
    const frame = document.getElementById('preview');
    if (!frame) return;
    frame.style.width = app.state.deviceW > 0 ? app.state.deviceW + 'px' : '';
  }

  function setDevice(w) {
    app.state.deviceW = w;
    dom.deviceSeg.querySelectorAll('.seg-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-w') === String(w));
    });
    if (w > 0) {
      dom.previewPane.classList.add('device-narrow');
      dom.deviceLabel.hidden = false;
      dom.deviceLabel.textContent = '宽度 ' + w + 'px';
      app.statusMsg('预览宽度已切换为 ' + w + 'px，模拟窄屏设备');
    } else {
      dom.previewPane.classList.remove('device-narrow');
      dom.deviceLabel.hidden = true;
      app.statusMsg('预览已恢复全宽');
    }
    applyDeviceToFrame();
  }

  function scheduleDraftSave() {
    if (!ns.draft.available()) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      draftTimer = null;
      saveDraft();
    }, 2000);
  }

  function fmtClock(t) {
    const d = new Date(t);
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function saveDraft() {
    if (!app.state.source) return;
    const files = ns.project.hasFiles() ? ns.project.entries() : [];
    ns.draft.save({
      fileName: app.state.fileName,
      htmlPath: ns.project.hasFiles() ? ns.project.getHtmlPath() : null,
      source: app.state.source,
      originalHTML: app.state.originalHTML,
      files: files
    }).then(function (ok) {
      if (ok) dom.statusDraft.textContent = '草稿已保存 ' + fmtClock(Date.now());
    });
  }

  function initDraftResume() {
    if (!ns.draft.available()) return;
    ns.draft.load().then(function (rec) {
      if (!rec || !rec.source) return;
      draftRecord = rec;
      dom.wcResume.hidden = false;
      const bits = [rec.fileName || '未命名.html'];
      if (rec.files && rec.files.length) bits.push('项目 ' + rec.files.length + ' 个文件');
      if (rec.savedAt) bits.push(fmtClock(rec.savedAt));
      dom.wcResumeInfo.textContent = bits.join(' · ');
    });
  }

  function restoreDraft(rec) {
    const done = function (original) {
      app.loadDocument(
        { name: rec.fileName || '未命名.html', html: rec.source },
        { original: original != null ? original : rec.originalHTML }
      );
      app.enterEditor();
      updateProjectStatus();
      app.statusMsg('已恢复上次编辑的草稿');
    };
    if (rec.files && rec.files.length && rec.htmlPath) {
      ns.project.restoreFromDraft(rec.files, rec.htmlPath).then(function (ok) {
        if (ok) {
          ns.project.stashCurrent(rec.source);
          ns.project.originalHtml(rec.htmlPath).then(function (orig) {
            done(orig || rec.originalHTML);
          });
        } else {
          done(rec.originalHTML);
        }
      });
    } else {
      done(rec.originalHTML);
    }
  }

  function collapseTree(c) {
    dom.treePane.classList.toggle('collapsed', c);
    dom.treeCollapsedBtn.hidden = !c;
    try { localStorage.setItem('he:tree', c ? '0' : '1'); } catch (e) { }
  }

  function collapseCode(c) {
    dom.codePane.classList.toggle('collapsed', c);
    dom.codeCollapsedBtn.hidden = !c;
    dom.divider.style.display = c ? 'none' : '';
    try { localStorage.setItem('he:code', c ? '0' : '1'); } catch (e) { }
  }

  function wireToolbar() {
    dom.btnOpen.addEventListener('click', function (e) {
      e.stopPropagation();
      dom.openMenuList.hidden = !dom.openMenuList.hidden;
    });
    document.addEventListener('click', function (e) {
      if (!dom.openMenu.contains(e.target)) dom.openMenuList.hidden = true;
      if (!dom.insertMenu.contains(e.target)) dom.insertMenuList.hidden = true;
      if (!dom.moreMenu.contains(e.target)) dom.moreMenuList.hidden = true;
      if (!dom.pageMenu.contains(e.target)) dom.pageMenuList.hidden = true;
    });
    dom.btnPage.addEventListener('click', function (e) {
      e.stopPropagation();
      dom.pageMenuList.hidden = !dom.pageMenuList.hidden;
    });
    dom.miOpenFile.addEventListener('click', function () {
      dom.openMenuList.hidden = true;
      dom.fileInput.click();
    });
    dom.miOpenDir.addEventListener('click', function () {
      dom.openMenuList.hidden = true;
      dom.dirInput.click();
    });

    dom.btnMore.addEventListener('click', function (e) {
      e.stopPropagation();
      dom.moreMenuList.hidden = !dom.moreMenuList.hidden;
    });
    dom.miRefresh.addEventListener('click', function () {
      dom.moreMenuList.hidden = true;
      app.refreshPreview();
      app.statusMsg('预览已刷新');
    });
    dom.miNewwin.addEventListener('click', function () {
      dom.moreMenuList.hidden = true;
      const ok = ns.io.openInNewWindow(ns.preview.serialize());
      if (!ok) app.statusMsg('弹出窗口被浏览器拦截，请允许弹窗后重试');
    });
    dom.miReset.addEventListener('click', function () {
      dom.moreMenuList.hidden = true;
      app.resetDoc();
    });
    dom.miKeys.addEventListener('click', function () {
      dom.moreMenuList.hidden = true;
      openKeysDialog();
    });
    dom.keysClose.addEventListener('click', closeKeysDialog);
    dom.keysOverlay.addEventListener('click', function (e) {
      if (e.target === dom.keysOverlay) closeKeysDialog();
    });

    dom.btnInsert.addEventListener('click', function (e) {
      e.stopPropagation();
      dom.insertMenuList.hidden = !dom.insertMenuList.hidden;
    });
    dom.insertMenuList.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-insert]');
      if (!btn) return;
      dom.insertMenuList.hidden = true;
      ns.insert.insert(btn.getAttribute('data-insert'));
    });

    dom.deviceSeg.addEventListener('click', function (e) {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      setDevice(parseInt(btn.getAttribute('data-w'), 10) || 0);
    });

    dom.treeToggle.addEventListener('click', function () { collapseTree(true); });
    dom.treeCollapsedBtn.addEventListener('click', function () { collapseTree(false); });
    try {
      if (localStorage.getItem('he:tree') === '0') collapseTree(true);
    } catch (e) { }

    dom.codeToggle.addEventListener('click', function () { collapseCode(true); });
    dom.codeCollapsedBtn.addEventListener('click', function () { collapseCode(false); });
    dom.codeFormat.addEventListener('click', app.formatSource);
    try {
      if (localStorage.getItem('he:code') === '0') collapseCode(true);
    } catch (e) { }

    dom.wcResume.addEventListener('click', function () {
      if (draftRecord) restoreDraft(draftRecord);
    });

    dom.fileInput.addEventListener('change', function () {
      const arr = Array.prototype.slice.call(dom.fileInput.files || []);
      dom.fileInput.value = '';
      if (arr.length) handleFiles(arr);
    });
    dom.dirInput.addEventListener('change', function () {
      const arr = Array.prototype.slice.call(dom.dirInput.files || []);
      dom.dirInput.value = '';
      if (arr.length) handleFiles(arr);
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

    dom.chkScripts.addEventListener('change', function (e) {
      app.state.scriptsEnabled = e.target.checked;
      app.refreshPreview();
      app.statusMsg(app.state.scriptsEnabled
        ? '已允许页面脚本执行（已重新渲染）'
        : '已禁用页面脚本（已重新渲染）');
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
        } else if (k === 'f') {
          e.preventDefault();
          ns.codeEditor.openFind();
        } else if (k === 'd') {
          if (e.target && (e.target.isContentEditable || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
          e.preventDefault();
          app.duplicateSelected();
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
        if (ns.preview.isDragging()) {
          ns.preview.cancelDrag();
          return;
        }
        if (ns.codeEditor.isFindOpen()) {
          ns.codeEditor.closeFind();
          return;
        }
        if (!dom.keysOverlay.hidden) {
          closeKeysDialog();
          return;
        }
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        if (!dom.picker.hidden) {
          const resolve = pickerResolve;
          hidePicker();
          if (resolve) resolve(null);
          return;
        }
        app.deselect();
      } else if (e.key === '?') {
        const t = e.target;
        if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        e.preventDefault();
        openKeysDialog();
      } else if (/^Arrow/.test(e.key) || e.key === 'Delete') {
        const t = e.target;
        if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        if (!app.state.selected || !app.state.selected.isConnected) return;
        e.preventDefault();
        if (e.key === 'Delete') app.deleteSelected();
        else app.navigateSelection(e.key);
      }
    });

    window.addEventListener('beforeunload', function (e) {
      app.flushCodeCommit();
      saveDraft();
      if (app.state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') saveDraft();
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
      btnInsert: $('btn-insert'),
      insertMenu: $('insert-menu'),
      insertMenuList: $('insert-menu-list'),
      btnMore: $('btn-more'),
      moreMenu: $('more-menu'),
      moreMenuList: $('more-menu-list'),
      miRefresh: $('mi-refresh'),
      miNewwin: $('mi-newwin'),
      miReset: $('mi-reset'),
      miKeys: $('mi-keys'),
      keysOverlay: $('keys-overlay'),
      keysClose: $('keys-close'),
      deviceSeg: $('device-seg'),
      deviceLabel: $('device-label'),
      treePane: $('tree-pane'),
      treeToggle: $('tree-toggle'),
      treeCollapsedBtn: $('tree-collapsed-btn'),
      btnUndo: $('btn-undo'),
      btnRedo: $('btn-redo'),
      chkScripts: $('chk-scripts'),
      filename: $('filename'),
      dirtyDot: $('dirty-dot'),
      pageMenu: $('page-menu'),
      pageMenuList: $('page-menu-list'),
      btnPage: $('btn-page'),
      welcome: $('welcome'),
      wcOpenFile: $('wc-open-file'),
      wcOpenDir: $('wc-open-dir'),
      wcSample: $('wc-sample'),
      wcResume: $('wc-resume'),
      wcResumeInfo: $('wc-resume-info'),
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
      codeToggle: $('code-toggle'),
      codeFormat: $('code-format'),
      codeCollapsedBtn: $('code-collapsed-btn'),
      divider: $('divider'),
      main: $('main'),
      previewPane: $('preview-pane'),
      toast: $('toast'),
      toastText: $('toast-text'),
      hint: $('preview-hint'),
      hintTitle: $('preview-hint-title'),
      hintSub: $('preview-hint-sub'),
      statusMsg: $('status-msg'),
      statusWarn: $('status-warn'),
      statusDraft: $('status-draft'),
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
      onContextMenu: function (el, e) { ns.contextmenu.open(el, e); },
      onInlineEditStart: function () {
        app.statusMsg('内联编辑中：直接输入文字，按 Esc 或点击其他位置结束');
      },
      onInlineEditCommit: function () { app.onPreviewCommit('内联编辑文本'); },
      onRendered: function (d) { app.onRendered(d); },
      onRenderError: function () { app.statusMsg('渲染预览失败，请检查源码'); },
      onShortcut: function (k, arg) {
        if (k === 'save') app.export();
        else if (k === 'undo') app.undo();
        else if (k === 'redo') app.redo();
        else if (k === 'duplicate') app.duplicateSelected();
        else if (k === 'keys') openKeysDialog();
        else if (k === 'nav') app.navigateSelection(arg);
        else if (k === 'delete') app.deleteSelected();
      },
      onDropFiles: function (files) { app.openDropped(files); },
      onDragCommit: function (el) {
        app.onPreviewCommit('移动元素');
        app.toast('已移动 ' + describe(el));
      }
    });

    ns.codeEditor.init($('code'), $('hl'), $('gutter-inner'), {
      onCommit: function (text) { app.onCodeCommit(text); },
      onStatus: function (m) { app.statusMsg(m); }
    });
    ns.codeEditor.initFind();

    ns.props.init($('props-panel'), {
      getEl: function () { return app.state.selected; },
      commit: function (label) { app.onPreviewCommit(label); },
      status: function (m) { app.statusMsg(m); },
      feedback: function (m) { app.toast(m); },
      deselect: function () { app.deselect(); },
      select: function (el) { ns.preview.select(el); }
    });

    ns.resize.init(dom.previewPane, {
      commit: function (label) { app.onPreviewCommit(label); },
      feedback: function (m) { app.toast(m); }
    });

    ns.insert.init({
      flushCodeCommit: function () { return app.flushCodeCommit(); },
      commit: function (label) { app.onPreviewCommit(label); },
      status: function (m) { app.statusMsg(m); },
      feedback: function (m) { app.toast(m); }
    });

    ns.tree.init($('tree-root'), {
      getDoc: function () { return ns.preview.getDoc(); },
      onSelect: function (el) {
        ns.preview.select(el);
        try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { }
      },
      commit: function (label) { app.onPreviewCommit(label); },
      status: function (m) { app.statusMsg(m); },
      feedback: function (m) { app.toast(m); }
    });

    ns.contextmenu.init($('ctx-menu'), {
      pane: function () { return dom.previewPane; },
      action: function (act) { ns.props.handleAction(act); },
      insert: function (type) { ns.insert.insert(type); },
      describe: describe
    });

    wireToolbar();
    wireShortcuts();
    wireSplitter();
    wireDrop();
    wireCursorStatus();
    initDraftResume();

    if (!ns.preview.isSandboxUsable()) {
      app.setWarn('当前环境（file://）下浏览器沙箱受限，已自动改用脚本禁用方案，功能不受影响');
    }

    updateTitle();
    updateStatusSize();
  };

  ns.app = app;
  ns.app.init();

})(window.HTMLEditor);
