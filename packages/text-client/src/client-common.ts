/**
 * @module client-common
 *
 * Shared plumbing for the text clients (interactive console, headless AI,
 * pseudo-AI relay): deck catalog loading, CLI argument parsing for
 * lobby-spawned clients, the join/rejoin handshake, and the
 * server-message and reconnect handling that differs between the headless
 * clients only by log prefix.
 */

import type { WebSocket } from 'ws';
import type { CardDefinition, CardDefinitionId, CardInstanceId, ClientMessage, DeckList, GameAction, JoinMessage, PlayerView, ServerMessage } from '@meccg/shared';
import { Alignment, buildInstanceLookup, formatCardList } from '@meccg/shared';
import { loadDeck, listDecks } from '@meccg/sim';
import type { Agent, AgentContext, AgentDecision } from '@meccg/sim';

// ---- Deck catalog (shared with the sim harness in @meccg/sim) ----

/** Load a catalog deck into a join message for the given player. */
export function loadDeckJoin(deckId: string, playerName: string): JoinMessage {
  const deck = loadDeck(deckId);
  return {
    type: 'join',
    name: playerName,
    alignment: deck.alignment,
    draftPool: deck.draftPool,
    playDeck: deck.playDeck,
    siteDeck: deck.siteDeck,
    sideboard: deck.sideboard,
    // The structured catalog deck, so the server validates what the editor
    // would have sent and records this seat's deck identity in the
    // completed-game record. The catalog file is a `DeckList` apart from the
    // branded `card` ids and the narrow alignment union — the same bridge the
    // browser client uses for its own deck lists.
    deckList: deck.file as unknown as DeckList,
  };
}

/**
 * Minimal join for reattaching to a game the server restored from autosave —
 * the server already has the decks, so only the name matters.
 */
export function rejoinMessage(playerName: string): JoinMessage {
  return { type: 'join', name: playerName, alignment: Alignment.Wizard, draftPool: [], playDeck: [], siteDeck: [], sideboard: [] };
}

/** List `{id, name}` of every deck in the catalog. */
export function listCatalogDecks(): { id: string; name: string }[] {
  return listDecks();
}

// ---- Spawned-client scaffolding (headless AI and pseudo-AI) ----

/** Parsed CLI args for lobby-spawned clients: `<port> <name> <token> [--deck id]`. */
export interface SpawnedClientArgs {
  port: number;
  playerName: string;
  token: string;
  deckId?: string;
  /** Trained-model weights path (Real-AI games): passed as `--model <path>`. */
  modelPath?: string;
  /**
   * Sim agent spec (e.g. `mc:ms=2000/turns=2`), passed as `--agent <spec>`.
   * Takes precedence over `--model`; without either the client plays the
   * heuristic strategy.
   */
  agentSpec?: string;
}

/**
 * Parse a spawned client's argv. Prints usage and exits the process when a
 * required argument is missing.
 */
export function parseSpawnedClientArgs(usageName: string): SpawnedClientArgs {
  const args = process.argv.filter(a => !a.startsWith('--'));
  const port = parseInt(args[2], 10);
  const playerName = args[3];
  const token = args[4];
  const deckIdx = process.argv.indexOf('--deck');
  const deckId = deckIdx >= 0 ? process.argv[deckIdx + 1] : undefined;
  const modelIdx = process.argv.indexOf('--model');
  const modelPath = modelIdx >= 0 ? process.argv[modelIdx + 1] : undefined;
  const agentIdx = process.argv.indexOf('--agent');
  const agentSpec = agentIdx >= 0 ? process.argv[agentIdx + 1] : undefined;
  if (!port || !playerName || !token) {
    console.error(`Usage: ${usageName} <port> <playerName> <token> [--deck <deckId>] [--agent <spec>]`);
    process.exit(1);
  }
  return { port, playerName, token, deckId, modelPath, agentSpec };
}

/**
 * Build the serialized join a spawned client sends on socket open: a full
 * deck join when a deck was given, or a minimal rejoin when the server is
 * restoring the game from autosave. The auth token is attached either way.
 */
export function spawnedJoinPayload(clientArgs: SpawnedClientArgs, logPrefix: string): string {
  let joinMsg: JoinMessage;
  if (clientArgs.deckId) {
    console.log(`${logPrefix} connected, sending join with deck "${clientArgs.deckId}"...`);
    joinMsg = loadDeckJoin(clientArgs.deckId, clientArgs.playerName);
  } else {
    console.log(`${logPrefix} connected, sending minimal join (rejoin)...`);
    joinMsg = rejoinMessage(clientArgs.playerName);
  }
  // Both spawned clients (headless AI, pseudo-AI relay) are AI-controlled
  // seats; the interactive console client builds its join elsewhere.
  const msg: ClientMessage = { ...joinMsg, ai: true, token: clientArgs.token } as ClientMessage;
  return JSON.stringify(msg);
}

