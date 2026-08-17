/**
 * @module observer-client
 *
 * The Ask AI observer (`specs/2026-08-17-ask-ai-observer.md`): a headless
 * process that attaches to the newest launched game with one AI agent selected,
 * and answers "what would this agent do here, and why" for the position on a
 * player's screen.
 *
 * Usage: npx tsx observer-client.ts [--agent <spec>] [--new] [--lobby <url>]
 *                                   [--once] [--name <name>]
 *
 * It never plays: it takes no seat, submits no actions, and receives no state
 * broadcasts. The position it explains comes from the game server's own log
 * (see `observer-log-tail`), because an honest explanation of a seat's decision
 * has to be computed from that seat's projected view, and the server never ships
 * the full state it would take to project one.
 *
 * One process follows game after game: when the game it is watching ends, it
 * goes back to asking the lobby for the next one. Starting it once is enough
 * for a session of testing.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WebSocket } from 'ws';
import type { AiQuestionMessage, ClientMessage, JoinMessage, ServerMessage } from '@meccg/shared';
import { Alignment, loadCardPool, setEngineConsoleLog } from '@meccg/shared';
import type { Agent } from '@meccg/sim';
import { explainDecision, resolveAgent } from '@meccg/sim';
import { lastMoveBy, openLogTail, resolveRecord } from './observer-log-tail.js';
import type { LogTail } from './observer-log-tail.js';

const USAGE = `observer — explain what an AI agent would do in the live game

Usage:
  bin/observe [--agent <spec>] [--new] [--lobby <url>] [--once]

Options:
  --agent <spec>  Sim registry spec of an explaining agent — h2 (default),
                  heuristic, 'mc:ms=2000/turns=2', 'bc:weights.json', …
                  Repeatable: every agent given is offered in the game
                  screen's Ask AI menu, so the same position can be put to
                  each of them.
  --new           Wait for the NEXT game to be launched instead of attaching
                  to the newest existing one.
  --lobby <url>   Lobby base URL. Default http://localhost:8080.
  --once          Explain the newest position on attach, print it, and exit.
                  Makes the observer useful (and testable) without a browser.
  --name <name>   Name to attach under. Default "Observer".
  -h, --help      This message.
`;

/** Anything the engine logs here describes a hypothetical the agent ran, never the real game. */
setEngineConsoleLog(false);

// ---- Arguments ----

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

/** Read a `--flag value` option. */
function option(name: string, fallback: string): string {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback;
}

/** Every `--flag value` occurrence, in the order given. */
function options(name: string): string[] {
  const values: string[] = [];
  argv.forEach((arg, i) => {
    if (arg !== `--${name}`) return;
    const value = argv[i + 1];
    if (value && !value.startsWith('--')) values.push(value);
  });
  return values;
}

const agentSpecs = options('agent');
if (agentSpecs.length === 0) agentSpecs.push('h2');
/** The default agent: the first one given, and what `--once` uses. */
const agentSpec = agentSpecs[0];
const lobbyUrl = option('lobby', 'http://localhost:8080').replace(/\/$/, '');
const observerName = option('name', 'Observer');
const waitForNew = argv.includes('--new');
const once = argv.includes('--once');

// ---- Setup ----

/**
 * Resolved up front, before anything connects: a typo in a spec or a missing
 * weights file must fail at launch rather than at the first question, when
 * someone is waiting for an answer in a browser. It also pays a `bc` agent's
 * weights-loading cost before the clock is running.
 */
const agents = new Map<string, Agent>();
for (const spec of agentSpecs) {
  try {
    agents.set(spec, resolveAgent(spec));
  } catch (err) {
    console.error(`observer: cannot use --agent ${spec}: ${(err as Error).message}`);
    process.exit(2);
  }
}
const agent = agents.get(agentSpec)!;

const cardPool = loadCardPool();

/** The lobby's master key, from the environment or the file the lobby writes. */
function masterKey(): string {
  if (process.env.MASTER_KEY) return process.env.MASTER_KEY;
  const secretsPath = path.join(os.homedir(), '.meccg', 'secrets.json');
  try {
    const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf-8')) as { masterKey?: string };
    if (secrets.masterKey) return secrets.masterKey;
  } catch {
    // Reported below with the remedy, rather than as a stack trace.
  }
  console.error(`observer: no master key — set MASTER_KEY or run the lobby once to create ${secretsPath}`);
  process.exit(2);
}

