// ======================================
// CONFIG – EDIT THESE TWO ONLY
// ======================================
const SHEET_ID = "1ilDa0ZleooN3OBruvtOqF9Ym1CitowFjaLCk1GiYiNc";
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbywemgGWVB87gFdGZGax7mbJ8U6cIoVxI0pYBJMz-Da66SR_qhknP2ogOISs1WtbGjbbg/exec";

const MATCHES_URL = `https://opensheet.elk.sh/${SHEET_ID}/Matches`;
const LEADERBOARD_URL = `https://opensheet.elk.sh/${SHEET_ID}/Leaderboard`;

const ROUND_ORDER = ["R32", "R16", "Quarter", "Semi", "Final"];

// sizing
const COL_WIDTH = 360;
const CARD_WIDTH = 320;
const HEADER_H = 62;
const TOP_PAD = 14;
const BASE_STEP = 130;
const MIN_GAP = 18;

let matches = [];
const picksByMatch = new Map();

let userZoom = 1;
let fittedZoom = 1;
let currentScale = 1;

window.fitBracket = fitBracket;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.submitPredictions = submitPredictions;
window.loadLeaderboard = loadLeaderboard;
window.syncBracketToSheet = syncBracketToSheet;

loadAll();
window.addEventListener("resize", () => {
  renderBracket();
  fitBracket();
});

// ======================================
// LOADERS
// ======================================
function loadAll() {
  Promise.all([loadMatches(), loadLeaderboard()])
    .then(() => {
      syncBracketToSheet();
      setTimeout(fitBracket, 50);
    })
    .catch(() => {});
}

function loadMatches() {
  return fetch(MATCHES_URL)
    .then(r => r.json())
    .then(data => {
      matches = Array.isArray(data) ? data : [];
      renderBracket();
      fitBracket();
    })
    .catch(() => {
      matches = [];
      renderBracket();
    });
}

function loadLeaderboard() {
  return fetch(LEADERBOARD_URL)
    .then(r => r.json())
    .then(data => renderLeaderboard(Array.isArray(data) ? data : []))
    .catch(() => renderLeaderboard([]));
}

// ======================================
// HELPERS
// ======================================
function safe(v) { return (v ?? "").toString().trim(); }

function initials(name) {
  return safe(name)
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join("");
}

function isBlankSlot(team) {
  const t = safe(team).toLowerCase();
  return t === "" || t === "tbd" || t === "?" || t === "null" || t === "undefined";
}

function sortRounds(foundRounds) {
  const set = new Set(foundRounds);
  const ordered = ROUND_ORDER.filter(r => set.has(r));
  const extra = [...set].filter(r => !ROUND_ORDER.includes(r)).sort();
  return [...ordered, ...extra];
}

function groupByRound(matchList) {
  const groups = {};
  matchList.forEach(m => {
    const round = safe(m.Round) || "Unknown";
    if (!groups[round]) groups[round] = [];
    groups[round].push(m);
  });
  Object.keys(groups).forEach(r => {
    groups[r].sort((a, b) => Number(a.MatchID) - Number(b.MatchID));
  });
  return groups;
}

// Map: MatchID -> { nextMatchId, nextSlot }
function buildNextMap() {
  const map = new Map();
  matches.forEach(m => {
    const id = safe(m.MatchID);
    const nextId = safe(m.NextMatchID);
    const slot = safe(m.NextSlot).toUpperCase();
    if (!id || !nextId) return;
    if (slot !== "A" && slot !== "B") return;
    map.set(id, { nextMatchId: nextId, nextSlot: slot });
  });
  return map;
}

// Inverse: destMatchId -> { A: sourceId, B: sourceId }
function buildDestSources(nextMap) {
  const destSources = new Map();
  nextMap.forEach((link, fromId) => {
    const destId = safe(link.nextMatchId);
    if (!destSources.has(destId)) destSources.set(destId, {});
    destSources.get(destId)[link.nextSlot] = fromId;
  });
  return destSources;
}

