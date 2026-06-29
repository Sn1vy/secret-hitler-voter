import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const rooms = new Map();
const sockets = new Map(); // socketId -> { ws, roomCode, playerName }

const LETTER_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O

// ─── Room factory & helpers ───────────────────────────────────────────────────

function generateCode() {
  let code;
  do {
    const l1 = LETTER_CHARS[Math.floor(Math.random() * LETTER_CHARS.length)];
    const l2 = LETTER_CHARS[Math.floor(Math.random() * LETTER_CHARS.length)];
    const digits = String(Math.floor(Math.random() * 9000) + 1000);
    code = `${l1}${l2}-${digits}`;
  } while (rooms.has(code));
  return code;
}

function createRoom(code, hostName) {
  return {
    code,
    phase: 'lobby',
    host: hostName,
    players: [],
    round: 0,
    nominations: { president: null, chancellor: null },
    ineligible: { president: null, chancellor: null },
    failedElections: 0,
    ballotCount: { ja: 0, nein: 0, cast: 0 },
    lastResult: null,
    history: [],
    publicVoting: false,
  };
}

function sendTo(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function sendError(ws, message) {
  sendTo(ws, { type: 'error', message });
}

function getRoomSnapshot(room, requestingName) {
  return {
    type: 'room:state',
    code: room.code,
    phase: room.phase,
    host: room.host,
    round: room.round,
    nominations: room.nominations,
    ineligible: room.ineligible,
    failedElections: room.failedElections,
    ballotCount: room.ballotCount,
    lastResult: room.lastResult,
    publicVoting: room.publicVoting,
    players: room.players.map(p => ({
      name: p.name,
      hasVoted: p.hasVoted,
      disconnected: p.disconnected || false,
      isYou: p.name === requestingName,
      ...(room.publicVoting && room.phase === 'result' ? { voteDirection: p.voteDirection || null } : {}),
    })),
    isHost: room.host === requestingName,
    myName: requestingName,
  };
}

function broadcastRoomState(room) {
  for (const [, ctx] of sockets) {
    if (ctx.roomCode === room.code && ctx.ws.readyState === WebSocket.OPEN) {
      sendTo(ctx.ws, getRoomSnapshot(room, ctx.playerName));
    }
  }
}

function advanceToNomination(room) {
  room.phase = 'nomination';
  room.round += 1;
  room.nominations = { president: null, chancellor: null };
  room.players.forEach(p => { p.hasVoted = false; p.voteDirection = null; });
  room.ballotCount = { ja: 0, nein: 0, cast: 0 };
}

function computeResult(room) {
  const { ja, nein } = room.ballotCount;
  const elected = ja > nein;

  const result = {
    ja,
    nein,
    elected,
    president: room.nominations.president,
    chancellor: room.nominations.chancellor,
    round: room.round,
  };

  room.lastResult = result;
  room.history.push(result);

  if (elected) {
    room.ineligible = {
      president: room.nominations.president,
      chancellor: room.nominations.chancellor,
    };
    room.failedElections = 0;
  } else {
    room.failedElections += 1;
    if (room.failedElections >= 3) {
      room.ineligible = { president: null, chancellor: null };
      room.failedElections = 0;
    }
  }

  room.phase = 'result';
  broadcastRoomState(room);
}

// ─── Message handlers ─────────────────────────────────────────────────────────

function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  const socketId = ws.id;
  const ctx = sockets.get(socketId);
  const room = ctx?.roomCode ? rooms.get(ctx.roomCode) : null;

  switch (msg.type) {

    case 'room:create': {
      const name = (msg.hostName || '').trim().slice(0, 24);
      if (!name) return sendError(ws, 'Name is required.');
      const code = generateCode();
      const newRoom = createRoom(code, name);
      newRoom.players.push({ name, hasVoted: false, disconnected: false });
      rooms.set(code, newRoom);
      ctx.roomCode = code;
      ctx.playerName = name;
      sendTo(ws, getRoomSnapshot(newRoom, name));
      break;
    }

    case 'room:join': {
      const code = (msg.code || '').trim().toUpperCase();
      const name = (msg.name || '').trim().slice(0, 24);
      if (!code || !name) return sendError(ws, 'Room code and name are required.');

      const joinRoom = rooms.get(code);
      if (!joinRoom) return sendError(ws, 'No room with that code. Check and try again.');

      // Reconnect: player already exists in room
      const existing = joinRoom.players.find(p => p.name === name);
      if (existing) {
        existing.disconnected = false;
        ctx.roomCode = code;
        ctx.playerName = name;
        sendTo(ws, getRoomSnapshot(joinRoom, name));
        broadcastRoomState(joinRoom);
        return;
      }

      if (joinRoom.phase !== 'lobby') return sendError(ws, 'This game is already in progress.');

      const activePlayers = joinRoom.players.filter(p => !p.disconnected);
      if (activePlayers.length >= 10) return sendError(ws, 'This room is full (10 players maximum).');
      if (joinRoom.players.some(p => p.name === name)) return sendError(ws, 'That name is taken in this room.');

      joinRoom.players.push({ name, hasVoted: false, disconnected: false });
      ctx.roomCode = code;
      ctx.playerName = name;
      broadcastRoomState(joinRoom);
      break;
    }

    case 'game:start': {
      if (!room) return sendError(ws, 'Not in a room.');
      if (room.host !== ctx.playerName) return sendError(ws, 'Only the host can start the game.');
      if (room.phase !== 'lobby') return sendError(ws, 'Game already started.');
      const active = room.players.filter(p => !p.disconnected);
      if (active.length < 5) return sendError(ws, 'Need at least 5 players to start.');
      room.publicVoting = !!msg.publicVoting;
      advanceToNomination(room);
      broadcastRoomState(room);
      break;
    }

    case 'nomination:set': {
      if (!room) return sendError(ws, 'Not in a room.');
      if (room.host !== ctx.playerName) return sendError(ws, 'Only the host can nominate.');
      if (room.phase !== 'nomination') return sendError(ws, 'Not in nomination phase.');

      const { president, chancellor } = msg;
      if (!president || !chancellor) return sendError(ws, 'Both roles must be filled.');
      if (president === chancellor) return sendError(ws, 'President and Chancellor must be different players.');

      const names = room.players.filter(p => !p.disconnected).map(p => p.name);
      if (!names.includes(president) || !names.includes(chancellor)) {
        return sendError(ws, 'Invalid player selection.');
      }
      if (president === room.ineligible.president) {
        return sendError(ws, `${president} is term-limited and cannot be President this round.`);
      }
      if (chancellor === room.ineligible.chancellor) {
        return sendError(ws, `${chancellor} is term-limited and cannot be Chancellor this round.`);
      }

      room.nominations = { president, chancellor };
      broadcastRoomState(room);
      break;
    }

    case 'vote:call': {
      if (!room) return sendError(ws, 'Not in a room.');
      if (room.host !== ctx.playerName) return sendError(ws, 'Only the host can call a vote.');
      if (room.phase !== 'nomination') return sendError(ws, 'Not in nomination phase.');
      if (!room.nominations.president || !room.nominations.chancellor) {
        return sendError(ws, 'Both roles must be nominated before calling a vote.');
      }
      room.phase = 'voting';
      room.players.forEach(p => { p.hasVoted = false; });
      room.ballotCount = { ja: 0, nein: 0, cast: 0 };
      broadcastRoomState(room);
      break;
    }

    case 'vote:cast': {
      if (!room) return sendError(ws, 'Not in a room.');
      if (room.phase !== 'voting') return sendError(ws, 'Not in voting phase.');

      const player = room.players.find(p => p.name === ctx.playerName);
      if (!player) return sendError(ws, 'Player not found.');
      if (player.hasVoted) return sendError(ws, 'You have already voted.');

      const { direction } = msg;
      if (direction !== 'ja' && direction !== 'nein') return sendError(ws, 'Invalid vote direction.');

      if (direction === 'ja') room.ballotCount.ja++;
      else room.ballotCount.nein++;
      room.ballotCount.cast++;
      player.hasVoted = true;
      if (room.publicVoting) player.voteDirection = direction;

      const active = room.players.filter(p => !p.disconnected);
      const total = active.length;

      // Broadcast incremental ballot count to all
      for (const [, sctx] of sockets) {
        if (sctx.roomCode === room.code && sctx.ws.readyState === WebSocket.OPEN) {
          sendTo(sctx.ws, { type: 'vote:ballot_count', cast: room.ballotCount.cast, total });
        }
      }

      if (room.ballotCount.cast >= total) {
        computeResult(room);
      }
      break;
    }

    case 'round:next': {
      if (!room) return sendError(ws, 'Not in a room.');
      if (room.host !== ctx.playerName) return sendError(ws, 'Only the host can advance to the next round.');
      if (room.phase !== 'result') return sendError(ws, 'Not in result phase.');
      advanceToNomination(room);
      broadcastRoomState(room);
      break;
    }

    default:
      break;
  }
}

