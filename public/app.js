import { createSocket } from './socket.js';

// ── State ─────────────────────────────────────────────────────────
let state = {
  myName: null,
  room: null,
  screen: 'landing',
};

// ── DOM Refs (queried once) ───────────────────────────────────────
const screens = Object.fromEntries(
  [...document.querySelectorAll('[data-screen]')].map(el => [el.dataset.screen, el])
);

const els = {
  // create room
  hostNameInput:    document.getElementById('input-host-name'),
  // join room
  roomCodeInput:    document.getElementById('input-room-code'),
  playerNameInput:  document.getElementById('input-player-name'),
  // lobby
  lobbyRoomCode:    document.getElementById('lobby-room-code'),
  lobbyPlayerList:  document.getElementById('lobby-player-list'),
  lobbyCount:       document.getElementById('lobby-count'),
  btnStartGame:     document.getElementById('btn-start-game'),
  lobbyWaitingMsg:  document.getElementById('lobby-waiting-msg'),
  // nomination
  nomRound:         document.getElementById('nom-round'),
  nomRoomCode:      document.getElementById('nom-room-code'),
  nomBanner:        document.getElementById('nom-banner'),
  nomHostControls:  document.getElementById('nom-host-controls'),
  selectPresident:  document.getElementById('select-president'),
  selectChancellor: document.getElementById('select-chancellor'),
  btnCallVote:      document.getElementById('btn-call-vote'),
  nomPlayerMsg:     document.getElementById('nom-player-msg'),
  // voting
  voteRound:        document.getElementById('vote-round'),
  voteRoomCode:     document.getElementById('vote-room-code'),
  voteBanner:       document.getElementById('vote-banner'),
  voteControls:     document.getElementById('vote-controls'),
  btnJa:            document.getElementById('btn-ja'),
  btnNein:          document.getElementById('btn-nein'),
  voteCastMsg:      document.getElementById('vote-cast-msg'),
  voteBallotCount:  document.getElementById('vote-ballot-count'),
  voteWaitingMsg:   document.getElementById('vote-waiting-msg'),
  // result
  resultRound:      document.getElementById('result-round'),
  resultRoomCode:   document.getElementById('result-room-code'),
  resultBanner:     document.getElementById('result-banner'),
  resultVerdict:    document.getElementById('result-verdict'),
  resultTally:      document.getElementById('result-tally'),
  btnNextRound:     document.getElementById('btn-next-round'),
  resultWaitingMsg: document.getElementById('result-waiting-msg'),
  // error
  errorToast:       document.getElementById('error-toast'),
};

// ── Socket ────────────────────────────────────────────────────────
const socket = createSocket();

// ── Utilities ─────────────────────────────────────────────────────

function showScreen(name) {
  Object.values(screens).forEach(s => s.removeAttribute('data-active'));
  screens[name]?.setAttribute('data-active', '');
  state.screen = name;
}

function showError(msg) {
  els.errorToast.textContent = msg;
  els.errorToast.classList.remove('hidden');
  clearTimeout(showError._timer);
  showError._timer = setTimeout(() => els.errorToast.classList.add('hidden'), 3500);
}

function renderBanner(container, president, chancellor) {
  container.innerHTML = '';

  const presDiv = document.createElement('div');
  presDiv.className = 'banner-side banner-side--president';
  const presLabel = document.createElement('span');
  presLabel.className = 'banner-label';
  presLabel.textContent = 'PRESIDENT';
  const presName = document.createElement('span');
  presName.className = 'banner-name';
  presName.textContent = president || '—';
  presDiv.appendChild(presLabel);
  presDiv.appendChild(presName);

  const divider = document.createElement('div');
  divider.className = 'banner-divider';

  const chanDiv = document.createElement('div');
  chanDiv.className = 'banner-side banner-side--chancellor';
  const chanLabel = document.createElement('span');
  chanLabel.className = 'banner-label';
  chanLabel.textContent = 'CHANCELLOR';
  const chanName = document.createElement('span');
  chanName.className = 'banner-name';
  chanName.textContent = chancellor || '—';
  chanDiv.appendChild(chanLabel);
  chanDiv.appendChild(chanName);

  container.appendChild(presDiv);
  container.appendChild(divider);
  container.appendChild(chanDiv);
}