// Side assignment: split each round list in half. Final is center.
function buildSideMap(groups, rounds) {
  const sideById = new Map();
  rounds.forEach(r => {
    const list = groups[r] || [];
    if (!list.length) return;

    if (r.toLowerCase() === "final") {
      list.forEach(m => sideById.set(safe(m.MatchID), "C"));
      return;
    }

    const half = Math.ceil(list.length / 2);
    list.forEach((m, idx) => sideById.set(safe(m.MatchID), idx < half ? "L" : "R"));
  });
  return sideById;
}

// Predicted teams flow forward based on picks
function computePredictedTeams(nextMap) {
  const predicted = new Map();
  matches.forEach(m => predicted.set(safe(m.MatchID), { teamA: safe(m.TeamA), teamB: safe(m.TeamB) }));

  for (let pass = 0; pass < 8; pass++) {
    matches.forEach(m => {
      const fromId = safe(m.MatchID);
      const link = nextMap.get(fromId);
      if (!link) return;

      const fromTeams = predicted.get(fromId) || { teamA: safe(m.TeamA), teamB: safe(m.TeamB) };
      const pick = safe(picksByMatch.get(fromId));
      if (!pick) return;
      if (pick !== fromTeams.teamA && pick !== fromTeams.teamB) return;

      const destId = safe(link.nextMatchId);
      const slot = link.nextSlot;
      const destCurrent = predicted.get(destId) || { teamA: "", teamB: "" };

      if (slot === "A") {
        if (isBlankSlot(destCurrent.teamA)) predicted.set(destId, { teamA: pick, teamB: destCurrent.teamB });
      } else {
        if (isBlankSlot(destCurrent.teamB)) predicted.set(destId, { teamA: destCurrent.teamA, teamB: pick });
      }
    });
  }

  return predicted;
}

