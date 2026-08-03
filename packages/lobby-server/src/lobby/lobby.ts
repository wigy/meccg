/**
 * @module lobby/lobby
 *
 * Manages online player presence and the challenge/accept flow.
 * Each authenticated player has a WebSocket connection to the lobby.
 * The lobby tracks who is online, routes challenges, and triggers
 * game launches when both players agree.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type WebSocket from 'ws';
import type { LobbyClientMessage, LobbyServerMessage } from './protocol.js';
import { killGame, launchGame } from '../games/launcher.js';
import { resolveModelFile } from '../games/models.js';
import { signGameToken } from '../auth/jwt.js';
import { lobbyLog } from '../lobby-log.js';
import { getDisplayName, getCredits } from '../players/store.js';
import { countUnread } from '../mail/store.js';

/**
 * Sim agent spec for the "Play vs MC-AI" button.
 *
 * A server-side constant rather than a protocol field on purpose: the spec
 * becomes argv of a spawned process, and a client-supplied one could name an
 * arbitrary weights file via `bc:<path>`. The `ms` budget bounds wall-clock
 * per decision so a search cannot stall a human's game; `turns=3` is the
 * shortest horizon measured to separate candidates at all (a 1-turn horizon
 * leaves almost every decision tied at 0).
 *
 * Promoted from its trial run 2026-07-28: measured on challenge decks a/b,
 * this agent beats the heuristic by +152 Elo [+59, +273] at 8 rollouts and
 * +352 [+228, +672] at 16, and beats the strongest trained policy by +149
 * [+39, +301]. It is the strongest opponent available and, unlike the
 * determinizing tree search, converts extra budget into strength — see
 * `specs/2026-07-28-parallel-monte-carlo.md` for scaling it across cores.
 *
 * Interactive play is latency-bound: the 2 s budget stays fixed and
 * `jobs=<cores−2>` buys more rollout rounds inside it, i.e. a stronger
 * opponent at unchanged pacing. Two cores are left for the game-server
 * process itself and the rest of the box. Batch harnesses must keep the
 * default `jobs=1` and parallelize across games via SIM_JOBS instead —
 * per-decision fan-out under SIM_JOBS would oversubscribe the machine.
 *
 * `candidates=4`, narrowed from 6 on 2026-08-02. At a fixed budget of 16
 * playouts the split between width and samples is flat: `2x8` gates at
 * −27 Elo [−96, +40] and `8x2` at −14 [−71, +41] against the `4x4`
 * reference, both spanning zero over 100 games each, and only the
 * degenerate `1x16` is genuinely worse at −154 [−255, −73]. Four is inside
 * that flat range, so it costs no measured strength — and under a *time*
 * budget a cheaper round is the point, because more rounds then fit inside
 * the same 2 s.
 *
 * Deliberately not pinned to an explicit `rollouts`: in time-budget mode
 * that becomes a round *cap* (`TIME_MODE_ROUND_CAP` in `agents/mc-agent`),
 * which would end the search early and leave most of the budget unspent.
 * The horizon stays at 3 — the sweep above held `turns=1` throughout, so it
 * says nothing about the horizon this spec uses.
 */
const MC_AGENT_SPEC = `mc:jobs=${Math.max(1, os.cpus().length - 2)}/ms=2000/turns=3/candidates=4`;

/**
 * Sim agent spec for the "Play vs Modular AI" button — Heuristics 2
 * (`specs/2026-07-27-heuristics-2-ai.md`).
 *
 * A server-side constant for the same reason as {@link MC_AGENT_SPEC}: the spec
 * becomes argv, and `h2:<modules>` would let a client select an arbitrary
 * module subset — which is a debugging seam, not something a lobby should
 * expose. The bare `h2` is every shipped module.
 *
 * Unlike the Monte-Carlo agent this one does not search, so it answers in
 * milliseconds rather than seconds. What it does instead is explain itself:
 * every decision it makes is reproducible through `npm run explain -w
 * @meccg/sim`, which no other opponent here can offer.
 *
 * Its strength is unproven. It decides about half of all contested decisions
 * and hands the rest to the heuristic, and a seven-game head-to-head put it
 * ahead 5-2 — a sample that separates nothing. Offered as an opponent worth
 * playing and reporting on, not as the strongest one available.
 */
const MODULAR_AGENT_SPEC = 'h2';

