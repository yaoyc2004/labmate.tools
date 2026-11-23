// labmate.tools — the antibody list shared by 7.2 Antibody Titration and 7.3 Staining Cocktail.
// Kept in this browser only (localStorage "labmate.antibodies.v1"); JSON export/import for backup or another computer.
(function () {
  "use strict";
  var F = window.LMF, LM = window.LM;
  var KEY = F.LIB_KEY;
  var canStore = true;

  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      var o = raw ? JSON.parse(raw) : null;
      return F.libValid(o) ? o.items : [];
    } catch (e) { canStore = false; return []; }
  }
  function save(items) {
    try { window.localStorage.setItem(KEY, JSON.stringify({ kind: "labmate.antibodies", v: 1, items: items })); return true; }
    catch (e) { canStore = false; return false; }
  }
  function uid() { return "ab" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  var listeners = [];
  var Lib = {
    all: load,
    canStore: function () { return canStore; },
    get: function (id) { return load().filter(function (a) { return a.id === id; })[0] || null; },
    // add or replace: same target + fluor + clone is the same antibody (a new lot replaces the old lot's values)
    put: function (a) {
      var items = load(), k = F.libKey(a), i = -1;
      items.forEach(function (x, j) { if ((a.id && x.id === a.id) || F.libKey(x) === k) i = j; });
      if (i >= 0) { a.id = items[i].id; items[i] = a; } else { a.id = a.id || uid(); items.push(a); }
      items.sort(function (x, y) { return String(x.target).localeCompare(String(y.target)) || String(x.fluor).localeCompare(String(y.fluor)); });
      save(items); fire(); return a;
    },
    remove: function (id) { save(load().filter(function (a) { return a.id !== id; })); fire(); },
    on: function (fn) { listeners.push(fn); },
    find: function (target, fluor) { return F.libFind(load(), target, fluor); },
    exportText: function () { return JSON.stringify({ kind: "labmate.antibodies", v: 1, exported: new Date().toISOString().slice(0, 10), items: load() }, null, 1); },
    importText: function (text) {
      var o = JSON.parse(text);
      if (!F.libValid(o)) throw new Error("format");
      o.items.forEach(function (a) { if (a && a.target) Lib.put(a); });
      return o.items.length;
    }
  };
  function fire() { listeners.forEach(function (fn) { fn(); }); }

  // a one-line description of a saved titration result
  Lib.titerText = function (a) {
    var t = a && a.titer;
    if (!t || !(t.amount > 0)) return "not titrated";
    var s = LM.fmt(t.amount, 3) + (t.unit === "ug" ? " µg" : " µL") + " / " + LM.fmt(t.finalVol, 3) + " µL";
    if (t.cells) s += ", " + (LM.parse(t.cells) > 0 ? LM.fmt(LM.parse(t.cells), 3) : t.cells) + " cells";
    if (t.date) s += " · " + t.date;
    return s;
  };
  Lib.label = function (a) { return [a.target, a.fluor].filter(Boolean).join(" ") + (a.clone ? " (" + a.clone + ")" : ""); };

  // The list panel: <div data-lib> with a table, delete buttons, export / import.
  Lib.mount = function (host, opts) {
    opts = opts || {};
    function render() {
      var items = load();
      var rows = items.map(function (a) {
        return '<tr data-id="' + LM.esc(a.id) + '"><td class="c-name"><b>' + LM.esc(a.target || "") + '</b> ' + LM.esc(a.fluor || "") +
          (a.clone ? ' <small>' + LM.esc(a.clone) + '</small>' : "") + '</td>' +
          '<td data-l="LOT">' + LM.esc(a.lot || "—") + '</td>' +
          '<td data-l="STOCK" class="c-num">' + (a.stock > 0 ? LM.fmt(a.stock, 3) + " mg/mL" : "—") + '</td>' +
          '<td data-l="TITER">' + LM.esc(Lib.titerText(a)) + '</td>' +
          '<td class="c-x">' + (opts.pick ? '<button type="button" class="fl-mini" data-act="pick">' + LM.esc(opts.pick) + '</button>' : "") +
          '<button type="button" class="rc-x" data-act="del" aria-label="Delete ' + LM.esc(Lib.label(a)) + '">×</button></td></tr>';
      }).join("");
      host.querySelector("[data-lib-body]").innerHTML = rows ||
        '<tr><td colspan="5" class="muted" style="padding:14px 10px">No antibodies saved yet.' + (opts.empty ? " " + opts.empty : "") + '</td></tr>';
      host.querySelector("[data-lib-count]").textContent = items.length ? items.length + " SAVED" : "";
      var warn = host.querySelector("[data-lib-warn]");
      if (warn) warn.hidden = canStore;
    }
    host.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-act]"); if (!b) return;
      var id = b.closest("tr").getAttribute("data-id"), a = Lib.get(id);
      if (b.getAttribute("data-act") === "del") { Lib.remove(id); }
      if (b.getAttribute("data-act") === "pick" && opts.onPick && a) opts.onPick(a);
    });
    var exp = host.querySelector("[data-lib-export]"), imp = host.querySelector("[data-lib-import]"), msg = host.querySelector("[data-lib-msg]");
    if (exp) exp.addEventListener("click", function () {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([Lib.exportText()], { type: "application/json" }));
      a.download = "labmate-antibodies.json"; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    });
    if (imp) imp.addEventListener("change", function () {
      var f = imp.files && imp.files[0]; if (!f) return;
      f.text().then(function (t) {
        try { var n = Lib.importText(t); if (msg) msg.textContent = "Imported " + n + " antibod" + (n === 1 ? "y" : "ies") + "."; }
        catch (e) { if (msg) msg.textContent = "That file is not a labmate.tools antibody list."; }
        imp.value = "";
      });
    });
    Lib.on(render);
    window.addEventListener("storage", function (e) { if (e.key === KEY) render(); });
    render();
  };

  window.LMLib = Lib;
})();