// ======================================
// RENDER: Left triangle + Right triangle -> Final
// ======================================
function renderBracket() {
  const columnsEl = document.getElementById("columns");
  const svg = document.getElementById("lines");
  const wrap = document.getElementById("bracketWrap");
  if (!columnsEl || !svg || !wrap) return;

  columnsEl.innerHTML = "";
  svg.innerHTML = "";
  if (!matches.length) return;

  const groups = groupByRound(matches);
  const rounds = sortRounds(Object.keys(groups));
  const nextMap = buildNextMap();
  const destSources = buildDestSources(nextMap);
  const predictedTeams = computePredictedTeams(nextMap);
  const sideById = buildSideMap(groups, rounds);

  const finalRoundName = rounds.find(r => r.toLowerCase() === "final") || "Final";
  const sideRounds = rounds.filter(r => r !== finalRoundName);

  // panes
  columnsEl.style.display = "flex";
  columnsEl.style.alignItems = "flex-start";
  columnsEl.style.justifyContent = "space-between";
  columnsEl.style.gap = "28px";

  const leftPane = document.createElement("div");
  const centerPane = document.createElement("div");
  const rightPane = document.createElement("div");

  [leftPane, centerPane, rightPane].forEach(p => {
    p.style.display = "flex";
    p.style.flexDirection = "row";
    p.style.alignItems = "flex-start";
    p.style.gap = "12px";
  });

  leftPane.style.flex = "1 1 0";
  centerPane.style.flex = "0 0 auto";
  rightPane.style.flex = "1 1 0";
  rightPane.style.justifyContent = "flex-end";

  columnsEl.appendChild(leftPane);
  columnsEl.appendChild(centerPane);
  columnsEl.appendChild(rightPane);

  const matchCardById = new Map();

  // LEFT triangle: outer -> inner (R32 ... Semi)
  sideRounds.forEach(r => {
    const col = buildRoundColumn(r, groups, predictedTeams, matchCardById);
    filterRoundCardsBySide(col, sideById, "L");
    leftPane.appendChild(col);
  });

  // CENTER: Final
  const finalCol = buildRoundColumn(finalRoundName, groups, predictedTeams, matchCardById);
  filterRoundCardsBySide(finalCol, sideById, "C");
  centerPane.appendChild(finalCol);

  // RIGHT triangle: outer -> inner but mirrored
  // We still append columns reversed so that Semi sits closest to center.
  [...sideRounds].reverse().forEach(r => {
    const col = buildRoundColumn(r, groups, predictedTeams, matchCardById);
    filterRoundCardsBySide(col, sideById, "R");
    rightPane.appendChild(col);
  });

  const anyCard = columnsEl.querySelector(".match");
  const cardH = anyCard ? anyCard.offsetHeight : 92;

  // --- Triangular vertical placement ---
  // We must compute y-centers based on FEEDER MIDPOINTS, but do it per side.
  const yCenterById = new Map();

  // Helper to stack a base round side list
  function stackBase(list) {
    list.forEach((m, i) => {
      yCenterById.set(safe(m.MatchID), HEADER_H + TOP_PAD + cardH / 2 + i * BASE_STEP);
    });
  }

  // Base round is earliest (usually R32)
  const baseRound = sideRounds[0] || rounds[0];
  const baseList = groups[baseRound] || [];

  stackBase(baseList.filter(m => sideById.get(safe(m.MatchID)) === "L"));
  stackBase(baseList.filter(m => sideById.get(safe(m.MatchID)) === "R"));

  // For later rounds on each side, set y = midpoint of its two feeder matches
  for (let i = 1; i < sideRounds.length; i++) {
    const r = sideRounds[i];
    const list = groups[r] || [];

    ["L", "R"].forEach(side => {
      const sideList = list.filter(m => sideById.get(safe(m.MatchID)) === side);
      let fallbackIndex = 0;

      sideList.forEach(m => {
        const mid = safe(m.MatchID);
        const feeders = destSources.get(mid) || {};
        const aSrc = feeders.A ? safe(feeders.A) : "";
        const bSrc = feeders.B ? safe(feeders.B) : "";

        const yA = aSrc ? yCenterById.get(aSrc) : null;
        const yB = bSrc ? yCenterById.get(bSrc) : null;

        let yCenter;
        if (typeof yA === "number" && typeof yB === "number") yCenter = (yA + yB) / 2;
        else yCenter = HEADER_H + TOP_PAD + cardH / 2 + fallbackIndex++ * Math.max(BASE_STEP, cardH + MIN_GAP);

        yCenterById.set(mid, yCenter);
      });
    });
  }

  // Final y centered between its two feeder semis (usually L semi + R semi)
  (groups[finalRoundName] || []).forEach(m => {
    const mid = safe(m.MatchID);
    const feeders = destSources.get(mid) || {};
    const aSrc = feeders.A ? safe(feeders.A) : "";
    const bSrc = feeders.B ? safe(feeders.B) : "";
    const yA = aSrc ? yCenterById.get(aSrc) : null;
    const yB = bSrc ? yCenterById.get(bSrc) : null;

    if (typeof yA === "number" && typeof yB === "number") yCenterById.set(mid, (yA + yB) / 2);
    else if (typeof yA === "number") yCenterById.set(mid, yA);
    else if (typeof yB === "number") yCenterById.set(mid, yB);
    else yCenterById.set(mid, HEADER_H + TOP_PAD + cardH / 2);
  });

  // Apply positions to cards
  columnsEl.querySelectorAll(".round").forEach(roundEl => {
    let maxBottom = HEADER_H + TOP_PAD;
    const cards = [...roundEl.querySelectorAll(".match")];
    let fallbackIndex = 0;

    cards.forEach(card => {
      const mid = safe(card.dataset.matchId);
      const yCenter = yCenterById.get(mid) ?? (HEADER_H + TOP_PAD + cardH / 2 + fallbackIndex++ * BASE_STEP);
      const top = Math.max(HEADER_H + TOP_PAD, yCenter - cardH / 2);
      card.style.left = `${(COL_WIDTH - CARD_WIDTH) / 2}px`;
      card.style.top = `${top}px`;
      maxBottom = Math.max(maxBottom, top + cardH);
    });

    roundEl.style.minHeight = `${maxBottom + 30}px`;
  });

  // Update wrap & svg
  const contentW = columnsEl.scrollWidth + 30;
  const contentH = columnsEl.scrollHeight + 240;
  wrap.style.width = `${contentW}px`;
  wrap.style.height = `${contentH}px`;
  svg.setAttribute("width", contentW);
  svg.setAttribute("height", contentH);

  // Draw lines (direction-aware) so right side mirrors correctly
  nextMap.forEach((link, fromId) => {
    const fromCard = matchCardById.get(fromId);
    const toCard = matchCardById.get(safe(link.nextMatchId));
    if (!fromCard || !toCard) return;
    drawMappedConnectorDirectional(svg, wrap, fromCard, toCard, link.nextSlot);
  });
}