/** Connection info for an active game that a player can rejoin. */
interface ActiveGameInfo {
  readonly port: number;
  readonly token: string;
  readonly opponent: string;
  readonly opponentDisplayName: string;
  /** AI deck ID used for this game (only set for AI games), remembered for rejoin. */
  readonly aiDeckId?: string;
  /** Model file the Real-AI plays with (only set for Real-AI games), remembered for rejoin. */
  readonly aiModelFile?: string;
}

/** A connected player in the lobby. */
interface OnlinePlayer {
  readonly name: string;
  ws: WebSocket;
  /** Set of player names who have sent us a challenge. */
  readonly pendingFrom: Set<string>;
  /** Whether this player is currently in a game. */
  inGame: boolean;
  /** Active game connection info, kept for rejoin after server restart. */
  activeGame: ActiveGameInfo | null;
  /**
   * Whether a `rejoin-game` launch is currently in flight for this player.
   * Guards against a duplicate `rejoin-game` message (e.g. a client retry
   * firing before the first game-server has finished spawning) launching a
   * second game-server process that restores the same save and races the
   * first one's actions.
   */
  rejoining: boolean;
}

/** An ongoing game (human-vs-human or vs an AI seat) that others can watch. */
interface WatchableGame {
  readonly port: number;
  readonly player1: string;
  readonly player2: string;
}

/** The lobby state: tracks online players and pending challenges. */
const onlinePlayers = new Map<string, OnlinePlayer>();

/**
 * Games in progress, keyed by port — human-vs-human and AI games alike.
 * Every entry is broadcast as a "p1 vs. p2" row that non-participants can
 * watch; the game server seats any non-player join as a spectator, so an
 * AI seat needs no special handling.
 */
const watchableGames = new Map<number, WatchableGame>();

/**
 * Active-game info per player name, surviving lobby reconnects. The
 * OnlinePlayer entry doubles as the presence list and is deleted when the
 * lobby socket closes, which used to take `activeGame` with it: a
 * reconnecting client's 'rejoin-game' then relaunched a NEW game server
 * while the old one was still alive inside its idle-exit grace period,
 * and the lobby briefly listed the same game twice. Entries live exactly
 * as long as the game-server child process ({@link clearPlayerGame}).
 */
const activeGamesByName = new Map<string, ActiveGameInfo>();

/** Record `info` as `player`'s active game, both on the player and in {@link activeGamesByName}. */
function setActiveGame(player: OnlinePlayer, info: ActiveGameInfo): void {
  player.activeGame = info;
  activeGamesByName.set(player.name, info);
}

/**
 * Clear a player's in-game state because the game on `port` ended. Looks
 * the player up by name — the OnlinePlayer captured at launch may have
 * been replaced by a lobby reconnect — and does nothing if the player has
 * already moved on to a newer game: during a relaunch the old server's
 * exit arrives after the new game started, and must not clobber it.
 */
function clearPlayerGame(name: string, port: number): void {
  const stored = activeGamesByName.get(name);
  if (stored?.port === port) activeGamesByName.delete(name);
  const current = onlinePlayers.get(name);
  if (!current) return;
  if (stored?.port === port || current.activeGame?.port === port) {
    current.inGame = false;
    current.activeGame = null;
    current.pendingFrom.clear();
  }
}

/**
 * Kill a still-running game server that is being replaced, forgetting its
 * players' active-game entries up front so its exit callback (which runs
 * concurrently with the replacement launch) cannot clobber the new game's
 * state. Resolves once the old process has exited — and its final
 * autosave has been written — so callers can safely launch or delete
 * saves afterwards.
 */
async function killLingeringGame(port: number): Promise<void> {
  const game = watchableGames.get(port);
  if (game) {
    for (const n of [game.player1, game.player2]) {
      if (activeGamesByName.get(n)?.port === port) activeGamesByName.delete(n);
    }
  }
  await killGame(port);
}

