// ======================================
// CONFIG – EDIT THESE TWO ONLY
// ======================================
const SHEET_ID = "1ilDa0ZleooN3OBruvtOqF9Ym1CitowFjaLCk1GiYiNc";
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbywemgGWVB87gFdGZGax7mbJ8U6cIoVxI0pYBJMz-Da66SR_qhknP2ogOISs1WtbGjbbg/exec";

// ======================================
const MATCHES_URL = `https://opensheet.elk.sh/${SHEET_ID}/Matches`;
const LEADERBOARD_URL = `https://opensheet.elk.sh/${SHEET_ID}/Leaderboard`;

const ROUND_ORDER = ["R32", "R16", "Quarter", "Semi", "Final"];

// layout tuning
const MATCH_HEIGHT = 96;
const BASE_GAP = 26;
const COL_WIDTH = 320;
const CARD_WIDTH = 280;
const HEADER_H = 58;

let matches = [];

// user picks: matchId -> pickedTeamName
const picksByMatch = new Map();

// zoom state
let userZoom = 1;
let fittedZoom = 1;

// expose controls to window
window.fitBracket = fitBracket;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.submitPredictions = submitPredictions;
window.loadLeaderboard = loadLeaderboard;
window.syncBracketToSheet = syncBracketToSheet;

// init
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
      // optional: try to sync actual winners into next rounds
      syncBracketToSheet();
      // fit after layout
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
function safe(v) {
  return (v ?? "").toString().trim();
}

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