function buildRoundColumn(roundName, groups, predictedTeams, matchCardById) {
  const roundEl = document.createElement("div");
  roundEl.className = "round";

  const header = document.createElement("div");
  header.className = "round-header";
  header.textContent = roundName;
  roundEl.appendChild(header);

  (groups[roundName] || []).forEach(m => {
    const matchId = safe(m.MatchID);
    const pred = predictedTeams.get(matchId) || { teamA: safe(m.TeamA), teamB: safe(m.TeamB) };

    const teamA = safe(m.TeamA) || safe(pred.teamA);
    const teamB = safe(m.TeamB) || safe(pred.teamB);

    const displayA = teamA || "TBD";
    const displayB = teamB || "TBD";

    const winner = safe(m.Winner);
    const picked = safe(picksByMatch.get(matchId));

    const aPicked = picked && picked === teamA;
    const bPicked = picked && picked === teamB;

    const card = document.createElement("div");
    card.className = "match";
    card.dataset.matchId = matchId;
    card.dataset.round = roundName;

    card.innerHTML = `
      <div class="teamrow ${aPicked ? "picked" : ""} ${displayA === "TBD" ? "disabled" : ""}"
           data-match="${escapeHtml(matchId)}" data-team="${escapeHtml(teamA)}" data-slot="A">
        <div class="logoBox">${displayA === "TBD" ? "" : initials(displayA)}</div>
        <div class="nameBox">${escapeHtml(displayA)}</div>
        <div class="scoreBox">${aPicked ? "✓" : ""}</div>
      </div>
      <div class="teamrow ${bPicked ? "picked" : ""} ${displayB === "TBD" ? "disabled" : ""}"
           data-match="${escapeHtml(matchId)}" data-team="${escapeHtml(teamB)}" data-slot="B">
        <div class="logoBox">${displayB === "TBD" ? "" : initials(displayB)}</div>
        <div class="nameBox">${escapeHtml(displayB)}</div>
        <div class="scoreBox">${bPicked ? "✓" : ""}</div>
      </div>
    `;

    card.querySelectorAll(".teamrow").forEach(row => {
      row.addEventListener("click", () => {
        const mid = safe(row.getAttribute("data-match"));
        const team = safe(row.getAttribute("data-team"));
        if (!mid || !team) return;
        if (isBlankSlot(team)) return;
        if (winner) return;
        picksByMatch.set(mid, team);
        renderBracket();
        fitBracket();
      });
    });

    roundEl.appendChild(card);
    matchCardById.set(matchId, card);
  });

  return roundEl;
}

function filterRoundCardsBySide(roundEl, sideById, wantedSide) {
  [...roundEl.querySelectorAll(".match")].forEach(card => {
    const mid = safe(card.dataset.matchId);
    const side = sideById.get(mid) || "L";
    if (side !== wantedSide) card.remove();
  });
}

// Direction-aware connector: fixes right side lines
function drawMappedConnectorDirectional(svg, wrap, fromCard, toCard, toSlot) {
  const scale = currentScale || 1;

  const w = wrap.getBoundingClientRect();
  const rf = fromCard.getBoundingClientRect();

  const targetRow =
    toSlot === "A"
      ? toCard.querySelector('.teamrow[data-slot="A"]')
      : toCard.querySelector('.teamrow[data-slot="B"]');

  const rr = (targetRow ? targetRow.getBoundingClientRect() : toCard.getBoundingClientRect());

  const fromCX = (rf.left + rf.right) / 2;
  const toCX = (rr.left + rr.right) / 2;
  const goingRight = toCX >= fromCX;

  const sx = (goingRight ? (rf.right - w.left) : (rf.left - w.left)) / scale;
  const sy = (rf.top - w.top + rf.height / 2) / scale;

  const tx = (goingRight ? (rr.left - w.left) : (rr.right - w.left)) / scale;
  const ty = (rr.top - w.top + rr.height / 2) / scale;

  const elbow = 30;
  const midX = goingRight ? (sx + elbow) : (sx - elbow);

  const segs = [
    `M ${sx} ${sy} L ${midX} ${sy}`,
    `M ${midX} ${sy} L ${midX} ${ty}`,
    `M ${midX} ${ty} L ${tx} ${ty}`
  ];

  segs.forEach(d => {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    p.setAttribute("stroke", "rgba(0,0,0,0.60)");
    p.setAttribute("stroke-width", "3");
    p.setAttribute("fill", "none");
    svg.appendChild(p);
  });
}