/** Send a typed message to a WebSocket. */
function send(ws: WebSocket, msg: LobbyServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/** Send a typed message to every online player. */
function broadcastToOnline(msg: LobbyServerMessage): void {
  for (const p of onlinePlayers.values()) {
    send(p.ws, msg);
  }
}

/** Broadcast the current online player list and games in progress to everyone. */
function broadcastPlayerList(): void {
  const players = Array.from(onlinePlayers.values()).map(p => ({
    name: p.name,
    displayName: getDisplayName(p.name),
    credits: getCredits(p.name),
    inGame: p.inGame,
  }));
  const games = Array.from(watchableGames.values()).map(g => ({
    port: g.port,
    player1: g.player1,
    player1DisplayName: getDisplayName(g.player1),
    player2: g.player2,
    player2DisplayName: getDisplayName(g.player2),
  }));
  broadcastToOnline({ type: 'online-players', players, games });
}

/**
 * Cancel every pending challenge that involves `name` because they are entering
 * a game — both challenges they sent (they are in other players' `pendingFrom`)
 * and challenges they received (`name`'s own `pendingFrom`). Any player whose
 * incoming-challenge prompt names `name` is told to dismiss it. Callers should
 * mark `name` as in-game and re-broadcast the player list afterwards so the
 * challenger's stale "Sent" button clears too.
 */
function cancelChallengesInvolving(name: string): void {
  // Outgoing: `name` challenged others — remove it from their pendingFrom and
  // dismiss the prompt they were shown.
  for (const other of onlinePlayers.values()) {
    if (other.name === name) continue;
    if (other.pendingFrom.delete(name)) {
      send(other.ws, { type: 'challenge-cancelled', from: name });
    }
  }
  // Incoming: others challenged `name` — drop those; `name`'s lobby prompt is
  // hidden behind the game screen, so no notification is needed.
  const player = onlinePlayers.get(name);
  if (player) player.pendingFrom.clear();
}

/** Send a typed message to a specific player if they are online. Silently drops if offline. */
export function notifyPlayer(name: string, msg: LobbyServerMessage): void {
  const player = onlinePlayers.get(name);
  if (player) {
    send(player.ws, msg);
  }
}

/** Send a system notification to all online players. */
export function broadcastNotification(message: string): void {
  broadcastToOnline({ type: 'system-notification', message });
}

/** Tell all connected clients to reload the page. Used during controlled reboot. */
export function broadcastForceReload(): void {
  broadcastToOnline({ type: 'force-reload' });
}

/** Register a new player connection in the lobby. */
export function playerConnected(name: string, ws: WebSocket): void {
  // If already connected (e.g. page refresh), update the WS but preserve game state
  const existing = onlinePlayers.get(name);
  if (existing) {
    existing.ws.close();
    existing.ws = ws;
  }

  // A fresh connection may belong to a player whose game server is still
  // running (the lobby socket dropped — e.g. a proxy idle timeout — while
  // the game lived on): restore the active game so 'rejoin-game' reconnects
  // to it instead of launching a duplicate server.
  const restored = activeGamesByName.get(name) ?? null;
  const player: OnlinePlayer = existing ?? { name, ws, pendingFrom: new Set(), inGame: restored !== null, activeGame: restored, rejoining: false };
  if (!existing) onlinePlayers.set(name, player);
  lobbyLog.log('connect', { name, online: onlinePlayers.size });
  broadcastPlayerList();

  // Mail that arrived while the player was offline produced no live
  // mail-notification, so seed the client's unread badge on connect.
  send(ws, { type: 'mail-notification', unreadCount: countUnread(name) });

  ws.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString()) as LobbyClientMessage;
      handleMessage(name, msg);
    } catch {
      send(ws, { type: 'error', message: 'Invalid message format' });
    }
  });

  ws.on('close', () => {
    // Only remove if this is still the current connection for this player
    const current = onlinePlayers.get(name);
    if (current && current.ws === ws) {
      onlinePlayers.delete(name);
      lobbyLog.log('disconnect', { name, online: onlinePlayers.size });
      broadcastPlayerList();
    }
  });
}