// ---- Character-draft display (console client) ----

/**
 * Render the character-draft status lines (round, pools, drafted lists,
 * set-aside) that the console client prints between the state dump and the
 * action menu. Returns an empty list outside the character-draft setup step.
 *
 * The two `draftState` entries are indexed by player order, not by viewer;
 * `view.selfIndex` identifies the viewing player's entry. An earlier version
 * guessed the entry by probing which pool held non-redacted cards, which
 * mislabeled the two sides ("Your"/"Opponent" swapped) as soon as the
 * viewer's own pool ran empty — reachable when a player is auto-stopped on
 * an exhausted pool while the opponent keeps drafting.
 */
export function formatDraftLines(
  view: PlayerView,
  isSpectator: boolean,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string[] {
  if (view.phaseState.phase !== 'setup' || view.phaseState.setupStep.step !== 'character-draft') return [];
  const draft = view.phaseState.setupStep;
  const instanceLookup = buildInstanceLookup(view);
  const resolve = (instanceIds: readonly CardInstanceId[]) =>
    instanceIds.map(id => instanceLookup(id) ?? id as unknown as CardDefinitionId);
  const list = (instanceIds: readonly CardInstanceId[]) => formatCardList(resolve(instanceIds), cardPool);
  const ids = (cards: readonly { readonly instanceId: CardInstanceId }[]) =>
    cards.map(c => c.instanceId);

  const lines: string[] = [`Draft round: ${draft.round}`];
  if (isSpectator) {
    lines.push(`${view.self.name} pool: ${list(ids(draft.draftState[0].pool))}`);
    lines.push(`${view.self.name} drafted: ${list(ids(draft.draftState[0].drafted))}`);
    lines.push(`${view.opponent.name} pool: ${list(ids(draft.draftState[1].pool))}`);
    lines.push(`${view.opponent.name} drafted: ${list(ids(draft.draftState[1].drafted))}`);
  } else {
    const selfIdx = view.selfIndex;
    const oppIdx = 1 - selfIdx;
    lines.push(`Your pool: ${list(ids(draft.draftState[selfIdx].pool))}`);
    lines.push(`Your drafted: ${list(ids(draft.draftState[selfIdx].drafted))}`);
    lines.push(`Opponent pool: ${list(ids(draft.draftState[oppIdx].pool))}`);
    lines.push(`Opponent drafted: ${list(ids(draft.draftState[oppIdx].drafted))}`);
  }

  const flatSetAside = [...draft.setAside[0], ...draft.setAside[1]];
  if (flatSetAside.length > 0) {
    lines.push(`Set aside: ${list(ids(flatSetAside))}`);
  }
  return lines;
}

/** Parse a raw WebSocket message buffer into a {@link ServerMessage}. */
export function parseServerMessage(raw: Buffer): ServerMessage {
  return JSON.parse(raw.toString()) as ServerMessage;
}

/**
 * Handle the server-message cases shared by the headless clients
 * (assigned / error / waiting / restart / disconnected), which differ only
 * by log prefix. Returns true when the message was one of those cases.
 */
export function logCommonServerMessage(logPrefix: string, msg: ServerMessage): boolean {
  switch (msg.type) {
    case 'assigned':
      console.log(`${logPrefix} assigned player ID: ${msg.playerId}`);
      return true;
    case 'error':
      console.log(`${logPrefix} received error: ${msg.message}`);
      return true;
    case 'waiting':
      console.log(`${logPrefix} waiting for opponent...`);
      return true;
    case 'restart':
      console.log(`${logPrefix}: server restarting, will reconnect...`);
      return true;
    case 'disconnected':
      console.log(`${logPrefix}: opponent disconnected`);
      return true;
    default:
      return false;
  }
}

/** Delay before the first reconnect attempt; doubles per consecutive failure. */
const RECONNECT_BASE_MS = 1000;

/** Ceiling on the backoff delay, so a long server outage still gets polled. */
const RECONNECT_MAX_MS = 30_000;

/**
 * Consecutive failed attempts before the client gives up and exits. With the
 * backoff above that is about five minutes — long enough to ride out a game
 * server restart, short enough that a client orphaned by a finished game does
 * not linger.
 */
const RECONNECT_MAX_ATTEMPTS = 15;

/** Consecutive failed connection attempts; reset whenever a socket opens. */
let reconnectAttempts = 0;

/** Reset the reconnect backoff. Exported for tests. */
export function resetReconnectAttempts(): void {
  reconnectAttempts = 0;
}

/**
 * Install the shared close/error handlers for a spawned client's socket:
 * reconnect after a close or a connection error, backing off exponentially
 * and giving up once the server has been unreachable for
 * {@link RECONNECT_MAX_ATTEMPTS} attempts. `onClose` runs before the
 * reconnect is scheduled (e.g. to clear a shared socket reference).
 *
 * At most one reconnect is ever scheduled per socket. `ws` emits `error` and
 * *then* `close` for a refused connection, so a handler pair that schedules
 * from both turns every failed attempt into two new sockets. That doubling
 * compounds: when a finished game left an AI client without a server to talk
 * to, retries went from 33 to ~49,000 per ten seconds inside two minutes and
 * the client died on a 4 GB V8 heap, taking the lobby log (512 MB of retry
 * lines in a day) with it.
 */
export function installReconnect(
  ws: WebSocket,
  logPrefix: string,
  reconnect: () => void,
  onClose?: () => void,
): void {
  let scheduled = false;

  /** Schedule the single reconnect this socket is allowed to trigger. */
  const scheduleReconnect = (): void => {
    if (scheduled) return;
    scheduled = true;
    reconnectAttempts++;
    if (reconnectAttempts > RECONNECT_MAX_ATTEMPTS) {
      console.error(`${logPrefix}: server unreachable after ${RECONNECT_MAX_ATTEMPTS} attempts, giving up`);
      process.exit(0);
    }
    const delayMs = Math.min(RECONNECT_BASE_MS * 2 ** (reconnectAttempts - 1), RECONNECT_MAX_MS);
    console.log(`${logPrefix} disconnected, reconnecting in ${delayMs}ms (attempt ${reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})...`);
    setTimeout(reconnect, delayMs);
  };

  // A socket that reaches open proves the server is back: start the next
  // outage from a short delay rather than wherever this one left off.
  ws.on('open', resetReconnectAttempts);

  ws.on('close', () => {
    onClose?.();
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error(`${logPrefix} connection error:`, err.message);
    // `close` normally follows and schedules the retry; this call is the
    // backstop for an error that never closes, and the guard above keeps the
    // two from becoming two sockets.
    scheduleReconnect();
  });
}

// ---- Headless AI decision input ----

/**
 * Strips `concede` — a human-only meta-action the server offers every seat —
 * from the view handed to an autonomous agent, not just from a derived
 * plain-action list. An agent that scores `EvaluatedAction` candidates
 * directly (e.g. the trained bc policy reads `context.view.legalActions` to
 * featurize and index candidates, not just `context.legalActions`) would
 * otherwise still see and can still pick it; filtering only a derived action
 * array does not reach that path. Returns `null` when there is nothing left
 * for the agent to decide.
 */
export function buildAgentDecisionInput(
  view: PlayerView,
): { view: PlayerView; actions: GameAction[] } | null {
  const evaluated = view.legalActions;
  if (!evaluated || evaluated.length === 0) return null;
  const nonConcede = evaluated.filter(e => e.action.type !== 'concede');
  const actions = nonConcede.filter(e => e.viable).map(e => e.action);
  if (actions.length === 0) return null;
  return { view: { ...view, legalActions: nonConcede }, actions };
}

/**
 * Choose an action without letting a broken decision take the whole client
 * down. `agent.chooseAction` runs untrusted-in-practice search/heuristic
 * code (the flat Monte-Carlo agent's worker pool, for one, throws loudly
 * rather than hanging silently when a worker dies — see `mc-pool.ts`), and
 * an AI client has nothing above it in the process tree that respawns it:
 * `launcher.ts` supervises the game-server child but never the AI child it
 * spawns alongside it. One uncaught decision error therefore used to crash
 * the client and strand the human opponent forever, mid-game, with no
 * further legal actions ever offered on their side — the position never
 * fully vanished from `agent.chooseAction`'s own list of legal actions, it
 * was the process holding the decision that never came back (bug report:
 * game mthc4u90-sgd13r, seq 399, "system hangs").
 *
 * Falls back to `pass` when offered (it always ends the current window
 * without inventing an opinion) and otherwise to the first legal action, so
 * a single bad decision costs one below-average move rather than the rest
 * of the game.
 */
export function safeChooseAction(agent: Agent, context: AgentContext): AgentDecision {
  try {
    return agent.chooseAction(context);
  } catch (err) {
    console.error(`AI decision failed (${agent.name}), falling back to a safe action:`, err);
    const fallback = context.legalActions.find(a => a.type === 'pass') ?? context.legalActions[0];
    return { action: fallback, note: `decision error — fell back to ${fallback.type}` };
  }
}
