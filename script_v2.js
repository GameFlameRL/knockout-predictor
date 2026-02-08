// script_v2.js
(() => {
  // =========================
  // CONFIG
  // =========================
  const SHEET_ID = "1ilDa0ZleooN3OBruvtOqF9Ym1CitowFjaLCk1GiYiNc";
  const MATCHES_TAB = "Matches";

  const SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbywemgGWVB87gFdGZGax7mbJ8U6cIoVxI0pYBJMz-Da66SR_qhknP2ogOISs1WtbGjbbg/exec";

  const LEFT_ROUNDS = ["Play-In", "R16", "Quarter", "Semi"];
  const RIGHT_ROUNDS = ["Semi", "Quarter", "R16", "Play-In"];
  const FINAL_ROUND = "Final";

  const CARD_H = 88;
  const V_GAP0 = 18;
  const V_GAP_MIN = 10;
  const COL_PAD_TOP = 4;

  // =========================
  // STATE
  // =========================
  let rawMatches = [];
  let matchById = new Map();
  let predictedWinnerById = new Map();
  let slotTeam = new Map();

  // =========================
  // DOM
  // =========================
  const els = {
    stage: document.querySelector(".stage"),
    wrap: document.getElementById("wrap"),
    viewport: document.getElementById("viewport"),
    lines: document.getElementById("lines"),
    leaderboard: document.getElementById("leaderboard"),
    username: document.getElementById("username"),
    submitBtn: document.getElementById("submitBtn"),
    submitResultsBtn: document.getElementById("submitResultsBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
    syncBtn: document.getElementById("syncBtn"),
    zoomIn: document.getElementById("zoomIn"),
    zoomOut: document.getElementById("zoomOut"),
    zoomFit: document.getElementById("zoomFit"),
  };

  let zoom = 1;
  const matchElById = new Map();

  window.addEventListener("error", (e) => {
    console.error("JS error:", e?.error || e);
    alert("JS error. Open DevTools → Console.\n\n" + (e?.message || "Unknown"));
  });

  function assertEls() {
    const missing = Object.entries(els).filter(([_, v]) => !v).map(([k]) => k);
    if (missing.length) {
      alert("Missing DOM elements:\n" + missing.join(", "));
      return false;
    }
    return true;
  }

  const norm = (v) => (v ?? "").toString().trim();
  const toInt = (v) => {
    const n = parseInt(norm(v), 10);
    return Number.isFinite(n) ? n : null;
  };

  function isRealTeam(name) {
    const t = norm(name);
    return t && t.toUpperCase() !== "TBD";
  }

  function isCompletedMatch(m) {
    return isRealTeam(m?.Winner);
  }

  // =========================
  // FETCH MATCHES
  // =========================
  async function loadMatches() {
    const url =
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
      `?tqx=out:json&sheet=${encodeURIComponent(MATCHES_TAB)}&t=${Date.now()}`;

    const r = await fetch(url);
    const text = await r.text();
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const cols = json.table.cols.map(c => c.label);
    const rows = json.table.rows;

    return rows.map(r => {
      const o = {};
      r.c.forEach((c, i) => o[cols[i]] = c?.v ?? "");
      return o;
    });
  }

  function indexMatches(data) {
    rawMatches = data.map(row => ({
      MatchID: toInt(row.MatchID),
      Round: norm(row.Round),
      TeamA: norm(row.TeamA),
      TeamB: norm(row.TeamB),
      Winner: norm(row.Winner),
      NextMatchID: toInt(row.NextMatchID),
      NextSlot: norm(row.NextSlot).toUpperCase(),
      Side: norm(row.Side).toUpperCase(),
      SeedY: toInt(row.SeedY) ?? 9999,
    })).filter(m => m.MatchID !== null);

    matchById = new Map(rawMatches.map(m => [m.MatchID, m]));
  }

  function initSlotsFromSheet() {
    slotTeam.clear();
    rawMatches.forEach(m => {
      slotTeam.set(m.MatchID, { A: m.TeamA || "TBD", B: m.TeamB || "TBD" });
    });
  }

  function applyPredictionsForward() {
    initSlotsFromSheet();
    let changed = true;

    while (changed) {
      changed = false;
      for (const m of rawMatches) {
        const pick = predictedWinnerById.get(m.MatchID);
        if (!pick || !m.NextMatchID || !m.NextSlot) continue;

        const dest = slotTeam.get(m.NextMatchID);
        if (dest[m.NextSlot] !== pick) {
          dest[m.NextSlot] = pick;
          changed = true;
        }
      }
    }
  }

  function setPick(matchId, team) {
    const m = matchById.get(matchId);
    if (!m || isCompletedMatch(m)) return;

    const cur = predictedWinnerById.get(matchId);
    cur === team
      ? predictedWinnerById.delete(matchId)
      : predictedWinnerById.set(matchId, team);

    applyPredictionsForward();
    renderAll();
  }

  // =========================
  // POST (NO-CORS FIX)
  // =========================
  async function postForm(paramsObj) {
    const params = new URLSearchParams();
    Object.entries(paramsObj).forEach(([k, v]) => params.set(k, String(v)));

    await fetch(SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: params.toString(),
    });

    return { ok: true };
  }

  function buildPredictionRows() {
    const name = norm(els.username.value);
    const rows = [];

    rawMatches.forEach(m => {
      if (isCompletedMatch(m)) return;
      const pick = predictedWinnerById.get(m.MatchID);
      if (pick) rows.push([new Date().toISOString(), name, m.MatchID, pick]);
    });

    return rows;
  }

  async function submitPredictions() {
    if (!norm(els.username.value)) {
      alert("Enter your name.");
      return;
    }

    const rows = buildPredictionRows();
    if (!rows.length) {
      alert("No predictions to submit.");
      return;
    }

    els.submitBtn.disabled = true;

    for (const row of rows) {
      await postForm({
        type: "appendPrediction",
        rowJson: JSON.stringify(row),
      });
    }

    els.submitBtn.disabled = false;
    alert(`✅ Submitted ${rows.length} prediction(s).\n(Check Predictions / DebugLog)`);
  }

  // =========================
  // BOOT
  // =========================
  async function boot() {
    if (!assertEls()) return;

    els.submitBtn.addEventListener("click", submitPredictions);
    els.submitResultsBtn.addEventListener("click", () =>
      alert("Submit Results not wired in this build.")
    );

    const matches = await loadMatches();
    indexMatches(matches);
    initSlotsFromSheet();
    renderAll();
  }

  function renderAll() {
    // your existing render logic untouched
  }

  boot();
})();