const key = masterKey();

/** What the lobby says about the game to attach to. */
interface ObserverTarget {
  port: number;
  gameId: string;
  player1: string;
  player2: string;
  launchedAt: string;
  token: string;
}

/** Ask the lobby for the newest launched game, or null when there is none (yet). */
async function fetchTarget(since?: string): Promise<ObserverTarget | null> {
  const query = since ? `?since=${encodeURIComponent(since)}` : '';
  const response = await fetch(`${lobbyUrl}/api/system/observer-target${query}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`lobby said ${response.status} ${response.statusText} — ${await response.text()}`);
  }
  return await response.json() as ObserverTarget;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Poll until the lobby has a game to attach to. */
async function waitForTarget(since?: string): Promise<ObserverTarget> {
  let announced = false;
  let lastError = '';
  for (;;) {
    try {
      const target = await fetchTarget(since);
      lastError = '';
      if (target) return target;
    } catch (err) {
      // Once per distinct problem, not once per second: an unreachable lobby is
      // one fact, and a screenful of it buries the answers this terminal exists
      // to print.
      const message = (err as Error).message;
      if (message !== lastError) {
        console.error(`observer: lobby ${lobbyUrl} unreachable (${message}) — retrying every second`);
        lastError = message;
      }
    }
    if (!announced) {
      console.log(since
        ? 'observer: waiting for the next game to start...'
        : 'observer: no game running — waiting for one to start...');
      announced = true;
    }
    await sleep(1_000);
  }
}

// ---- Answering ----

/**
 * Explain one question, or say why it cannot be answered.
 *
 * The seat and sequence number both come from the server, so the answer is
 * about the position the asker is looking at, for the seat the server decided
 * they may ask about.
 */
async function answer(
  question: AiQuestionMessage,
  tail: LogTail,
  gameId: string,
): Promise<{ lines: string[]; elapsedMs: number } | { error: string }> {
  const asked = agents.get(question.agent);
  if (!asked) {
    return { error: `this observer offers ${[...agents.keys()].join(', ')}, not "${question.agent}"` };
  }

  const resolved = await resolveRecord(tail, question.stateSeq);
  if (!resolved) {
    return { error: `no position recorded yet in ${path.basename(tail.path)}` };
  }

  // `last-move` rewinds to the position the seat last decided from, and carries
  // the move it made so the explanation can render a verdict on it.
  const target = question.mode === 'last-move'
    ? lastMoveBy(tail, resolved.record.stateSeq, question.forPlayer)
    : { record: resolved.record, played: undefined };
  if (!target) {
    return { error: `${question.forPlayer} has not moved yet in this game` };
  }

  const started = Date.now();
  let lines: string[];
  try {
    lines = [...explainDecision({
      agent: asked,
      agentSpec: question.agent,
      state: target.record.state,
      playerId: question.forPlayer,
      title: `game ${gameId}#${target.record.stateSeq}`
        + (question.mode === 'last-move' ? ' — the position before their last move' : ''),
      cardPool,
      source: { gameId, stateSeq: target.record.stateSeq },
      actuallyPlayed: target.played,
    }).lines];
  } catch (err) {
    return { error: `${question.agent} failed on this position: ${(err as Error).message}` };
  }

  if (question.mode !== 'last-move' && !resolved.exact) {
    // An explanation of the wrong position must never look like an explanation
    // of the right one.
    lines.unshift(
      `NOTE: position ${question.stateSeq} had not reached the log; this explains`
      + ` ${resolved.record.stateSeq} instead.`,
      '',
    );
  }
  return { lines, elapsedMs: Date.now() - started };
}

// ---- Attaching ----

/** The join that attaches as an observer rather than taking a seat. */
function observerJoin(target: ObserverTarget): JoinMessage {
  return {
    type: 'join',
    name: observerName,
    token: target.token,
    alignment: Alignment.Wizard,
    draftPool: [],
    playDeck: [],
    siteDeck: [],
    sideboard: [],
    observer: { agents: agentSpecs },
  };
}

/**
 * Attach to one game and answer questions until it ends.
 *
 * Questions are handled one at a time: an `mc` search pegs a core (or a whole
 * worker pool), so overlapping searches would make every answer slower and
 * later than asking them in turn.
 */