/** Handle a message from a connected player. */
function handleMessage(fromName: string, msg: LobbyClientMessage): void {
  const from = onlinePlayers.get(fromName);
  if (!from) return;

  switch (msg.type) {
    case 'challenge': {
      const target = onlinePlayers.get(msg.opponentName);
      if (!target) {
        send(from.ws, { type: 'error', message: `${msg.opponentName} is not online` });
        return;
      }
      if (target.inGame) {
        send(from.ws, { type: 'error', message: `${msg.opponentName} is already in a game` });
        return;
      }
      if (msg.opponentName === fromName) {
        send(from.ws, { type: 'error', message: 'You cannot challenge yourself' });
        return;
      }
      target.pendingFrom.add(fromName);
      send(target.ws, { type: 'challenge-received', from: fromName, fromDisplayName: getDisplayName(fromName) });
      break;
    }

    case 'accept-challenge': {
      if (!from.pendingFrom.has(msg.from)) {
        send(from.ws, { type: 'error', message: 'No pending challenge from that player' });
        return;
      }
      from.pendingFrom.delete(msg.from);
      const challenger = onlinePlayers.get(msg.from);
      if (!challenger) {
        send(from.ws, { type: 'error', message: `${msg.from} is no longer online` });
        return;
      }
      void startGame(challenger, from);
      break;
    }

    case 'decline-challenge': {
      from.pendingFrom.delete(msg.from);
      const challenger = onlinePlayers.get(msg.from);
      if (challenger) {
        send(challenger.ws, { type: 'challenge-declined', by: fromName, byDisplayName: getDisplayName(fromName) });
      }
      break;
    }

    case 'cancel-challenge': {
      // Withdraw a challenge `fromName` sent to `msg.opponentName`: drop it from
      // the target's pending set and dismiss the prompt they were shown.
      const target = onlinePlayers.get(msg.opponentName);
      if (target && target.pendingFrom.delete(fromName)) {
        send(target.ws, { type: 'challenge-cancelled', from: fromName });
      }
      break;
    }

    case 'play-heuristic-ai': {
      if (from.inGame) {
        send(from.ws, { type: 'error', message: 'You are already in a game' });
        return;
      }
      void startAiGame(from, msg.deckId);
      break;
    }

    case 'play-mc-ai': {
      if (from.inGame) {
        send(from.ws, { type: 'error', message: 'You are already in a game' });
        return;
      }
      void startAiGame(from, msg.deckId, undefined, MC_AGENT_SPEC);
      break;
    }

    case 'play-modular-ai': {
      if (from.inGame) {
        send(from.ws, { type: 'error', message: 'You are already in a game' });
        return;
      }
      void startAiGame(from, msg.deckId, undefined, MODULAR_AGENT_SPEC);
      break;
    }

    case 'play-real-ai': {
      if (from.inGame) {
        send(from.ws, { type: 'error', message: 'You are already in a game' });
        return;
      }
      void startAiGame(from, msg.deckId, msg.model);
      break;
    }

    case 'play-tutorial': {
      // A still-live Mentor game (e.g. an abandoned tab's session inside
      // its idle-exit grace period) must not block a fresh start; any
      // other live game does.
      const lingeringMentorPort = from.activeGame?.opponent === 'Mentor' ? from.activeGame.port : null;
      if (from.inGame && lingeringMentorPort === null) {
        send(from.ws, { type: 'error', message: 'You are already in a game' });
        return;
      }
      from.inGame = false;
      from.activeGame = null;
      void (async () => {
        // Kill the lingering Mentor server BEFORE deleting the saves: it
        // writes a final autosave on SIGTERM, which would otherwise land
        // after the delete and resurrect the run the player just dropped.
        if (lingeringMentorPort !== null) await killLingeringGame(lingeringMentorPort);
        // The Start button always begins a fresh run at step 1: drop any
        // autosaved mid-tutorial progress. Only the reload/rejoin flow
        // ('rejoin-game' with the Mentor) resumes a saved tutorial.
        deleteTutorialSaves(from.name);
        await startTutorialGame(from);
      })();
      break;
    }

    case 'play-pseudo-ai': {
      if (from.inGame) {
        send(from.ws, { type: 'error', message: 'You are already in a game' });
        return;
      }
      void startPseudoAiGame(from, msg.deckId);
      break;
    }

    case 'watch-game': {
      const game = watchableGames.get(msg.port);
      if (!game) {
        send(from.ws, { type: 'error', message: 'That game is no longer in progress' });
        return;
      }
      // A player of the game cannot "watch" it: joining the game server with
      // their own name would replace their real player connection.
      if (game.player1 === fromName || game.player2 === fromName) {
        send(from.ws, { type: 'error', message: 'You are a player in that game' });
        return;
      }
      // The game server authenticates spectators by the same JWT as players
      // (token.sub must equal the join name); it does not check the game id,
      // so any valid id works. The watcher's name is not one of the two
      // players, so the server seats them as a spectator.
      const token = signGameToken(fromName, `watch-${game.port}`);
      lobbyLog.log('watch-game', { watcher: fromName, port: game.port, player1: game.player1, player2: game.player2 });
      send(from.ws, {
        type: 'game-watching',
        port: game.port,
        token,
        player1DisplayName: getDisplayName(game.player1),
        player2DisplayName: getDisplayName(game.player2),
      });
      break;
    }

    case 'rejoin-game': {
      const opponentName = msg.opponent;
      const isAi = opponentName.startsWith('AI-');

      // If a live game against this opponent is already known — the server
      // survived while only the client's sockets dropped, or the opponent
      // already relaunched one that includes us — send back the stored
      // connection info instead of launching another server.
      if (from.activeGame && from.activeGame.opponent === opponentName) {
        lobbyLog.log('rejoin-existing', { name: fromName, opponent: opponentName });
        send(from.ws, { type: 'game-starting', ...from.activeGame });
        break;
      }

      // A relaunch is already in flight for this player (e.g. the client's
      // rejoin-retry timer fired again before the first game-server finished
      // spawning). Launching a second one would leave two live game-server
      // processes restoring the same save and racing each other's actions —
      // the AI seat then looks like it is fighting itself (e.g. transferring
      // an item back and forth forever). Drop the duplicate instead; the
      // in-flight launch will answer with 'game-starting' when it is done.
      if (from.rejoining) {
        lobbyLog.log('rejoin-ignored', { name: fromName, opponent: opponentName, reason: 'launch already in progress' });
        break;
      }

      // Capture AI deck and model before clearing state, so the rejoin can reuse them
      const storedAiDeckId = from.activeGame?.aiDeckId;
      const storedAiModelFile = from.activeGame?.aiModelFile;

      // The Real-AI is identified by its model rather than by a spec, so it
      // needs the same treatment as the spec agents below. Without a
      // remembered model there is nothing to relaunch: seating the heuristic
      // would swap the opponent and move the game onto a different save key,
      // so refuse instead.
      if (opponentName === 'AI-Real' && storedAiModelFile === undefined) {
        send(from.ws, { type: 'error', message: 'Cannot rejoin: the Real-AI model for this game is no longer known' });
        return;
      }

      // A human opponent must exist and be free before anything is torn down.
      let humanOpponent: OnlinePlayer | undefined;
      if (opponentName !== 'Mentor' && !isAi) {
        humanOpponent = onlinePlayers.get(opponentName);
        if (!humanOpponent) {
          send(from.ws, { type: 'error', message: `${opponentName} is no longer online` });
          return;
        }
        if (humanOpponent.activeGame && humanOpponent.activeGame.opponent !== fromName) {
          send(from.ws, { type: 'error', message: `${opponentName} is already in another game` });
          return;
        }
      }

      // A different game of ours may still be live (e.g. this client's
      // session predates a game started from another tab). It is being
      // abandoned, so kill it before launching: one player must never have
      // two live game servers — the stale one would linger in the
      // watchable-games list as a duplicate row.
      const lingering = activeGamesByName.get(fromName);

      // Clear stale inGame state from the dead game
      from.inGame = false;
      from.activeGame = null;
      from.rejoining = true;
      const clearRejoining = (): void => { from.rejoining = false; };

      const relaunch = async (): Promise<void> => {
        if (lingering) await killLingeringGame(lingering.port);
        if (opponentName === 'Mentor') {
          // Relaunch the tutorial server; it restores the autosaved tutorial
          // (state + script cursor) and resumes at the same step. The Mentor
          // seat is played server-side, so a normal rejoin would never seat.
          await startTutorialGame(from);
        } else if (opponentName === 'AI-Pseudo') {
          await startPseudoAiGame(from);
        } else if (isAi) {
          // Preserve which AI it was: relaunching 'AI-MC' without the spec
          // would silently seat the heuristic instead, so a reconnect would
          // change opponents mid-match.
          const rejoinSpec = opponentName === 'AI-MC' ? MC_AGENT_SPEC
            : opponentName === 'AI-Modular' ? MODULAR_AGENT_SPEC
              : undefined;
          await startAiGame(from, storedAiDeckId, storedAiModelFile, rejoinSpec);
        } else {
          const opponent = humanOpponent!;
          opponent.inGame = false;
          opponent.activeGame = null;
          await startGame(from, opponent);
        }
      };
      void relaunch().finally(clearRejoining);
      break;
    }
  }
}

