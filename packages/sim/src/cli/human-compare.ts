/**
 * @module cli/human-compare
 *
 * What did the human actually do here, and what would the AI have done?
 *
 * Every instrument in this package measures the AI against itself. `compare`
 * shadow-polls one agent against another, `gate` rates one against another,
 * `coverage` and `scoring-loop` count what the module tree speaks to. All of
 * them are silent on the only question that matters, because the reference
 * they measure against is another thing this repository built.
 *
 * The live server has a better reference. The recorded corpus is **107–0** to
 * the humans across 21 distinct players, at a median 42 marshalling points to
 * the AI's 2 — and every one of those games is on disk as a full state per
 * decision. That is a policy which demonstrably wins, sampled thousands of
 * times, in positions the AI has genuinely faced.
 *
 * ## Agreement is not correctness, and this is still worth running
 *
 * `compare` already argues the principle: converging on another agent's
 * choices is as likely to mean the faults were acquired as that both found the
 * same truth. That holds for a human too — strong players make mistakes, and
 * 21 of them do not share one policy.
 *
 * What has changed is that nothing else resolves. Marshalling-point means at
 * n=20 are three games wearing a decimal point; the gate returned an interval
 * straddling zero; five model changes moved every funnel metric monotonically
 * and moved the score not at all. A disagreement here is not proof of an
 * error, but it is a *position worth explaining*, and that is more than any
 * other instrument in this package currently offers.
 *
 * ## Recovering the move, which the log does not record
 *
 * The game log stores `legalActions` and the full `GameState` per record, and
 * the `reason` field names the action *type* — but not which candidate was
 * taken. The engine is a pure reducer with its RNG **in the state**, so the
 * move is recoverable exactly rather than guessed: apply each candidate to
 * state N, hash the result, and compare against state N+1. Dice and shuffles
 * come out identical because the seed travelled with the position.
 *
 * The matching is deliberately conservative. A decision counts only when
 * **exactly one** candidate reproduces the next state. Zero matches means an
 * automatic step intervened between the records; several means the candidates
 * are indistinguishable by their effect, and attributing one of them would be
 * inventing data. Both are reported rather than silently dropped, because an
 * attribution rate that quietly falls is how a corpus tool starts lying.
 *
 * Usage:
 *   npm run human-compare -w @meccg/sim -- --dir ~/backup/ai-meccg.com [options]
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadCardPool, reduce, setEngineConsoleLog } from '@meccg/shared';
import type { GameAction, GameState, PlayerId } from '@meccg/shared';
import { projectPlayerView } from '@meccg/game-server';
import { parseCliArgs, numberFlag, resolveAgent, stringFlag } from './common.js';
import { hashState, withStandardCardPool } from '../ai/h2/scenario-store.js';
import { readGameLog } from '../ai/h2/game-log.js';
import { forwardActions } from '../ai/regress.js';
import type { AgentContext } from '../types.js';

/** Flag reference, printed by `--help`. */
const USAGE = `human-compare — does the AI choose what the human chose?

Replays recorded human games, recovers the move the human actually made by
re-applying each legal candidate through the reducer, and asks an agent what it
would have done in the same position.

Agreement is not correctness. A disagreement is a position worth explaining.

Usage:
  npm run human-compare -w @meccg/sim -- --dir <corpus> [options]
  npm run human-compare -w @meccg/sim -- --game <id|path> [options]

Options:
  --dir <path>      corpus root holding games/ and logs/games/
  --game <id|path>  a single game log
  --games <n>       how many games to sample from --dir (default 5)
  --agent <spec>    agent to poll (default h2)
  --top <n>         disagreeing action types to list (default 12)
  --max-decisions <n>  stop a game after this many attributed decisions
  --json            machine-readable summary
  --help            this message
`;

/** A decision recovered from a log: the position, the options, the human's move. */
interface HumanDecision {
  readonly gameId: string;
  readonly stateSeq: number;
  readonly turn: number;
  readonly phase: string;
  readonly player: PlayerId;
  readonly state: GameState;
  readonly legalActions: readonly GameAction[];
  readonly chosen: GameAction;
}

/** Why a record produced no attributable decision. */
type SkipReason = 'forced' | 'opponent-acted' | 'no-match' | 'ambiguous' | 'reducer-error';

const args = parseCliArgs(process.argv.slice(2));
if (args.flags['help'] === true || args.flags['h'] === true) {
  console.log(USAGE);
  process.exit(0);
}
setEngineConsoleLog(false);

const corpusDir = stringFlag(args, 'dir');
const singleGame = stringFlag(args, 'game');
const sampleSize = numberFlag(args, 'games', 5);
const agentSpec = stringFlag(args, 'agent') ?? 'h2';
const topN = numberFlag(args, 'top', 12);
const maxDecisions = numberFlag(args, 'max-decisions', Number.POSITIVE_INFINITY);
const asJson = args.flags['json'] === true;