function populatePlayerSelect(selectEl, players, ineligibleName, excludeName) {
  const currentVal = selectEl.value;
  selectEl.innerHTML = '<option value="">— choose —</option>';

  for (const player of players) {
    if (player.name === excludeName) continue;
    const opt = document.createElement('option');
    opt.value = player.name;
    const ineligible = player.name === ineligibleName;
    opt.textContent = ineligible ? `${player.name} (ineligible)` : player.name;
    opt.disabled = ineligible;
    selectEl.appendChild(opt);
  }

  // Restore previous selection if still valid
  if (currentVal) {
    const match = [...selectEl.options].find(o => o.value === currentVal && !o.disabled);
    if (match) selectEl.value = currentVal;
  }
}

function saveSession(name, roomCode) {
  try {
    localStorage.setItem('sh_name', name);
    localStorage.setItem('sh_room', roomCode);
  } catch { /* storage unavailable */ }
}

function clearSession() {
  try {
    localStorage.removeItem('sh_name');
    localStorage.removeItem('sh_room');
  } catch { /* storage unavailable */ }
}

function loadSession() {
  try {
    return {
      name: localStorage.getItem('sh_name'),
      room: localStorage.getItem('sh_room'),
    };
  } catch {
    return { name: null, room: null };
  }
}

// ── Render Functions ──────────────────────────────────────────────

function renderLobby(room) {
  els.lobbyRoomCode.textContent = room.code;

  const active = room.players.filter(p => !p.disconnected);
  els.lobbyPlayerList.innerHTML = '';

  for (let i = 0; i < 10; i++) {
    const li = document.createElement('li');
    if (i < active.length) {
      li.setAttribute('data-filled', '');
      const p = active[i];
      li.textContent = p.name;
      if (p.isYou) {
        const tag = document.createElement('span');
        tag.className = 'you-tag';
        tag.textContent = '(you)';
        li.appendChild(tag);
      }
    } else {
      li.textContent = '…waiting';
    }
    els.lobbyPlayerList.appendChild(li);
  }

  const count = active.length;
  els.lobbyCount.textContent = count < 5
    ? `${count} present — need at least 5 to begin`
    : `${count} legislators present`;

  if (room.isHost) {
    els.btnStartGame.classList.remove('hidden');
    els.lobbyWaitingMsg.classList.add('hidden');
    els.btnStartGame.disabled = count < 5;
  } else {
    els.btnStartGame.classList.add('hidden');
    els.lobbyWaitingMsg.classList.remove('hidden');
  }
}

function renderNomination(room) {
  els.nomRound.textContent = `ROUND ${room.round}`;
  els.nomRoomCode.textContent = room.code;

  const { president, chancellor } = room.nominations;
  renderBanner(els.nomBanner, president, chancellor);

  if (room.isHost) {
    els.nomHostControls.classList.remove('hidden');
    els.nomPlayerMsg.classList.add('hidden');

    const active = room.players.filter(p => !p.disconnected);
    populatePlayerSelect(els.selectPresident, active, room.ineligible.president, null);

    const selectedPres = els.selectPresident.value;
    populatePlayerSelect(els.selectChancellor, active, room.ineligible.chancellor, selectedPres || null);

    updateCallVoteBtn();
  } else {
    els.nomHostControls.classList.add('hidden');
    els.nomPlayerMsg.classList.remove('hidden');
  }
}

function updateCallVoteBtn() {
  const p = els.selectPresident.value;
  const c = els.selectChancellor.value;
  els.btnCallVote.disabled = !p || !c;
}

function renderVoting(room) {
  els.voteRound.textContent = `ROUND ${room.round}`;
  els.voteRoomCode.textContent = room.code;

  renderBanner(els.voteBanner, room.nominations.president, room.nominations.chancellor);

  const me = room.players.find(p => p.isYou);
  const hasVoted = me?.hasVoted || false;

  if (hasVoted) {
    els.voteControls.classList.add('hidden');
    els.voteCastMsg.classList.remove('hidden');
    els.voteWaitingMsg.classList.remove('hidden');
  } else {
    els.voteControls.classList.remove('hidden');
    els.voteCastMsg.classList.add('hidden');
    els.voteWaitingMsg.classList.add('hidden');
    els.btnJa.disabled = false;
    els.btnNein.disabled = false;
  }

  const active = room.players.filter(p => !p.disconnected);
  els.voteBallotCount.textContent = `${room.ballotCount.cast} of ${active.length} ballots cast`;
}

