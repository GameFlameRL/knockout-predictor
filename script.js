// ================================
// CONFIG – EDIT THESE TWO ONLY
// ================================
const SHEET_ID = "1ilDa0ZleooN3OBruvtOqF9Ym1CitowFjaLCk1GiYiNc";
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbyDS97V_4V-KeSaGWMtTNlSnJoMAG4cTOh7sSMDf3V7WYfF5qbgf7LxEnVELebDmYXIng/exec";

// ================================
const MATCHES_URL = `https://opensheet.elk.sh/${SHEET_ID}/Matches`;
const LEADERBOARD_URL = `https://opensheet.elk.sh/${SHEET_ID}/Leaderboard`;

let matches = [];

// Preferred round order (customize if you want)
const ROUND_ORDER = ["R32", "R16", "Quarter", "Semi", "Final"];

// ================================
// INITIAL LOAD
// ================================
loadMatches();
loadLeaderboard();

// ================================
// LOADERS
// ================================
function loadMatches() {
  fetch(MATCHES_URL)
    .then(res => res.json())
    .then(data => {
      matches = Array.isArray(data) ? data : [];
      renderBracket();
    })
    .catch(err => {
      console.error("Failed to load Matches", err);
      showBracketMessage("Failed to load matches. Check sheet publishing + tab name.");
    });
}

function loadLeaderboard() {
  fetch(LEADERBOARD_URL)
    .then(res => res.json())
    .then(data => renderLeaderboard(Array.isArray(data) ? data : []))
    .catch(err => console.error("Failed to load leaderboard", err));
}

// ================================
// HELPERS
// ================================
function initials(name) {
  return (name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join("");
}

function normRound(r) {
  return (r || "").trim();
}

function showBracketMessage(msg) {
  const el = document.getElementById("bracketMsg");
  if (!el) return;
  el.style.display = "block";
  el.innerHTML = msg;
}

// Sort rounds by preferred order, then anything else after
function sortRounds(roundNames) {
  const set = new Set(roundNames);
  const inOrder = ROUND_ORDER.filter(r => set.has(r));
  const extras = roundNames.filter(r => !ROUND_ORDER.includes(r)).sort();
  return [...inOrder, ...extras];
}

// ================================
// BRACKET RENDER
// ================================
function renderBracket() {
  const inner = document.getElementById("bracketInner");
  if (!inner) return;

  inner.innerHTML = "";

  if (!matches.length) {
    showBracketMessage("No matches found. Check your Matches sheet rows and headers.");
    return;
  }

  // Group matches by round
  const groups = {};
  matches.forEach(m => {
    const r = normRound(m.Round) || "Round";
    if (!groups[r]) groups[r] = [];
    groups[r].push(m);
  });

  const rounds = sortRounds(Object.keys(groups));

  // Build columns
  rounds.forEach(roundName => {
    const col = document.createElement("div");
    col.className = "round-col";

    const title = document.createElement("div");
    title.className = "round-title";
    title.innerHTML = `<span>${roundName}</span><small>${groups[roundName].length} matches</small>`;
    col.appendChild(title);

    // Sort matches within round by MatchID numeric if possible
    groups[roundName].sort((a, b) => Number(a.MatchID) - Number(b.MatchID));

    groups[roundName].forEach(m => {
      const winner = (m.Winner || "").trim();

      const card = document.createElement("div");
      card.className = "match-card";

      card.innerHTML = `
        <div class="match-top">
          <span>Match ${m.MatchID}</span>
          <span>${winner ? "✅ played" : "🕒 pending"}</span>
        </div>

        <div class="fixture">
          <div class="team">
            <div class="badge">${initials(m.TeamA)}</div>
            <div class="team-name">${m.TeamA}</div>
          </div>

          <div class="vs">VS</div>

          <div class="team">
            <div class="badge">${initials(m.TeamB)}</div>
            <div class="team-name">${m.TeamB}</div>
          </div>
        </div>

        <div class="pick">
          <label>
            <input type="radio" name="match_${m.MatchID}" value="${m.TeamA}">
            Pick ${m.TeamA}
          </label>
          <label>
            <input type="radio" name="match_${m.MatchID}" value="${m.TeamB}">
            Pick ${m.TeamB}
          </label>
        </div>

        <div class="result-note">
          ${winner ? `✅ Result: <strong>${winner}</strong>` : `Result: not set yet`}
        </div>
      `;

      col.appendChild(card);
    });

    inner.appendChild(col);
  });

  // hide any previous message
  const msg = document.getElementById("bracketMsg");
  if (msg) msg.style.display = "none";
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

  if (rows.length === 0) return alert("Pick at least one match.");

  Promise.all(rows.map(row => postRow(row)))
    .then(() => {
      alert("Predictions submitted!");
      loadLeaderboard();
    })
    .catch(err => {
      console.error("Submit failed", err);
      alert("Submission failed. Check Apps Script permissions / deployment.");
    });
}

function postRow(row) {
  return fetch(SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify(row)
  });
}

// ================================
// LEADERBOARD RENDER
// ================================
function renderLeaderboard(data) {
  const ul = document.getElementById("leaderboard");
  if (!ul) return;

  ul.innerHTML = "";

  if (!data.length) {
    ul.innerHTML = "<li style='opacity:.7'>No entries yet.</li>";
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
