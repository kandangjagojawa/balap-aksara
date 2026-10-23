/**
 * Balap Ketik Aksara Jawa - Core Application Logic
 */

let soalData = [];
let peer = null;
let hostConnMap = {}; 
let role = null;
let roomCode = '';
let activeQuestions = [];
let currentQuestionIndex = 0;
let currentQuestion = null;
let questionStartTime = 0;

// Player State
let playerProfile = { name: '', avatar: '🏎️' };
let playerConn = null;
let playerTypedText = '';
let playerCurrentWordIdx = 0;
let playerIsFinished = false;

const views = {
  landing: document.getElementById('v-landing'),
  host: document.getElementById('v-host'),
  join: document.getElementById('v-join'),
  playerWaiting: document.getElementById('v-player-waiting'),
  playerGame: document.getElementById('v-player-game')
};

document.addEventListener('DOMContentLoaded', async () => {
  await loadSoalData();
  setupEventListeners();
});

async function loadSoalData() {
  try {
    const res = await fetch('soal.json');
    soalData = await res.json();
    populateLevelCheckboxes();
  } catch (err) {
    console.error("Gagal memuat soal.json:", err);
    alert("Gagal memuat file soal.json. Pastikan file soal.json tersedia!");
  }
}

function populateLevelCheckboxes() {
  const container = document.getElementById('levelContainer');
  if (!container) return;
  container.innerHTML = '';

  const levels = [...new Set(soalData.map(s => s.level))].sort((a,b) => a - b);
  levels.forEach(lvl => {
    const levelSoalList = soalData.filter(s => s.level === lvl);
    const titleName = levelSoalList[0]?.title || `Level ${lvl}`;
    
    const label = document.createElement('label');
    label.innerHTML = `
      <input type="checkbox" value="${lvl}" class="chk-level" checked>
      Lvl ${lvl}: ${titleName} (${levelSoalList.length} Soal)
    `;
    container.appendChild(label);
  });
}

