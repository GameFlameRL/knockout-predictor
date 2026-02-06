// ======================================
// CONFIG – EDIT THESE TWO ONLY
// ======================================
const SHEET_ID = "1ilDa0ZleooN3OBruvtOqF9Ym1CitowFjaLCk1GiYiNc";
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbywemgGWVB87gFdGZGax7mbJ8U6cIoVxI0pYBJMz-Da66SR_qhknP2ogOISs1WtbGjbbg/exec";

const MATCHES_URL = `https://opensheet.elk.sh/${SHEET_ID}/Matches`;
const LEADERBOARD_URL = `https://opensheet.elk.sh/${SHEET_ID}/Leaderboard`;

const ROUND_ORDER = ["R32", "R16", "Quarter", "Semi", "Final"];

// Bigger cards + tighter gaps (matches your current look)
const MATCH_HEIGHT = 112;
const BASE_GAP = 14;
const COL_WIDTH = 360;
const CARD_WIDTH = 320;
const HEADER_H = 62;

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

// Build a mapping from MatchID -> { nextMatchId, nextSlot } using your sheet columns
function buildNextMap() {
  const map = new Map();
  matches.forEach(m => {
    const id = safe(m.MatchID);
    const nextId = safe(m.NextMatchID);
    const slotRaw = safe(m.NextSlot).toUpperCase(); // "A" or "B"
    if (!id) return;
    if (!nextId) return;
    if (slotRaw !== "A" && slotRaw !== "B") return;
    map.set(id, { nextMatchId: nextId, nextSlot: slotRaw });
  });
  return map;
}

// Predicted entrants propagate forward based on picks + mapping
function computePredictedTeams() {
  const predicted = new Map();
  const nextMap = buildNextMap();

  // Seed from sheet
  matches.forEach(m => {
    predicted.set(safe(m.MatchID), {
      teamA: safe(m.TeamA),
      teamB: safe(m.TeamB)
    });
  });

  // Apply predicted propagation: each picked match writes its winner into its target match slot
  // We do this repeatedly for safety (in case of multi-round propagation).
  // 4 passes is plenty for R32->Final.
  for (let pass = 0; pass < 4; pass++) {
    matches.forEach(m => {
      const fromId = safe(m.MatchID);
      const link = nextMap.get(fromId);
      if (!link) return;

      const fromTeams = predicted.get(fromId) || { teamA: safe(m.TeamA), teamB: safe(m.TeamB) };
      const pick = safe(picksByMatch.get(fromId));
      if (!pick) return;

      // Only accept pick if it matches one of that match's participants
      if (pick !== fromTeams.teamA && pick !== fromTeams.teamB) return;

      const destId = safe(link.nextMatchId);
      const slot = link.nextSlot; // "A" or "B"
      const destCurrent = predicted.get(destId) || { teamA: "", teamB: "" };

      // Only write into blank/TBD slots (so real sheet values can win if present)
      if (slot === "A") {
        const canWrite = isBlankSlot(destCurrent.teamA);
        predicted.set(destId, { teamA: canWrite ? pick : destCurrent.teamA, teamB: destCurrent.teamB });
      } else {
        const canWrite = isBlankSlot(destCurrent.teamB);
        predicted.set(destId, { teamA: destCurrent.teamA, teamB: canWrite ? pick : destCurrent.teamB });
      }
    });
  }

  return predicted;
}

