// ======================================
// CONFIG – EDIT THESE TWO ONLY
// ======================================
const SHEET_ID = "1ilDa0ZleooN3OBruvtOqF9Ym1CitowFjaLCk1GiYiNc";
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbywemgGWVB87gFdGZGax7mbJ8U6cIoVxI0pYBJMz-Da66SR_qhknP2ogOISs1WtbGjbbg/exec";

const MATCHES_URL = `https://opensheet.elk.sh/${SHEET_ID}/Matches`;
const LEADERBOARD_URL = `https://opensheet.elk.sh/${SHEET_ID}/Leaderboard`;

const ROUND_ORDER = ["R32", "R16", "Quarter", "Semi", "Final"];

// sizing (vertically denser)
const COL_WIDTH = 330;
const CARD_WIDTH = 320;
const HEADER_H = 58;
const TOP_PAD = 10;
const BASE_STEP = 92;   // ✅ denser vertically
const MIN_GAP = 10;

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

function isBye(team) { return safe(team).toLowerCase() === "bye"; }

function autoByePick(teamA, teamB) {
  const aBye = isBye(teamA);
  const bBye = isBye(teamB);
  if (aBye && !bBye && !isBlankSlot(teamB)) return safe(teamB);
  if (bBye && !aBye && !isBlankSlot(teamA)) return safe(teamA);
  return "";
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

function buildDestSources(nextMap) {
  const destSources = new Map();
  nextMap.forEach((link, fromId) => {
    const destId = safe(link.nextMatchId);
    if (!destSources.has(destId)) destSources.set(destId, {});
    destSources.get(destId)[link.nextSlot] = fromId;
  });
  return destSources;
}

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

// ======================================
// PREDICTED FLOW (manual + BYE auto)
// ======================================
function computePredictedTeams(nextMap) {
  const predicted = new Map();

  matches.forEach(m => {
    predicted.set(safe(m.MatchID), { teamA: safe(m.TeamA), teamB: safe(m.TeamB) });
  });

  for (let pass = 0; pass < 10; pass++) {
    matches.forEach(m => {
      const fromId = safe(m.MatchID);
      const link = nextMap.get(fromId);
      if (!link) return;

      const fromTeams = predicted.get(fromId) || { teamA: safe(m.TeamA), teamB: safe(m.TeamB) };
      const tA = safe(fromTeams.teamA);
      const tB = safe(fromTeams.teamB);

      const manualPick = safe(picksByMatch.get(fromId));
      const byePick = autoByePick(tA, tB);
      const pick = manualPick || byePick;

      if (!pick) return;
      if (pick !== tA && pick !== tB) return;

      const destId = safe(link.nextMatchId);
      const slot = link.nextSlot;
      const destCurrent = predicted.get(destId) || { teamA: "", teamB: "" };

      if (slot === "A") {
        if (isBlankSlot(destCurrent.teamA) || isBye(destCurrent.teamA)) {
          predicted.set(destId, { teamA: pick, teamB: destCurrent.teamB });
        }
      } else {
        if (isBlankSlot(destCurrent.teamB) || isBye(destCurrent.teamB)) {
          predicted.set(destId, { teamA: destCurrent.teamA, teamB: pick });
        }
      }
    });
  }

  return predicted;
}

// ======================================
// COORDS (within wrap, immune to scale)
// ======================================
function getOffsetWithinWrap(el, wrap) {
  const rEl = el.getBoundingClientRect();
  const rWrap = wrap.getBoundingClientRect();
  // return in *unscaled* wrap coordinates
  const x = (rEl.left - rWrap.left) / (currentScale || 1);
  const y = (rEl.top - rWrap.top) / (currentScale || 1);
  const w = rEl.width / (currentScale || 1);
  const h = rEl.height / (currentScale || 1);
  return { x, y, w, h };
}

// ======================================
// RENDER (two triangles -> Final)
// ======================================
function renderBracket() {
  const columnsEl = document.getElementById("columns");
  const svg = document.getElementById("lines");
  const wrap = document.getElementById("bracketWrap");
  if (!columnsEl || !svg || !wrap) return;

  columnsEl.innerHTML = "";
  svg.innerHTML = "";
  if (!matches.length) return;

  // ✅ ensure SVG sits above the cards and spans the wrap
  wrap.style.position = "relative";
  svg.style.position = "absolute";
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.pointerEvents = "none";
  svg.style.zIndex = "5";

  const groups = groupByRound(matches);
  const rounds = sortRounds(Object.keys(groups));
  const nextMap = buildNextMap();
  const destSources = buildDestSources(nextMap);
  const predictedTeams = computePredictedTeams(nextMap);
  const sideById = buildSideMap(groups, rounds);

  const finalRoundName = rounds.find(r => r.toLowerCase() === "final") || "Final";
  const sideRounds = rounds.filter(r => r !== finalRoundName);

  // Centered bracket for triangles
  columnsEl.style.display = "flex";
  columnsEl.style.alignItems = "flex-start";
  columnsEl.style.justifyContent = "center";
  columnsEl.style.gap = "18px";
  columnsEl.style.padding = "0 20px";
  columnsEl.style.position = "relative";
  columnsEl.style.zIndex = "2";

  const leftPane = document.createElement("div");
  const centerPane = document.createElement("div");
  const rightPane = document.createElement("div");

  [leftPane, centerPane, rightPane].forEach(p => {
    p.style.display = "flex";
    p.style.flexDirection = "row";
    p.style.alignItems = "flex-start";
    p.style.gap = "8px";
    p.style.flex = "0 0 auto";
  });

  columnsEl.appendChild(leftPane);
  columnsEl.appendChild(centerPane);
  columnsEl.appendChild(rightPane);

  const matchCardById = new Map();

  // LEFT
  sideRounds.forEach(r => {
    const col = buildRoundColumn(r, groups, predictedTeams, matchCardById);
    filterRoundCardsBySide(col, sideById, "L");
    leftPane.appendChild(col);
  });

  // CENTER Final
  const finalCol = buildRoundColumn(finalRoundName, groups, predictedTeams, matchCardById);
  filterRoundCardsBySide(finalCol, sideById, "C");
  centerPane.appendChild(finalCol);

  // RIGHT (reversed)
  [...sideRounds].reverse().forEach(r => {
    const col = buildRoundColumn(r, groups, predictedTeams, matchCardById);
    filterRoundCardsBySide(col, sideById, "R");
    rightPane.appendChild(col);
  });

  // Determine card height
  const anyCard = columnsEl.querySelector(".match");
  const cardH = anyCard ? anyCard.offsetHeight : 88;

  // Triangular vertical placement using feeder midpoints
  const yCenterById = new Map();

  function stackBase(list) {
    list.forEach((m, i) => {
      yCenterById.set(safe(m.MatchID), HEADER_H + TOP_PAD + cardH / 2 + i * BASE_STEP);
    });
  }

  const baseRound = sideRounds[0] || rounds[0];
  const baseList = groups[baseRound] || [];
  stackBase(baseList.filter(m => sideById.get(safe(m.MatchID)) === "L"));
  stackBase(baseList.filter(m => sideById.get(safe(m.MatchID)) === "R"));

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
        else yCenter = HEADER_H + TOP_PAD + cardH / 2 + fallbackIndex++ * (cardH + MIN_GAP);

        yCenterById.set(mid, yCenter);
      });
    });
  }

  // Final centered between semis
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

  // Apply positions
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

    roundEl.style.minHeight = `${maxBottom + 24}px`;
  });

  // Size wrap & svg
  const contentW = columnsEl.scrollWidth + 40;
  const contentH = columnsEl.scrollHeight + 260;

  wrap.style.width = `${contentW}px`;
  wrap.style.height = `${contentH}px`;

  svg.setAttribute("width", contentW);
  svg.setAttribute("height", contentH);

  // Draw lines (now stable)
  nextMap.forEach((link, fromId) => {
    const fromCard = matchCardById.get(fromId);
    const toCard = matchCardById.get(safe(link.nextMatchId));
    if (!fromCard || !toCard) return;
    drawConnectorInWrap(svg, wrap, fromCard, toCard, link.nextSlot);
  });
}

