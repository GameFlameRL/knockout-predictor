/* =========================
   Knockout Predictor script.js
   Graph-based bracket layout:
   - Keeps your sheet EXACTLY as typed
   - Places matches by their actual links (NextMatchID/NextSlot)
   - Forms left triangle + right triangle into Final
   ========================= */

/* ====== CONFIG ====== */
const SHEET_ID = "1ilDa0ZleooN3OBruvtOqF9Ym1CitowFjaLCk1GiYiNc";
const MATCHES_TAB_NAME = "Matches";
const LEADERBOARD_TAB_NAME = "Leaderboard";

// OpenSheet endpoint (you’re already using this)
const MATCHES_URL = `https://opensheet.elk.sh/${SHEET_ID}/${encodeURIComponent(MATCHES_TAB_NAME)}`;
const LEADERBOARD_URL = `https://opensheet.elk.sh/${SHEET_ID}/${encodeURIComponent(LEADERBOARD_TAB_NAME)}`;

// Your Apps Script Web App (submit predictions / sync bracket)
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbywemgGWVB87gFdGZGax7mbJ8U6cIoVxI0pYBJMz-Da66SR_qhknP2ogOISs1WtbGjbbg/exec";

/* ====== UI / LAYOUT SETTINGS ====== */
const ROUNDS_ORDER = ["Play-In", "R16", "Quarter", "Semi", "Final"];

const CARD_W = 320;
const ROW_H = 44;
const CARD_H = ROW_H * 2;        // 2 team rows
const ROUND_GAP_X = 28;
const MIN_GAP_Y = 16;

const TOP_PAD = 20;
const LEFT_PAD = 20;

const FINAL_GAP_X = 60;          // space around center final
const SIDE_INSET = 10;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.6;

/* ====== STATE ====== */
let zoom = 1.0;

let matches = [];                // normalized match objects
let matchById = new Map();       // id -> match
let incoming = new Map();        // id -> [{fromId, slot}]
let sideOf = new Map();          // id -> "L" | "R" | "C"
let picks = new Map();           // id -> winnerTeamName

/* ====== DOM ====== */
const el = {
  stage: null,
  viewport: null,
  wrap: null,
  lines: null,
  columns: null,
  nameInput: null,
  btnSubmit: null,
  btnRefresh: null,
  btnSync: null,
  btnZoomIn: null,
  btnZoomOut: null,
  btnFit: null,
  leaderboard: null,
};

/* =========================
   BOOT
   ========================= */
document.addEventListener("DOMContentLoaded", () => {
  bindDom();
  bindButtons();
  refreshAll();
});

function bindDom() {
  // Expecting your HTML already has these ids (from your current app)
  el.stage = document.querySelector(".stage") || document.body;
  el.viewport = document.querySelector(".bracket-viewport") || el.stage;
  el.wrap = document.querySelector(".bracket-wrap") || createDiv(el.viewport, "bracket-wrap");
  el.columns = document.querySelector(".columns") || createDiv(el.wrap, "columns");

  el.lines = document.querySelector("#lines");
  if (!el.lines) {
    el.lines = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.lines.setAttribute("id", "lines");
    el.wrap.appendChild(el.lines);
  }

  el.nameInput = document.querySelector("#username") || document.querySelector('input[placeholder*="name"]');
  el.btnSubmit = document.querySelector("#submitBtn") || findButton("Submit Predictions");
  el.btnRefresh = document.querySelector("#refreshBtn") || findButton("Refresh");
  el.btnSync = document.querySelector("#syncBtn") || findButton("Sync Bracket");

  el.btnZoomOut = document.querySelector("#zoomOut") || findButton("-");
  el.btnFit = document.querySelector("#zoomFit") || findButton("Fit");
  el.btnZoomIn = document.querySelector("#zoomIn") || findButton("+");

  el.leaderboard = document.querySelector("#leaderboardList") || document.querySelector(".leaderboard");
}

function bindButtons() {
  if (el.btnRefresh) el.btnRefresh.addEventListener("click", () => refreshAll(true));
  if (el.btnFit) el.btnFit.addEventListener("click", () => fitToStage());
  if (el.btnZoomIn) el.btnZoomIn.addEventListener("click", () => setZoom(zoom + 0.1));
  if (el.btnZoomOut) el.btnZoomOut.addEventListener("click", () => setZoom(zoom - 0.1));

  if (el.btnSubmit) el.btnSubmit.addEventListener("click", submitPredictions);
  if (el.btnSync) el.btnSync.addEventListener("click", syncBracket);
}

