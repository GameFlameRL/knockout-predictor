/* =========================
   Knockout Predictor (Graph Renderer)
   - Reads Matches from OpenSheet
   - Uses MatchID -> NextMatchID/NextSlot wiring
   - Uses Side (L/R) + SeedY to anchor layout
   - Computes triangle positions + draws correct lines
   - Click team names to pick; picks auto-advance
   ========================= */

(() => {
  // ====== CONFIG (EDIT THESE) ======
  const SHEET_ID = "1ilDa0ZleooN3OBruvtOqF9Ym1CitowFjaLCk1GiYiNc";
  const MATCHES_TAB = "Matches";
  const LEADERBOARD_TAB = "Leaderboard"; // optional; safe if empty
  const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbywemgGWVB87gFdGZGax7mbJ8U6cIoVxI0pYBJMz-Da66SR_qhknP2ogOISs1WtbGjbbg/exec"; // your deployed Apps Script

  // Layout tuning
  const COL_W = 360;        // column width (matches your CSS .round width)
  const COL_GAP = 28;       // gap between columns
  const CENTER_GAP = 70;    // space between left triangle and right triangle (Final sits here)
  const MATCH_H = 88;       // 2 rows * 44px (matches your CSS teamrow height)
  const V_GAP = 16;         // vertical gap between matches
  const TOP_PAD = 8;

  // Round labels are just cosmetic now (renderer does NOT depend on them)
  const ROUND_LABELS = {
    "Play-In": "Play-In",
    "R16": "R16",
    "Quarter": "Quarter",
    "Semi": "Semi",
    "Final": "Final"
  };

  // ====== DOM HOOKS (change only if your index.html differs) ======
  const els = {
    username: document.querySelector('#username') || document.querySelector('input[placeholder*="name"]'),
    submitBtn: document.querySelector('#submitBtn') || findBtnByText("Submit Predictions"),
    refreshBtn: document.querySelector('#refreshBtn') || findBtnByText("Refresh"),
    syncBtn: document.querySelector('#syncBtn') || findBtnByText("Sync Bracket"),
    zoomOut: findBtnByText("-"),
    zoomFit: findBtnByText("Fit"),
    zoomIn: findBtnByText("+"),

    stage: document.querySelector('.stage'),
    viewport: document.querySelector('.bracket-viewport'),
    wrap: document.querySelector('.bracket-wrap'),
    columns: document.querySelector('.columns'),
    lines: document.querySelector('#lines'),

    leaderboardList: document.querySelector('#leaderboardList') || document.querySelector('.leaderboard')
  };

  // Create SVG if missing
  if (!els.lines && els.wrap) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("id", "lines");
    svg.style.position = "absolute";
    svg.style.inset = "0";
    svg.style.pointerEvents = "none";
    els.wrap.appendChild(svg);
    els.lines = svg;
  }

  // Safety
  if (!els.wrap || !els.columns) {
    console.warn("Missing bracket DOM containers. Ensure .bracket-wrap and .columns exist in index.html.");
  }

  // ====== STATE ======
  const state = {
    zoom: 1,
    matches: [],
    nodes: new Map(),         // id -> node
    incoming: new Map(),      // id -> array of feeder ids
    outgoing: new Map(),      // id -> { nextId, slot }
    picks: new Map(),         // id -> pickedTeamName
    finalId: null,
    leftMaxDepth: 0,
    rightMaxDepth: 0,
  };

  // ====== URLS ======
  const MATCHES_URL = `https://opensheet.elk.sh/${SHEET_ID}/${encodeURIComponent(MATCHES_TAB)}`;
  const LEADERBOARD_URL = `https://opensheet.elk.sh/${SHEET_ID}/${encodeURIComponent(LEADERBOARD_TAB)}`;

  // ====== INIT ======
  wireButtons();
  refreshAll();

  // =========================
  // UI WIRING
  // =========================
  function wireButtons() {
    if (els.refreshBtn) els.refreshBtn.addEventListener("click", () => refreshAll());

    if (els.zoomOut) els.zoomOut.addEventListener("click", () => setZoom(state.zoom * 0.9));
    if (els.zoomIn) els.zoomIn.addEventListener("click", () => setZoom(state.zoom * 1.1));
    if (els.zoomFit) els.zoomFit.addEventListener("click", () => fitZoom());

    if (els.submitBtn) els.submitBtn.addEventListener("click", async () => {
      const username = (els.username?.value || "").trim();
      if (!username) return alert("Enter your name first.");
      const payload = buildSubmissionPayload(username);
      if (!payload.picks.length) return alert("Make at least 1 pick.");

      // Submit to Apps Script (optional)
      if (!SCRIPT_URL) return alert("SCRIPT_URL not set.");
      try {
        els.submitBtn.disabled = true;
        const res = await fetch(SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ action: "submitPicks", ...payload })
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        alert("Submitted ✅");
        await loadLeaderboard();
      } catch (e) {
        console.error(e);
        alert("Submit failed: " + (e?.message || e));
      } finally {
        els.submitBtn.disabled = false;
      }
    });

    if (els.syncBtn) els.syncBtn.addEventListener("click", async () => {
      // Optional: sync winners forward in sheet based on Winner column.
      // Your earlier build used Apps Script for this. Keep it if you want.
      if (!SCRIPT_URL) return alert("SCRIPT_URL not set.");
      try {
        els.syncBtn.disabled = true;
        const res = await fetch(SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ action: "syncBracket" })
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        alert("Synced ✅");
        await refreshAll();
      } catch (e) {
        console.error(e);
        alert("Sync failed: " + (e?.message || e));
      } finally {
        els.syncBtn.disabled = false;
      }
    });
  }

  function setZoom(z) {
    state.zoom = clamp(z, 0.45, 2.4);
    if (els.wrap) els.wrap.style.transform = `scale(${state.zoom})`;
  }

  function fitZoom() {
    if (!els.stage || !els.wrap) return;
    // Fit to stage width
    const stageW = els.stage.clientWidth - 24;
    const contentW = els.wrap.scrollWidth || els.wrap.getBoundingClientRect().width || 1200;
    const z = stageW / contentW;
    setZoom(z);
  }

  // =========================
  // DATA LOAD
  // =========================
  async function refreshAll() {
    await loadMatches();
    buildGraph();
    renderGraphBracket();
    drawAllLines();
    await loadLeaderboard();
    fitZoom();
  }

  async function loadMatches() {
    const res = await fetch(`${MATCHES_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`Matches fetch failed: HTTP ${res.status}`);
    const rows = await res.json();

    // Normalize + parse numbers
    state.matches = rows
      .map(r => ({
        MatchID: toInt(r.MatchID),
        Round: (r.Round || "").trim(),
        TeamA: cleanTeam(r.TeamA),
        TeamB: cleanTeam(r.TeamB),
        Winner: cleanTeam(r.Winner),
        NextMatchID: toInt(r.NextMatchID),
        NextSlot: (r.NextSlot || "").trim().toUpperCase(),
        Side: (r.Side || "").trim().toUpperCase(),
        SeedY: toInt(r.SeedY),
      }))
      .filter(r => Number.isFinite(r.MatchID)); // must have IDs

    // Find Final
    // Prefer Round == Final, else "no NextMatchID"
    const finalRow = state.matches.find(m => m.Round.toLowerCase() === "final") ||
                     state.matches.find(m => !m.NextMatchID);
    state.finalId = finalRow?.MatchID || null;

    // Clear old picks if they are for matches no longer present
    const ids = new Set(state.matches.map(m => m.MatchID));
    for (const k of [...state.picks.keys()]) if (!ids.has(k)) state.picks.delete(k);
  }

  async function loadLeaderboard() {
    if (!els.leaderboardList) return;
    // Leaderboard optional: handle missing tab or empty gracefully
    try {
      const res = await fetch(`${LEADERBOARD_URL}?t=${Date.now()}`);
      if (!res.ok) throw new Error("No leaderboard");
      const rows = await res.json();
      renderLeaderboard(rows);
    } catch {
      renderLeaderboard([]);
    }
  }

  // =========================
  // GRAPH BUILD
  // =========================
  function buildGraph() {
    state.nodes = new Map();
    state.incoming = new Map();
    state.outgoing = new Map();

    for (const m of state.matches) {
      state.nodes.set(m.MatchID, { ...m });
      state.incoming.set(m.MatchID, []);
    }

    for (const m of state.matches) {
      if (m.NextMatchID && state.nodes.has(m.NextMatchID)) {
        state.outgoing.set(m.MatchID, { nextId: m.NextMatchID, slot: m.NextSlot });
        state.incoming.get(m.NextMatchID).push(m.MatchID);
      }
    }
  }

  // =========================
  // LAYOUT (Triangle into Triangle)
  // =========================
  function renderGraphBracket() {
    if (!els.columns) return;

    // Clear
    els.columns.innerHTML = "";
    if (els.lines) els.lines.innerHTML = "";

    // Compute depths (distance to Final) using reverse BFS from Final
    const depth = computeDepthsToFinal(state.finalId);

    // Determine left/right max depth
    const leftNodes = [...state.nodes.values()].filter(n => (n.Side || "") === "L");
    const rightNodes = [...state.nodes.values()].filter(n => (n.Side || "") === "R");

    state.leftMaxDepth = maxOf(leftNodes.map(n => depth.get(n.MatchID) ?? 0));
    state.rightMaxDepth = maxOf(rightNodes.map(n => depth.get(n.MatchID) ?? 0));

    // Build columns order: Left depths (max..1), Final (0), Right depths (1..max)
    const colSpecs = [];

    for (let d = state.leftMaxDepth; d >= 1; d--) colSpecs.push({ side: "L", depth: d });
    colSpecs.push({ side: "C", depth: 0 }); // Final column
    for (let d = 1; d <= state.rightMaxDepth; d++) colSpecs.push({ side: "R", depth: d });

    // Create columns
    const colEls = [];
    for (const spec of colSpecs) {
      const col = document.createElement("div");
      col.className = "round";
      col.style.width = COL_W + "px";
      col.style.position = "relative";

      const header = document.createElement("div");
      header.className = "round-header";
      header.textContent = columnLabel(spec, depth);
      col.appendChild(header);

      els.columns.appendChild(col);
      colEls.push({ spec, el: col });
    }

    // Position matches (y) using SeedY anchors + midpoint propagation
    const yPos = computeYPositions(depth);

    // Render matches into appropriate column
    for (const { spec, el } of colEls) {
      const list = [...state.nodes.values()].filter(n => {
        const d = depth.get(n.MatchID) ?? 999;
        if (spec.side === "C") return n.MatchID === state.finalId || d === 0;
        return n.Side === spec.side && d === spec.depth;
      });

      // Sort by y for stable stacking
      list.sort((a, b) => (yPos.get(a.MatchID) ?? 0) - (yPos.get(b.MatchID) ?? 0));

      for (const node of list) {
        const matchEl = renderMatchCard(node);
        matchEl.style.top = (TOP_PAD + (yPos.get(node.MatchID) ?? 0)) + "px";
        el.appendChild(matchEl);
      }
    }

    // Give bracket-wrap a meaningful width so Fit works
    if (els.wrap) {
      const totalCols = colSpecs.length;
      els.columns.style.gap = COL_GAP + "px";
      els.wrap.style.padding = "10px 10px 30px";
      // Allow scrollWidth to reflect content
    }
  }

  function columnLabel(spec, depthMap) {
    if (spec.side === "C") return "Final";
    // Use the most common Round name for nodes in that column
    const nodes = [...state.nodes.values()].filter(n => n.Side === spec.side && (depthMap.get(n.MatchID) ?? -1) === spec.depth);
    const round = mostCommon(nodes.map(n => n.Round));
    return ROUND_LABELS[round] || round || (spec.side === "L" ? "Left" : "Right");
  }

  function computeDepthsToFinal(finalId) {
    const depth = new Map();
    if (!finalId || !state.nodes.has(finalId)) {
      // fallback: treat everything as depth 1
      for (const id of state.nodes.keys()) depth.set(id, 1);
      return depth;
    }

    // Reverse BFS outward from Final: depth(final)=0; feeders=1; feeders of feeders=2...
    depth.set(finalId, 0);
    const q = [finalId];

    while (q.length) {
      const cur = q.shift();
      const curD = depth.get(cur);

      const feeders = state.incoming.get(cur) || [];
      for (const f of feeders) {
        if (!depth.has(f)) {
          depth.set(f, curD + 1);
          q.push(f);
        }
      }
    }

    // Any disconnected nodes: place far left/right with max+1
    const maxD = maxOf([...depth.values()]);
    for (const id of state.nodes.keys()) {
      if (!depth.has(id)) depth.set(id, maxD + 1);
    }
    return depth;
  }

  function computeYPositions(depthMap) {
    const y = new Map();

    // 1) Anchor nodes with SeedY (per side) at earliest depths first
    // We want feeders positioned before targets, so sort by depth DESC
    const nodesByDepthDesc = [...state.nodes.values()].sort((a, b) => (depthMap.get(b.MatchID) ?? 0) - (depthMap.get(a.MatchID) ?? 0));

    // Determine per-side vertical spacing
    const spacing = MATCH_H + V_GAP;

    // SeedY anchors
    for (const n of nodesByDepthDesc) {
      if (Number.isFinite(n.SeedY) && n.SeedY > 0) {
        y.set(n.MatchID, (n.SeedY - 1) * spacing);
      }
    }

    // 2) Midpoint propagate for non-anchored nodes
    for (const n of nodesByDepthDesc.reverse()) {
      if (y.has(n.MatchID)) continue;
      const feeders = state.incoming.get(n.MatchID) || [];
      if (feeders.length >= 1) {
        const ys = feeders.map(fid => y.get(fid)).filter(v => Number.isFinite(v));
        if (ys.length) {
          y.set(n.MatchID, avg(ys));
          continue;
        }
      }
      // fallback: stack at bottom of its side
      const sameSide = [...state.nodes.values()].filter(x => (x.Side || "") === (n.Side || ""));
      const maxY = maxOf(sameSide.map(s => y.get(s.MatchID)).filter(v => Number.isFinite(v)));
      y.set(n.MatchID, (Number.isFinite(maxY) ? maxY + spacing : 0));
    }

    // 3) Collision pass within each (side, depth) column: ensure minimum spacing
    const groups = new Map(); // key -> array ids sorted by y
    for (const n of state.nodes.values()) {
      const d = depthMap.get(n.MatchID) ?? 0;
      const side = n.Side || (n.MatchID === state.finalId ? "C" : "");
      const key = `${side}|${d}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n.MatchID);
    }

    for (const [key, ids] of groups.entries()) {
      ids.sort((a, b) => (y.get(a) ?? 0) - (y.get(b) ?? 0));
      for (let i = 1; i < ids.length; i++) {
        const prev = ids[i - 1];
        const cur = ids[i];
        const min = (y.get(prev) ?? 0) + spacing;
        if ((y.get(cur) ?? 0) < min) y.set(cur, min);
      }
    }

    return y;
  }

  // =========================
  // RENDER MATCH CARD
  // =========================
  function renderMatchCard(node) {
    const el = document.createElement("div");
    el.className = "match";
    el.dataset.matchId = String(node.MatchID);

    // Resolve displayed teams: use local picks propagation (virtual bracket)
    const display = getDisplayTeams(node.MatchID);

    const aRow = renderTeamRow(node, "A", display.TeamA);
    const bRow = renderTeamRow(node, "B", display.TeamB);

    el.appendChild(aRow);
    el.appendChild(bRow);

    // Size/positioning handled by CSS + top style
    el.style.left = "0px";
    el.style.right = "0px";

    return el;
  }

  function renderTeamRow(node, slot, teamNameRaw) {
    const teamName = teamNameRaw || "TBD";
    const row = document.createElement("div");
    row.className = "teamrow";

    const logo = document.createElement("div");
    logo.className = "logoBox";
    logo.textContent = abbreviate(teamName);

    const name = document.createElement("div");
    name.className = "nameBox";
    name.textContent = teamName;

    const score = document.createElement("div");
    score.className = "scoreBox";
    score.textContent = ""; // prediction mode (no scores)

    // Winner styling from sheet (actual)
    if (node.Winner && equalTeam(node.Winner, teamName)) row.classList.add("win");

    // Pick styling from local picks
    const picked = state.picks.get(node.MatchID);
    if (picked && equalTeam(picked, teamName)) row.classList.add("picked");
    if (picked && !equalTeam(picked, teamName) && teamName !== "TBD") row.classList.add("loser");

    // Disable clicking TBD
    if (!teamNameRaw || teamName === "TBD") row.classList.add("disabled");

    // Click to pick (team name row)
    row.addEventListener("click", () => {
      if (row.classList.contains("disabled")) return;

      // Auto resolve if BYE exists: if opponent is blank/TBD, still allow pick for the known team
      setPick(node.MatchID, teamName);
    });

    row.appendChild(logo);
    row.appendChild(name);
    row.appendChild(score);

    // Mark row for line targeting (slot A/B)
    row.dataset.slot = slot;

    return row;
  }

  // =========================
  // PICKS + AUTO ADVANCE
  // =========================
  function setPick(matchId, teamName) {
    state.picks.set(matchId, teamName);

    // Propagate forward along the graph
    propagateForward(matchId);

    // Re-render + redraw
    renderGraphBracket();
    drawAllLines();
  }

  function propagateForward(fromMatchId) {
    const edge = state.outgoing.get(fromMatchId);
    if (!edge) return;

    const winner = state.picks.get(fromMatchId) || getSheetWinner(fromMatchId);
    if (!winner) return;

    const nextId = edge.nextId;
    const slot = edge.slot;

    // Write into virtual display slot by storing a "slot override" in picksSlotMap
    // We'll compute display teams dynamically from sheet teams + propagated picks.
    // To keep it simple, we store synthetic picks in a separate map.
    if (!state._slotFill) state._slotFill = new Map(); // key: `${matchId}|A` -> team
    state._slotFill.set(`${nextId}|${slot}`, winner);

    // If the next match already had a pick that is now invalid, clear it (and downstream)
    const nextDisplay = getDisplayTeams(nextId);
    const nextPick = state.picks.get(nextId);
    if (nextPick && !equalTeam(nextPick, nextDisplay.TeamA) && !equalTeam(nextPick, nextDisplay.TeamB)) {
      clearPickCascade(nextId);
    }

    // Continue propagation if next match has a pick or becomes auto-decidable (BYE)
    const maybeAuto = autoDecideIfBye(nextId);
    if (maybeAuto) {
      state.picks.set(nextId, maybeAuto);
    }
    if (state.picks.has(nextId)) propagateForward(nextId);
  }

  function clearPickCascade(matchId) {
    state.picks.delete(matchId);
    // clear synthetic slot fills forward too
    const edge = state.outgoing.get(matchId);
    if (!edge) return;

    const nextId = edge.nextId;
    if (state._slotFill) {
      state._slotFill.delete(`${nextId}|A`);
      state._slotFill.delete(`${nextId}|B`);
    }
    clearPickCascade(nextId);
  }

  function autoDecideIfBye(matchId) {
    const d = getDisplayTeams(matchId);
    const a = d.TeamA;
    const b = d.TeamB;

    // If one side is missing/TBD and the other is real, auto pick the real one
    if (isRealTeam(a) && !isRealTeam(b)) return a;
    if (isRealTeam(b) && !isRealTeam(a)) return b;
    return null;
  }

  // Display teams = sheet TeamA/TeamB with propagated fills applied
  function getDisplayTeams(matchId) {
    const node = state.nodes.get(matchId);
    if (!node) return { TeamA: "TBD", TeamB: "TBD" };

    let a = node.TeamA || "";
    let b = node.TeamB || "";

    // Apply slot fills from upstream picks
    if (state._slotFill) {
      const fa = state._slotFill.get(`${matchId}|A`);
      const fb = state._slotFill.get(`${matchId}|B`);
      if (fa) a = fa;
      if (fb) b = fb;
    }

    // Normalize blanks to TBD
    return {
      TeamA: a || "TBD",
      TeamB: b || "TBD"
    };
  }

  function getSheetWinner(matchId) {
    const n = state.nodes.get(matchId);
    return n?.Winner || "";
  }

  function buildSubmissionPayload(username) {
    const picks = [];
    for (const [matchId, team] of state.picks.entries()) {
      picks.push({ MatchID: matchId, Pick: team });
    }
    // Stable order
    picks.sort((a, b) => a.MatchID - b.MatchID);
    return { username, picks };
  }

  // =========================
  // LINES
  // =========================
  function drawAllLines() {
    if (!els.lines) return;

    // Resize SVG to cover wrap
    const wrapRect = els.wrap.getBoundingClientRect();
    const svg = els.lines;
    svg.setAttribute("width", Math.ceil(els.wrap.scrollWidth || wrapRect.width));
    svg.setAttribute("height", Math.ceil(els.wrap.scrollHeight || wrapRect.height));

    // Clear
    svg.innerHTML = "";

    // Draw each edge from match -> nextMatch slot
    for (const [fromId, edge] of state.outgoing.entries()) {
      const toId = edge.nextId;
      const slot = edge.slot;

      const fromEl = document.querySelector(`.match[data-match-id="${fromId}"]`);
      const toEl = document.querySelector(`.match[data-match-id="${toId}"]`);
      if (!fromEl || !toEl) continue;

      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      const wrap = els.wrap.getBoundingClientRect();

      // Start at mid-right of from match
      const x1 = (fromRect.right - wrap.left);
      const y1 = (fromRect.top - wrap.top) + (MATCH_H / 2);

      // End at left edge of the target row A/B midpoint
      const toRow = toEl.querySelector(`.teamrow[data-slot="${slot}"]`);
      const tr = toRow ? toRow.getBoundingClientRect() : toRect;
      const x2 = (toRect.left - wrap.left);
      const y2 = (tr.top - wrap.top) + (tr.height / 2);

      // Bezier-ish orthogonal line
      const midX = (x1 + x2) / 2;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "rgba(0,0,0,0.55)");
      path.setAttribute("stroke-width", "3");
      path.setAttribute("stroke-linecap", "round");
      svg.appendChild(path);
    }
  }

  // =========================
  // LEADERBOARD RENDER
  // =========================
  function renderLeaderboard(rows) {
    if (!els.leaderboardList) return;

    // Clear existing
    els.leaderboardList.innerHTML = "";

    const norm = (rows || [])
      .map(r => ({
        Username: (r.Username || r.username || "").trim(),
        Points: (r.Points || r.points || "").toString().trim()
      }))
      .filter(r => r.Username);

    if (!norm.length) {
      const li = document.createElement("div");
      li.className = "hint";
      li.textContent = "No entries yet.";
      els.leaderboardList.appendChild(li);
      return;
    }

    for (const r of norm) {
      const row = document.createElement("li");
      row.className = "lb-row";

      const u = document.createElement("div");
      u.className = "lb-user";
      u.textContent = r.Username;

      const p = document.createElement("div");
      p.className = "lb-points";
      p.textContent = `${r.Points} pts`;

      row.appendChild(u);
      row.appendChild(p);
      els.leaderboardList.appendChild(row);
    }
  }

  // =========================
  // HELPERS
  // =========================
  function findBtnByText(text) {
    const buttons = [...document.querySelectorAll("button")];
    return buttons.find(b => (b.textContent || "").trim() === text) || null;
  }

  function toInt(v) {
    const n = parseInt(String(v || "").trim(), 10);
    return Number.isFinite(n) ? n : null;
  }

  function cleanTeam(s) {
    const t = (s ?? "").toString().trim();
    return t;
  }

  function equalTeam(a, b) {
    return (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
  }

  function abbreviate(team) {
    const t = (team || "").trim();
    if (!t || t === "TBD") return "";
    if (t.length <= 3) return t.toUpperCase();
    // use first letters of up to 2 words
    const parts = t.split(/\s+/).filter(Boolean);
    const ab = parts.slice(0, 2).map(p => p[0]).join("");
    return ab.toUpperCase();
  }

  function isRealTeam(t) {
    const s = (t || "").trim();
    if (!s) return false;
    if (s.toUpperCase() === "TBD") return false;
    if (s.toUpperCase() === "BYE") return false;
    return true;
  }

  function avg(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function maxOf(arr) {
    let m = -Infinity;
    for (const v of arr) if (Number.isFinite(v)) m = Math.max(m, v);
    return m === -Infinity ? 0 : m;
  }

  function mostCommon(arr) {
    const m = new Map();
    for (const x of arr) {
      const k = (x || "").trim();
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    let best = "";
    let bestC = 0;
    for (const [k, c] of m.entries()) {
      if (c > bestC) { best = k; bestC = c; }
    }
    return best;
  }

  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }

})();
