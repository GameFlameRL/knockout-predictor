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

let matches = [];

// layout tuning
const MATCH_HEIGHT = 92;
const BASE_GAP = 26;
const COL_WIDTH = 320;
const CARD_WIDTH = 280;
const HEADER_H = 54;

// build stamp so you can confirm newest JS is live
const BUILD_STAMP = new Date().toISOString();

// ======================================
// INIT
// ======================================
debugWrite(`BUILD: ${BUILD_STAMP}\nLoading…`);
loadAll();
window.addEventListener("resize", renderBracket);

// ======================================
// DEBUG
// ======================================
function debugWrite(msg) {
  const el = document.getElementById("debug");
  if (el) el.textContent = msg;
}

function debugAppend(msg) {
  const el = document.getElementById("debug");
  if (el) el.textContent += `\n${msg}`;
}

// ======================================
// LOADERS
// ======================================
function loadAll() {
  Promise.all([loadMatches(), loadLeaderboard()])
    .then(() => {
      // auto-sync once on load (safe overwrite rules apply)
      syncBracketToSheet();
    })
    .catch(() => {});
}

function loadMatches() {
  const url = `${MATCHES_URL}?t=${Date.now()}`;

  debugWrite(
    `BUILD: ${BUILD_STAMP}\n` +
    `SHEET_ID: ${SHEET_ID}\n` +
    `MATCHES_URL: ${url}\n` +
    `SCRIPT_URL: ${SCRIPT_URL}\n` +
    `\nFetching matches…`
  );

  return fetch(url)
    .then(r => {
      debugAppend(`Matches fetch HTTP: ${r.status}`);
      return r.json();
    })
    .then(data => {
      matches = Array.isArray(data) ? data : [];
      debugAppend(`Matches loaded: ${matches.length}`);

      if (matches.length) {
        const first = matches[0];
        debugAppend(`First match keys: ${Object.keys(first).join(", ")}`);
        debugAppend(
          `First match sample: MatchID=${safe(first.MatchID)} Round=${safe(first.Round)} TeamA=${safe(first.TeamA)} TeamB=${safe(first.TeamB)} Winner=${safe(first.Winner)}`
        );
      } else {
        debugAppend(`Matches is empty array. That means opensheet returned [] for your Matches tab.`);
      }

      renderBracket();
    })
    .catch(err => {
      debugAppend(`MATCHES ERROR: ${String(err)}`);
      matches = [];
      renderBracket();
    });
}

