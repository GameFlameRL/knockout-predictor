// ================================
// CONFIG – EDIT THESE TWO ONLY
// ================================
const SHEET_ID = "1ilDa0ZleooN3OBruvtOqF9Ym1CitowFjaLCk1GiYiNc";
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbyDS97V_4V-KeSaGWMtTNlSnJoMAG4cTOh7sSMDf3V7WYfF5qbgf7LxEnVELebDmYXIng/exec";

// ================================
const MATCHES_URL = `https://opensheet.elk.sh/${SHEET_ID}/Matches`;
const LEADERBOARD_URL = `https://opensheet.elk.sh/${SHEET_ID}/Leaderboard`;

// Round order + display names
const ROUND_ORDER = ["Quarterfinals", "Semifinals", "Grand Finals", "Quarter", "Semi", "Final"];

// Layout constants (tweak to taste)
const MATCH_HEIGHT = 34 * 2 + 8 + 8; // approx team rows + picks padding
const BASE_GAP = 22;                 // vertical gap in first round
const COL_WIDTH = 320;               // matches CSS round width is 320
const CARD_WIDTH = 280;              // matches CSS match width is 280
const HEADER_H = 48;                 // space under header

let matches = [];

loadMatches();
loadLeaderboard();
window.addEventListener("resize", () => {
  // re-render to re-draw lines on resize
  renderBracket();
});

function loadMatches() {
  fetch(MATCHES_URL)
    .then(r => r.json())
    .then(data => {
      matches = Array.isArray(data) ? data : [];
      renderBracket();
    })
    .catch(err => console.error("Matches load failed:", err));
}

function loadLeaderboard() {
  fetch(LEADERBOARD_URL)
    .then(r => r.json())
    .then(data => renderLeaderboard(Array.isArray(data) ? data : []))
    .catch(err => console.error("Leaderboard load failed:", err));
}

function renderLeaderboard(data) {
  const ul = document.getElementById("leaderboard");
  ul.innerHTML = "";
  if (!data.length) {
    ul.innerHTML = `<li style="opacity:.8">No entries yet.</li>`;
    return;
  }
  data.forEach(p => {
    ul.innerHTML += `
      <li class="lb-row">
        <span class="lb-user">${p.Username}</span>
        <span class="lb-points">${p.Points} pts</span>
      </li>
    `;
  });
}

function initials(name) {
  return (name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0,2)
    .map(w => w[0].toUpperCase())
    .join("");
}

function sortRounds(rounds) {
  const uniq = [...new Set(rounds)];
  const inOrder = ROUND_ORDER.filter(r => uniq.includes(r));
  const extras = uniq.filter(r => !ROUND_ORDER.includes(r)).sort();
  return [...inOrder, ...extras];
}

function groupByRound() {
  const groups = {};
  matches.forEach(m => {
    const r = (m.Round || "").trim() || "Round";
    if (!groups[r]) groups[r] = [];
    groups[r].push(m);
  });
  // sort matches within each round by MatchID
  Object.keys(groups).forEach(r => {
    groups[r].sort((a,b) => Number(a.MatchID) - Number(b.MatchID));
  });
  return groups;
}