/* =========================
   DATA LOAD
   ========================= */
async function refreshAll(force = false) {
  await loadMatches();
  buildGraph();
  classifySides();
  applyExistingWinnersFromSheet();
  renderBracket();
  drawLines();
  loadLeaderboard().catch(() => {});
}

async function loadMatches() {
  const url = `${MATCHES_URL}?t=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Matches fetch failed: ${res.status}`);
  const data = await res.json();

  matches = (Array.isArray(data) ? data : []).map(normalizeMatch).filter(m => m.id != null);

  matchById = new Map(matches.map(m => [m.id, m]));
}

function normalizeMatch(row) {
  // Defensive: OpenSheet keys may vary by capitalization
  const get = (k) => row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()] ?? "";

  const idRaw = get("MatchID");
  const id = parseInt(String(idRaw).trim(), 10);
  if (!Number.isFinite(id)) return { id: null };

  const round = String(get("Round")).trim();

  const teamA = cleanTeam(get("TeamA"));
  const teamB = cleanTeam(get("TeamB"));
  const winner = cleanTeam(get("Winner"));

  const nextIdRaw = get("NextMatchID");
  const nextMatchId = nextIdRaw === "" ? null : parseInt(String(nextIdRaw).trim(), 10);
  const nextSlot = String(get("NextSlot")).trim().toUpperCase() || null;

  return {
    id,
    round,
    teamA,
    teamB,
    winner,
    nextMatchId: Number.isFinite(nextMatchId) ? nextMatchId : null,
    nextSlot: (nextSlot === "A" || nextSlot === "B") ? nextSlot : null,

    // layout fields
    x: 0,
    y: 0,
    side: "C", // L/R/C
  };
}

function cleanTeam(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (s.toUpperCase() === "TBD") return "";
  if (s.toUpperCase() === "BYE") return ""; // we never treat BYE as a team
  return s;
}

/* =========================
   GRAPH
   ========================= */
function buildGraph() {
  incoming = new Map();
  for (const m of matches) {
    if (m.nextMatchId && m.nextSlot) {
      if (!incoming.has(m.nextMatchId)) incoming.set(m.nextMatchId, []);
      incoming.get(m.nextMatchId).push({ fromId: m.id, slot: m.nextSlot });
    }
  }
}

function findFinalMatchId() {
  // Prefer Round == Final, else match with no nextMatchId
  const final = matches.find(m => m.round === "Final") || matches.find(m => !m.nextMatchId);
  return final ? final.id : null;
}

/* =========================
   SIDE CLASSIFICATION (L/R)
   - determines left triangle and right triangle
   based on which Semi feeds Final slot A vs B
   ========================= */
function classifySides() {
  sideOf = new Map();

  const finalId = findFinalMatchId();
  if (!finalId) return;

  const finalsIncoming = incoming.get(finalId) || [];

  const aFeeder = finalsIncoming.find(x => x.slot === "A");
  const bFeeder = finalsIncoming.find(x => x.slot === "B");

  // If missing, fall back to split by round order (best-effort)
  const leftRoot = aFeeder ? aFeeder.fromId : null;
  const rightRoot = bFeeder ? bFeeder.fromId : null;

  // Mark center
  sideOf.set(finalId, "C");

  if (leftRoot) markSubtree(leftRoot, "L");
  if (rightRoot) markSubtree(rightRoot, "R");

  // Any unclassified earlier matches: assign by which root they eventually reach
  // (walk forward via nextMatchId until final)
  for (const m of matches) {
    if (sideOf.has(m.id)) continue;
    const end = walkToFinal(m.id, finalId);
    if (end === "L" || end === "R") sideOf.set(m.id, end);
  }

  // Apply to objects
  for (const m of matches) {
    m.side = sideOf.get(m.id) || (m.id === finalId ? "C" : "L");
  }
}

function markSubtree(rootId, side) {
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    if (sideOf.has(id)) continue;
    sideOf.set(id, side);
    const feeders = incoming.get(id) || [];
    for (const f of feeders) stack.push(f.fromId);
  }
}