// Build predicted teams per match by propagating user picks forward.
// Returns Map(matchId -> { teamA, teamB })
function computePredictedTeams() {
  const predicted = new Map();

  const groups = groupByRound(matches);
  const rounds = sortRounds(Object.keys(groups));

  // Seed predicted with whatever the sheet already provides for a match.
  rounds.forEach(r => {
    (groups[r] || []).forEach(m => {
      predicted.set(safe(m.MatchID), {
        teamA: safe(m.TeamA),
        teamB: safe(m.TeamB)
      });
    });
  });

  // Propagate from round to next using picksByMatch.
  for (let ri = 0; ri < rounds.length - 1; ri++) {
    const curr = groups[rounds[ri]] || [];
    const next = groups[rounds[ri + 1]] || [];

    for (let j = 0; j < next.length; j++) {
      const m1 = curr[j * 2];
      const m2 = curr[j * 2 + 1];
      const dest = next[j];
      if (!m1 || !m2 || !dest) continue;

      const m1id = safe(m1.MatchID);
      const m2id = safe(m2.MatchID);
      const destId = safe(dest.MatchID);

      // Determine participants for the two source matches (sheet or predicted)
      const m1Teams = predicted.get(m1id) || { teamA: safe(m1.TeamA), teamB: safe(m1.TeamB) };
      const m2Teams = predicted.get(m2id) || { teamA: safe(m2.TeamA), teamB: safe(m2.TeamB) };

      const m1Pick = safe(picksByMatch.get(m1id));
      const m2Pick = safe(picksByMatch.get(m2id));

      // Only set predicted entrants when both picks exist and are valid team names
      if (!m1Pick || !m2Pick) continue;
      if (m1Pick !== m1Teams.teamA && m1Pick !== m1Teams.teamB) continue;
      if (m2Pick !== m2Teams.teamA && m2Pick !== m2Teams.teamB) continue;

      // DO NOT overwrite real sheet entrants if they exist and are not blank
      const destCurrent = predicted.get(destId) || { teamA: safe(dest.TeamA), teamB: safe(dest.TeamB) };

      const destAIsBlank = isBlankSlot(destCurrent.teamA);
      const destBIsBlank = isBlankSlot(destCurrent.teamB);

      const newTeamA = destAIsBlank ? m1Pick : destCurrent.teamA;
      const newTeamB = destBIsBlank ? m2Pick : destCurrent.teamB;

      predicted.set(destId, { teamA: newTeamA, teamB: newTeamB });
    }
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

  // Create columns
  rounds.forEach(roundName => {
    const roundEl = document.createElement("div");
    roundEl.className = "round";

    const header = document.createElement("div");
    header.className = "round-header";
    header.textContent = roundName;
    roundEl.appendChild(header);

    (groups[roundName] || []).forEach((m, i) => {
      const matchId = safe(m.MatchID);

      // Display teams: prefer real sheet, else predicted, else TBD
      const pred = predictedTeams.get(matchId) || { teamA: safe(m.TeamA), teamB: safe(m.TeamB) };
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

      const card = document.createElement("div");
      card.className = "match";
      card.dataset.matchId = matchId;
      card.dataset.index = String(i);

      card.innerHTML = `
        <div class="teamrow ${aWin ? "win" : ""} ${aPicked ? "picked" : ""} ${aDisabled ? "disabled" : ""}" data-match="${escapeHtml(matchId)}" data-team="${escapeHtml(teamA)}">
          <div class="logoBox">${displayA === "TBD" ? "" : initials(displayA)}</div>
          <div class="nameBox">${escapeHtml(displayA)}</div>
          <div class="scoreBox">${aPicked ? "✓" : ""}</div>
        </div>
        <div class="teamrow ${bWin ? "win" : ""} ${bPicked ? "picked" : ""} ${bDisabled ? "disabled" : ""}" data-match="${escapeHtml(matchId)}" data-team="${escapeHtml(teamB)}">
          <div class="logoBox">${displayB === "TBD" ? "" : initials(displayB)}</div>
          <div class="nameBox">${escapeHtml(displayB)}</div>
          <div class="scoreBox">${bPicked ? "✓" : ""}</div>
        </div>
      `;

      // Click-to-pick
      card.querySelectorAll(".teamrow").forEach(row => {
        row.addEventListener("click", () => {
          const mid = safe(row.getAttribute("data-match"));
          const team = safe(row.getAttribute("data-team"));

          // Block invalid picks
          if (!mid || !team) return;
          if (isBlankSlot(team)) return;

          // Optional anti-cheat: block picks after result exists
          // If you want to allow late picks, comment the next line:
          if (winner) return;

          picksByMatch.set(mid, team);

          // Auto-advance happens automatically via computePredictedTeams() on re-render
          renderBracket();
          fitBracket();
        });
      });

      roundEl.appendChild(card);
    });

    columnsEl.appendChild(roundEl);
    roundEls.push(roundEl);
  });

  // Position cards by round depth so connectors align
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

  // Make the SVG match the unscaled content size so lines stay correct
  const contentW = columnsEl.scrollWidth + 24;
  const contentH = columnsEl.scrollHeight + 120;
  wrap.style.width = `${contentW}px`;
  wrap.style.height = `${contentH}px`;

  svg.setAttribute("width", contentW);
  svg.setAttribute("height", contentH);

  // Draw connectors between every round (each destination match connects from two source matches)
  for (let r = 0; r < roundEls.length - 1; r++) {
    const leftCards = [...roundEls[r].querySelectorAll(".match")];
    const rightCards = [...roundEls[r + 1].querySelectorAll(".match")];

    rightCards.forEach((rightCard, j) => {
      const a = leftCards[j * 2];
      const b = leftCards[j * 2 + 1];
      if (a && b) drawConnector(svg, wrap, a, b, rightCard);
    });
  }
}

function drawConnector(svg, wrap, a, b, to) {
  const w = wrap.getBoundingClientRect();
  const ra = a.getBoundingClientRect();
  const rb = b.getBoundingClientRect();
  const rt = to.getBoundingClientRect();

  const ax = ra.right - w.left;
  const ay = ra.top - w.top + ra.height / 2;

  const bx = rb.right - w.left;
  const by = rb.top - w.top + rb.height / 2;

  const tx = rt.left - w.left;
  const ty = rt.top - w.top + rt.height / 2;

  const midX = ax + 28;

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
  const contentH = columns.scrollHeight + 140;

  const viewW = stage.clientWidth - 28;
  const viewH = stage.clientHeight - 28;

  fittedZoom = Math.max(0.3, Math.min(viewW / contentW, viewH / contentH, 1));
  applyZoom();
}

function applyZoom() {
  const wrap = document.getElementById("bracketWrap");
  if (!wrap) return;
  const scale = fittedZoom * userZoom;
  wrap.style.transform = `scale(${scale})`;
}

function zoomIn() {
  userZoom = Math.min(2.0, userZoom + 0.1);
  applyZoom();
}
function zoomOut() {
  userZoom = Math.max(0.4, userZoom - 0.1);
  applyZoom();
}

// ======================================
// AUTO-ADVANCE ACTUAL WINNERS INTO SHEET (optional feature)
// ======================================
function syncBracketToSheet() {
  if (!matches.length) return;

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

      updates.push({
        type: "setMatchTeams",
        matchId: safe(dest.MatchID),
        teamA: w1,
        teamB: w2
      });
    }
  }

  if (!updates.length) return;

  // sequential fire-and-forget
  let chain = Promise.resolve();
  updates.forEach(u => {
    chain = chain.then(() => fetch(SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify(u),
      mode: "no-cors"
    }));
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
