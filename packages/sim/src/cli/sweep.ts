/**
 * @module cli/sweep
 *
 * Vary one number and watch a real decision change — or not change.
 *
 * Plan §5.3: this is what turns "the risk posture makes it bolder when
 * trailing" and "the travel cost is about right" from intentions into
 * something observable. A tunable that never changes any decision on the
 * corpus is either dead or mis-scaled; one that flips a decision between 0.3
 * and 0.4 is carrying far more weight than a hand-chosen number should.
 *
 * Usage:
 *   npm run sweep -w @meccg/sim -- --scenario <id> --over risk --from -1 --to 1
 *   npm run sweep -w @meccg/sim -- --scenario <id> --over tunable:tapTempoCost --from 0 --to 2
 */

import { loadCardPool, setEngineConsoleLog } from '@meccg/shared';
import type { GameAction } from '@meccg/shared';
import { buildCompanyNames, buildInstanceLookup, describeAction, stripCardMarkers } from '@meccg/shared';
import { parseCliArgs, numberFlag, stringFlag } from './common.js';
import { DEFAULT_TUNABLES, withTunable } from '../ai/h2/core/tunables.js';
import type { Tunables } from '../ai/h2/core/tunables.js';
import { loadWinProbModel } from '../ai/h2/core/winprob.js';
import { computeStanding } from '../ai/h2/services/standing.js';
import { ALL_MODULES, evaluateDecision } from '../ai/h2/core/registry.js';
import { loadScenario, scenarioView } from '../ai/h2/scenario-store.js';

/** Flag reference, printed by `--help`. */
const USAGE = `sweep — vary one number and watch a real decision change, or not

Usage:
  npm run sweep -w @meccg/sim -- --scenario <id> --over <axis> [options]

Options:
  --scenario <id>     a checked-in scenario
  --over <axis>       'risk' for the risk posture, or 'tunable:<name>'
  --from <n>          start of the range (default -1 for risk, 0 otherwise)
  --to <n>            end of the range (default +1 for risk, twice the
                      shipped value otherwise)
  --steps <n>         how many points to sample (default 9)
  --help              this message
`;

const args = parseCliArgs(process.argv.slice(2));
if (args.flags['help'] === true || args.flags['h'] === true) {
  console.log(USAGE);
  process.exit(0);
}
setEngineConsoleLog(false);

const scenarioId = stringFlag(args, 'scenario');
const axis = stringFlag(args, 'over');
if (!scenarioId || !axis) {
  console.error('sweep: --scenario <id> and --over <axis> are both required');
  process.exit(2);
}

const overRisk = axis === 'risk';
const tunableName = overRisk ? null : axis.replace(/^tunable:/, '');
if (!overRisk && !(tunableName! in DEFAULT_TUNABLES)) {
  console.error(`sweep: unknown tunable "${tunableName}" — available: ${Object.keys(DEFAULT_TUNABLES).join(', ')}`);
  process.exit(2);
}

const shipped = overRisk ? 0 : (DEFAULT_TUNABLES as unknown as Record<string, number>)[tunableName!];
const from = numberFlag(args, 'from', overRisk ? -1 : 0);
const to = numberFlag(args, 'to', overRisk ? 1 : Math.max(1, shipped * 2));
const steps = Math.max(2, numberFlag(args, 'steps', 9));

const cardPool = loadCardPool();
const model = loadWinProbModel();
const scenario = loadScenario(scenarioId);
const view = scenarioView(scenario);
const legalActions = view.legalActions.filter(e => e.viable).map(e => e.action);

/** Describe an action the way `explain` does. */
const lookup = buildInstanceLookup(view);
const companies = buildCompanyNames(view.self.companies, view.self.characters, cardPool);
const playerNames: Record<string, string> = {
  [view.self.id as string]: view.self.name,
  [view.opponent.id as string]: view.opponent.name,
};
const describe = (action: GameAction): string =>
  stripCardMarkers(describeAction(action, cardPool, lookup, companies, playerNames));

console.log(`Sweeping ${axis} over ${scenarioId}`);
console.log(`  ${scenario.description}`);
if (!overRisk) console.log(`  shipped value: ${shipped}`);
console.log('');

let previous: string | null = null;
let flips = 0;

for (let i = 0; i < steps; i++) {
  const value = from + ((to - from) * i) / (steps - 1);
  const tunables: Tunables = overRisk ? DEFAULT_TUNABLES : withTunable(DEFAULT_TUNABLES, tunableName!, value);
  const standing = computeStanding(view, model, tunables, overRisk ? value : undefined);
  const { evaluations } = evaluateDecision(ALL_MODULES, {
    view, cardPool, legalActions, tunables, standing,
  });
  if (evaluations.length === 0) {
    console.log(`  ${value.toFixed(2).padStart(6)}   (no module scored this decision)`);
    continue;
  }
  const best = evaluations[0];
  const chosen = describe(best.action);
  // A flip is the point of the exercise: everything else is one number moving.
  const marker = previous !== null && chosen !== previous ? ' ←' : '';
  if (marker) flips++;
  const shippedMark = !overRisk && Math.abs(value - shipped) < (to - from) / (steps - 1) / 2 ? ' *' : '';
  console.log(`  ${value.toFixed(2).padStart(6)}${shippedMark.padEnd(2)}  `
    + `U ${(best.utility * 100).toFixed(2).padStart(7)}%   ${chosen}${marker}`);
  previous = chosen;
}

console.log('');
if (flips === 0) {
  console.log(`No decision change across the range. On this position ${axis} is not what decides it —`);
  console.log('which is worth knowing before spending effort tuning it.');
} else {
  console.log(`${flips} decision change(s), marked ←. A number that flips a real decision inside its`);
  console.log('plausible range is carrying more weight than a hand-chosen constant should.');
}
if (!overRisk) console.log('The shipped value is marked *.');
