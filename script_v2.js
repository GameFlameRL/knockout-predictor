// script_v2.js
(() => {
  // =========================
  // CONFIG (edit these only)
  // =========================
  const SHEET_ID = "1ilDa0ZleooN3OBruvtOqF9Ym1CitowFjaLCk1GiYiNc";
  const MATCHES_TAB = "Matches";

  // Your Apps Script web app URL (for submit + leaderboard + optional sync)
  const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbywemgGWVB87gFdGZGax7mbJ8U6cIoVxI0pYBJMz-Da66SR_qhknP2ogOISs1WtbGjbbg/exec";

  // Round order for YOUR format (Play-In separate, mirrored triangles)
  const LEFT_ROUNDS = ["Play-In", "R16", "Quarter", "Semi"];
  const RIGHT_ROUNDS = ["Semi", "Quarter", "R16", "Play-In"]; // mirrored visually
  const FINAL_ROUND = "Final";

  // Layout sizing (dense)
  const CARD_H = 88;      // 2 rows x 44px
  const V_GAP0 = 18;      // base vertical gap for first column
  const V_GAP_MIN = 10;   // minimum gap as rounds get tighter
  const COL_PAD_TOP = 4;

  // =========================
  // STATE
  // =========================
  let rawMatches = [];
  let matchById = new Map();

  // predictedWinnerById: matchId -> teamName
  let predictedWinnerById = new Map();

  // slotTeam[matchId] = { A: teamName, B: teamName }
  let slotTeam = new Map();

  // DOM refs
  const els = {
    stage: document.querySelector(".stage"),
    wrap: document.getElementById("wrap"),
    viewport: document.getElementById("viewport"),
    lines: document.getElementById("lines"),
    leaderboard: document.getElementById("leaderboard"),
    username: document.getElementById("username"),
    submitBtn: document.getElementById("submitBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
    syncBtn: document.getElementById("syncBtn"),
    zoomIn: document.getElementById("zoomIn"),
    zoomOut: document.getElementById("zoomOut"),
    zoomFit: document.getElementById("zoomFit"),
  };

  let zoom = 1;

  // Match element lookup for line anchors
  const matchElById = new Map();

  // =========================
  // HELPERS
  // =========================
  const norm = (v) => (v ?? "").toString().trim();
  const toInt = (v) => {
    const n = parseInt(norm(v), 10);
    return Number.isFinite(n) ? n : null;
  };

  function isRealTeam(name) {
    const t = norm(name);
    return t !== "" && t.toUpperCase() !== "TBD";
  }

  // CHANGED: fixture considered completed if Winner is set to a real team name
  function isCompletedMatch(m) {
    const w = norm(m?.Winner);
    return isRealTeam(w);
  }

  function setZoom(z) {
    zoom = Math.max(0.35, Math.min(1.6, z));
    els.wrap.style.transform = `scale(${zoom})`;
    drawLines();
    sizeViewportToContent();
  }

  function fitZoom() {
    const vp = els.viewport.getBoundingClientRect();
    const wr = els.wrap.getBoundingClientRect();

    const contentW = (wr.width / zoom) || els.wrap.scrollWidth || 1;
    const contentH = (wr.height / zoom) || els.wrap.scrollHeight || 1;

    const pad = 24;
    const zW = (vp.width - pad) / contentW;
    const zH = (vp.height - pad) / contentH;

    const target = Math.max(0.35, Math.min(1.2, Math.min(zW, zH)));
    setZoom(target);
  }

  function sizeViewportToContent() {
    const wr = els.wrap.getBoundingClientRect();
    const scaledH = Math.ceil(wr.height);
    const pad = 24;
    els.viewport.style.height = `${Math.max(220, scaledH + pad)}px`;
    els.stage.style.height = "auto";
  }

  // =========================
  // FETCH (GViz)
  // =========================
  async function loadMatches() {
    const url =
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
      `?tqx=out:json&sheet=${encodeURIComponent(MATCHES_TAB)}&t=${Date.now()}`;

    const r = await fetch(url);
    if (!r.ok) throw new Error(`Matches fetch failed: HTTP ${r.status}`);

    const text = await r.text();

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) {
      throw new Error("Matches fetch failed: GViz returned unexpected response. Check sheet access.");
    }

    const json = JSON.parse(text.slice(start, end + 1));
    const table = json?.table;
    const cols = (table?.cols || []).map(c => norm(c.label || c.id));
    const rows = table?.rows || [];

    const out = rows.map((rw) => {
      const obj = {};
      const cells = rw.c || [];
      for (let i = 0; i < cols.length; i++) {
        const key = cols[i] || `col${i}`;
        obj[key] = cells[i]?.v ?? "";
      }
      return obj;
    });

    return Array.isArray(out) ? out : [];
  }

  async function loadLeaderboard() {
    try {
      const u = `${SCRIPT_URL}?action=leaderboard&t=${Date.now()}`;
      const r = await fetch(u);
      if (!r.ok) throw new Error(`Leaderboard HTTP ${r.status}`);
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async function syncBracket() {
    try {
      const u = `${SCRIPT_URL}?action=sync&t=${Date.now()}`;
      await fetch(u);
    } catch {}
  }

  // =========================
  // BUILD BRACKET MODEL
  // =========================
  function indexMatches(data) {
    rawMatches = data.map((row) => {
      const obj = {
        MatchID: toInt(row.MatchID),
        Round: norm(row.Round),
        TeamA: norm(row.TeamA),
        TeamB: norm(row.TeamB),
        Winner: norm(row.Winner),
        NextMatchID: toInt(row.NextMatchID),
        NextSlot: norm(row.NextSlot).toUpperCase(), // A/B
        Side: norm(row.Side).toUpperCase(), // L/R/C
        SeedY: toInt(row.SeedY) ?? 9999,
      };
      return obj;
    }).filter(m => m.MatchID !== null);

    matchById = new Map(rawMatches.map(m => [m.MatchID, m]));
  }

  function initSlotsFromSheet() {
    slotTeam = new Map();
    for (const m of rawMatches) {
      slotTeam.set(m.MatchID, {
        A: norm(m.TeamA) || "TBD",
        B: norm(m.TeamB) || "TBD",
      });
    }
  }

  function sourcesFeeding(matchId) {
    const out = [];
    for (const m of rawMatches) {
      if (m.NextMatchID === matchId && (m.NextSlot === "A" || m.NextSlot === "B")) {
        out.push(m);
      }
    }
    return out;
  }

  function applyPredictionsForward() {
    initSlotsFromSheet();

    let changed = true;
    let guard = 0;

    while (changed && guard < 50) {
      changed = false;
      guard++;

      for (const m of rawMatches) {
        const pick = predictedWinnerById.get(m.MatchID);
        if (!pick) continue;

        const destId = m.NextMatchID;
        const destSlot = m.NextSlot;
        if (!destId || !destSlot) continue;

        const dest = slotTeam.get(destId);
        if (!dest) continue;

        if (dest[destSlot] !== pick) {
          dest[destSlot] = pick;
          slotTeam.set(destId, dest);
          changed = true;
        }
      }
    }

    for (const m of rawMatches) {
      const pick = predictedWinnerById.get(m.MatchID);
      if (!pick) continue;
      const s = slotTeam.get(m.MatchID);
      if (!s) continue;
      const a = norm(s.A);
      const b = norm(s.B);
      if (pick !== a && pick !== b) predictedWinnerById.delete(m.MatchID);
    }
  }

  function setPick(matchId, teamName) {
    const m = matchById.get(matchId);
    if (!m) return;

    // CHANGED: block selecting completed fixtures
    if (isCompletedMatch(m)) return;

    const teams = slotTeam.get(matchId);
    if (!teams) return;

    const a = norm(teams.A);
    const b = norm(teams.B);

    if (!isRealTeam(teamName)) return;
    if (teamName !== a && teamName !== b) return;

    const current = predictedWinnerById.get(matchId);
    if (current === teamName) predictedWinnerById.delete(matchId);
    else predictedWinnerById.set(matchId, teamName);

    applyPredictionsForward();
    renderAll();
  }

  // =========================
  // LAYOUT (triangles)
  // =========================
  function getColumnEl(side, round) {
    return document.querySelector(`.round-col[data-side="${side}"][data-round="${round}"]`);
  }

  function groupBySideRound() {
    const groups = new Map();
    for (const m of rawMatches) {
      const key = `${m.Side}|${m.Round}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    for (const [k, arr] of groups) {
      arr.sort((a, b) => (a.SeedY - b.SeedY) || (a.MatchID - b.MatchID));
      groups.set(k, arr);
    }
    return groups;
  }

  function computePositions(groups) {
    const pos = new Map();

    function placeColumn(side, round, colIndex) {
      const key = `${side}|${round}`;
      const ms = groups.get(key) || [];
      const t = Math.max(0, Math.min(3, colIndex));
      const gap = Math.max(V_GAP_MIN, V_GAP0 - t * 3);

      for (let i = 0; i < ms.length; i++) {
        const m = ms[i];
        const seed = (m.SeedY && m.SeedY !== 9999) ? m.SeedY : (i + 1);
        const y = COL_PAD_TOP + (seed - 1) * (CARD_H + gap);
        pos.set(m.MatchID, { x: 0, y });
      }
    }

    LEFT_ROUNDS.forEach((r, i) => placeColumn("L", r, i));
    RIGHT_ROUNDS.forEach((r, i) => placeColumn("R", r, i));
    placeColumn("C", FINAL_ROUND, 0);

    for (let pass = 0; pass < 6; pass++) {
      for (const m of rawMatches) {
        const destId = m.NextMatchID;
        const dest = destId ? matchById.get(destId) : null;
        if (!dest) continue;

        const feeders = sourcesFeeding(destId).map(x => pos.get(x.MatchID)).filter(Boolean);
        if (feeders.length >= 2) {
          const ys = feeders.map(p => p.y);
          const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
          const current = pos.get(destId);
          if (current) pos.set(destId, { ...current, y: centerY });
        }
      }
    }

    return pos;
  }

  // =========================
  // RENDER
  // =========================
  function clearColumns() {
    document.querySelectorAll(".round-col").forEach(col => col.innerHTML = "");
    matchElById.clear();
  }

  function renderMatchCard(m) {
    const teams = slotTeam.get(m.MatchID) || { A: "TBD", B: "TBD" };
    const pick = predictedWinnerById.get(m.MatchID) || "";

    const aName = norm(teams.A) || "TBD";
    const bName = norm(teams.B) || "TBD";

    const actualWin = norm(m.Winner);
    const completed = isCompletedMatch(m); // CHANGED

    const el = document.createElement("div");
    el.className = "match";
    el.dataset.matchId = String(m.MatchID);

    const rowA = document.createElement("div");
    rowA.className = "teamrow";
    rowA.dataset.slot = "A";
    rowA.dataset.team = aName;

    const rowB = document.createElement("div");
    rowB.className = "teamrow";
    rowB.dataset.slot = "B";
    rowB.dataset.team = bName;

    function buildRow(row, teamName) {
      const logo = document.createElement("div");
      logo.className = "logoBox";
      logo.textContent = teamName && teamName !== "TBD"
        ? teamName.split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase()
        : "";

      const name = document.createElement("div");
      name.className = "nameBox";
      name.textContent = teamName || "TBD";

      const score = document.createElement("div");
      score.className = "scoreBox";
      score.textContent = "";

      row.appendChild(logo);
      row.appendChild(name);
      row.appendChild(score);

      // Disable click if TBD/empty OR match is completed
      if (!isRealTeam(teamName) || completed) row.classList.add("disabled");

      // Actual winner highlight
      if (actualWin && teamName === actualWin) row.classList.add("win");

      // User pick highlight (only meaningful if not completed, but harmless)
      if (pick && teamName === pick) row.classList.add("picked");
      if (pick && teamName !== pick && isRealTeam(teamName)) row.classList.add("loser");

      row.addEventListener("click", () => {
        if (!isRealTeam(teamName)) return;
        if (completed) return; // CHANGED: hard block
        setPick(m.MatchID, teamName);
      });
    }

    buildRow(rowA, aName);
    buildRow(rowB, bName);

    el.appendChild(rowA);
    el.appendChild(rowB);

    return el;
  }

  function renderBracket() {
    clearColumns();

    const groups = groupBySideRound();
    const pos = computePositions(groups);

    for (const m of rawMatches) {
      const colSide = m.Side;
      const colRound = m.Round;

      const isLeft = colSide === "L" && LEFT_ROUNDS.includes(colRound);
      const isRight = colSide === "R" && ["Play-In","R16","Quarter","Semi"].includes(colRound);
      const isCenter = colSide === "C" && colRound === FINAL_ROUND;

      if (!isLeft && !isRight && !isCenter) continue;

      const col = getColumnEl(colSide, colRound);
      if (!col) continue;

      const card = renderMatchCard(m);
      const p = pos.get(m.MatchID) || { x: 0, y: 0 };
      card.style.top = `${Math.max(0, p.y)}px`;

      col.appendChild(card);
      matchElById.set(m.MatchID, card);
    }
  }

  function drawLines() {
    while (els.lines.firstChild) els.lines.removeChild(els.lines.firstChild);

    const wrapRect = els.wrap.getBoundingClientRect();
    const svg = els.lines;

    const unscaledW = Math.ceil(wrapRect.width / zoom);
    const unscaledH = Math.ceil(wrapRect.height / zoom);
    svg.setAttribute("width", String(unscaledW));
    svg.setAttribute("height", String(unscaledH));
    svg.setAttribute("viewBox", `0 0 ${unscaledW} ${unscaledH}`);

    function rowEdge(matchId, slot, edge) {
      const card = matchElById.get(matchId);
      if (!card) return null;
      const row = card.querySelector(`.teamrow[data-slot="${slot}"]`);
      if (!row) return null;

      const rowRect = row.getBoundingClientRect();
      const wrapR = els.wrap.getBoundingClientRect();

      const xPx = edge === "right" ? rowRect.right : rowRect.left;
      const x = (xPx - wrapR.left) / zoom;
      const y = (rowRect.top - wrapR.top + rowRect.height / 2) / zoom;
      return { x, y };
    }

    function matchOutputAnchor(m) {
      const outEdge = (m.Side === "R") ? "left" : "right";
      const a = rowEdge(m.MatchID, "A", outEdge);
      const b = rowEdge(m.MatchID, "B", outEdge);
      if (!a || !b) return null;
      return { x: (outEdge === "right" ? Math.max(a.x, b.x) : Math.min(a.x, b.x)), y: (a.y + b.y) / 2 };
    }

    function destSlotAnchor(sourceMatch, destId, destSlot) {
      const destM = matchById.get(destId);
      if (!destM) return null;

      let inEdge = "left";
      if (destM.Side === "R") inEdge = "right";
      if (destM.Side === "C") inEdge = (sourceMatch.Side === "R") ? "right" : "left";

      return rowEdge(destId, destSlot, inEdge);
    }

    for (const m of rawMatches) {
      if (!m.NextMatchID || !m.NextSlot) continue;

      const out = matchOutputAnchor(m);
      if (!out) continue;

      const dest = destSlotAnchor(m, m.NextMatchID, m.NextSlot);
      if (!dest) continue;

      const x1 = out.x, y1 = out.y;
      const x2 = dest.x, y2 = dest.y;

      const midX = x1 + (x2 - x1) * 0.5;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "rgba(0,0,0,0.55)");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("d", `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`);
      svg.appendChild(path);
    }
  }

  function renderLeaderboard(rows) {
    els.leaderboard.innerHTML = "";
    if (!rows || rows.length === 0) {
      const li = document.createElement("li");
      li.className = "lb-row";
      li.innerHTML = `<span class="lb-user">No entries yet.</span><span class="lb-points"></span>`;
      els.leaderboard.appendChild(li);
      return;
    }

    for (const r of rows) {
      const user = norm(r.Username || r.User || r.name || r.username);
      const pts = norm(r.Points || r.points || r.score);
      const li = document.createElement("li");
      li.className = "lb-row";
      li.innerHTML = `<span class="lb-user">${user || "?"}</span><span class="lb-points">${pts !== "" ? `${pts} pts` : ""}</span>`;
      els.leaderboard.appendChild(li);
    }
  }

  function renderAll() {
    renderBracket();
    requestAnimationFrame(() => {
      drawLines();
      fitZoom();
      sizeViewportToContent();
    });
  }

  // =========================
  // SUBMIT PREDICTIONS
  // =========================
  function buildPicksPayload() {
    const name = norm(els.username.value);
    const picks = [];

    for (const m of rawMatches) {
      // CHANGED: also don't include completed fixtures in the submit payload
      if (isCompletedMatch(m)) continue;

      const pick = predictedWinnerById.get(m.MatchID);
      if (!pick) continue;

      const s = slotTeam.get(m.MatchID);
      if (!s) continue;
      if (!isRealTeam(s.A) || !isRealTeam(s.B)) continue;

      picks.push({
        MatchID: m.MatchID,
        Round: m.Round,
        Side: m.Side,
        TeamA: norm(s.A),
        TeamB: norm(s.B),
        Pick: pick,
      });
    }

    return { Username: name, Picks: picks };
  }

  async function submitPredictions() {
    const name = norm(els.username.value);
    if (!name) {
      alert("Enter your name first (exact spelling).");
      return;
    }

    const payload = buildPicksPayload();
    try {
      const r = await fetch(SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submitPredictions", ...payload }),
      });
      if (!r.ok) throw new Error(`Submit HTTP ${r.status}`);
      alert("Predictions submitted!");
      await refreshLeaderboardOnly();
    } catch (e) {
      alert("Submit failed. If your Apps Script expects a different payload/action, tell me and I’ll match it.");
      console.error(e);
    }
  }

  // =========================
  // MAIN
  // =========================
  async function refreshAll() {
    const matches = await loadMatches();
    indexMatches(matches);

    initSlotsFromSheet();
    applyPredictionsForward();

    renderAll();
  }

  async function refreshLeaderboardOnly() {
    const lb = await loadLeaderboard();
    renderLeaderboard(lb);
  }

  async function boot() {
    els.refreshBtn.addEventListener("click", async () => {
      try { await refreshAll(); } catch (e) { console.error(e); alert(e.message); }
    });

    els.syncBtn.addEventListener("click", async () => {
      await syncBracket();
      try { await refreshAll(); } catch (e) { console.error(e); }
    });

    els.submitBtn.addEventListener("click", submitPredictions);

    els.zoomIn.addEventListener("click", () => setZoom(zoom + 0.1));
    els.zoomOut.addEventListener("click", () => setZoom(zoom - 0.1));
    els.zoomFit.addEventListener("click", () => fitZoom());

    window.addEventListener("resize", () => {
      fitZoom();
      drawLines();
      sizeViewportToContent();
    });

    try {
      await refreshAll();
      await refreshLeaderboardOnly();
      setTimeout(() => {
        fitZoom();
        sizeViewportToContent();
      }, 50);
    } catch (e) {
      console.error(e);
      alert(e.message);
    }
  }

  boot();
})();