function loadLeaderboard() {
  const url = `${LEADERBOARD_URL}?t=${Date.now()}`;

  return fetch(url)
    .then(r => r.json())
    .then(data => renderLeaderboard(Array.isArray(data) ? data : []))
    .catch(err => debugAppend(`LEADERBOARD ERROR: ${String(err)}`));
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

function sortRounds(foundRounds) {
  const set = new Set(foundRounds);
  const ordered = ROUND_ORDER.filter(r => set.has(r));
  const extra = [...set].filter(r => !ROUND_ORDER.includes(r)).sort();
  return [...ordered, ...extra];
}

function groupByRound() {
  const groups = {};
  matches.forEach(m => {
    const round = safe(m.Round) || "Unknown";
    if (!groups[round]) groups[round] = [];
    groups[round].push(m);
  });

  Object.keys(groups).forEach(r => {
    groups[r].sort((a, b) => Number(a.MatchID) - Number(b.MatchID));
  });

  return groups;
}

function isBlankSlot(team) {
  const t = safe(team).toLowerCase();
  return t === "" || t === "tbd" || t === "?" || t === "null" || t === "undefined";
}

// ======================================
// BRACKET RENDER
// ======================================
function renderBracket() {
  const columnsEl = document.getElementById("columns");
  const svg = document.getElementById("lines");
  const wrap = document.getElementById("bracketWrap");

  if (!columnsEl || !svg || !wrap) {
    debugAppend(`DOM ERROR: Missing one of #columns, #lines, #bracketWrap`);
    return;
  }

  columnsEl.innerHTML = "";
  svg.innerHTML = "";

  if (!matches.length) return;

  const groups = groupByRound();
  const rounds = sortRounds(Object.keys(groups));
  const roundEls = [];

  rounds.forEach((roundName) => {
    const roundEl = document.createElement("div");
    roundEl.className = "round";

    const header = document.createElement("div");
    header.className = "round-header";
    header.textContent = roundName;
    roundEl.appendChild(header);

    (groups[roundName] || []).forEach((m, i) => {
      const teamA = safe(m.TeamA);
      const teamB = safe(m.TeamB);
      const winner = safe(m.Winner);

      const card = document.createElement("div");
      card.className = "match";
      card.dataset.matchId = safe(m.MatchID);
      card.dataset.index = String(i);

      const aWin = winner && winner === teamA;
      const bWin = winner && winner === teamB;

      card.innerHTML = `
        <div class="teamrow ${aWin ? "win" : ""}">
          <div class="logoBox">${initials(teamA)}</div>
          <div class="nameBox">${teamA}</div>
          <div class="scoreBox"></div>
        </div>
        <div class="teamrow ${bWin ? "win" : ""}">
          <div class="logoBox">${initials(teamB)}</div>
          <div class="nameBox">${teamB}</div>
          <div class="scoreBox"></div>
        </div>
        <div class="picks">
          <label><input type="radio" name="match_${safe(m.MatchID)}" value="${teamA}"> ${teamA}</label>
          <label><input type="radio" name="match_${safe(m.MatchID)}" value="${teamB}"> ${teamB}</label>
        </div>
      `;

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

  // Resize SVG overlay
  const rect = wrap.getBoundingClientRect();
  svg.setAttribute("width", rect.width);
  svg.setAttribute("height", rect.height);

  // Draw connectors between rounds
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

  [
    `M ${ax} ${ay} L ${midX} ${ay}`,
    `M ${bx} ${by} L ${midX} ${by}`,
    `M ${midX} ${ay} L ${midX} ${by}`,
    `M ${midX} ${(ay + by) / 2} L ${tx} ${ty}`
  ].forEach(d => {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    p.setAttribute("stroke", "rgba(0,0,0,0.6)");
    p.setAttribute("stroke-width", "3");
    p.setAttribute("fill", "none");
    svg.appendChild(p);
  });
}

// ======================================
// AUTO-ADVANCE + WRITE BACK
// ======================================
function syncBracketToSheet() {
  if (!matches.length) {
    debugAppend("SYNC: skipped (no matches loaded)");
    return;
  }

  const groups = groupByRound();
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

  if (!updates.length) {
    debugAppend("SYNC: nothing to write (no new winners or next slots already filled)");
    return;
  }

  debugAppend(`SYNC: writing ${updates.length} match updates…`);
  runSequential_(updates);
}

function runSequential_(updates) {
  let chain = Promise.resolve();
  updates.forEach(u => { chain = chain.then(() => postToScript_(u)); });

  chain
    .then(() => {
      debugAppend("SYNC: done, reloading matches…");
      return loadMatches();
    })
    .catch(err => debugAppend(`SYNC ERROR: ${String(err)}`));
}

function postToScript_(payload) {
  return fetch(SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify(payload),
    mode: "no-cors"
  });
}

// ======================================
// SUBMIT PREDICTIONS
// ======================================
function submitPredictions() {
  const user = safe(document.getElementById("username")?.value);
  if (!user) return alert("Enter your username first.");

  const rows = [];
  matches.forEach(m => {
    const pick = document.querySelector(`input[name="match_${safe(m.MatchID)}"]:checked`);
    if (pick) rows.push([new Date().toISOString(), user, safe(m.MatchID), pick.value]);
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
    .catch(err => {
      console.error(err);
      alert("Submission failed. Check Apps Script deployment.");
    });
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
        <span class="lb-user">${user}</span>
        <span class="lb-points">${pts} pts</span>
      </li>
    `;
  });
}