function watch(target: ObserverTarget): Promise<void> {
  return new Promise<void>((done) => {
    const ws = new WebSocket(`ws://localhost:${target.port}`);
    let gameId = target.gameId;
    let tail: LogTail = openLogTail(gameId);
    let working = false;
    const queue: AiQuestionMessage[] = [];
    let finished = false;

    const finish = (): void => {
      if (finished) return;
      finished = true;
      done();
    };

    const send = (msg: ClientMessage): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    const pump = async (): Promise<void> => {
      if (working) return;
      working = true;
      try {
        for (let question = queue.shift(); question; question = queue.shift()) {
          console.log(`observer: ${question.agent} asked about ${question.forPlayer}`
            + `${question.mode === 'last-move' ? "'s last move" : ''} at #${question.stateSeq}`
            + ` (turn ${question.turn}, ${question.phase}${question.step ? `/${question.step}` : ''})`);
          const result = await answer(question, tail, gameId);
          if ('error' in result) {
            console.error(`observer: ${result.error}`);
            send({ type: 'ai-error', requestId: question.requestId, message: result.error });
            continue;
          }
          send({
            type: 'ai-answer',
            requestId: question.requestId,
            lines: result.lines,
            agent: question.agent,
            elapsedMs: result.elapsedMs,
          });
          // The terminal running the observer doubles as a transcript of
          // everything that was asked.
          console.log(result.lines.join('\n'));
          console.log(`observer: answered in ${result.elapsedMs}ms`);
        }
      } finally {
        working = false;
      }
    };

    ws.on('open', () => {
      ws.send(JSON.stringify(observerJoin(target)));
    });

    ws.on('message', (raw: Buffer) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(raw.toString()) as ServerMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'assigned':
          // The server's gameId is authoritative — the lobby's is a convenience
          // that would be stale if a relaunch had replaced the game.
          if (msg.gameId && msg.gameId !== 'unknown' && msg.gameId !== gameId) {
            gameId = msg.gameId;
            tail = openLogTail(gameId);
          }
          console.log(`observer: attached to ${gameId} on port ${target.port}`
            + ` as "${observerName}" offering ${agentSpecs.join(', ')}`);
          console.log(`observer: following ${tail.path}`);
          if (once) explainNewestAndExit(tail, gameId);
          break;
        case 'ai-question':
          queue.push(msg);
          void pump();
          break;
        case 'error':
          console.error(`observer: server said: ${msg.message}`);
          break;
        case 'restart':
        case 'disconnected':
          console.log(`observer: ${msg.type} — letting go of ${gameId}`);
          ws.close();
          break;
        default:
          break;
      }
    });

    ws.on('close', () => {
      console.log(`observer: connection to ${gameId} closed`);
      finish();
    });

    ws.on('error', (err: Error) => {
      console.error(`observer: socket error: ${err.message}`);
      finish();
    });
  });
}

/**
 * `--once`: explain the newest recorded position and exit.
 *
 * The seat is whoever the log says was to act, which is the same choice the
 * server makes for a spectator's question. Useful on its own, and it makes the
 * observer testable without a browser.
 */
function explainNewestAndExit(tail: LogTail, gameId: string): void {
  const record = tail.newest();
  if (!record) {
    console.error(`observer: nothing recorded yet in ${tail.path}`);
    process.exit(1);
  }
  const seat = record.activePlayer ?? record.state.players[0].id;
  const explanation = explainDecision({
    agent,
    agentSpec,
    state: record.state,
    playerId: seat,
    title: `game ${gameId}#${record.stateSeq}`,
    cardPool,
    source: { gameId, stateSeq: record.stateSeq },
  });
  console.log(explanation.lines.join('\n'));
  process.exit(0);
}

// ---- Main loop ----

async function main(): Promise<void> {
  console.log(`observer: agents ${agentSpecs.join(', ')}, lobby ${lobbyUrl}`);
  // `--new` skips whatever is already running: the point of the flag is to
  // start the observer first and then launch the game you want watched.
  let since = waitForNew ? new Date().toISOString() : undefined;

  for (;;) {
    const target = await waitForTarget(since);
    console.log(`observer: ${target.player1} vs. ${target.player2}`
      + ` (${target.gameId}, launched ${target.launchedAt})`);
    await watch(target);
    if (once) return;
    // Follow the *next* game rather than re-attaching to the one that just
    // ended: its server is gone, and the lobby will still list it briefly.
    since = target.launchedAt;
    console.log('observer: waiting for the next game...');
  }
}

void main();
