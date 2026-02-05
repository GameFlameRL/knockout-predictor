const SHEET_ID = "1ilDa0ZleooN3OBruvtOqF9Ym1CitowFjaLCk1GiYiNc";
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyDS97V_4V-KeSaGWMtTNlSnJoMAG4cTOh7sSMDf3V7WYfF5qbgf7LxEnVELebDmYXIng/exec"; // from Step 9

const MATCHES_URL = `https://opensheet.elk.sh/${SHEET_ID}/Matches`;
const LEADERBOARD_URL = `https://opensheet.elk.sh/${SHEET_ID}/Leaderboard`;

let matches = [];

fetch(MATCHES_URL)
  .then(res => res.json())
  .then(data => {
    matches = data;
    renderMatches();
  })
  .catch(err => {
    document.getElementById("matches").innerHTML = "Error loading matches.";
    console.log(err);
  });

function renderMatches() {
  const div = document.getElementById("matches");
  div.innerHTML = "";

  matches.forEach(m => {
    div.innerHTML += `
      <div class="match">
        <strong>Match ${m.MatchID}</strong><br>
        <label><input type="radio" name="match_${m.MatchID}" value="${m.TeamA}"> ${m.TeamA}</label><br>
        <label><input type="radio" name="match_${m.MatchID}" value="${m.TeamB}"> ${m.TeamB}</label>
      </div>
    `;
  });
}

function submitPredictions() {
  const user = document.getElementById("username").value.trim();
  if (!user) return alert("Enter your name first.");

  const rows = [];

  matches.forEach(m => {
    const pick = document.querySelector(`input[name="match_${m.MatchID}"]:checked`);
    if (pick) rows.push([new Date().toISOString(), user, m.MatchID, pick.value]);
  });

  if (rows.length === 0) return alert("Pick at least 1 match.");

  Promise.all(rows.map(r => postRow(r)))
    .then(() => {
      alert("Predictions submitted!");
      loadLeaderboard();
    })
    .catch(() => alert("Submission failed. Check SCRIPT_URL + permissions."));
}

function postRow(row) {
  return fetch(SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify(row)
  });
}

function loadLeaderboard() {
  fetch(LEADERBOARD_URL)
    .then(res => res.json())
    .then(data => {
      const ul = document.getElementById("leaderboard");
      ul.innerHTML = "";
      data.forEach(p => ul.innerHTML += `<li>${p.Username}: ${p.Points}</li>`);
    });
}

loadLeaderboard();
