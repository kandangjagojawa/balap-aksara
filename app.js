/**
 * Balap Ketik Aksara Jawa - Core Application Logic
 * Supports Real-time Multi-device PeerJS Network
 */

// Global App State
let soalData = [];
let peer = null;
let hostConnMap = {}; // { connId: { conn, name, avatar, wordIdx, progressPercent, finished, finishTime } }
let role = null; // 'HOST' or 'PLAYER'
let roomCode = '';
let activeQuestions = [];
let currentQuestionIndex = 0;
let currentQuestion = null;

// Player Local State
let playerProfile = { name: '', avatar: '🏎️' };
let playerConn = null;
let playerTypedText = '';
let playerCurrentWordIdx = 0;
let playerIsFinished = false;

// DOM Elements
const views = {
  landing: document.getElementById('v-landing'),
  host: document.getElementById('v-host'),
  join: document.getElementById('v-join'),
  playerWaiting: document.getElementById('v-player-waiting'),
  playerGame: document.getElementById('v-player-game')
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  await loadSoalData();
  setupEventListeners();
});

// Load Questions from soal.json
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

// Populate Level Selection in Host Screen
function populateLevelCheckboxes() {
  const container = document.getElementById('levelContainer');
  if (!container) return;
  container.innerHTML = '';

  // Extract unique levels
  const levels = [...new Set(soalData.map(s => s.level))].sort((a,b) => a - b);
  levels.forEach(lvl => {
    const levelSoalList = soalData.filter(s => s.level === lvl);
    const titleName = levelSoalList[0]?.title || `Level ${lvl}`;
    
    const label = document.createElement('label');
    label.innerHTML = `
      <input type="checkbox" value="${lvl}" class="chk-level" checked>
      Level ${lvl}: ${titleName} (${levelSoalList.length} Soal)
    `;
    container.appendChild(label);
  });
}

// Navigation Helper
function showView(viewName) {
  Object.keys(views).forEach(k => {
    if (views[k]) views[k].classList.remove('active');
  });
  if (views[viewName]) views[viewName].classList.add('active');
}

// Generate 4-letter Room Code
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Setup Event Listeners
function setupEventListeners() {
  // Navigation
  document.getElementById('btnStartHost').addEventListener('click', initHostMode);
  document.getElementById('btnGoJoin').addEventListener('click', () => showView('join'));
  document.getElementById('btnResetHost').addEventListener('click', () => location.reload());

  // Guide Modal
  document.getElementById('btnGuide').addEventListener('click', () => {
    document.getElementById('guideModal').classList.add('active');
  });
  document.getElementById('btnCloseGuide').addEventListener('click', () => {
    document.getElementById('guideModal').classList.remove('active');
  });

  // Podium Modal Close
  document.getElementById('btnClosePodium').addEventListener('click', () => {
    document.getElementById('podiumModal').classList.remove('active');
  });

  // Avatar Picker
  document.querySelectorAll('.avatar-opt').forEach(opt => {
    opt.addEventListener('click', (e) => {
      document.querySelectorAll('.avatar-opt').forEach(a => a.classList.remove('selected'));
      e.target.classList.add('selected');
      playerProfile.avatar = e.target.getAttribute('data-avatar');
    });
  });

  // Join Form Submit
  document.getElementById('joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = document.getElementById('inputRoomCode').value.trim().toUpperCase();
    const name = document.getElementById('inputPlayerName').value.trim();
    if (!code || !name) return;
    initPlayerMode(code, name);
  });

  // Host Controls
  document.getElementById('btnStartRace').addEventListener('click', startRaceHost);
  document.getElementById('btnNextQuestion').addEventListener('click', nextQuestionHost);

  // Virtual Keyboard Listeners
  setupVirtualKeyboard();
}