function showView(viewName) {
  Object.keys(views).forEach(k => {
    if (views[k]) views[k].classList.remove('active');
  });
  if (views[viewName]) views[viewName].classList.add('active');
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function formatDuration(totalSeconds) {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}m ${secs}s`;
}

function setupEventListeners() {
  document.getElementById('btnStartHost').addEventListener('click', initHostMode);
  document.getElementById('btnGoJoin').addEventListener('click', () => showView('join'));
  document.getElementById('btnResetHost').addEventListener('click', () => location.reload());

  document.getElementById('btnGuide').addEventListener('click', () => {
    document.getElementById('guideModal').classList.add('active');
  });
  document.getElementById('btnCloseGuide').addEventListener('click', () => {
    document.getElementById('guideModal').classList.remove('active');
  });

  document.getElementById('btnClosePodium').addEventListener('click', () => {
    document.getElementById('podiumModal').classList.remove('active');
  });

  document.querySelectorAll('.avatar-opt').forEach(opt => {
    opt.addEventListener('click', (e) => {
      document.querySelectorAll('.avatar-opt').forEach(a => a.classList.remove('selected'));
      e.target.classList.add('selected');
      playerProfile.avatar = e.target.getAttribute('data-avatar');
    });
  });

  document.getElementById('joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = document.getElementById('inputRoomCode').value.trim().toUpperCase();
    const name = document.getElementById('inputPlayerName').value.trim();
    if (!code || !name) return;
    initPlayerMode(code, name);
  });

  document.getElementById('btnStartRace').addEventListener('click', startRaceHost);
  document.getElementById('btnNextQuestion').addEventListener('click', nextQuestionHost);
  document.getElementById('btnEndRace').addEventListener('click', endRaceHost);
  document.getElementById('btnStartNewGame').addEventListener('click', resetForNewGameHost);

  setupVirtualKeyboard();
}

// ================= HOST MODE =================
function initHostMode() {
  role = 'HOST';
  roomCode = generateRoomCode();
  const peerId = `balap-aksara-${roomCode}`;

  document.getElementById('hostCodeDisplay').innerText = roomCode;
  showView('host');

  peer = new Peer(peerId);

  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      initHostMode();
    }
  });

  peer.on('connection', (conn) => {
    conn.on('data', (data) => handleHostIncomingData(conn, data));
    conn.on('close', () => handleHostPlayerDisconnect(conn.peer));
  });
}

function handleHostIncomingData(conn, data) {
  if (data.type === 'JOIN') {
    hostConnMap[conn.peer] = {
      conn: conn,
      name: data.name,
      avatar: data.avatar || '🏎️',
      wordIdx: 0,
      progressPercent: 0,
      finished: false,
      finishTime: null,
      score: 0,
      lastQuestionTime: 0,
      totalTimeSpent: 0,
      fastestTime: null
    };

    updateHostPlayerCount();
    renderRaceTrack();
    conn.send({ type: 'JOINED_SUCCESS', roomCode: roomCode });
  } 
  else if (data.type === 'PROGRESS') {
    const player = hostConnMap[conn.peer];
    if (player) {
      player.wordIdx = data.wordIdx;
      player.progressPercent = data.progressPercent;
      
      updatePlayerTrackPosition(conn.peer, data.progressPercent);

      if (data.progressPercent >= 100 && !player.finished) {
        player.finished = true;
        player.finishTime = Date.now();
        
        const timeSpent = data.timeSpent || Math.max(1, Math.round((Date.now() - questionStartTime) / 1000));
        player.lastQuestionTime = timeSpent;
        player.totalTimeSpent += timeSpent;
        
        if (player.fastestTime === null || timeSpent < player.fastestTime) {
          player.fastestTime = timeSpent;
        }

        const finishedCount = Object.values(hostConnMap).filter(p => p.finished).length;
        const pointTable = [100, 80, 60, 50, 40, 30, 20, 10];
        const addScore = pointTable[finishedCount - 1] || 10;
        player.score += addScore;

        renderRaceTrack();
      }
    }
  }
}

function handleHostPlayerDisconnect(peerId) {
  delete hostConnMap[peerId];
  updateHostPlayerCount();
  renderRaceTrack();
}

function updateHostPlayerCount() {
  const count = Object.keys(hostConnMap).length;
  document.getElementById('playerCountBadge').innerText = `👥 ${count} Siswa Terhubung`;
}

function renderRaceTrack() {
  const container = document.getElementById('raceTrack');
  const players = Object.values(hostConnMap);

  if (players.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-sub); margin-top: 4rem;">
        Menunggu siswa bergabung menggunakan Kode Ruangan di atas...
      </div>`;
    return;
  }

  container.innerHTML = '';
  players.forEach(p => {
    const lane = document.createElement('div');
    lane.className = 'race-lane';
    lane.id = `lane-${p.conn.peer}`;

    const timeLabel = p.lastQuestionTime > 0 ? ` (${p.lastQuestionTime}s)` : '';
    lane.innerHTML = `
      <div class="lane-player-info">${p.avatar} ${p.name} - ${p.score || 0} Pts${timeLabel}</div>
      <div class="lane-avatar" id="avatar-${p.conn.peer}" style="left: 10px;">${p.avatar}</div>
      <div class="lane-finish-line"></div>
    `;
    container.appendChild(lane);
    updatePlayerTrackPosition(p.conn.peer, p.progressPercent || 0);
  });
}

function updatePlayerTrackPosition(peerId, percent) {
  const avatarElem = document.getElementById(`avatar-${peerId}`);
  if (!avatarElem) return;
  const leftPos = Math.min(percent, 100);
  avatarElem.style.left = `calc(${leftPos}% * 0.88 + 10px)`;
}