if (!corpusDir && !singleGame) {
  console.error('human-compare: pass --dir <corpus> or --game <id|path>');
  process.exit(2);
}

const cardPool = loadCardPool();

/**
 * The games in a corpus that have a human seat, with that seat's ID.
 *
 * Read from the completed-game summaries rather than guessed at: they carry a
 * `human` flag per player, and a log without a summary is a game that never
 * finished, whose later decisions are not ones a human ever judged worth
 * making.
 */
function humanGames(dir: string): { gameId: string; player: PlayerId; name: string }[] {
  const summaries = path.join(dir, 'games');
  if (!fs.existsSync(summaries)) throw new Error(`no games/ directory under ${dir}`);
  const found: { gameId: string; player: PlayerId; name: string }[] = [];
  for (const file of fs.readdirSync(summaries)) {
    if (!file.endsWith('.json')) continue;
    const summary = JSON.parse(fs.readFileSync(path.join(summaries, file), 'utf-8')) as {
      gameId?: string;
      players?: { playerId?: string; name?: string; human?: boolean }[];
    };
    const human = summary.players?.find(p => p.human === true);
    if (!summary.gameId || !human?.playerId) continue;
    found.push({
      gameId: summary.gameId,
      player: human.playerId as PlayerId,
      name: human.name ?? human.playerId,
    });
  }
  return found;
}

/**
 * Recover the human's move at one record by re-applying every candidate.
 *
 * Exactly one candidate must reproduce the next recorded state. The engine's
 * RNG lives in the state, so a dice roll replays identically and a match is an
 * identity rather than a resemblance.
 */
function recover(
  state: GameState,
  candidates: readonly GameAction[],
  nextHash: string,
  actedType: string | undefined,
): { chosen: GameAction } | { skipped: SkipReason } {
  // The next record's `reason` names the action *type* that produced it, which
  // is what separates "the human chose differently" from "the opponent moved".
  // In a simultaneous phase both seats are offered actions and only one acts,
  // and without this every one of the other seat's moves reads as a failure to
  // attribute — it was 1177 of them against 291 attributed on the first run.
  const ofType = actedType === undefined
    ? candidates
    : candidates.filter(a => a.type === actedType);
  if (ofType.length === 0) return { skipped: 'opponent-acted' };

  const matches: GameAction[] = [];
  for (const action of ofType) {
    let result;
    try {
      result = reduce(state, action);
    } catch {
      continue;
    }
    if (result.error !== undefined) continue;
    if (hashState(result.state) === nextHash) matches.push(action);
  }
  if (matches.length === 1) return { chosen: matches[0] };
  // A single candidate of the acted type that does not reproduce the state is
  // still the move the human made — the mismatch is an intervening automatic
  // step, not a different choice. Anything less certain is refused.
  if (matches.length === 0 && ofType.length === 1) return { chosen: ofType[0] };
  return { skipped: matches.length === 0 ? 'no-match' : 'ambiguous' };
}

/** Read one game's attributable human decisions. */
function decisionsOf(logRef: string, gameId: string, player: PlayerId): {
  decisions: HumanDecision[];
  skips: Record<SkipReason, number>;
} {
  const records = readGameLog(logRef).filter(r => r.event === 'state');
  const decisions: HumanDecision[] = [];
  const skips: Record<SkipReason, number> = {
    forced: 0, 'opponent-acted': 0, 'no-match': 0, ambiguous: 0, 'reducer-error': 0,
  };

  for (let i = 0; i < records.length - 1; i++) {
    const record = records[i];
    const offered = (record as unknown as {
      legalActions?: Record<string, { action: GameAction; reason?: string }[]>;
    }).legalActions?.[player as unknown as string];
    if (!offered || offered.length === 0) continue;

    // The log lists *every* candidate the engine considered, viable or not, and
    // carries the refusal on `reason`. Feeding the non-viable ones to an agent
    // is how the first run had it playing `not-playable` — a marker the engine
    // emits for a card that cannot be played — 66 times.
    const viable = offered.filter(e => e.reason === undefined && e.action.type !== 'not-playable');
    // Every agent drops the engine's marked undos, so a decision counts only
    // where the human really had a choice between moves forward.
    const candidates = forwardActions(viable.map(e => e.action));
    if (candidates.length < 2) {
      skips.forced++;
      continue;
    }

    const state = withStandardCardPool(record.state);
    const nextHash = hashState(withStandardCardPool(records[i + 1].state));
    const actedType = (records[i + 1] as unknown as { reason?: string }).reason;
    const outcome = recover(state, candidates, nextHash, actedType);
    if ('skipped' in outcome) {
      skips[outcome.skipped]++;
      continue;
    }
    decisions.push({
      gameId,
      stateSeq: record.stateSeq,
      turn: record.turn,
      phase: record.phase,
      player,
      state,
      legalActions: candidates,
      chosen: outcome.chosen,
    });
    if (decisions.length >= maxDecisions) break;
  }
  return { decisions, skips };
}