// ==========================================
// HOST (GURU) MODE LOGIC
// ==========================================
function initHostMode() {
  role = 'HOST';
  roomCode = generateRoomCode();
  const peerId = `balap-aksara-${roomCode}`;

  document.getElementById('hostCodeDisplay').innerText = roomCode;
  showView('host');

  // Initialize PeerJS for Host
  peer = new Peer(peerId);

  peer.on('open', (id) => {
    console.log("Ruang Host Berhasil Dibuat ID:", id);
  });

  peer.on('error', (err) => {
    console.error("Peer Host Error:", err);
    if (err.type === 'unavailable-id') {
      alert("Kode ruangan terpakai, mencoba membuat kode baru...");
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
      finishTime: null
    };

    updateHostPlayerCount();
    renderRaceTrack();

    // Confirm connection back to player
    conn.send({ type: 'JOINED_SUCCESS', roomCode: roomCode });
  } 
  else if (data.type === 'PROGRESS') {
    if (hostConnMap[conn.peer]) {
      hostConnMap[conn.peer].wordIdx = data.wordIdx;
      hostConnMap[conn.peer].progressPercent = data.progressPercent;
      
      updatePlayerTrackPosition(conn.peer, data.progressPercent);

      if (data.progressPercent >= 100 && !hostConnMap[conn.peer].finished) {
        hostConnMap[conn.peer].finished = true;
        hostConnMap[conn.peer].finishTime = Date.now();
        checkRaceCompletion();
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

    lane.innerHTML = `
      <div class="lane-player-info">${p.avatar} ${p.name}</div>
      <div class="lane-avatar" id="avatar-${p.conn.peer}" style="left: 10px;">${p.avatar}</div>
      <div class="lane-finish-line"></div>
    `;
    container.appendChild(lane);

    // set current position
    updatePlayerTrackPosition(p.conn.peer, p.progressPercent || 0);
  });
}

function updatePlayerTrackPosition(peerId, percent) {
  const avatarElem = document.getElementById(`avatar-${peerId}`);
  if (!avatarElem) return;

  // Calculate percentage along track (leaving margin for finish flag)
  const leftPos = Math.min(percent, 100);
  avatarElem.style.left = `calc(${leftPos}% * 0.88 + 10px)`;
}

function startRaceHost() {
  // Filter active questions by selected levels
  const selectedLevels = Array.from(document.querySelectorAll('.chk-level:checked')).map(cb => parseInt(cb.value));
  
  if (selectedLevels.length === 0) {
    alert("Pilih minimal satu tingkat kesulitan!");
    return;
  }

  activeQuestions = soalData.filter(s => selectedLevels.includes(s.level));
  
  if (activeQuestions.length === 0) {
    alert("Tidak ada soal tersedia untuk level yang dipilih!");
    return;
  }

  // Shuffle questions
  activeQuestions.sort(() => Math.random() - 0.5);
  currentQuestionIndex = 0;

  broadcastQuestionToPlayers();

  document.getElementById('btnStartRace').style.display = 'none';
  document.getElementById('btnNextQuestion').style.display = 'inline-block';
}

function broadcastQuestionToPlayers() {
  currentQuestion = activeQuestions[currentQuestionIndex];

  // Update Host Display Banner
  document.getElementById('hostTargetLatin').innerText = `Soal ${currentQuestionIndex + 1}/${activeQuestions.length} - ${currentQuestion.title}: "${currentQuestion.latin}"`;
  document.getElementById('hostTargetAksara').innerText = currentQuestion.aksara;

  // Reset player progress for this question
  Object.keys(hostConnMap).forEach(peerId => {
    hostConnMap[peerId].wordIdx = 0;
    hostConnMap[peerId].progressPercent = 0;
    hostConnMap[peerId].finished = false;
    hostConnMap[peerId].finishTime = null;
    updatePlayerTrackPosition(peerId, 0);
  });

  // Broadcast to all connected player clients
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
    alert("Semua soal dalam ronde ini telah selesai!");
    showPodiumWinner();
  }
}

function checkRaceCompletion() {
  const players = Object.values(hostConnMap);
  const allFinished = players.length > 0 && players.every(p => p.finished);

  if (allFinished) {
    setTimeout(() => {
      showPodiumWinner();
    }, 1000);
  }
}

function showPodiumWinner() {
  const players = Object.values(hostConnMap);
  if (players.length === 0) return;

  // Sort players by finish time or progress
  players.sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progressPercent - a.progressPercent;
  });

  const listContainer = document.getElementById('podiumList');
  listContainer.innerHTML = '';

  players.forEach((p, index) => {
    const item = document.createElement('div');
    let rankClass = '';
    let medal = `Rank #${index + 1}`;
    if (index === 0) { rankClass = 'first'; medal = '🥇 Juara 1'; }
    else if (index === 1) { rankClass = 'second'; medal = '🥈 Juara 2'; }
    else if (index === 2) { rankClass = 'third'; medal = '🥉 Juara 3'; }

    item.className = `podium-item ${rankClass}`;
    item.innerHTML = `
      <div>${medal} - ${p.avatar} ${p.name}</div>
      <div style="color: var(--accent);">${p.finished ? 'FINISH 🏁' : Math.round(p.progressPercent) + '%'}</div>
    `;
    listContainer.appendChild(item);
  });

  document.getElementById('podiumTitle').innerText = `Hasil Ronde Soal ${currentQuestionIndex + 1}`;
  document.getElementById('podiumModal').classList.add('active');
}