/** Launch a game between two players. */
async function startGame(player1: OnlinePlayer, player2: OnlinePlayer): Promise<void> {
  player1.inGame = true;
  player2.inGame = true;
  // Both are now busy: withdraw every other challenge involving either of them.
  cancelChallengesInvolving(player1.name);
  cancelChallengesInvolving(player2.name);

  try {
    const result = await launchGame(player1.name, player2.name);
    lobbyLog.log('game-start', { player1: player1.name, player2: player2.name, port: result.port });

    const p1Game: ActiveGameInfo = {
      port: result.port,
      token: result.tokens[0],
      opponent: player2.name,
      opponentDisplayName: getDisplayName(player2.name),
    };
    const p2Game: ActiveGameInfo = {
      port: result.port,
      token: result.tokens[1],
      opponent: player1.name,
      opponentDisplayName: getDisplayName(player1.name),
    };
    setActiveGame(player1, p1Game);
    setActiveGame(player2, p2Game);

    // Register the game so others can watch it, then broadcast so the updated
    // list (players now in-game, a new watchable game) reaches everyone.
    watchableGames.set(result.port, { port: result.port, player1: player1.name, player2: player2.name });

    send(player1.ws, { type: 'game-starting', ...p1Game });
    send(player2.ws, { type: 'game-starting', ...p2Game });
    broadcastPlayerList();

    // When the game ends, mark players as available again
    result.onEnd(() => {
      clearPlayerGame(player1.name, result.port);
      clearPlayerGame(player2.name, result.port);
      watchableGames.delete(result.port);
      broadcastPlayerList();
      lobbyLog.log('game-end', { player1: player1.name, player2: player2.name });
    });
  } catch (err) {
    lobbyLog.log('error', { context: 'game-start', error: String(err) });
    player1.inGame = false;
    player2.inGame = false;
    player1.activeGame = null;
    player2.activeGame = null;
    send(player1.ws, { type: 'error', message: 'Failed to start game server' });
    send(player2.ws, { type: 'error', message: 'Failed to start game server' });
    broadcastPlayerList();
  }
}