function walkToFinal(startId, finalId) {
  let cur = matchById.get(startId);
  const seen = new Set();
  while (cur && cur.nextMatchId && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.nextMatchId === finalId) {
      // determine slot at final
      const finalsIncoming = incoming.get(finalId) || [];
      const edge = finalsIncoming.find(x => x.fromId === cur.id);
      if (!edge) return null;
      return edge.slot === "A" ? "L" : "R";
    }
    cur = matchById.get(cur.nextMatchId);
  }
  return null;
}

/* =========================
   EXISTING WINNERS (from sheet)
   ========================= */
function applyExistingWinnersFromSheet() {
  picks.clear();

  // Use sheet Winner column as initial picks where present
  for (const m of matches) {
    if (m.winner) {
      picks.set(m.id, m.winner);
    }
  }

  // Now propagate winners forward into downstream Team slots (graph fill)
  // This keeps your data consistent in UI even if the sheet already has some winners.
  propagateAllPicks();
}

function propagateAllPicks() {
  // Start by clearing all dynamically-filled downstream slots
  // We do NOT erase seeded TeamA/TeamB that are explicitly present.
  const baseTeams = new Map();
  for (const m of matches) {
    baseTeams.set(m.id, { teamA: m.teamA, teamB: m.teamB });
  }

  // Reset teams to base
  for (const m of matches) {
    const base = baseTeams.get(m.id);
    m.teamA = base.teamA;
    m.teamB = base.teamB;
  }

  // Apply picks in topological-ish order by round progression
  // We may have cross-order, so we do multiple passes until stable.
  for (let pass = 0; pass < 6; pass++) {
    for (const m of matches) {
      const win = picks.get(m.id);
      if (!win) continue;
      if (m.nextMatchId && m.nextSlot) {
        const nxt = matchById.get(m.nextMatchId);
        if (!nxt) continue;
        if (m.nextSlot === "A") {
          if (!nxt.teamA || nxt.teamA === win) nxt.teamA = win;
        } else {
          if (!nxt.teamB || nxt.teamB === win) nxt.teamB = win;
        }
      }
    }
  }
}

/* =========================
   RENDER
   ========================= */
function renderBracket() {
  el.columns.innerHTML = "";
  clearSvg(el.lines);

  // Build round columns for BOTH sides:
  // Left: Play-In -> R16 -> Quarter -> Semi
  // Center: Final
  // Right: Semi <- Quarter <- R16 <- Play-In
  const leftRounds = ["Play-In", "R16", "Quarter", "Semi"];
  const rightRounds = ["Semi", "Quarter", "R16", "Play-In"];

  const finalId = findFinalMatchId();
  const finalMatch = finalId ? matchById.get(finalId) : null;

  // Layout both sides first (computes x,y)
  const leftPlaced = layoutSide("L", leftRounds, true);
  const rightPlaced = layoutSide("R", rightRounds, false);

  // Place Final centered between sides
  if (finalMatch) {
    const leftMost = leftPlaced.bounds;
    const rightMost = rightPlaced.bounds;

    const centerX = (leftMost.maxX + rightMost.minX) / 2;
    finalMatch.x = centerX - CARD_W / 2;
    finalMatch.y = (leftMost.midY + rightMost.midY) / 2 - CARD_H / 2;
  }

  // Now render columns visually in the same order as the layout
  // Left columns
  for (const r of leftRounds) {
    renderRoundColumn(r, "L", true);
  }

  // Final column
  if (finalMatch) {
    const col = createDiv(el.columns, "round");
    col.style.width = `${CARD_W + 40}px`;
    const hdr = createDiv(col, "round-header");
    hdr.textContent = "Final";
    renderMatchCard(finalMatch, col);
  }

  // Right columns
  for (const r of rightRounds) {
    renderRoundColumn(r, "R", false);
  }

  // Resize SVG to cover wrap
  requestAnimationFrame(() => {
    fitSvgToContent();
    drawLines();
    // If user has never fit, fit once
    fitToStage(true);
  });
}

function renderRoundColumn(roundName, side, isLeftToRight) {
  const col = createDiv(el.columns, "round");
  col.style.width = `${CARD_W + 40}px`;

  const hdr = createDiv(col, "round-header");
  hdr.textContent = roundName;

  const ms = matches
    .filter(m => m.round === roundName && m.side === side)
    // sort by y so they appear in correct order within column container
    .sort((a, b) => a.y - b.y);

  for (const m of ms) {
    renderMatchCard(m, col);
  }
}