function startRaceHost() {
  const selectedLevels = Array.from(document.querySelectorAll('.chk-level:checked')).map(cb => parseInt(cb.value));
  
  if (selectedLevels.length === 0) {
    alert("Pilih minimal satu tingkat kesulitan!");
    return;
  }

  activeQuestions = soalData.filter(s => selectedLevels.includes(s.level));
  if (activeQuestions.length === 0) {
    alert("Tidak ada soal tersedia!");
    return;
  }

  activeQuestions.sort(() => Math.random() - 0.5);
  currentQuestionIndex = 0;

  broadcastQuestionToPlayers();

  document.getElementById('levelSelectorBox').style.display = 'none';
  document.getElementById('btnStartRace').style.display = 'none';
  document.getElementById('btnNextQuestion').style.display = 'inline-block';
  document.getElementById('btnEndRace').style.display = 'inline-block';
  document.getElementById('btnStartNewGame').style.display = 'none';
}

function broadcastQuestionToPlayers() {
  currentQuestion = activeQuestions[currentQuestionIndex];
  questionStartTime = Date.now();

  document.getElementById('hostTargetLatin').innerText = `Soal ${currentQuestionIndex + 1}/${activeQuestions.length} - ${currentQuestion.title}: "${currentQuestion.latin}"`;
  document.getElementById('hostTargetAksara').innerText = currentQuestion.aksara;

  Object.keys(hostConnMap).forEach(peerId => {
    hostConnMap[peerId].wordIdx = 0;
    hostConnMap[peerId].progressPercent = 0;
    hostConnMap[peerId].finished = false;
    hostConnMap[peerId].finishTime = null;
    hostConnMap[peerId].lastQuestionTime = 0;
    updatePlayerTrackPosition(peerId, 0);
  });

  renderRaceTrack();

  const payload = {
    type: 'START_QUESTION',
    questionIndex: currentQuestionIndex,
    totalQuestions: activeQuestions.length,
    question: currentQuestion
  };

  Object.values(hostConnMap).forEach(p => {
    p.conn.send(payload);
  });
}

function nextQuestionHost() {
  if (currentQuestionIndex + 1 < activeQuestions.length) {
    currentQuestionIndex++;
    broadcastQuestionToPlayers();
  } else {
    endRaceHost();
  }
}

function endRaceHost() {
  const players = Object.values(hostConnMap);
  players.sort((a, b) => b.score - a.score || a.totalTimeSpent - b.totalTimeSpent);

  const leaderboardData = players.map((p, index) => ({
    rank: index + 1,
    name: p.name,
    avatar: p.avatar,
    score: p.score,
    totalTimeSpent: p.totalTimeSpent,
    fastestTime: p.fastestTime
  }));

  renderLeaderboardModal(leaderboardData, true);

  Object.values(hostConnMap).forEach(p => {
    p.conn.send({
      type: 'GAME_ENDED',
      leaderboard: leaderboardData
    });
  });

  document.getElementById('btnNextQuestion').style.display = 'none';
  document.getElementById('btnEndRace').style.display = 'none';
  document.getElementById('btnStartNewGame').style.display = 'inline-block';
}

function renderLeaderboardModal(leaderboardData, isHost = false) {
  const listContainer = document.getElementById('podiumList');
  listContainer.innerHTML = '';

  leaderboardData.forEach((p) => {
    const item = document.createElement('div');
    let rankClass = '';
    let medal = `#${p.rank}`;
    if (p.rank === 1) { rankClass = 'first'; medal = '👑 Juara 1'; }
    else if (p.rank === 2) { rankClass = 'second'; medal = '🥈 Juara 2'; }
    else if (p.rank === 3) { rankClass = 'third'; medal = '🥉 Juara 3'; }

    const formattedTotalTime = formatDuration(p.totalTimeSpent || 0);
    const formattedFastest = p.fastestTime ? `${p.fastestTime}s` : '-';

    item.className = `podium-item ${rankClass}`;
    item.innerHTML = `
      <div>${medal} - ${p.avatar} ${p.name}</div>
      <div class="podium-details">
        <div style="color: var(--accent); font-weight: 800; font-size: 1.1rem;">${p.score} PTS</div>
        <div style="color: var(--text-sub); font-size: 0.75rem;">Total: <b>${formattedTotalTime}</b> | Tercepat: <b>${formattedFastest}</b></div>
      </div>
    `;
    listContainer.appendChild(item);
  });

  document.getElementById('podiumHeaderTitle').innerText = "🏆 KLASEMEN AKHIR 🏆";
  document.getElementById('podiumTitle').innerText = "Permainan Telah Diakhiri";
  
  const closeBtn = document.getElementById('btnClosePodium');
  if (!isHost) {
    closeBtn.style.display = 'none';
  } else {
    closeBtn.style.display = 'inline-block';
  }

  document.getElementById('podiumModal').classList.add('active');
}