// ==========================================
// PLAYER (SISWA) MODE LOGIC
// ==========================================
function initPlayerMode(code, name) {
  role = 'PLAYER';
  roomCode = code;
  playerProfile.name = name;

  document.getElementById('waitPlayerName').innerText = name;
  document.getElementById('waitRoomCode').innerText = code;
  showView('playerWaiting');

  // Connect to Host Peer ID
  const targetHostPeerId = `balap-aksara-${code}`;
  peer = new Peer();

  peer.on('open', (id) => {
    playerConn = peer.connect(targetHostPeerId);

    playerConn.on('open', () => {
      // Send JOIN payload
      playerConn.send({
        type: 'JOIN',
        name: playerProfile.name,
        avatar: playerProfile.avatar
      });
    });

    playerConn.on('data', (data) => handlePlayerIncomingData(data));

    playerConn.on('error', (err) => {
      alert("Gagal terhubung ke ruang guru! Periksa kembali kode ruangan.");
      showView('join');
    });
  });

  peer.on('error', (err) => {
    console.error("Peer Player Error:", err);
    alert("Tidak dapat menemukan ruangan dengan kode tersebut!");
    showView('join');
  });
}

function handlePlayerIncomingData(data) {
  if (data.type === 'START_QUESTION') {
    currentQuestion = data.question;
    playerTypedText = '';
    playerCurrentWordIdx = 0;
    playerIsFinished = false;

    renderPlayerGameScreen();
    showView('playerGame');
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

  // Render Latin Words
  const latinContainer = document.getElementById('pLatinWords');
  latinContainer.innerHTML = currentQuestion.words.map((w, idx) => {
    const activeCls = idx === playerCurrentWordIdx ? 'active-word' : '';
    return `<span class="${activeCls}">${w.latin}</span>`;
  }).join(' ');

  // Render Aksara Target Words
  const aksaraContainer = document.getElementById('pAksaraWords');
  aksaraContainer.innerHTML = currentQuestion.words.map((w, idx) => {
    if (idx < playerCurrentWordIdx) {
      return `<span class="completed">${w.aksara}</span>`;
    } else if (idx === playerCurrentWordIdx) {
      return `<span class="current">${w.aksara}</span>`;
    } else {
      return `<span>${w.aksara}</span>`;
    }
  }).join(' ');
}

function setupVirtualKeyboard() {
  // On-screen character keys
  document.querySelectorAll('.kb-key[data-char]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const char = btn.getAttribute('data-char');
      appendPlayerChar(char);
    });
  });

  // Backspace
  document.getElementById('btnKbBackspace').addEventListener('click', () => {
    removePlayerChar();
  });

  // Clear
  document.getElementById('btnKbClear').addEventListener('click', () => {
    playerTypedText = '';
    updateTypedDisplay();
  });

  // Space / Next Word
  document.getElementById('btnKbSpace').addEventListener('click', () => {
    checkWordMatchAndAdvance(true);
  });
}

function appendPlayerChar(char) {
  if (playerIsFinished) return;
  playerTypedText += char;
  updateTypedDisplay();
  checkWordMatchAndAdvance(false);
}

function removePlayerChar() {
  if (playerIsFinished || playerTypedText.length === 0) return;
  
  // Handle UTF-16 surrogate pairs and combined Aksara characters
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

  // If exact match OR forced by space button when matched
  if (typedTrimmed === targetAksara || (forcedBySpace && typedTrimmed === targetAksara)) {
    // Word completed!
    playerCurrentWordIdx++;
    playerTypedText = '';
    updateTypedDisplay();

    const totalWords = currentQuestion.words.length;
    const progressPercent = (playerCurrentWordIdx / totalWords) * 100;
    updatePlayerProgressBar(progressPercent);

    if (playerCurrentWordIdx >= totalWords) {
      playerIsFinished = true;
      document.getElementById('pPosIndicator').innerText = "FINISH 🏁";
    } else {
      document.getElementById('pPosIndicator').innerText = `Kata ${playerCurrentWordIdx + 1}/${totalWords}`;
    }

    // Send Progress to Host
    if (playerConn && playerConn.open) {
      playerConn.send({
        type: 'PROGRESS',
        wordIdx: playerCurrentWordIdx,
        progressPercent: progressPercent
      });
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
