// script_v2.js
(() => {
  // =========================
  // CONFIG (edit these only)
  // =========================
  const SHEET_ID = "1ilDa0ZleooN3OBruvtOqF9Ym1CitowFjaLCk1GiYiNc";
  const MATCHES_TAB = "Matches";

  // Your Apps Script web app URL (for submit + leaderboard + optional sync)
  // If you don’t use Apps Script for leaderboard yet, it’ll just show “No entries yet.”
  const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbywemgGWVB87gFdGZGax7mbJ8U6cIoVxI0pYBJMz-Da66SR_qhknP2ogOISs1WtbGjbbg/exec";

  const MATCHES_URL = `https://opensheet.elk.sh/${SHEET_ID}/${encodeURIComponent(MATCHES_TAB)}`;

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

  // Predicted picks:
  // predictedWinnerById: matchId -> teamName
  let predictedWinnerById = new Map();

  // Derived bracket slots:
  // slotTeam[matchId] = { A: teamName, B: teamName }
  let slotTeam = new Map();

  // DOM refs
  const els = {
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

  function setZoom(z) {
    zoom = Math.max(0.4, Math.min(1.6, z));
    els.wrap.style.transform = `scale(${zoom})`;
    drawLines();
  }

  function fitZoom() {
    // Fit whole bracket width into viewport
    const vp = els.viewport.getBoundingClientRect();
    const contentW = els.wrap.scrollWidth || els.wrap.getBoundingClientRect().width;
    if (!contentW) return;
    const target = Math.max(0.4, Math.min(1.2, (vp.width - 20) / contentW));
    setZoom(target);
  }

  // =========================
  // FETCH
  // =========================
  async function loadMatches() {
    const url = `${MATCHES_URL}?t=${Date.now()}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Matches fetch failed: HTTP ${r.status}`);
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  }

  async function loadLeaderboard() {
    // This expects your Apps Script to return:
    // [{ Username: "name", Points: "12" }, ...]
    // If yours differs, adjust parse below.
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

  // Optional: sync winners from sheet (if you implement it server-side)
  async function syncBracket() {
    // This button is safe even if your Apps Script doesn’t support it.
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
    // Start from base sheet slots each time and re-apply winners in topological-ish order.
    initSlotsFromSheet();

    // We propagate by iterating until no change (small graph, safe).
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

    // After propagation, validate picks: if a pick is no longer one of the two teams, clear it.
    for (const m of rawMatches) {
      const pick = predictedWinnerById.get(m.MatchID);
      if (!pick) continue;
      const s = slotTeam.get(m.MatchID);
      if (!s) continue;
      const a = norm(s.A);
      const b = norm(s.B);
      if (pick !== a && pick !== b) {
        predictedWinnerById.delete(m.MatchID);
      }
    }
  }

  function setPick(matchId, teamName) {
    const m = matchById.get(matchId);
    if (!m) return;

    const teams = slotTeam.get(matchId);
    if (!teams) return;

    const a = norm(teams.A);
    const b = norm(teams.B);

    if (!isRealTeam(teamName)) return;
    if (teamName !== a && teamName !== b) return;

    // Toggle: clicking the already-picked team clears the pick
    const current = predictedWinnerById.get(matchId);
    if (current === teamName) predictedWinnerById.delete(matchId);
    else predictedWinnerById.set(matchId, teamName);

    // Recompute forward and clear invalid downstream picks automatically
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
    const groups = new Map(); // key `${side}|${round}` -> matches[]
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
    // pos: matchId -> { x, y }
    const pos = new Map();

    // Helper: place a column’s matches by (seedY) baseline
    function placeColumn(side, round, colIndex, isRightMirror) {
      const key = `${side}|${round}`;
      const ms = groups.get(key) || [];
      // tighter as we move inward
      const t = Math.max(0, Math.min(3, colIndex));
      const gap = Math.max(V_GAP_MIN, V_GAP0 - t * 3);

      for (let i = 0; i < ms.length; i++) {
        const m = ms[i];
        // Use SeedY if present (1..), else fallback to index
        const seed = (m.SeedY && m.SeedY !== 9999) ? m.SeedY : (i + 1);
        const y = COL_PAD_TOP + (seed - 1) * (CARD_H + gap);
        pos.set(m.MatchID, { x: 0, y });
      }
      return { gap, count: ms.length };
    }

    // Baseline placement for outer columns
    // Left: Play-In colIndex 0, R16 1, Quarter 2, Semi 3
    LEFT_ROUNDS.forEach((r, i) => placeColumn("L", r, i, false));
    // Right: Play-In is visually last (colIndex 3 baseline), but we compute by its inward distance:
    // We want right triangle to have same density, so use mirrored index mapping:
    // Right body columns are [Semi(0), Quarter(1), R16(2), Play-In(3)] visually
    RIGHT_ROUNDS.forEach((r, i) => placeColumn("R", r, i, true));
    // Center Final baseline
    placeColumn("C", FINAL_ROUND, 0, false);

    // Now refine inward rounds so they center between their feeders (triangle look)
    // We do a few relaxation passes.
    for (let pass = 0; pass < 6; pass++) {
      for (const m of rawMatches) {
        const destId = m.NextMatchID;
        const dest = destId ? matchById.get(destId) : null;
        if (!dest) continue;

        const a = pos.get(m.MatchID);
        const b = pos.get(destId);
        if (!a || !b) continue;

        // We want dest centered on its feeders.
        const feeders = sourcesFeeding(destId).map(x => pos.get(x.MatchID)).filter(Boolean);
        if (feeders.length >= 2) {
          const ys = feeders.map(p => p.y);
          const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
          const current = pos.get(destId);
          if (current) {
            pos.set(destId, { ...current, y: centerY });
          }
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
      logo.textContent = teamName && teamName !== "TBD" ? teamName.split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase() : "";

      const name = document.createElement("div");
      name.className = "nameBox";
      name.textContent = teamName || "TBD";

      const score = document.createElement("div");
      score.className = "scoreBox";
      // No scores in predictor mode; keep blank
      score.textContent = "";

      row.appendChild(logo);
      row.appendChild(name);
      row.appendChild(score);

      // Disable click if TBD/empty
      if (!isRealTeam(teamName)) row.classList.add("disabled");

      // Actual winner highlight
      if (actualWin && teamName === actualWin) row.classList.add("win");

      // User pick highlight
      if (pick && teamName === pick) row.classList.add("picked");
      if (pick && teamName !== pick && isRealTeam(teamName)) row.classList.add("loser");

      row.addEventListener("click", () => {
        if (!isRealTeam(teamName)) return;
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

    // Group by side/round
    const groups = groupBySideRound();
    const pos = computePositions(groups);

    // Render matches into correct columns based on Side+Round
    for (const m of rawMatches) {
      let colSide = m.Side;
      let colRound = m.Round;

      // Only render the rounds we care about
      const isLeft = colSide === "L" && LEFT_ROUNDS.includes(colRound);
      const isRight = colSide === "R" && ["Play-In","R16","Quarter","Semi"].includes(colRound); // data uses normal names
      const isCenter = colSide === "C" && colRound === FINAL_ROUND;

      if (!isLeft && !isRight && !isCenter) continue;

      // Right side is displayed reversed; map normal round -> displayed column round
      if (colSide === "R") {
        // data round is "Play-In","R16","Quarter","Semi"
        // but our right DOM columns are [Semi, Quarter, R16, Play-In]
        // we can keep round as-is because DOM has those in that order already via data-round.
        // For right, we *do* have columns for those rounds (see index.html): Semi,Quarter,R16,Play-In
      }

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
    // Clear SVG
    while (els.lines.firstChild) els.lines.removeChild(els.lines.firstChild);

    // Ensure SVG covers the wrap content
    const wrapRect = els.wrap.getBoundingClientRect();
    const svg = els.lines;
    svg.setAttribute("width", String(els.wrap.scrollWidth || wrapRect.width));
    svg.setAttribute("height", String(els.wrap.scrollHeight || wrapRect.height));

    function anchorFor(matchId, slot) {
      const card = matchElById.get(matchId);
      if (!card) return null;
      const row = card.querySelector(`.teamrow[data-slot="${slot}"]`);
      if (!row) return null;

      const rowRect = row.getBoundingClientRect();
      const wrapR = els.wrap.getBoundingClientRect();

      // Anchor at the right edge middle of row
      const x = (rowRect.right - wrapR.left) / zoom;
      const y = (rowRect.top - wrapR.top + rowRect.height / 2) / zoom;
      return { x, y };
    }

    function anchorLeftEdge(matchId, slot) {
      const card = matchElById.get(matchId);
      if (!card) return null;
      const row = card.querySelector(`.teamrow[data-slot="${slot}"]`);
      if (!row) return null;

      const rowRect = row.getBoundingClientRect();
      const wrapR = els.wrap.getBoundingClientRect();

      const x = (rowRect.left - wrapR.left) / zoom;
      const y = (rowRect.top - wrapR.top + rowRect.height / 2) / zoom;
      return { x, y };
    }

    // Draw each connection based on NextMatchID/NextSlot
    for (const m of rawMatches) {
      if (!m.NextMatchID || !m.NextSlot) continue;

      const destId = m.NextMatchID;
      const destSlot = m.NextSlot;

      // Source is always the "winner output" of this match:
      // Use the center between its two rows at right edge.
      const aOut = anchorFor(m.MatchID, "A");
      const bOut = anchorFor(m.MatchID, "B");
      if (!aOut || !bOut) continue;

      const x1 = Math.max(aOut.x, bOut.x);
      const y1 = (aOut.y + bOut.y) / 2;

      // Destination slot anchor: left edge of that slot row
      const dest = anchorLeftEdge(destId, destSlot);
      if (!dest) continue;

      const x2 = dest.x;
      const y2 = dest.y;

      // Orthogonal-ish path for clean bracket look
      const midX = (x1 + x2) / 2;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "rgba(0,0,0,0.55)");
      path.setAttribute("stroke-width", "2");

      // M x1,y1 -> H midX -> V y2 -> H x2
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
    // Give layout a beat to hit DOM before drawing lines
    requestAnimationFrame(() => drawLines());
  }

  // =========================
  // SUBMIT PREDICTIONS
  // =========================
  function buildPicksPayload() {
    // Payload shape is intentionally simple.
    // Apps Script can map it however you want.
    const name = norm(els.username.value);
    const picks = [];

    for (const m of rawMatches) {
      const pick = predictedWinnerById.get(m.MatchID);
      if (!pick) continue;

      // only include if both teams are real
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

    // Start from sheet base teams
    initSlotsFromSheet();

    // Re-apply any saved predictions (if you want persistence later)
    applyPredictionsForward();

    renderAll();
  }

  async function refreshLeaderboardOnly() {
    const lb = await loadLeaderboard();
    renderLeaderboard(lb);
  }

  async function boot() {
    // Wire buttons
    els.refreshBtn.addEventListener("click", async () => {
      try { await refreshAll(); } catch (e) { console.error(e); alert(e.message); }
    });

    els.syncBtn.addEventListener("click", async () => {
      await syncBracket();
      // reload after sync
      try { await refreshAll(); } catch (e) { console.error(e); }
    });

    els.submitBtn.addEventListener("click", submitPredictions);

    els.zoomIn.addEventListener("click", () => setZoom(zoom + 0.1));
    els.zoomOut.addEventListener("click", () => setZoom(zoom - 0.1));
    els.zoomFit.addEventListener("click", () => fitZoom());

    window.addEventListener("resize", () => drawLines());

    // Initial load
    try {
      await refreshAll();
      await refreshLeaderboardOnly();
      // Fit after first render
      setTimeout(() => fitZoom(), 50);
    } catch (e) {
      console.error(e);
      alert(e.message);
    }
  }

  boot();
})();