/**
 * Launch a game against an AI opponent: the Heuristic-AI (rule-based
 * strategy) by default, a Real-AI when `modelFile` names a trained model
 * from the server's models directory, or any sim registry agent when
 * `agentSpec` is given. The model argument is a bare file name validated
 * against the directory listing — never a client supplied path; `agentSpec`
 * is likewise only ever a server-side constant.
 */
async function startAiGame(
  player: OnlinePlayer,
  deckId?: string,
  modelFile?: string,
  agentSpec?: string,
): Promise<void> {
  if (!deckId) {
    send(player.ws, { type: 'error', message: 'Select a deck for the AI before starting' });
    return;
  }
  let aiModelPath: string | undefined;
  if (modelFile !== undefined) {
    const resolved = resolveModelFile(modelFile);
    if (!resolved) {
      send(player.ws, { type: 'error', message: 'Unknown AI model' });
      return;
    }
    aiModelPath = resolved;
  }
  player.inGame = true;
  // Entering a game withdraws any challenges involving this player.
  cancelChallengesInvolving(player.name);
  // The name is the save key and the rejoin key, so each agent spec needs its
  // own. Deriving it from "an agent spec was supplied" was fine while there was
  // one such agent; a second would have made both share MC's saves.
  const aiName = agentSpec === MC_AGENT_SPEC ? 'AI-MC'
    : agentSpec === MODULAR_AGENT_SPEC ? 'AI-Modular'
      : modelFile !== undefined ? 'AI-Real'
        : 'AI-Heuristic';

  try {
    const result = await launchGame(player.name, aiName, {
      ai: true, aiDeckId: deckId, aiModelPath, aiAgentSpec: agentSpec,
    });
    lobbyLog.log('game-start', { player1: player.name, player2: aiName, ai: true, port: result.port });

    const gameInfo: ActiveGameInfo = {
      port: result.port,
      token: result.tokens[0],
      opponent: aiName,
      opponentDisplayName: aiName,
      aiDeckId: deckId,
      aiModelFile: modelFile,
    };
    setActiveGame(player, gameInfo);
    // Register the game so others see this player as busy — shown as a
    // "player vs. AI-*" row they can watch instead of a Challenge button.
    watchableGames.set(result.port, { port: result.port, player1: player.name, player2: aiName });

    send(player.ws, { type: 'game-starting', ...gameInfo });
    broadcastPlayerList();

    result.onEnd(() => {
      clearPlayerGame(player.name, result.port);
      watchableGames.delete(result.port);
      broadcastPlayerList();
      lobbyLog.log('game-end', { player1: player.name, player2: aiName, ai: true });
    });
  } catch (err) {
    lobbyLog.log('error', { context: 'ai-game-start', error: String(err) });
    player.inGame = false;
    player.activeGame = null;
    send(player.ws, { type: 'error', message: 'Failed to start game server' });
    broadcastPlayerList();
  }
}