// ---- Run ----

const targets = singleGame
  ? [{ gameId: singleGame, player: (stringFlag(args, 'player') ?? 'p1') as PlayerId, name: 'human', ref: singleGame }]
  : humanGames(corpusDir!)
    .slice(0, sampleSize)
    .map(g => ({ ...g, ref: path.join(corpusDir!, 'logs', 'games', `${g.gameId}.jsonl`) }));

const agent = resolveAgent(agentSpec);
const totals = {
  decisions: 0, agreed: 0,
  forced: 0, opponentActed: 0, noMatch: 0, ambiguous: 0, reducerError: 0,
};
/** Agreement per action type, keyed by the *human's* choice. */
const byType = new Map<string, { seen: number; agreed: number }>();
/** What the agent played instead, keyed `human → agent`. */
const swaps = new Map<string, number>();

for (const target of targets) {
  if (!fs.existsSync(target.ref)) continue;
  const { decisions, skips } = decisionsOf(target.ref, target.gameId, target.player);
  totals.forced += skips.forced;
  totals.opponentActed += skips['opponent-acted'];
  totals.noMatch += skips['no-match'];
  totals.ambiguous += skips.ambiguous;
  totals.reducerError += skips['reducer-error'];

  agent.startGame?.();
  for (const decision of decisions) {
    const view = projectPlayerView(decision.state, decision.player);
    const context: AgentContext = {
      view,
      cardPool,
      legalActions: decision.legalActions,
      evaluated: view.legalActions,
      random: () => 0.5,
    } as unknown as AgentContext;

    let played: GameAction;
    try {
      played = agent.chooseAction(context).action;
    } catch {
      totals.reducerError++;
      continue;
    }

    totals.decisions++;
    const humanType = decision.chosen.type;
    const entry = byType.get(humanType) ?? { seen: 0, agreed: 0 };
    entry.seen++;
    // Identity, not deep equality: the candidate list handed to the agent is
    // the same array the human's move was recovered from, so the agreed case
    // is the same object.
    const agreed = played === decision.chosen;
    if (agreed) {
      totals.agreed++;
      entry.agreed++;
    } else {
      const key = `${humanType} → ${played.type}`;
      swaps.set(key, (swaps.get(key) ?? 0) + 1);
    }
    byType.set(humanType, entry);
  }
  process.stderr.write(`  … ${target.gameId} (${decisions.length} decisions)\n`);
}

// ---- Report ----

const rate = (a: number, b: number): string => (b === 0 ? '—' : `${((a / b) * 100).toFixed(1)}%`);

if (asJson) {
  console.log(JSON.stringify({
    agent: agentSpec,
    games: targets.length,
    ...totals,
    agreement: totals.decisions === 0 ? null : totals.agreed / totals.decisions,
    byType: Object.fromEntries([...byType].map(([t, e]) => [t, { ...e, rate: e.agreed / e.seen }])),
    swaps: Object.fromEntries(swaps),
  }, null, 2));
} else {
  console.log(`\nhuman-compare: ${agentSpec} against ${targets.length} recorded human game(s)\n`);
  console.log(`attributed decisions   ${totals.decisions}`);
  console.log(`  agreed with human    ${totals.agreed}  (${rate(totals.agreed, totals.decisions)})`);
  console.log('\nnot attributable (reported, not hidden):');
  console.log(`  forced (one option)  ${totals.forced}`);
  console.log(`  the opponent acted   ${totals.opponentActed}`);
  console.log(`  no candidate matched ${totals.noMatch}`);
  console.log(`  several matched      ${totals.ambiguous}`);
  console.log(`  agent or reducer errored ${totals.reducerError}`);

  console.log('\n── agreement by the human\'s action type ──\n');
  const rows = [...byType].sort((a, b) => b[1].seen - a[1].seen).slice(0, topN);
  console.log('action                       human chose it   agent agreed');
  for (const [type, entry] of rows) {
    console.log(`  ${type.padEnd(26)}${String(entry.seen).padStart(9)}`
      + `${`${entry.agreed} (${rate(entry.agreed, entry.seen)})`.padStart(18)}`);
  }

  console.log('\n── what the agent played instead, most common first ──\n');
  for (const [key, count] of [...swaps].sort((a, b) => b[1] - a[1]).slice(0, topN)) {
    console.log(`  ${String(count).padStart(5)}  ${key}`);
  }
  console.log('\nAgreement is not correctness. A disagreement is a position worth explaining:');
  console.log('  npm run explain -w @meccg/sim -- --game <id> --seq <n>\n');
}