// ======================================
// BRACKET RENDER
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
  const predictedTeams = computePredictedTeams();

  const roundEls = [];

  rounds.forEach(roundName => {
    const roundEl = document.createElement("div");
    roundEl.className = "round";

    const header = document.createElement("div");
    header.className = "round-header";
    header.textContent = roundName;
    roundEl.appendChild(header);

    (groups[roundName] || []).forEach((m, i) => {
      const matchId = safe(m.MatchID);

      const pred = predictedTeams.get(matchId) || { teamA: safe(m.TeamA), teamB: safe(m.TeamB) };

      // prefer sheet values, fallback to predicted if sheet blank
      const teamA = safe(m.TeamA) || safe(pred.teamA);
      const teamB = safe(m.TeamB) || safe(pred.teamB);

      const displayA = teamA || "TBD";
      const displayB = teamB || "TBD";

      const winner = safe(m.Winner);
      const picked = safe(picksByMatch.get(matchId));

      const aWin = winner && winner === teamA;
      const bWin = winner && winner === teamB;

      const aPicked = picked && picked === teamA;
      const bPicked = picked && picked === teamB;

      const aDisabled = displayA === "TBD";
      const bDisabled = displayB === "TBD";

      const aLoser = picked && picked !== teamA;
      const bLoser = picked && picked !== teamB;

      const card = document.createElement("div");
      card.className = "match";
      card.dataset.matchId = matchId;
      card.dataset.index = String(i);

      card.innerHTML = `
        <div class="teamrow ${aWin ? "win" : ""} ${aPicked ? "picked" : ""} ${aLoser ? "loser" : ""} ${aDisabled ? "disabled" : ""}" data-match="${escapeHtml(matchId)}" data-team="${escapeHtml(teamA)}">
          <div class="logoBox">${displayA === "TBD" ? "" : initials(displayA)}</div>
          <div class="nameBox">${escapeHtml(displayA)}</div>
          <div class="scoreBox">${aPicked ? "✓" : ""}</div>
        </div>
        <div class="teamrow ${bWin ? "win" : ""} ${bPicked ? "picked" : ""} ${bLoser ? "loser" : ""} ${bDisabled ? "disabled" : ""}" data-match="${escapeHtml(matchId)}" data-team="${escapeHtml(teamB)}">
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
          if (winner) return; // lock after official result exists

          picksByMatch.set(mid, team);
          renderBracket();
          fitBracket();
        });
      });

      roundEl.appendChild(card);
    });

    columnsEl.appendChild(roundEl);
    roundEls.push(roundEl);
  });

  // Position cards
  roundEls.forEach((roundEl, rIdx) => {
    const cards = [...roundEl.querySelectorAll(".match")];
    const gap = BASE_GAP * Math.pow(2, rIdx);
    const step = MATCH_HEIGHT + gap;
    const topOffset = HEADER_H + gap / 2;

    cards.forEach((card, i) => {
      card.style.left = `${(COL_WIDTH - CARD_WIDTH) / 2}px`;
      card.style.top = `${topOffset + i * step}px`;
    });
  });

  // Wrapper size for SVG coordinate space
  const contentW = columnsEl.scrollWidth + 24;
  const contentH = columnsEl.scrollHeight + 160;
  wrap.style.width = `${contentW}px`;
  wrap.style.height = `${contentH}px`;

  svg.setAttribute("width", contentW);
  svg.setAttribute("height", contentH);

  // Connect rounds by visual order (still fine)
  for (let r = 0; r < roundEls.length - 1; r++) {
    const leftCards = [...roundEls[r].querySelectorAll(".match")];
    const rightCards = [...roundEls[r + 1].querySelectorAll(".match")];

    rightCards.forEach((rightCard, j) => {
      const a = leftCards[j * 2];
      const b = leftCards[j * 2 + 1];
      if (a && b) drawConnectorScaled(svg, wrap, a, b, rightCard);
    });
  }
}

function drawConnectorScaled(svg, wrap, a, b, to) {
  const scale = currentScale || 1;

  const w = wrap.getBoundingClientRect();
  const ra = a.getBoundingClientRect();
  const rb = b.getBoundingClientRect();
  const rt = to.getBoundingClientRect();

  const ax = (ra.right - w.left) / scale;
  const ay = (ra.top - w.top + ra.height / 2) / scale;

  const bx = (rb.right - w.left) / scale;
  const by = (rb.top - w.top + rb.height / 2) / scale;

  const tx = (rt.left - w.left) / scale;
  const ty = (rt.top - w.top + rt.height / 2) / scale;

  const midX = ax + 30;

  const paths = [
    `M ${ax} ${ay} L ${midX} ${ay}`,
    `M ${bx} ${by} L ${midX} ${by}`,
    `M ${midX} ${ay} L ${midX} ${by}`,
    `M ${midX} ${(ay + by) / 2} L ${tx} ${ty}`
  ];

  paths.forEach(d => {
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
  const contentH = columns.scrollHeight + 180;

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

function zoomIn() {
  userZoom = Math.min(2.0, userZoom + 0.1);
  applyZoom();
  renderBracket();
}
function zoomOut() {
  userZoom = Math.max(0.4, userZoom - 0.1);
  applyZoom();
  renderBracket();
}

// ======================================
// SYNC OFFICIAL WINNERS (uses mapping if present)
// ======================================
function syncBracketToSheet() {
  if (!matches.length) return;

  const nextMap = buildNextMap();
  const updatesByDest = new Map(); // destId -> {teamA?, teamB?}

  // If mapping exists for a match, use it; otherwise fallback to old pairing logic
  const hasAnyMapping = nextMap.size > 0;

  if (hasAnyMapping) {
    matches.forEach(m => {
      const fromId = safe(m.MatchID);
      const link = nextMap.get(fromId);
      if (!link) return;

      const win = safe(m.Winner);
      if (!win) return;

      const destId = safe(link.nextMatchId);
      const slot = link.nextSlot;

      if (!updatesByDest.has(destId)) updatesByDest.set(destId, {});
      const u = updatesByDest.get(destId);
      if (slot === "A") u.teamA = win;
      if (slot === "B") u.teamB = win;
    });

    const payloads = [];
    updatesByDest.forEach((u, destId) => {
      // Only send if we have both sides (keeps bracket tidy)
      if (!u.teamA || !u.teamB) return;
      payloads.push({ type: "setMatchTeams", matchId: destId, teamA: u.teamA, teamB: u.teamB });
    });

    if (!payloads.length) return;

    let chain = Promise.resolve();
    payloads.forEach(p => {
      chain = chain.then(() => fetch(SCRIPT_URL, { method:"POST", body: JSON.stringify(p), mode:"no-cors" }));
    });
    chain.then(() => loadMatches()).catch(() => {});
    return;
  }

  // Fallback: original sequential pairing (if no mapping columns used)
  const groups = groupByRound(matches);
  const rounds = sortRounds(Object.keys(groups));
  const updates = [];

  for (let r = 0; r < rounds.length - 1; r++) {
    const curr = groups[rounds[r]] || [];
    const next = groups[rounds[r + 1]] || [];

    for (let j = 0; j < next.length; j++) {
      const m1 = curr[j * 2];
      const m2 = curr[j * 2 + 1];
      const dest = next[j];
      if (!m1 || !m2 || !dest) continue;

      const w1 = safe(m1.Winner);
      const w2 = safe(m2.Winner);
      if (!w1 || !w2) continue;

      const destA = safe(dest.TeamA);
      const destB = safe(dest.TeamB);

      const canWriteA = isBlankSlot(destA) || destA === w1;
      const canWriteB = isBlankSlot(destB) || destB === w2;
      if (!canWriteA || !canWriteB) continue;

      updates.push({ type:"setMatchTeams", matchId: safe(dest.MatchID), teamA: w1, teamB: w2 });
    }
  }

  if (!updates.length) return;

  let chain = Promise.resolve();
  updates.forEach(u => {
    chain = chain.then(() => fetch(SCRIPT_URL, { method:"POST", body: JSON.stringify(u), mode:"no-cors" }));
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
    .then(() => {
      alert("Predictions submitted!");
      loadLeaderboard();
    })
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

// ======================================
// UTIL
// ======================================
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