function renderMatchCard(m, parent) {
  const card = createDiv(parent, "match");
  card.dataset.matchId = String(m.id);

  // Absolute position inside the BRACKET WRAP, not inside column
  // We’ll position via transform with a wrapper alignment trick:
  // Set card position absolute relative to .bracket-wrap
  card.style.position = "absolute";
  card.style.left = `${m.x}px`;
  card.style.top = `${m.y}px`;
  card.style.width = `${CARD_W}px`;

  // Team rows (clickable)
  const a = buildTeamRow(m, "A");
  const b = buildTeamRow(m, "B");
  card.appendChild(a);
  card.appendChild(b);

  // Attach to wrap instead of parent column so lines map correctly in one coordinate system
  el.wrap.appendChild(card);
}

function buildTeamRow(match, slot) {
  const teamName = slot === "A" ? match.teamA : match.teamB;
  const row = createDiv(null, "teamrow");

  const abbr = makeAbbr(teamName);
  const logo = createDiv(row, "logoBox");
  logo.textContent = abbr;

  const name = createDiv(row, "nameBox");
  name.textContent = teamName || "TBD";

  const score = createDiv(row, "scoreBox");
  score.textContent = ""; // you can later show scores, not used in predictor

  // Disable if empty/TBD
  if (!teamName) row.classList.add("disabled");

  // Pick highlight
  const pick = picks.get(match.id);
  if (pick && teamName && pick === teamName) row.classList.add("picked");
  if (pick && teamName && pick !== teamName) row.classList.add("loser");

  // Click to pick
  row.addEventListener("click", () => {
    if (!teamName) return;
    setPick(match.id, teamName);
  });

  return row;
}

function setPick(matchId, winnerName) {
  picks.set(matchId, winnerName);

  // Recompute downstream teams based on picks
  propagateAllPicks();

  // Re-layout because positions might not change, but lines and labels will
  // (keeping your “way typed” stable)
  // We do not re-fetch; we re-render from local state.
  clearAllRenderedMatches();
  renderBracket();
}

function clearAllRenderedMatches() {
  // remove old match cards
  const cards = el.wrap.querySelectorAll(".match");
  cards.forEach(c => c.remove());
}

/* =========================
   LAYOUT ENGINE (GRAPH-BASED)
   This is the key to “make your way work”.
   - Play-In is anchored by order in sheet (within side)
   - Every later match is positioned at midpoint of its feeder matches
   - Right side mirrors inward
   ========================= */
