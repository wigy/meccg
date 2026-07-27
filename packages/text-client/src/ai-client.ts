/**
 * @module ai-client
 *
 * Headless AI player that connects to a game server via WebSocket
 * and submits legal moves chosen by the heuristic ("Smart") strategy.
 * Card definitions are loaded once at start so the strategy can score
 * actions against the static card pool.
 *
 * Usage: npx tsx ai-client.ts <port> <playerName> <token> --deck <deckId>
 *          [--model <weights.json>] [--agent <spec>]
 *
 * With `--model`, decisions come from a trained policy net (the sim's
 * `bc` agent: argmax over the masked softmax, with the same load-time
 * runtime-parity self-test the training pipeline uses) instead of the
 * heuristic strategy.
 *
 * With `--agent`, decisions come from any agent in the sim registry, named
 * by the same spec the sim CLIs take — for example
 * `--agent 'mc:ms=2000/turns=2'` to play the flat Monte-Carlo searcher with
 * a two-second budget per decision. `--agent` wins over `--model`.
 */

import { WebSocket } from 'ws';
import type { ClientMessage, GameAction, EvaluatedAction, PlayerView } from '@meccg/shared';
import type { AiContext, WeightedAction } from '@meccg/sim';
import { loadCardPool, describeAction, buildInstanceLookup, buildCompanyNames, stripCardMarkers } from '@meccg/shared';
import { loadAiStrategy, sampleWeighted, createBcAgent, resolveAgent } from '@meccg/sim';
import type { Agent } from '@meccg/sim';
import { parseSpawnedClientArgs, spawnedJoinPayload, logCommonServerMessage, installReconnect, parseServerMessage } from './client-common.js';

const clientArgs = parseSpawnedClientArgs('ai-client');

/**
 * Agent seam: a registry agent (`--agent`), a trained model (`--model`), or
 * null to fall through to the heuristic strategy below.
 */
let modelAgent: Agent | null = null;
if (clientArgs.agentSpec) {
  modelAgent = resolveAgent(clientArgs.agentSpec);
  console.log(`AI using agent: ${clientArgs.agentSpec}`);
} else if (clientArgs.modelPath) {
  modelAgent = createBcAgent(clientArgs.modelPath);
  console.log(`AI using trained model: ${clientArgs.modelPath}`);
}
const strategy = loadAiStrategy('heuristic');
if (!strategy && !modelAgent) {
  console.error('Heuristic AI strategy is not available — this should never happen.');
  process.exit(1);
}
if (!modelAgent) console.log(`AI using strategy: ${strategy!.name}`);

/** Static card pool — loaded once and reused for every decision. */
const cardPool = loadCardPool();

/** Random integer in [min, max] inclusive. */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Pick the per-decision delay (ms). Combat rolls take longer so they are followable. */
function decisionDelayMs(action: GameAction, view: import('@meccg/shared').PlayerView): number {
  // Body check against an opponent character: 3-4 seconds of tension.
  if (action.type === 'body-check-roll') {
    const combat = view.combat;
    if (combat && combat.bodyCheckTarget === 'character' && combat.defendingPlayerId !== view.self.id) {
      return randInt(3000, 4000);
    }
    // Body check for own character: 2-3 seconds.
    return randInt(2000, 3000);
  }
  // Strike resolution involves a dice roll and needs time to register visually.
  if (action.type === 'resolve-strike') {
    return randInt(1500, 2500);
  }
  // Other combat decisions (assigning strikes, choosing order, cancelling attacks).
  if (['assign-strike', 'choose-strike-order', 'support-strike', 'cancel-attack', 'halve-strikes', 'cancel-by-tap'].includes(action.type)) {
    return randInt(1000, 2000);
  }
  // Default: 0.5-1.5 seconds for natural pacing.
  return randInt(500, 1500);
}

/** Maximum number of weighted candidates to print per decision. */
const LOG_TOP_N = 6;

/** Render a single weighted action as a one-line summary for the log. */
function describeWeighted(weighted: WeightedAction, view: PlayerView): string {
  const lookup = buildInstanceLookup(view);
  const companies = buildCompanyNames(view.self.companies, view.self.characters, cardPool);
  const players = { [view.self.id as string]: view.self.name, [view.opponent.id as string]: view.opponent.name };
  const desc = stripCardMarkers(describeAction(weighted.action, cardPool, lookup, companies, players));
  return `${desc}  [w=${weighted.weight}]`;
}