function resetForNewGameHost() {
  document.getElementById('podiumModal').classList.remove('active');

  Object.keys(hostConnMap).forEach(peerId => {
    hostConnMap[peerId].score = 0;
    hostConnMap[peerId].totalTimeSpent = 0;
    hostConnMap[peerId].fastestTime = null;
    hostConnMap[peerId].lastQuestionTime = 0;
    hostConnMap[peerId].wordIdx = 0;
    hostConnMap[peerId].progressPercent = 0;
    hostConnMap[peerId].finished = false;
  });

  Object.values(hostConnMap).forEach(p => {
    p.conn.send({ type: 'RESET_TO_LOBBY' });
  });

  document.getElementById('hostTargetLatin').innerText = "Menunggu balapan baru dimulai...";
  document.getElementById('hostTargetAksara').innerText = "ꦱꦸꦒꦼꦁꦫꦮꦸꦃ";

  renderRaceTrack();

  document.getElementById('levelSelectorBox').style.display = 'block';
  document.getElementById('btnStartRace').style.display = 'inline-block';
  document.getElementById('btnStartNewGame').style.display = 'none';
  document.getElementById('btnNextQuestion').style.display = 'none';
  document.getElementById('btnEndRace').style.display = 'none';
}

// ================= PLAYER MODE =================
function initPlayerMode(code, name) {
  role = 'PLAYER';
  roomCode = code;
  playerProfile.name = name;

  document.getElementById('waitPlayerName').innerText = name;
  document.getElementById('waitRoomCode').innerText = code;
  showView('playerWaiting');

  const targetHostPeerId = `balap-aksara-${code}`;
  peer = new Peer();

  peer.on('open', () => {
    playerConn = peer.connect(targetHostPeerId);

    playerConn.on('open', () => {
      playerConn.send({
        type: 'JOIN',
        name: playerProfile.name,
        avatar: playerProfile.avatar
      });
    });

    playerConn.on('data', (data) => handlePlayerIncomingData(data));
  });

  peer.on('error', () => {
    alert("Gagal terhubung ke ruang guru! Periksa kode ruangan.");
    showView('join');
  });
}

function handlePlayerIncomingData(data) {
  if (data.type === 'START_QUESTION') {
    document.getElementById('podiumModal').classList.remove('active');
    currentQuestion = data.question;
    questionStartTime = Date.now();
    playerTypedText = '';
    playerCurrentWordIdx = 0;
    playerIsFinished = false;

    renderPlayerGameScreen();
    showView('playerGame');
  } 
  else if (data.type === 'GAME_ENDED') {
    renderLeaderboardModal(data.leaderboard, false);
  }
  else if (data.type === 'RESET_TO_LOBBY') {
    document.getElementById('podiumModal').classList.remove('active');
    showView('playerWaiting');
  }
}

