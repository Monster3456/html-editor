window.HTMLEditor = window.HTMLEditor || {};

(function (ns) {

  function decodeBuffer(buf) {
    const bytes = new Uint8Array(buf);
    let enc = 'utf-8';
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) enc = 'utf-16le';
    else if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) enc = 'utf-16be';
    else {
      const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 4096));
      const m = /charset\s*=\s*["']?\s*([\w-]+)/i.exec(head) || /encoding\s*=\s*["']([\w-]+)["']/i.exec(head);
      if (m) enc = m[1].toLowerCase();
    }
    let text;
    try {
      text = new TextDecoder(enc).decode(buf);
    } catch (e) {
      text = new TextDecoder('utf-8').decode(buf);
    }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return text;
  }

  ns.io = {
    openFile: function (file) {
      return file.arrayBuffer().then(function (buf) {
        return { name: file.name, html: decodeBuffer(buf) };
      });
    },

    openFiles: function (fileList) {
      const files = Array.prototype.filter.call(fileList || [], function (f) {
        return /\.(html?|xhtml)$/i.test(f.name) || f.type === 'text/html';
      });
      if (!files.length) return Promise.resolve(null);
      return ns.io.openFile(files[0]);
    },

    exportFile: function (name, html) {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name || '未命名.html';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    },

    openInNewWindow: function (html) {
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (!w) return false;
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      return true;
    },

    enableDropTarget: function (target, onFiles) {
      let depth = 0;
      target.addEventListener('dragenter', function (e) {
        e.preventDefault();
        depth++;
        target.classList.add('drop-active');
      });
      target.addEventListener('dragover', function (e) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      target.addEventListener('dragleave', function (e) {
        e.preventDefault();
        depth = Math.max(0, depth - 1);
        if (depth === 0) target.classList.remove('drop-active');
      });
      target.addEventListener('drop', function (e) {
        e.preventDefault();
        depth = 0;
        target.classList.remove('drop-active');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          onFiles(e.dataTransfer.files);
        }
      });
    }
  };

})(window.HTMLEditor);
