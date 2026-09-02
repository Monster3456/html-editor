window.HTMLEditor = window.HTMLEditor || {};

(function (ns) {

  let entries = [];
  let index = -1;

  function capFor(html) {
    return html.length > 1048576 ? 20 : 100;
  }

  ns.history = {
    reset: function (html, label) {
      entries = [{ html: html, label: label || '初始' }];
      index = 0;
    },

    commit: function (html, label) {
      if (index >= 0 && entries[index] && entries[index].html === html) return false;
      entries.splice(index + 1);
      entries.push({ html: html, label: label || '编辑' });
      const cap = capFor(html);
      if (entries.length > cap) entries.splice(0, entries.length - cap);
      index = entries.length - 1;
      return true;
    },

    undo: function () {
      if (index <= 0) return null;
      index--;
      return entries[index];
    },

    redo: function () {
      if (index >= entries.length - 1) return null;
      index++;
      return entries[index];
    },

    canUndo: function () {
      return index > 0;
    },

    canRedo: function () {
      return index < entries.length - 1;
    },

    current: function () {
      return entries[index] || null;
    }
  };

})(window.HTMLEditor);