function layoutSide(side, rounds, isLeftToRight) {
  const finalId = findFinalMatchId();

  // group matches by round for this side
  const byRound = new Map();
  for (const r of rounds) byRound.set(r, []);
  for (const m of matches) {
    if (m.side !== side) continue;
    if (!byRound.has(m.round)) continue;
    byRound.get(m.round).push(m);
  }

  // Determine X positions per round, inward toward center
  // We’ll lay out with local x from LEFT_PAD and later shift right side.
  const colW = CARD_W + 40;
  const gapX = ROUND_GAP_X;

  // Compute base X for side columns
  const totalCols = rounds.length;
  const sideWidth = totalCols * colW + (totalCols - 1) * gapX;

  // We need global positions:
  // Left side starts at LEFT_PAD
  // Right side starts after left + final + gap, but we’ll compute after both sides
  // For now: left uses positive, right uses placeholder; we’ll adjust right later.

  // 1) Anchor earliest round (Play-In) using sheet order within side
  // Sort stable by MatchID (or by sheet row order, which OpenSheet gives in order)
  const firstRound = rounds[0];
  const baseList = byRound.get(firstRound).slice();

  // Anchor Y positions
  baseList.forEach((m, i) => {
    m.y = TOP_PAD + i * (CARD_H + MIN_GAP_Y);
  });

  // 2) For later rounds: set Y = midpoint of feeders if feeders exist
  for (let idx = 1; idx < rounds.length; idx++) {
    const r = rounds[idx];
    const list = byRound.get(r);

    // Initial guess: keep current y ordering if none
    list.sort((a, b) => a.id - b.id);

    for (const m of list) {
      const feeders = incoming.get(m.id) || [];
      const feedersInSide = feeders
        .map(f => matchById.get(f.fromId))
        .filter(x => x && x.side === side);

      if (feedersInSide.length === 2) {
        const yMid = (feedersInSide[0].y + feedersInSide[1].y) / 2;
        m.y = yMid;
      } else if (feedersInSide.length === 1) {
        m.y = feedersInSide[0].y; // single feeder: follow it
      } else {
        // no feeders: keep relative order
        // (seeded entries can be here)
        // If y not set, set based on index
        if (!Number.isFinite(m.y)) m.y = TOP_PAD + list.indexOf(m) * (CARD_H + MIN_GAP_Y);
      }
    }

    // 3) Resolve collisions within the round column
    resolveVerticalCollisions(list, CARD_H + MIN_GAP_Y);
  }

  // 4) Set X positions
  // Left side: columns increase x to the right (toward center)
  // Right side: columns decrease x to the left (toward center)
  // We don’t know global right origin yet, so we compute local and shift later.
  rounds.forEach((r, i) => {
    const xLocal = isLeftToRight
      ? (LEFT_PAD + i * (colW + gapX))
      : (LEFT_PAD + (totalCols - 1 - i) * (colW + gapX));

    for (const m of byRound.get(r)) {
      // Put cards under header: shift down slightly
      m.x = xLocal + 20;
      m.y = m.y + 40; // header space
    }
  });

  // Bounds
  const all = rounds.flatMap(r => byRound.get(r));
  const minX = Math.min(...all.map(m => m.x), Infinity);
  const maxX = Math.max(...all.map(m => m.x + CARD_W), -Infinity);
  const minY = Math.min(...all.map(m => m.y), Infinity);
  const maxY = Math.max(...all.map(m => m.y + CARD_H), -Infinity);
  const midY = (minY + maxY) / 2;

  return { byRound, bounds: { minX, maxX, minY, maxY, midY } };
}

function resolveVerticalCollisions(list, minDist) {
  // list already has y set; enforce minimum spacing top-down
  list.sort((a, b) => a.y - b.y);
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    const cur = list[i];
    if (cur.y < prev.y + minDist) {
      cur.y = prev.y + minDist;
    }
  }
}

/* =========================
   LINES (SVG)
   Connect from match to its NextMatch slot (A/B)
   ========================= */
