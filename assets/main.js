// labmate.tools — homepage
(function () {
  "use strict";
  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  // ---------- find a tool ----------
  var q = document.getElementById("q");
  if (!q) return;
  var chips = document.getElementById("chips");
  var count = document.getElementById("findCount");
  var empty = document.getElementById("findEmpty");
  var sections = Array.prototype.slice.call(document.querySelectorAll(".catalog > section"));
  var cat = "";

  // a few everyday words people type, mapped to words the tools use
  var ALIAS = { centrifuge: "rpm", spin: "rpm", weigh: "molarity", grams: "molarity", dilute: "dilution", diluting: "dilution",
    label: "labels", tube: "labels", tubes: "labels", sticker: "labels", map: "layout", pipette: "plate", pipetting: "plate" };

  function norm(t) {
    return String(t).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[\u00b5\u03bc]/g, "u").replace(/×/g, "x");
  }
  var items = [];
  sections.forEach(function (sec) {
    sec.querySelectorAll(".item").forEach(function (li) {
      li.dataset.cat = sec.id;
      var text = norm(li.textContent + " " + (li.getAttribute("data-keywords") || "") + " " + sec.id);
      var ws = text.split(/[^a-z0-9/.+\-]+/);
      ws.slice().forEach(function (w) { if (/[\/\-]/.test(w)) ws = ws.concat(w.split(/[\/\-]/)); });
      items.push({ li: li, sec: sec, text: text, words: ws.filter(Boolean) });
    });
  });

  function words(v) {
    return norm(v).replace(/[^a-z0-9/.\-+ ]+/g, " ").split(/\s+/).filter(function (w) { return w && !/^(a|an|the|to|of|for|my|i|in|on|and|how|do|make|calculate|calculator|tool)$/.test(w); });
  }
  // a typed word matches the start of any word of the tool ("dil" → dilution), not the middle ("um" ≠ volume)
  function has(it, w) {
    for (var i = 0; i < it.words.length; i++) if (it.words[i].indexOf(w) === 0) return true;
    return false;
  }
  function match(it, ws) {
    if (cat && it.sec.id !== cat) return false;
    return ws.every(function (w) {
      if (has(it, w)) return true;
      if (ALIAS[w] && has(it, ALIAS[w])) return true;
      // tolerate plurals: "dilutions", "labels" ↔ "label"
      return w.length > 3 && /s$/.test(w) && has(it, w.slice(0, -1));
    });
  }

  function run() {
    var ws = words(q.value);
    var shown = 0;
    items.forEach(function (it) {
      var ok = match(it, ws);
      it.li.hidden = !ok;
      if (ok) shown++;
    });
    sections.forEach(function (sec) {
      sec.hidden = !sec.querySelector(".item:not([hidden])");
    });
    var filtered = ws.length || cat;
    count.textContent = filtered ? shown + " OF " + items.length + " TOOLS" : items.length + " TOOLS";
    empty.hidden = shown > 0;
    if (!shown) document.getElementById("findQ").textContent = q.value.trim() || chips.querySelector('[aria-pressed="true"]').textContent;
  }

  q.addEventListener("input", run);
  q.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { q.value = ""; run(); }
    if (e.key === "Enter") {
      var first = document.querySelector(".catalog .item:not([hidden]) a");
      if (first && words(q.value).length) first.click();
    }
  });
  chips.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    cat = b.getAttribute("data-cat");
    chips.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    run();
  });
  // "/" jumps to the search box
  document.addEventListener("keydown", function (e) {
    var t = e.target;
    if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !t.isContentEditable) {
      e.preventDefault(); q.focus();
    }
  });
  // ?q=dilution opens with a search filled in
  try {
    var pre = new URLSearchParams(window.location.search).get("q");
    if (pre) q.value = pre;
  } catch (e) { /* old browser */ }
  run();
})();