/** Save directory shared with the game servers (same default as game-session). */
const SAVE_DIR = process.env.SAVE_DIR ?? path.join(os.homedir(), '.meccg', 'saves');

/**
 * Delete a player's tutorial save files, so the next tutorial launch starts
 * a fresh run at step 1 instead of restoring the autosaved cursor.
 */
function deleteTutorialSaves(playerName: string): void {
  const key = [playerName.toLowerCase(), 'mentor'].sort().join('_vs_');
  for (const suffix of ['.json', '-autosave.json']) {
    const savePath = path.join(SAVE_DIR, `${key}${suffix}`);
    try {
      if (fs.existsSync(savePath)) fs.unlinkSync(savePath);
    } catch (err) {
      lobbyLog.log('error', { context: 'tutorial-save-delete', error: String(err) });
    }
  }
}

/**
 * Launch the guided tutorial: a scripted teaching game against the
 * server-driven "Mentor" seat (no AI client process; the game session
 * plays the Mentor itself). Decks are fixed by the shared tutorial module.
 */
async function startTutorialGame(player: OnlinePlayer): Promise<void> {
  player.inGame = true;
  cancelChallengesInvolving(player.name);
  const mentorName = 'Mentor';

  try {
    const result = await launchGame(player.name, mentorName, { tutorial: true });
    lobbyLog.log('game-start', { player1: player.name, player2: mentorName, tutorial: true, port: result.port });

    const gameInfo: ActiveGameInfo = {
      port: result.port,
      token: result.tokens[0],
      opponent: mentorName,
      opponentDisplayName: mentorName,
    };
    setActiveGame(player, gameInfo);
    watchableGames.set(result.port, { port: result.port, player1: player.name, player2: mentorName });

    send(player.ws, { type: 'game-starting', ...gameInfo });
    broadcastPlayerList();

    result.onEnd(() => {
      clearPlayerGame(player.name, result.port);
      watchableGames.delete(result.port);
      broadcastPlayerList();
      lobbyLog.log('game-end', { player1: player.name, player2: mentorName, tutorial: true });
    });
  } catch (err) {
    lobbyLog.log('error', { context: 'tutorial-game-start', error: String(err) });
    player.inGame = false;
    player.activeGame = null;
    send(player.ws, { type: 'error', message: 'Failed to start game server' });
    broadcastPlayerList();
  }
}

/** Launch a pseudo-AI game where the human controls both sides via two WS connections. */
async function startPseudoAiGame(player: OnlinePlayer, deckId?: string): Promise<void> {
  player.inGame = true;
  // Entering a game withdraws any challenges involving this player.
  cancelChallengesInvolving(player.name);
  const aiName = 'AI-Pseudo';

  try {
    // No AI client process — the web client connects twice (as human + AI)
    const result = await launchGame(player.name, aiName, { aiDeckId: deckId });
    lobbyLog.log('game-start', { player1: player.name, player2: aiName, pseudoAi: true, port: result.port });

    const gameInfo: ActiveGameInfo = {
      port: result.port,
      token: result.tokens[0],
      opponent: aiName,
      opponentDisplayName: aiName,
    };
    setActiveGame(player, gameInfo);
    // Like real AI games, a pseudo-AI game shows up as a watchable "vs. AI-Pseudo"
    // row; the spectator projection hides both hands, so it is safe to watch even
    // though one human controls both seats.
    watchableGames.set(result.port, { port: result.port, player1: player.name, player2: aiName });

    send(player.ws, {
      type: 'game-starting',
      ...gameInfo,
      pseudoAi: true,
      aiToken: result.tokens[1],
    });
    broadcastPlayerList();

    result.onEnd(() => {
      clearPlayerGame(player.name, result.port);
      watchableGames.delete(result.port);
      broadcastPlayerList();
      lobbyLog.log('game-end', { player1: player.name, player2: aiName, pseudoAi: true });
    });
  } catch (err) {
    lobbyLog.log('error', { context: 'pseudo-ai-game-start', error: String(err) });
    player.inGame = false;
    player.activeGame = null;
    send(player.ws, { type: 'error', message: 'Failed to start game server' });
    broadcastPlayerList();
  }
}