function drawLines() {
  clearSvg(el.lines);

  // Need accurate card positions (after render)
  for (const m of matches) {
    if (!m.nextMatchId || !m.nextSlot) continue;

    const from = el.wrap.querySelector(`.match[data-match-id="${m.id}"]`);
    const to = el.wrap.querySelector(`.match[data-match-id="${m.nextMatchId}"]`);
    if (!from || !to) continue;

    const fromBox = from.getBoundingClientRect();
    const toBox = to.getBoundingClientRect();
    const wrapBox = el.wrap.getBoundingClientRect();

    // Convert to wrap-local coords
    const fx1 = fromBox.left - wrapBox.left;
    const fy1 = fromBox.top - wrapBox.top;

    const tx1 = toBox.left - wrapBox.left;
    const ty1 = toBox.top - wrapBox.top;

    // Start point: right edge if to is right, else left edge
    const fromCenterY = fy1 + CARD_H / 2;

    const goingRight = tx1 > fx1;
    const startX = goingRight ? (fx1 + CARD_W) : fx1;
    const endX = goingRight ? tx1 : (tx1 + CARD_W);

    // End point: slot A is top row midpoint, slot B bottom row midpoint
    const slotYOffset = (m.nextSlot === "A") ? (ROW_H / 2) : (ROW_H + ROW_H / 2);
    const endY = ty1 + slotYOffset;

    const startY = fromCenterY;

    // nice bracket curve
    const midX = (startX + endX) / 2;

    const d = `M ${startX} ${startY}
               C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "rgba(0,0,0,0.55)");
    path.setAttribute("stroke-width", "2.5");
    path.setAttribute("stroke-linecap", "round");
    el.lines.appendChild(path);
  }

  fitSvgToContent();
}

function fitSvgToContent() {
  // Ensure SVG covers entire wrap content area
  const box = el.wrap.getBoundingClientRect();
  el.lines.setAttribute("width", box.width);
  el.lines.setAttribute("height", box.height);
  el.lines.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
  el.lines.style.position = "absolute";
  el.lines.style.left = "0";
  el.lines.style.top = "0";
  el.lines.style.pointerEvents = "none";
}

function clearSvg(svg) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

/* =========================
   ZOOM / FIT
   ========================= */
function setZoom(v) {
  zoom = clamp(v, ZOOM_MIN, ZOOM_MAX);
  el.wrap.style.transform = `scale(${zoom})`;
}

function fitToStage(onlyIfUnset = false) {
  // Fit bracket into stage viewport
  // Compute content bounds based on rendered cards
  const cards = Array.from(el.wrap.querySelectorAll(".match"));
  if (!cards.length) return;

  const wrapRect = el.wrap.getBoundingClientRect();
  const stageRect = el.stage.getBoundingClientRect();

  // Find content bounding box in wrap-local coords (using style left/top)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cards) {
    const x = parseFloat(c.style.left || "0");
    const y = parseFloat(c.style.top || "0");
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + CARD_W);
    maxY = Math.max(maxY, y + CARD_H);
  }

  const contentW = maxX - minX + 60;
  const contentH = maxY - minY + 60;

  const availW = stageRect.width - 40;
  const availH = stageRect.height - 40;

  const z = clamp(Math.min(availW / contentW, availH / contentH), ZOOM_MIN, ZOOM_MAX);

  // If onlyIfUnset and zoom already user-changed, skip
  if (onlyIfUnset && zoom !== 1.0) {
    // still ensure transform applied
    setZoom(zoom);
    return;
  }

  zoom = z;
  el.wrap.style.transform = `scale(${zoom})`;
}

/* =========================
   SUBMIT / SYNC / LEADERBOARD
   (Best-effort: depends on your Apps Script endpoints)
   ========================= */
async function submitPredictions() {
  const username = (el.nameInput?.value || "").trim();
  if (!username) {
    alert("Enter your name first (exact spelling).");
    return;
  }

  // Build payload: list of {MatchID, Winner}
  const payload = [];
  for (const [id, winner] of picks.entries()) {
    if (!winner) continue;
    payload.push({ MatchID: id, Winner: winner });
  }

  try {
    const res = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "submitPredictions", username, picks: payload }),
    });

    const txt = await res.text();
    if (!res.ok) throw new Error(txt || `HTTP ${res.status}`);
    await loadLeaderboard().catch(() => {});
    alert("Predictions submitted ✅");
  } catch (e) {
    alert(`Submit failed: ${e.message}`);
  }
}

async function syncBracket() {
  try {
    const res = await fetch(`${SCRIPT_URL}?action=syncBracket&t=${Date.now()}`, { method: "GET" });
    const txt = await res.text();
    if (!res.ok) throw new Error(txt || `HTTP ${res.status}`);
    await refreshAll(true);
  } catch (e) {
    alert(`Sync failed: ${e.message}`);
  }
}

async function loadLeaderboard() {
  if (!el.leaderboard) return;
  const res = await fetch(`${LEADERBOARD_URL}?t=${Date.now()}`);
  if (!res.ok) return;
  const data = await res.json();

  // Expect rows like {Username, Points}
  const rows = (Array.isArray(data) ? data : [])
    .map(r => ({
      user: String(r.Username ?? r.username ?? "").trim(),
      points: String(r.Points ?? r.points ?? "").trim(),
    }))
    .filter(r => r.user);

  el.leaderboard.innerHTML = "";
  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "lb-row";
    li.innerHTML = `<div class="lb-user">No entries yet.</div><div class="lb-points"></div>`;
    el.leaderboard.appendChild(li);
    return;
  }

  rows.forEach(r => {
    const li = document.createElement("li");
    li.className = "lb-row";
    li.innerHTML = `<div class="lb-user">${escapeHtml(r.user)}</div><div class="lb-points">${escapeHtml(r.points)} pts</div>`;
    el.leaderboard.appendChild(li);
  });
}

/* =========================
   HELPERS
   ========================= */
function createDiv(parent, cls) {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  if (parent) parent.appendChild(d);
  return d;
}

function findButton(text) {
  const btns = Array.from(document.querySelectorAll("button"));
  return btns.find(b => (b.textContent || "").trim().toLowerCase() === text.toLowerCase());
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function makeAbbr(name) {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}