function handleClose(ws) {
  const ctx = sockets.get(ws.id);
  if (!ctx?.roomCode) { sockets.delete(ws.id); return; }

  const room = rooms.get(ctx.roomCode);
  if (room) {
    const player = room.players.find(p => p.name === ctx.playerName);

    if (room.phase === 'lobby') {
      room.players = room.players.filter(p => p.name !== ctx.playerName);

      if (room.host === ctx.playerName && room.players.length > 0) {
        room.host = room.players[0].name;
      }

      if (room.players.length === 0) {
        rooms.delete(room.code);
      } else {
        broadcastRoomState(room);
      }
    } else {
      // In-game: keep player, mark disconnected
      if (player) player.disconnected = true;

      if (room.host === ctx.playerName) {
        const next = room.players.find(p => !p.disconnected && p.name !== ctx.playerName);
        if (next) room.host = next.name;
      }

      // If all remaining active players have voted, conclude the vote
      if (room.phase === 'voting') {
        const active = room.players.filter(p => !p.disconnected);
        if (active.length > 0 && room.ballotCount.cast >= active.length) {
          computeResult(room);
        } else {
          broadcastRoomState(room);
        }
      } else {
        broadcastRoomState(room);
      }
    }
  }

  sockets.delete(ws.id);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const app = express();
app.use(express.static(join(__dirname, 'public')));
app.get('*', (_req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));

const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.id = randomUUID();
  sockets.set(ws.id, { ws, roomCode: null, playerName: null });
  ws.on('message', raw => handleMessage(ws, raw));
  ws.on('close', () => handleClose(ws));
  ws.on('error', err => console.error('ws error:', err.message));
});

server.listen(PORT, () => {
  console.log(`Secret Hitler Voting running at http://localhost:${PORT}`);
});
