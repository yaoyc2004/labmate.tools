// labmate.tools — 3.1 RPM ↔ g   RCF = 1.118e-5 × r(cm) × rpm²
(function () {
  "use strict";
  var LM = window.LM;
  var KEY = "lm-rpm-v1";
  var K = 1.118e-5;
  var MAX_RPM_NOTE = 15000;
  var EXAMPLE = { solve: "rpm", r: "8.4", ru: "cm", rpm: "", g: "12000", prpm: "13000", pr: "7.3", pru: "cm" };

  var $ = function (id) { return document.getElementById(id); };
  var box = function (t) { return document.querySelector('[data-term="' + t + '"]'); };
  var state = LM.load(KEY);
  if (!state || (state.solve !== "rpm" && state.solve !== "g")) state = JSON.parse(JSON.stringify(EXAMPLE));
  var lastText = "";

  function rpmRound(x) { return x >= 100 ? Math.round(x / 10) * 10 : Math.round(x); }
  function gRound(x) { return x >= 100 ? Math.round(x) : parseFloat(LM.fmtPlain(x, 3)); }
  function n(x) { return LM.fmt(x, 7); }

  function cm(id, unitId) {
    var v = LM.parse($(id).value);
    if (v == null || isNaN(v)) return v;
    return $(unitId).value === "mm" ? v / 10 : v;
  }
  function setMsg(t, text) {
    $(t + "m").textContent = text || "";
    box(t).classList.toggle("is-bad", !!text);
  }
  function check(t, v) {
    if (v == null) return "empty";
    if (isNaN(v)) { setMsg(t, "Not a number"); return "bad"; }
    if (v <= 0) { setMsg(t, "Must be above zero"); return "bad"; }
    return "";
  }

  function setSolve(t) {
    state.solve = t;
    document.querySelectorAll("#solveSeg button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-solve") === t));
    });
    ["rpm", "g"].forEach(function (k) {
      var solved = k === t;
      box(k).classList.toggle("is-solved", solved);
      $(k).readOnly = solved; $(k).tabIndex = solved ? -1 : 0;
      $(k).placeholder = solved ? "?" : "";
      box(k).querySelector(".term-name").textContent = (solved ? "SOLVING · " : "") + (k === "rpm" ? "SPEED" : "RELATIVE FORCE");
    });
    $(t).value = "";
    update();
  }

  function update() {
    ["r", "rpm", "g"].forEach(function (t) { setMsg(t, ""); });
    var solve = state.solve, known = solve === "rpm" ? "g" : "rpm";
    var r = cm("r", "ru"), k = LM.parse($(known).value);
    var e1 = check("r", r), e2 = check(known, k);
    var r0 = r;
    if (e1 || e2) {
      $(solve).value = "";
      if (e1 === "bad" || e2 === "bad") empty("Check the highlighted value.", "", true);
      else empty("Waiting for " + [e1 ? "rotor radius" : "", e2 ? (known === "g" ? "force" : "speed") : ""].filter(Boolean).join(" and "),
        "Fill in the rotor radius and the " + (known === "g" ? "× g" : "rpm") + " to get the " + (solve === "g" ? "× g" : "rpm") + ".");
    } else {
      var rpm = solve === "rpm" ? Math.sqrt(k / (K * r)) : k;
      var g = solve === "g" ? K * r * k * k : k;
      var rpmR = rpmRound(rpm), gR = gRound(g);
      $(solve).value = solve === "rpm" ? String(rpmR) : String(gR);
      show(r0, rpm, g, rpmR, gR);
    }
    match();
    save();
  }

  function show(r, rpm, g, rpmR, gR) {
    var ans = $("ans"), solve = state.solve;
    ans.classList.remove("is-empty", "is-error");
    $("copy").disabled = false;
    var rT = LM.fmt(r, 4) + " cm";
    if (solve === "rpm") {
      $("ansBig").innerHTML = n(rpmR) + " rpm";
      $("ansSay").innerHTML = n(gR) + " × g with a " + rT + " rotor radius. Set the centrifuge to <b>" + n(rpmR) + " rpm</b>.";
    } else {
      $("ansBig").innerHTML = n(gR) + " <span class=\"eq\">× g</span>";
      $("ansSay").innerHTML = n(rpmR) + " rpm with a " + rT + " rotor radius gives <b>" + n(gR) + " × g</b>.";
    }
    $("slip").classList.remove("is-empty");
    $("rR").textContent = rT; $("rRpm").textContent = n(rpmR) + " rpm"; $("rG").textContent = n(gR) + " × g";
    var notes = [];
    if (rpm > MAX_RPM_NOTE) notes.push('<li class="note">Above ' + n(MAX_RPM_NOTE) + " rpm — check your rotor's maximum rated speed before you spin.</li>");
    if (r > 40) notes.push('<li class="note">A ' + LM.esc(rT) + " radius is unusually large — did you mean mm? Switch the unit if so.</li>");
    $("notes").innerHTML = notes.join("");
    lastText = "Centrifuge — labmate.tools\nRotor radius: " + rT + "\nSpeed: " + LM.fmtPlain(rpmR, 7) + " rpm\nForce: " + LM.fmtPlain(gR, 7) + " x g";
  }
  function empty(title, say, isErr) {
    var ans = $("ans");
    ans.classList.toggle("is-error", !!isErr); ans.classList.toggle("is-empty", !isErr);
    $("copy").disabled = true;
    $("ansBig").textContent = title; $("ansSay").textContent = say;
    $("slip").classList.add("is-empty");
    ["rR", "rRpm", "rG"].forEach(function (id) { $(id).textContent = "—"; });
    $("notes").innerHTML = ""; lastText = "";
  }

  // protocol rpm on their rotor → same × g → rpm on yours
  function match() {
    setMsg("prpm", ""); setMsg("pr", "");
    var p = LM.parse($("prpm").value), pr = cm("pr", "pru"), r = cm("r", "ru");
    var e = [check("prpm", p), check("pr", pr)];
    if (e[0] || e[1]) { $("match").textContent = "—"; $("matchSay").textContent = ""; return; }
    if (!r || isNaN(r) || r <= 0) { $("match").textContent = "—"; $("matchSay").textContent = "Enter your rotor radius above."; return; }
    var g = K * pr * p * p;
    var mine = Math.sqrt(g / (K * r)); // = p × √(pr / r)
    $("match").textContent = n(rpmRound(mine)) + " rpm";
    $("matchSay").innerHTML = n(rpmRound(p)) + " rpm on their " + LM.fmt(pr, 4) + " cm rotor is " + n(gRound(g)) + " × g. On your " + LM.fmt(r, 4) +
      " cm rotor, the same force is <b>" + n(rpmRound(mine)) + " rpm</b>.";
  }

  function save() {
    var s = { solve: state.solve };
    ["r", "ru", "rpm", "g", "prpm", "pr", "pru"].forEach(function (id) { s[id] = $(id).value; });
    s[state.solve] = "";
    LM.save(KEY, s);
  }

  document.querySelectorAll("#solveSeg button").forEach(function (b) {
    b.addEventListener("click", function () { setSolve(b.getAttribute("data-solve")); });
  });
  ["r", "rpm", "g", "prpm", "pr"].forEach(function (id) { $(id).addEventListener("input", update); });
  ["ru", "pru"].forEach(function (id) { $(id).addEventListener("change", update); });
  $("clear").addEventListener("click", function () {
    ["r", "rpm", "g", "prpm", "pr"].forEach(function (id) { $(id).value = ""; });
    update(); $("r").focus();
  });
  $("copy").addEventListener("click", function () {
    if (!lastText) return;
    LM.copy(lastText, function (ok) {
      $("copied").textContent = ok ? "COPIED ✓" : "Copy failed";
      setTimeout(function () { $("copied").textContent = ""; }, 2200);
    });
  });

  ["r", "ru", "rpm", "g", "prpm", "pr", "pru"].forEach(function (id) { if (state[id] != null) $(id).value = state[id]; });
  setSolve(state.solve);
})();