function buildRoundColumn(roundName, groups, predictedTeams, matchCardById) {
  const roundEl = document.createElement("div");
  roundEl.className = "round";
  roundEl.style.width = `${COL_WIDTH}px`;

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

    const manualPick = safe(picksByMatch.get(matchId));
    const byePick = autoByePick(displayA, displayB);
    const picked = manualPick || byePick;

    const aPicked = picked && picked === teamA && !isBye(teamA);
    const bPicked = picked && picked === teamB && !isBye(teamB);

    const aIsBye = isBye(displayA);
    const bIsBye = isBye(displayB);

    const card = document.createElement("div");
    card.className = "match";
    card.dataset.matchId = matchId;
    card.dataset.round = roundName;

    card.style.position = "relative";
    card.style.overflow = "hidden";

    const byeRowStyle = "pointer-events:none;";
    const byeLogoStyle = "visibility:hidden;";
    const byeNameStyle = "visibility:hidden;";
    const byeScoreStyle = "visibility:visible; font-size:11px; opacity:0.85; letter-spacing:0.3px;";

    card.innerHTML = `
      <div class="teamrow ${aPicked ? "picked" : ""} ${displayA === "TBD" ? "disabled" : ""} ${aIsBye ? "bye" : ""}"
           style="${aIsBye ? byeRowStyle : ""}"
           data-match="${escapeHtml(matchId)}" data-team="${escapeHtml(teamA)}" data-slot="A">
        <div class="logoBox" style="${aIsBye ? byeLogoStyle : ""}">${displayA === "TBD" || aIsBye ? "" : initials(displayA)}</div>
        <div class="nameBox" style="${aIsBye ? byeNameStyle : ""}">${escapeHtml(displayA)}</div>
        <div class="scoreBox" style="${aIsBye ? byeScoreStyle : ""}">${aIsBye ? "BYE" : (aPicked ? "✓" : "")}</div>
      </div>

      <div class="teamrow ${bPicked ? "picked" : ""} ${displayB === "TBD" ? "disabled" : ""} ${bIsBye ? "bye" : ""}"
           style="${bIsBye ? byeRowStyle : ""}"
           data-match="${escapeHtml(matchId)}" data-team="${escapeHtml(teamB)}" data-slot="B">
        <div class="logoBox" style="${bIsBye ? byeLogoStyle : ""}">${displayB === "TBD" || bIsBye ? "" : initials(displayB)}</div>
        <div class="nameBox" style="${bIsBye ? byeNameStyle : ""}">${escapeHtml(displayB)}</div>
        <div class="scoreBox" style="${bIsBye ? byeScoreStyle : ""}">${bIsBye ? "BYE" : (bPicked ? "✓" : "")}</div>
      </div>
    `;

    card.querySelectorAll(".teamrow").forEach(row => {
      row.addEventListener("click", () => {
        const mid = safe(row.getAttribute("data-match"));
        const team = safe(row.getAttribute("data-team"));
        if (!mid || !team) return;
        if (isBlankSlot(team) || isBye(team)) return;
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

// ✅ Lines drawn in wrap-space (always visible, always aligned)
function drawConnectorInWrap(svg, wrap, fromCard, toCard, toSlot) {
  const fromBox = getOffsetWithinWrap(fromCard, wrap);

  const targetRow =
    toSlot === "A"
      ? toCard.querySelector('.teamrow[data-slot="A"]')
      : toCard.querySelector('.teamrow[data-slot="B"]');

  const toBox = targetRow ? getOffsetWithinWrap(targetRow, wrap) : getOffsetWithinWrap(toCard, wrap);

  const fromCX = fromBox.x + fromBox.w / 2;
  const toCX = toBox.x + toBox.w / 2;
  const goingRight = toCX >= fromCX;

  const sx = goingRight ? (fromBox.x + fromBox.w) : fromBox.x;
  const sy = fromBox.y + fromBox.h / 2;

  const tx = goingRight ? toBox.x : (toBox.x + toBox.w);
  const ty = toBox.y + toBox.h / 2;

  const elbow = 22;
  const midX = goingRight ? (sx + elbow) : (sx - elbow);

  const segs = [
    `M ${sx} ${sy} L ${midX} ${sy}`,
    `M ${midX} ${sy} L ${midX} ${ty}`,
    `M ${midX} ${ty} L ${tx} ${ty}`
  ];

  segs.forEach(d => {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    p.setAttribute("stroke", "rgba(0,0,0,0.70)");
    p.setAttribute("stroke-width", "3");
    p.setAttribute("fill", "none");
    p.setAttribute("stroke-linecap", "round");
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

  const nextMap = buildNextMap();
  const predictedTeams = computePredictedTeams(nextMap);

  const rows = [];
  matches.forEach(m => {
    const mid = safe(m.MatchID);
    const t = predictedTeams.get(mid) || { teamA: safe(m.TeamA), teamB: safe(m.TeamB) };
    const tA = safe(t.teamA);
    const tB = safe(t.teamB);

    const manualPick = safe(picksByMatch.get(mid));
    const byePick = autoByePick(tA, tB);
    const pick = manualPick || byePick;

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
