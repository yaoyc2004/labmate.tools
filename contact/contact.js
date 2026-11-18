// labmate.tools — contact page: preselect the topic from ?topic=, prefill templates, send to Formspree
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var form = $("ct-form"), topic = $("ct-topic"), msg = $("ct-msg"), status = $("ct-status"), send = $("ct-send");
  var done = $("ct-done");
  if (!form) return;

  var params;
  try { params = new URLSearchParams(location.search); } catch (e) { params = { get: function () { return null; } }; }

  // Older links or loose spellings → option values
  var ALIAS = { "qpcr-relative-quantification": "qpcr", "ddcq": "qpcr", "ddct": "qpcr", "rpm": "rpm-to-g", "cell-count": "cell-seeding",
    "western": "protein-loading", "densitometry": "blot-densitometry", "poster": "poster-check", "panel": "panel-designer",
    "scalebar": "scale-bar", "tool-request": "request", "new-tool": "request", "home": "general", "about": "general" };

  // Message templates a page can ask for with ?about=
  var TEMPLATES = {
    instrument: {
      kind: "Request",
      text: "Please add my qPCR instrument.\n\nInstrument and software version:\n\nExport menu I used:\n\nWhat went wrong (no columns found, wrong genes, …):\n\n(We'll reply by email to ask for an example export — sample names can be replaced with codes.)\n"
    },
    tool: {
      kind: "Request",
      text: "The step that slows me down:\n\nHow I handle it today:\n\nHow often it comes up:\n"
    }
  };

  function optionExists(v) {
    for (var i = 0; i < topic.options.length; i++) if (topic.options[i].value === v) return true;
    return false;
  }
  function setKind(v) {
    var r = form.querySelector('input[name="kind"][value="' + v + '"]');
    if (r) r.checked = true;
  }

  var want = (params.get("topic") || "").trim().toLowerCase();
  if (ALIAS[want]) want = ALIAS[want];
  if (want && optionExists(want)) {
    topic.value = want;
    topic.classList.add("is-preset");
    if (want === "request") setKind("Request");
  }
  var kind = (params.get("kind") || "").toLowerCase();
  if (kind === "problem") setKind("Problem");
  else if (kind === "request") setKind("Request");
  else if (kind === "question") setKind("Question");

  var tpl = TEMPLATES[(params.get("about") || "").toLowerCase()];
  if (!tpl && want === "request") tpl = TEMPLATES.tool;
  if (tpl && !msg.value) {
    msg.value = tpl.text;
    if (!params.get("kind")) setKind(tpl.kind);
  }

  // "Back" goes to the tool the visitor came from
  var back = $("ct-back");
  if (want && want !== "general" && want !== "request" && want !== "privacy" && optionExists(want)) back.href = "../tools/" + want + "/";
  else if (want === "privacy") back.href = "../privacy/";

  topic.addEventListener("change", function () { topic.classList.remove("is-preset"); });

  function label() {
    var o = topic.options[topic.selectedIndex];
    return o ? o.text : topic.value;
  }
  function kindValue() {
    var r = form.querySelector('input[name="kind"]:checked');
    return r ? r.value : "Question";
  }
  function fill() {
    $("ct-subject").value = "[labmate.tools] " + kindValue() + " — " + label();
    var ref = "";
    try { if (document.referrer && new URL(document.referrer).origin === location.origin) ref = document.referrer; } catch (e) {}
    $("ct-from").value = ref || (want ? location.href : "");
  }

  function setStatus(text, bad) {
    status.textContent = text;
    status.classList.toggle("is-err", !!bad);
  }

  form.addEventListener("submit", function (ev) {
    fill();
    if (!window.fetch || !window.FormData) return; // plain POST; Formspree shows its own thank-you page
    ev.preventDefault();
    if (!msg.value.trim()) { setStatus("Please write a message.", true); msg.focus(); return; }
    send.disabled = true;
    setStatus("Sending…");
    fetch(form.action, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) { return { ok: r.ok, data: data }; });
      })
      .then(function (res) {
        send.disabled = false;
        if (res.ok) {
          setStatus("");
          var email = $("ct-email").value.trim();
          $("ct-done-say").textContent = email ? "We'll reply to " + email + "." : "You didn't leave an email, so we can't reply — but we read every message.";
          form.hidden = true;
          done.hidden = false;
          done.focus();
          form.reset();
          return;
        }
        var errs = res.data && res.data.errors;
        var why = errs && errs.length ? errs.map(function (e) { return e.message; }).join(" ") : "The message wasn't sent.";
        setStatus(why + " Please try again in a moment.", true);
      })
      .catch(function () {
        send.disabled = false;
        setStatus("No connection — the message wasn't sent. Check your network and try again.", true);
      });
  });

  $("ct-again").addEventListener("click", function () {
    done.hidden = true;
    form.hidden = false;
    if (want && optionExists(want)) topic.value = want;
    msg.focus();
  });
})();