// ======================================
// FIT + ZOOM
// ======================================
function fitBracket() {
  const stage = document.getElementById("stage");
  const wrap = document.getElementById("bracketWrap");
  const columns = document.getElementById("columns");
  if (!stage || !wrap || !columns) return;

  const contentW = columns.scrollWidth + 40;
  const contentH = columns.scrollHeight + 240;

  const viewW = stage.clientWidth - 28;
  const viewH = stage.clientHeight - 28;

  fittedZoom = Math.max(0.35, Math.min(viewW / contentW, viewH / contentH, 1));
  applyZoom();
}

function applyZoom() {
  const wrap = document.getElementById("bracketWrap");
  if (!wrap) return;
  currentScale = fittedZoom * userZoom;
  wrap.style.transform = `scale(${currentScale})`;
}

function zoomIn() { userZoom = Math.min(2.0, userZoom + 0.1); applyZoom(); renderBracket(); }
function zoomOut() { userZoom = Math.max(0.4, userZoom - 0.1); applyZoom(); renderBracket(); }

// ======================================
// SYNC OFFICIAL WINNERS INTO SHEET
// ======================================
function syncBracketToSheet() {
  if (!matches.length) return;

  const nextMap = buildNextMap();
  if (nextMap.size === 0) return;

  const updatesByDest = new Map();
  matches.forEach(m => {
    const fromId = safe(m.MatchID);
    const link = nextMap.get(fromId);
    if (!link) return;

    const win = safe(m.Winner);
    if (!win) return;

    const destId = safe(link.nextMatchId);
    if (!updatesByDest.has(destId)) updatesByDest.set(destId, {});
    const u = updatesByDest.get(destId);
    if (link.nextSlot === "A") u.teamA = win;
    if (link.nextSlot === "B") u.teamB = win;
  });

  const payloads = [];
  updatesByDest.forEach((u, destId) => {
    if (!u.teamA || !u.teamB) return;
    payloads.push({ type: "setMatchTeams", matchId: destId, teamA: u.teamA, teamB: u.teamB });
  });

  if (!payloads.length) return;

  let chain = Promise.resolve();
  payloads.forEach(p => {
    chain = chain.then(() => fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify(p), mode: "no-cors" }));
  });

  chain.then(() => loadMatches()).catch(() => {});
}

// ======================================
// SUBMIT PREDICTIONS
// ======================================
function submitPredictions() {
  const user = safe(document.getElementById("username")?.value);
  if (!user) return alert("Enter your username first.");

  const rows = [];
  matches.forEach(m => {
    const mid = safe(m.MatchID);
    const pick = safe(picksByMatch.get(mid));
    if (pick) rows.push([new Date().toISOString(), user, mid, pick]);
  });

  if (!rows.length) return alert("Pick at least one match.");

  Promise.all(rows.map(row => {
    const payload = { type: "appendPrediction", row };
    return fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify(payload), mode: "no-cors" });
  }))
    .then(() => { alert("Predictions submitted!"); loadLeaderboard(); })
    .catch(() => alert("Submission failed. Check Apps Script deployment."));
}

// ======================================
// LEADERBOARD
// ======================================
function renderLeaderboard(data) {
  const ul = document.getElementById("leaderboard");
  if (!ul) return;

  ul.innerHTML = "";

  if (!data.length) {
    ul.innerHTML = `<li style="opacity:.8">No entries yet.</li>`;
    return;
  }

  data.forEach(p => {
    const user = safe(p.Username) || "Unknown";
    const ptsRaw = safe(p.Points);
    const pts = (!ptsRaw || ptsRaw.toUpperCase() === "#N/A") ? "0" : ptsRaw;

    ul.innerHTML += `
      <li class="lb-row">
        <span class="lb-user">${escapeHtml(user)}</span>
        <span class="lb-points">${escapeHtml(pts)} pts</span>
      </li>
    `;
  });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