/**
 * Print the ranked candidates the decision was made from, marking the pick.
 *
 * Every agent gets this, not just the heuristic strategy: a one-line "the
 * agent picked X" is not enough to follow a search agent's reasoning while
 * playing against it, and the candidate ranking is exactly what makes a
 * surprising move explicable. Agents that report no candidates (a forced
 * action, or a fallback that does not weigh) print only the header.
 */
function logCandidates(
  view: PlayerView,
  header: string,
  candidates: readonly WeightedAction[],
  picked: GameAction,
): void {
  console.log(`AI [${view.phaseState.phase}] ${header}`);
  const top = [...candidates].sort((a, b) => b.weight - a.weight).slice(0, LOG_TOP_N);
  for (const candidate of top) {
    console.log(`  ${candidate.action === picked ? '→' : ' '} ${describeWeighted(candidate, view)}`);
  }
  if (candidates.length > LOG_TOP_N) {
    console.log(`    … and ${candidates.length - LOG_TOP_N} more`);
  }
}

/**
 * Pick the next action by delegating to the active strategy and emit a
 * decision summary to stdout. The summary lists the top weighted candidates
 * with their score so a tail of the lobby log shows what the AI is thinking.
 */
function pickAction(view: PlayerView, actions: readonly GameAction[]): GameAction {
  // Real-AI mode: the trained net picks the argmax action from the same
  // projected view a human client sees; the value estimate is logged so a
  // lobby-log tail shows the model's win-probability read of the position.
  if (modelAgent) {
    const decision = modelAgent.chooseAction({
      view,
      cardPool,
      legalActions: actions,
      evaluated: view.legalActions,
      random: Math.random,
    });
    const header = decision.note
      ? `${decision.note} — of ${actions.length} actions:`
      : `agent pick of ${actions.length} actions:`;
    logCandidates(view, header, decision.considered ?? [], decision.action);
    return decision.action;
  }
  const context: AiContext = { view, cardPool, legalActions: actions };
  const weighted = strategy!.weighActions(context);
  if (weighted.length === 0) {
    console.log(`AI [${view.phaseState.phase}] no weighted actions, defaulting to first legal action`);
    return actions[0];
  }

  const picked = sampleWeighted(weighted);
  const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);
  logCandidates(view, `weighing ${weighted.length} actions (total weight ${totalWeight}):`, weighted, picked);
  return picked;
}

function connect(): void {
  const url = `ws://localhost:${clientArgs.port}`;
  console.log(`AI connecting to ${url} as "${clientArgs.playerName}"...`);
  const ws = new WebSocket(url);

  ws.on('open', () => {
    ws.send(spawnedJoinPayload(clientArgs, 'AI'));
  });

  ws.on('message', (raw: Buffer) => {
    const msg = parseServerMessage(raw);
    if (msg.type !== 'state') {
      logCommonServerMessage('AI', msg);
      return;
    }

    const evaluated: readonly EvaluatedAction[] = msg.view.legalActions;
    if (!evaluated || evaluated.length === 0) return;
    // Extract only viable actions
    const actions = evaluated.filter(e => e.viable).map(e => e.action);
    if (actions.length === 0) return;

    // Pick now so we can compute the right delay (body-check rolls
    // against the human player get a longer pause for tension).
    const action = pickAction(msg.view, actions);
    const delayMs = decisionDelayMs(action, msg.view);
    const lookup = buildInstanceLookup(msg.view);
    const companies = buildCompanyNames(msg.view.self.companies, msg.view.self.characters, cardPool);
    const players = { [msg.view.self.id as string]: msg.view.self.name, [msg.view.opponent.id as string]: msg.view.opponent.name };
    const summary = stripCardMarkers(describeAction(action, cardPool, lookup, companies, players));
    setTimeout(() => {
      console.log(`AI action: ${summary} (delay ${delayMs}ms)`);
      const actionMsg: ClientMessage = { type: 'action', action };
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(actionMsg));
      }
    }, delayMs);
  });

  installReconnect(ws, 'AI', connect);
}

connect();