function renderPlayerGameScreen() {
  if (!currentQuestion) return;

  const totalWords = currentQuestion.words.length;
  document.getElementById('pCurrentWordIdx').innerText = playerCurrentWordIdx + 1;
  document.getElementById('pTotalWords').innerText = totalWords;
  document.getElementById('pTypedDisplay').innerText = '';
  document.getElementById('pPosIndicator').innerText = `Kata ${playerCurrentWordIdx + 1}/${totalWords}`;
  
  updatePlayerProgressBar(0);

  const latinContainer = document.getElementById('pLatinWords');
  latinContainer.innerHTML = currentQuestion.words.map((w, idx) => {
    const activeCls = idx === playerCurrentWordIdx ? 'active-word' : '';
    return `<span class="${activeCls}">${w.latin}</span>`;
  }).join(' ');

  // Scripto continua (join Tanpa Spasi)
  const aksaraContainer = document.getElementById('pAksaraWords');
  aksaraContainer.innerHTML = currentQuestion.words.map((w, idx) => {
    if (idx < playerCurrentWordIdx) return `<span class="completed">${w.aksara}</span>`;
    if (idx === playerCurrentWordIdx) return `<span class="current">${w.aksara}</span>`;
    return `<span>${w.aksara}</span>`;
  }).join('');
}

function setupVirtualKeyboard() {
  document.querySelectorAll('.kb-key[data-char]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      appendPlayerChar(btn.getAttribute('data-char'));
    });
  });

  document.getElementById('btnKbBackspace').addEventListener('click', removePlayerChar);
  document.getElementById('btnKbClear').addEventListener('click', () => {
    playerTypedText = '';
    updateTypedDisplay();
  });
  document.getElementById('btnKbSpace').addEventListener('click', () => checkWordMatchAndAdvance(true));
}

function appendPlayerChar(char) {
  if (playerIsFinished) return;
  playerTypedText += char;
  updateTypedDisplay();
  checkWordMatchAndAdvance(false);
}

function removePlayerChar() {
  if (playerIsFinished || playerTypedText.length === 0) return;
  const chars = Array.from(playerTypedText);
  chars.pop();
  playerTypedText = chars.join('');
  updateTypedDisplay();
}

function updateTypedDisplay() {
  document.getElementById('pTypedDisplay').innerText = playerTypedText;
}

function checkWordMatchAndAdvance(forcedBySpace) {
  if (playerIsFinished || !currentQuestion) return;

  const currentTargetWord = currentQuestion.words[playerCurrentWordIdx];
  if (!currentTargetWord) return;

  const targetAksara = currentTargetWord.aksara.trim();
  const typedTrimmed = playerTypedText.trim();

  if (typedTrimmed === targetAksara || (forcedBySpace && typedTrimmed === targetAksara)) {
    playerCurrentWordIdx++;
    playerTypedText = '';
    updateTypedDisplay();

    const totalWords = currentQuestion.words.length;
    const progressPercent = (playerCurrentWordIdx / totalWords) * 100;
    updatePlayerProgressBar(progressPercent);

    if (playerCurrentWordIdx >= totalWords) {
      playerIsFinished = true;
      const timeSpent = Math.max(1, Math.round((Date.now() - questionStartTime) / 1000));
      document.getElementById('pPosIndicator').innerText = `FINISH 🏁 (${timeSpent}s)`;

      if (playerConn && playerConn.open) {
        playerConn.send({
          type: 'PROGRESS',
          wordIdx: playerCurrentWordIdx,
          progressPercent: 100,
          timeSpent: timeSpent
        });
      }
    } else {
      document.getElementById('pPosIndicator').innerText = `Kata ${playerCurrentWordIdx + 1}/${totalWords}`;
      if (playerConn && playerConn.open) {
        playerConn.send({
          type: 'PROGRESS',
          wordIdx: playerCurrentWordIdx,
          progressPercent: progressPercent
        });
      }
    }

    if (!playerIsFinished) {
      renderPlayerGameScreen();
    }
  }
}

function updatePlayerProgressBar(percent) {
  const bar = document.getElementById('pProgressBar');
  if (bar) bar.style.width = `${percent}%`;
}
