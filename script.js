// ======================================
// CONFIG – EDIT THESE TWO ONLY
// ======================================
const SHEET_ID = "1ilDa0ZleooN3OBruvtOqF9Ym1CitowFjaLCk1GiYiNc";
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbyDS97V_4V-KeSaGWMtTNlSnJoMAG4cTOh7sSMDf3V7WYfF5qbgf7LxEnVELebDmYXIng/exec";

// ======================================
const MATCHES_URL = `https://opensheet.elk.sh/${SHEET_ID}/Matches`;
const LEADERBOARD_URL = `https://opensheet.elk.sh/${SHEET_ID}/Leaderboard`;

// FORCE correct round order
const ROUND_ORDER = ["R32", "R16", "Quarter", "Semi", "Final"];

let matches = [];

// layout tuning (matches your CSS)
const MATCH_HEIGHT = 92;
const BASE_GAP = 26;
const COL_WIDTH = 320;
const CARD_WIDTH = 280;
const HEADER_H = 54;

// ======================================
// INIT
// ======================================
loadMatches();
loadLeaderboard();

window.addEventListener("resize", renderBracket);

// ======================================
// LOADERS
// ======================================
function loadMatches() {
  fetch(MATCHES_URL)
    .then(r => r.json())
    .then(data => {
      matches = Array.isArray(data) ? data : [];
      renderBracket();
    })
    .catch(err => {
      console.error("Failed to load matches", err);
    });
}

function loadLeaderboard() {
  fetch(LEADERBOARD_URL)
    .then(r => r.json())
    .then(data => renderLeaderboard(Array.isArray(data) ? data : []))
    .catch(err => console.error("Failed to load leaderboard", err));
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

  const groups = groupByRound();
  const rounds = sortRounds(Object.keys(groups));
  const roundEls = [];

  // Build columns
  rounds.forEach((roundName, roundIndex) => {
    const roundEl = document.createElement("div");
    roundEl.className = "round";

    const header = document.createElement("div");
    header.className = "round-header";
    header.textContent = roundName;
    roundEl.appendChild(header);

    groups[roundName].forEach((m, i) => {
      const teamA = safe(m.TeamA);
      const teamB = safe(m.TeamB);
      const winner = safe(m.Winner);

      const card = document.createElement("div");
      card.className = "match";
      card.dataset.round = roundIndex;
      card.dataset.index = i;

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
          <label>
            <input type="radio" name="match_${m.MatchID}" value="${teamA}">
            ${teamA}
          </label>
          <label>
            <input type="radio" name="match_${m.MatchID}" value="${teamB}">
            ${teamB}
          </label>
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

  // Draw connectors
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
// SUBMIT PREDICTIONS
// ======================================
function submitPredictions() {
  const user = safe(document.getElementById("username")?.value);
  if (!user) return alert("Enter your username first.");

  const rows = [];

  matches.forEach(m => {
    const pick = document.querySelector(
      `input[name="match_${m.MatchID}"]:checked`
    );
    if (pick) {
      rows.push([new Date().toISOString(), user, m.MatchID, pick.value]);
    }
  });

  if (!rows.length) return alert("Pick at least one match.");

  Promise.all(
    rows.map(r =>
      fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify(r) })
    )
  )
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
    ul.innerHTML = `<li style="opacity:.7">No entries yet.</li>`;
    return;
  }

  data.forEach(p => {
    ul.innerHTML += `
      <li class="lb-row">
        <span class="lb-user">${safe(p.Username)}</span>
        <span class="lb-points">${safe(p.Points)} pts</span>
      </li>
    `;
  });
}
