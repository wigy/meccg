/**
 * @module cli/coverage
 *
 * How much of the game does H2 actually speak to, and what is stopping it?
 *
 * The README has carried a coverage table since P1, produced by an ad hoc
 * script and stale ever since. It is the wrong thing to guess at, because it is
 * the number that decides which module to write next: an action type appearing
 * in a tenth of contested decisions with no owner is worth a module, and one
 * appearing twice a game is not, however conspicuous it looked in the one
 * scenario that prompted the question.
 *
 * So this replays self-play games and asks the registry the same question the
 * agent asks, decision by decision:
 *
 * - **Contested** — more than one legal action. Agreement and coverage are both
 *   free where there is only one, so they are counted separately.
 * - **Covered** — every candidate has an owning module. The decision is H2's.
 * - **Partial** — some candidates are owned. The agent acts anyway when the
 *   best covered utility clears `partialCoverageMargin`, and hands the decision
 *   to Heuristics 1 otherwise; both are counted, because the second is a cost.
 * - **Flat** — completely covered and every candidate scored the same. That is
 *   a tie rather than an opinion, and it also falls back.
 *
 * The output ends with the unowned action types by frequency, which is the
 * work list.
 *
 * Usage:
 *   npm run coverage -w @meccg/sim -- [--games 4] [--seed 1] [--agents h2,heuristic]
 */

import { loadCardPool, setEngineConsoleLog } from '@meccg/shared';
import { playGame } from '../runner.js';
import { parseCliArgs, numberFlag, resolveAgent, resolvePair, resolveDecks } from './common.js';
import type { Agent, AgentContext } from '../types.js';
import { DEFAULT_TUNABLES } from '../ai/h2/core/tunables.js';
import { loadWinProbModel } from '../ai/h2/core/winprob.js';
import { computeStanding } from '../ai/h2/services/standing.js';
import { ALL_MODULES, evaluateDecision, ownerOf } from '../ai/h2/core/registry.js';

/** Flag reference, printed by `--help`. */
const USAGE = `coverage — how much of the game does H2 speak to, and what is stopping it?

Replays self-play decisions and asks the registry which of them H2 owns. The
tail of the report is the work list: the action types appearing in contested
decisions that no module owns.

Usage:
  npm run coverage -w @meccg/sim -- [options]

Options:
  --games <n>       self-play games to sample (default 4)
  --seed <n>        base seed (default 1)
  --agents <a,b>    the H2 agent and its opponent (default h2,heuristic)
  --decks <a,b>     deck IDs
  --top <n>         unowned action types to list (default 15)
  --help            this message
`;

const args = parseCliArgs(process.argv.slice(2));
if (args.flags['help'] === true || args.flags['h'] === true) {
  console.log(USAGE);
  process.exit(0);
}
setEngineConsoleLog(false);

const games = numberFlag(args, 'games', 4);
const baseSeed = numberFlag(args, 'seed', 1);
const top = numberFlag(args, 'top', 15);
const [selfSpec, opponentSpec] = resolvePair(args, 'agents', ['h2', 'heuristic']);
const decks = resolveDecks(args);
const cardPool = loadCardPool();
const model = loadWinProbModel();

/** Running tallies over every decision seen. */
const tally = {
  decisions: 0,
  contested: 0,
  covered: 0,
  partialActed: 0,
  partialHandedOver: 0,
  flat: 0,
  uncoveredEntirely: 0,
};

/** Contested appearances per action type, and how many had an owner. */
const byType = new Map<string, { seen: number; owned: number }>();
/** Contested decisions blocked by each unowned action type. */
const blockedBy = new Map<string, number>();
/**
 * Action types a module *owns* but declined, by module.
 *
 * Worth separating from "nobody owns it": an unowned type is a module waiting
 * to be written, while a declined one is a module that took responsibility and
 * then had nothing to say — either a declared gap, like `hazards` on events, or
 * a bug, like the two modules that once restated the all-or-nothing rule inside
 * their own `claims()` and silenced themselves.
 */
const declinedBy = new Map<string, number>();