function renderBracket() {
  const columnsEl = document.getElementById("columns");
  const svg = document.getElementById("lines");
  const wrap = document.getElementById("bracketWrap");

  columnsEl.innerHTML = "";
  svg.innerHTML = "";

  if (!matches.length) return;

  const groups = groupByRound();
  const rounds = sortRounds(Object.keys(groups));

  // Build columns
  const roundEls = [];
  rounds.forEach((roundName, roundIndex) => {
    const round = document.createElement("div");
    round.className = "round";

    const header = document.createElement("div");
    header.className = "round-header";
    header.textContent = roundName;
    round.appendChild(header);

    // Add match cards (absolute positioned later)
    const ms = groups[roundName];
    ms.forEach((m, i) => {
      const card = document.createElement("div");
      card.className = "match";
      card.dataset.roundIndex = String(roundIndex);
      card.dataset.matchIndex = String(i);
      card.dataset.matchId = String(m.MatchID);

      const winner = (m.Winner || "").trim();
      const scoreA = (m.ScoreA ?? "").toString().trim();
      const scoreB = (m.ScoreB ?? "").toString().trim();

      // winner highlight per row
      const aWin = winner && winner === m.TeamA;
      const bWin = winner && winner === m.TeamB;

      // optional logo URLs from sheet: LogoA/LogoB
      const logoA = (m.LogoA || "").trim();
      const logoB = (m.LogoB || "").trim();

      card.innerHTML = `
        <div class="teamrow ${aWin ? "win" : ""}">
          <div class="logoBox">
            ${logoA ? `<img src="${logoA}" alt="">` : `<span>${initials(m.TeamA)}</span>`}
          </div>
          <div class="nameBox">${m.TeamA}</div>
          <div class="scoreBox">${scoreA}</div>
        </div>

        <div class="teamrow ${bWin ? "win" : ""}">
          <div class="logoBox">
            ${logoB ? `<img src="${logoB}" alt="">` : `<span>${initials(m.TeamB)}</span>`}
          </div>
          <div class="nameBox">${m.TeamB}</div>
          <div class="scoreBox">${scoreB}</div>
        </div>

        <div class="picks">
          <label><input type="radio" name="match_${m.MatchID}" value="${m.TeamA}"> ${m.TeamA}</label>
          <label><input type="radio" name="match_${m.MatchID}" value="${m.TeamB}"> ${m.TeamB}</label>
        </div>
      `;
      round.appendChild(card);
    });

    columnsEl.appendChild(round);
    roundEls.push(round);
  });

  // Position cards like a true bracket
  rounds.forEach((roundName, rIdx) => {
    const round = roundEls[rIdx];
    const cards = [...round.querySelectorAll(".match")];

    const gap = BASE_GAP * Math.pow(2, rIdx); // spacing doubles each round
    const step = MATCH_HEIGHT + gap;
    const topOffset = HEADER_H + (gap / 2);   // gives that centered look

    cards.forEach((card, i) => {
      const top = topOffset + i * step;
      card.style.top = `${top}px`;
      card.style.left = `${(COL_WIDTH - CARD_WIDTH) / 2}px`;
    });
  });

  // Resize SVG to overlay bracket area
  const rect = wrap.getBoundingClientRect();
  svg.setAttribute("width", rect.width);
  svg.setAttribute("height", rect.height);

  // Draw connectors between rounds (assumes match pairing in order: 0&1 -> 0, 2&3 -> 1, etc)
  for (let r = 0; r < roundEls.length - 1; r++) {
    const leftRound = roundEls[r];
    const rightRound = roundEls[r + 1];

    const leftCards = [...leftRound.querySelectorAll(".match")];
    const rightCards = [...rightRound.querySelectorAll(".match")];

    // For each right match, connect from two left matches
    rightCards.forEach((rightCard, j) => {
      const a = leftCards[j * 2];
      const b = leftCards[j * 2 + 1];
      if (!a || !b) return;

      drawConnector(svg, wrap, a, b, rightCard);
    });
  }
}

function drawConnector(svg, wrap, cardA, cardB, cardTo) {
  const wrapRect = wrap.getBoundingClientRect();
  const ra = cardA.getBoundingClientRect();
  const rb = cardB.getBoundingClientRect();
  const rt = cardTo.getBoundingClientRect();

  // from right middle of A and B
  const ax = ra.right - wrapRect.left;
  const ay = ra.top - wrapRect.top + ra.height / 2;

  const bx = rb.right - wrapRect.left;
  const by = rb.top - wrapRect.top + rb.height / 2;

  // to left middle of target
  const tx = rt.left - wrapRect.left;
  const ty = rt.top - wrapRect.top + rt.height / 2;

  const midX = ax + 26; // small horizontal run before vertical join

  // path: A -> join, B -> join, join -> target
  const p1 = `M ${ax} ${ay} L ${midX} ${ay}`;
  const p2 = `M ${bx} ${by} L ${midX} ${by}`;
  const pV = `M ${midX} ${ay} L ${midX} ${by}`;
  const p3 = `M ${midX} ${(ay + by) / 2} L ${tx} ${ty}`;

  [p1, p2, pV, p3].forEach(d => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("stroke", "rgba(0,0,0,0.65)");
    path.setAttribute("stroke-width", "3");
    path.setAttribute("fill", "none");
    svg.appendChild(path);
  });
}

// ================================
// SUBMIT PREDICTIONS
// ================================
function submitPredictions() {
  const user = document.getElementById("username").value.trim();
  if (!user) return alert("Enter your username first.");

  const rows = [];

  matches.forEach(m => {
    const pick = document.querySelector(`input[name="match_${m.MatchID}"]:checked`);
    if (pick) rows.push([new Date().toISOString(), user, m.MatchID, pick.value]);
  });

  if (!rows.length) return alert("Pick at least one match.");

  Promise.all(rows.map(row => fetch(SCRIPT_URL, { method:"POST", body: JSON.stringify(row) })))
    .then(() => {
      alert("Predictions submitted!");
      loadLeaderboard();
    })
    .catch(err => {
      console.error(err);
      alert("Submission failed. Check Apps Script permissions / deployment.");
    });
}