function renderResult(room) {
  els.resultRound.textContent = `ROUND ${room.round}`;
  els.resultRoomCode.textContent = room.code;

  renderBanner(els.resultBanner, room.nominations.president, room.nominations.chancellor);

  const result = room.lastResult;
  if (result) {
    els.resultVerdict.textContent = result.elected
      ? 'GOVERNMENT\nELECTED'
      : 'GOVERNMENT\nREJECTED';
    els.resultVerdict.setAttribute('data-elected', String(result.elected));

    els.resultTally.innerHTML = '';
    const jaSpan = document.createElement('span');
    jaSpan.textContent = `JA!  ${result.ja}`;
    const neinSpan = document.createElement('span');
    neinSpan.textContent = `NEIN!  ${result.nein}`;
    els.resultTally.appendChild(jaSpan);
    els.resultTally.appendChild(neinSpan);
  }

  if (room.isHost) {
    els.btnNextRound.classList.remove('hidden');
    els.resultWaitingMsg.classList.add('hidden');
  } else {
    els.btnNextRound.classList.add('hidden');
    els.resultWaitingMsg.classList.remove('hidden');
  }
}

function applyRoomState(room) {
  state.room = room;
  if (room.myName) state.myName = room.myName;
  saveSession(room.myName, room.code);

  switch (room.phase) {
    case 'lobby':      renderLobby(room);      showScreen('lobby');      break;
    case 'nomination': renderNomination(room); showScreen('nomination'); break;
    case 'voting':     renderVoting(room);     showScreen('voting');     break;
    case 'result':     renderResult(room);     showScreen('result');     break;
  }
}

// ── Button Event Listeners ────────────────────────────────────────

document.getElementById('btn-go-create').addEventListener('click', () => showScreen('create-room'));
document.getElementById('btn-go-join').addEventListener('click', () => showScreen('join-room'));
document.getElementById('btn-back-from-create').addEventListener('click', () => showScreen('landing'));
document.getElementById('btn-back-from-join').addEventListener('click', () => showScreen('landing'));

document.getElementById('btn-create-submit').addEventListener('click', () => {
  const name = els.hostNameInput.value.trim();
  if (!name) return showError('Enter your name to create a room.');
  state.myName = name;
  socket.send('room:create', { hostName: name });
});

document.getElementById('btn-join-submit').addEventListener('click', () => {
  const code = els.roomCodeInput.value.trim().toUpperCase();
  const name = els.playerNameInput.value.trim();
  if (!code) return showError('Enter the room code.');
  if (!name) return showError('Enter your name.');
  state.myName = name;
  socket.send('room:join', { code, name });
});

// Allow pressing Enter to submit on create/join screens
els.hostNameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-create-submit').click();
});
els.playerNameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-join-submit').click();
});
els.roomCodeInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') els.playerNameInput.focus();
});

els.btnStartGame.addEventListener('click', () => socket.send('game:start'));

els.selectPresident.addEventListener('change', () => {
  if (!state.room) return;
  const active = state.room.players.filter(p => !p.disconnected);
  populatePlayerSelect(
    els.selectChancellor,
    active,
    state.room.ineligible.chancellor,
    els.selectPresident.value || null
  );
  updateCallVoteBtn();
});

els.selectChancellor.addEventListener('change', updateCallVoteBtn);

els.btnCallVote.addEventListener('click', () => {
  const president = els.selectPresident.value;
  const chancellor = els.selectChancellor.value;
  if (!president || !chancellor) return showError('Select both President and Chancellor.');
  socket.send('nomination:set', { president, chancellor });
  socket.send('vote:call');
  els.btnCallVote.disabled = true;
});

els.btnJa.addEventListener('click', () => {
  els.btnJa.disabled = true;
  els.btnNein.disabled = true;
  socket.send('vote:cast', { direction: 'ja' });
});

els.btnNein.addEventListener('click', () => {
  els.btnJa.disabled = true;
  els.btnNein.disabled = true;
  socket.send('vote:cast', { direction: 'nein' });
});

els.btnNextRound.addEventListener('click', () => socket.send('round:next'));

// ── Socket Event Handlers ─────────────────────────────────────────

socket.on('room:state', applyRoomState);

socket.on('vote:ballot_count', msg => {
  if (state.screen === 'voting') {
    els.voteBallotCount.textContent = `${msg.cast} of ${msg.total} ballots cast`;
  }
});

socket.on('error', msg => showError(msg.message));

socket.on('socket:reconnect', () => {
  const { name, room } = loadSession();
  if (name && room) {
    state.myName = name;
    socket.send('room:join', { code: room, name });
  }
});
