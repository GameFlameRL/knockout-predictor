let data;
const predictionsKey = "knockout_predictions";

const bracketEl = document.getElementById("bracket");
const leaderboardEl = document.getElementById("leaderboard");
const saveBtn = document.getElementById("saveBtn");

saveBtn.addEventListener("click", savePredictions);

fetch("data.json")
  .then((res) => res.json())
  .then((json) => {
    data = json;
    renderBracket();
    renderLeaderboard();
  })
  .catch(() => {
    bracketEl.innerHTML = "<p>Could not load data.json. Check file name + path.</p>";
  });

function renderBracket() {
  bracketEl.innerHTML = "";

  data.rounds.forEach((round) => {
    const title = document.createElement("h3");
    title.className = "round-title";
    title.textContent = `${round.name} (worth ${round.points} pt each)`;
    bracketEl.appendChild(title);

    round.matches.forEach((match) => {
      const div = document.createElement("div");
      div.className = "match";

      div.innerHTML = `
        <div><strong>Match ${match.id}</strong></div>
        <label>
          <input type="radio" name="match_${match.id}" value="${match.teamA}">
          ${match.teamA}
        </label>
        <label>
          <input type="radio" name="match_${match.id}" value="${match.teamB}">
          ${match.teamB}
        </label>
        ${match.winner ? `<div class="hint">✅ Result: ${match.winner}</div>` : `<div class="hint">Result: not set yet</div>`}
      `;

      bracketEl.appendChild(div);
    });
  });
}

function savePredictions() {
  const username = document.getElementById("username").value.trim();
  if (!username) return alert("Enter your name");

  const picks = {};
  document.querySelectorAll("input[type=radio]:checked").forEach((input) => {
    picks[input.name] = input.value;
  });

  const all = JSON.parse(localStorage.getItem(predictionsKey) || "{}");
  all[username] = picks;
  localStorage.setItem(predictionsKey, JSON.stringify(all));

  alert("Predictions saved!");
  renderLeaderboard();
}

function renderLeaderboard() {
  leaderboardEl.innerHTML = "";

  const all = JSON.parse(localStorage.getItem(predictionsKey) || "{}");
  const scores = [];

  for (const user in all) {
    let score = 0;

    data.rounds.forEach((round) => {
      round.matches.forEach((match) => {
        const predicted = all[user][`match_${match.id}`];
        if (match.winner && predicted === match.winner) {
          score += round.points;
        }
      });
    });

    scores.push({ user, score });
  }

  scores.sort((a, b) => b.score - a.score);

  if (scores.length === 0) {
    leaderboardEl.innerHTML = "<li>No predictions saved yet.</li>";
    return;
  }

  scores.forEach((s) => {
    const li = document.createElement("li");
    li.textContent = `${s.user}: ${s.score} pts`;
    leaderboardEl.appendChild(li);
  });
}