for (let g = 0; g < games; g++) {
  const inner = resolveAgent(selfSpec);
  const spy: Agent = {
    name: inner.name,
    startGame: () => inner.startGame?.(),
    chooseAction(context: AgentContext) {
      tally.decisions++;
      if (context.legalActions.length > 1) {
        const standing = computeStanding(context.view, model, DEFAULT_TUNABLES);
        const { evaluations, complete, uncovered } = evaluateDecision(ALL_MODULES, {
          view: context.view,
          cardPool,
          legalActions: context.legalActions,
          tunables: DEFAULT_TUNABLES,
          standing,
        });
        tally.contested++;

        const scored = new Set(evaluations.map(e => e.action));
        for (const action of context.legalActions) {
          const entry = byType.get(action.type) ?? { seen: 0, owned: 0 };
          entry.seen++;
          if (scored.has(action)) {
            entry.owned++;
          } else {
            const owner = ownerOf(ALL_MODULES, action, {
              view: context.view,
              cardPool,
              legalActions: context.legalActions,
              tunables: DEFAULT_TUNABLES,
              standing,
            });
            if (owner) {
              const key = `${action.type} (${owner.name})`;
              declinedBy.set(key, (declinedBy.get(key) ?? 0) + 1);
            }
          }
          byType.set(action.type, entry);
        }

        if (complete) {
          const best = evaluations[0];
          const worst = evaluations[evaluations.length - 1];
          const discriminates = evaluations.length > 0
            && best.utility - worst.utility > DEFAULT_TUNABLES.partialCoverageMargin;
          if (discriminates || (evaluations.length > 0 && best.utility > DEFAULT_TUNABLES.partialCoverageMargin)) {
            tally.covered++;
          } else {
            tally.flat++;
          }
        } else if (evaluations.length === 0) {
          tally.uncoveredEntirely++;
          for (const type of new Set(uncovered)) blockedBy.set(type, (blockedBy.get(type) ?? 0) + 1);
        } else if (evaluations[0].utility > DEFAULT_TUNABLES.partialCoverageMargin) {
          tally.partialActed++;
          for (const type of new Set(uncovered)) blockedBy.set(type, (blockedBy.get(type) ?? 0) + 1);
        } else {
          tally.partialHandedOver++;
          for (const type of new Set(uncovered)) blockedBy.set(type, (blockedBy.get(type) ?? 0) + 1);
        }
      }
      return inner.chooseAction(context);
    },
  };

  playGame({ agents: [spy, resolveAgent(opponentSpec)], decks, seed: baseSeed + g });
  console.log(`  … game ${g + 1}/${games}, ${tally.contested} contested decisions so far`);
}

/** A count as a percentage of contested decisions. */
function share(count: number): string {
  return tally.contested === 0 ? '  n/a' : `${((count / tally.contested) * 100).toFixed(1)}%`;
}

console.log('');
console.log(`${tally.decisions} decisions over ${games} games, ${tally.contested} contested`);
console.log('');
console.log(`  covered and decisive     ${String(tally.covered).padStart(6)}  ${share(tally.covered)}`);
console.log(`  covered but flat         ${String(tally.flat).padStart(6)}  ${share(tally.flat)}   → H1`);
console.log(`  partial, acted anyway    ${String(tally.partialActed).padStart(6)}  ${share(tally.partialActed)}`);
console.log(`  partial, handed over     ${String(tally.partialHandedOver).padStart(6)}  ${share(tally.partialHandedOver)}   → H1`);
console.log(`  no owner at all          ${String(tally.uncoveredEntirely).padStart(6)}  ${share(tally.uncoveredEntirely)}   → H1`);
const h2Decides = tally.covered + tally.partialActed;
console.log('');
console.log(`  H2 decides ${share(h2Decides)} of contested decisions.`);

console.log('');
console.log('Action types in contested decisions with no owner, by how often they appear:');
const unowned = [...byType.entries()]
  .filter(([, entry]) => entry.owned < entry.seen)
  .sort((a, b) => (b[1].seen - b[1].owned) - (a[1].seen - a[1].owned))
  .slice(0, top);
if (unowned.length === 0) {
  console.log('  (none — every action type offered in a contested decision has an owner)');
} else {
  for (const [type, entry] of unowned) {
    const blocked = blockedBy.get(type) ?? 0;
    console.log(
      `  ${type.padEnd(28)} ${String(entry.seen - entry.owned).padStart(6)} unowned`
      + `   blocks ${String(blocked).padStart(5)} decision(s)`,
    );
  }
}
console.log('');
console.log('"Blocks" counts contested decisions where the type went unscored — the same');
console.log('decision is counted once per unowned type it contains, so the column sums to');
console.log('more than the number of decisions.');

console.log('');
console.log('Candidates a module owns but declined — a declared gap, or a module that has');
console.log('silently stopped answering:');
const declined = [...declinedBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
if (declined.length === 0) {
  console.log('  (none — every owned candidate was scored)');
} else {
  for (const [key, count] of declined) {
    console.log(`  ${key.padEnd(44)} ${String(count).padStart(6)} declined`);
  }
}
