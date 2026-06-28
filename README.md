# Secret Hitler — Voting Companion

A mobile-first web app for handling government votes during a game of Secret Hitler. Players join a shared room on their own devices and cast simultaneous secret ballots.

## Setup

Requires [Node.js](https://nodejs.org) v18 or later.

```bash
npm install
npm start
```

Then open `http://localhost:3000` in a browser. Share the URL with other players on the same network.

## How to Play

1. **Host** opens the app and clicks **CREATE A ROOM** — a room code is generated (e.g. `XK-7742`)
2. **Players** click **JOIN A ROOM**, enter the code and their name
3. Once 5–10 players are in the lobby, the host clicks **START GAME**
4. Each round, the host selects a **President** and **Chancellor** from the dropdowns and clicks **CALL THE VOTE**
5. Every player simultaneously taps **JA!** or **NEIN!** on their own device — votes are secret
6. When all ballots are in, the result is revealed to everyone at once
7. The host clicks **NEXT ROUND** to continue

## Rules Encoded

- **5–10 players** required to start
- A **majority of Ja!** votes is required to elect the government — ties fail
- The elected President and Chancellor are **term-limited** for the following round
- **3 consecutive failed elections** clear all term limits (chaos track)
- Individual votes are never recorded or revealed — only the aggregate count

## Files

```
package.json      — dependencies (Express, ws)
server.js         — WebSocket server, all room and game logic
public/
  index.html      — single-page shell with all 7 screens
  style.css       — design system (Bauhaus/pamphlet aesthetic)
  socket.js       — WebSocket client with auto-reconnect
  app.js          — client state machine and DOM rendering
```

## Notes

- No database — all state is in-memory; rooms disappear when the server restarts
- Players who disconnect mid-game can rejoin by entering the same name and room code
- If the host disconnects, the next connected player is promoted to host
- The server runs on port 3000 by default; set the `PORT` environment variable to change it
