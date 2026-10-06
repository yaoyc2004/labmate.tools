/* labmate.tools — hand data from one tool page to another.
 * The sending page stores a small payload and opens the next tool;
 * the receiving page takes it once. Nothing leaves the browser.
 */
(function () {
  'use strict';
  var KEY = 'labmate.handoff.v1';
  var MAX_AGE = 15 * 60 * 1000; // a hand-off older than 15 minutes is ignored

  function stores() {
    var out = [];
    try { out.push(window.localStorage); } catch (e) { /* blocked */ }
    try { out.push(window.sessionStorage); } catch (e) { /* blocked */ }
    return out;
  }

  // to: the receiving tool's folder name, e.g. 'plate-tracker'
  function send(to, data, url) {
    var payload = JSON.stringify({ to: to, at: Date.now(), from: location.pathname, data: data });
    var ok = false;
    stores().forEach(function (s) { try { s.setItem(KEY, payload); ok = true; } catch (e) { /* full or blocked */ } });
    if (url) { window.location.href = url + (url.indexOf('?') < 0 ? '?' : '&') + 'from=handoff'; }
    return ok;
  }

  // returns the data meant for this tool (and removes it), or null
  function take(to) {
    var found = null;
    stores().forEach(function (s) {
      var raw;
      try { raw = s.getItem(KEY); } catch (e) { return; }
      if (!raw) { return; }
      try {
        var p = JSON.parse(raw);
        if (p && p.to === to && Date.now() - p.at < MAX_AGE && !found) { found = p.data; }
        if (p && p.to === to) { s.removeItem(KEY); }
      } catch (e) { try { s.removeItem(KEY); } catch (e2) { /* ignore */ } }
    });
    // tidy the address bar so a refresh doesn't look like a new hand-off
    if (/[?&]from=handoff/.test(location.search) && window.history && history.replaceState) {
      var q = location.search.replace(/([?&])from=handoff(&|$)/, function (m, a, b) { return b ? a : ''; }).replace(/[?&]$/, '');
      history.replaceState(null, '', location.pathname + q + location.hash);
    }
    return found;
  }

  // a one-line note at the top of the page, e.g. "Imported 2 plates from Plate Layout"
  function note(text, anchor) {
    var el = document.createElement('div');
    el.className = 'lm-handoff-note';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span></span><button type="button" aria-label="Dismiss">×</button>';
    el.firstChild.textContent = text;
    el.lastChild.addEventListener('click', function () { el.remove(); });
    if (anchor === 'toast') { el.classList.add('is-toast'); document.body.appendChild(el); }
    else { var host = anchor || document.querySelector('main') || document.body; host.insertBefore(el, host.firstChild); }
    setTimeout(function () { if (el.parentNode) { el.classList.add('is-fading'); } }, 9000);
    setTimeout(function () { if (el.parentNode) { el.remove(); } }, 10000);
  }

  window.LMH = { send: send, take: take, note: note };
})();
