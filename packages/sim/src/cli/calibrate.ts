/**
 * @module cli/calibrate
 *
 * Check an H2 module's claimed probabilities against the real reducer.
 *
 * Usage:
 *   npm run calibrate -w @meccg/sim -- [--module combat] [--scenario <id>]
 *     [--rollouts 5000]
 *
 * For every scenario the module claims, every dice action it offers is replayed
 * through the engine `--rollouts` times with a fresh seed, and the observed
 * frequency of each outcome is compared against the module's claim using a 99%
 * binomial interval. Exits non-zero when any claim falls outside its interval,
 * so this is usable as a gate and not only as a report.
 */

import { createRng, loadCardPool, setEngineConsoleLog } from '@meccg/shared';
import type { GameAction } from '@meccg/shared';
import { parseCliArgs, numberFlag, stringFlag } from './common.js';
import { DEFAULT_TUNABLES } from '../ai/h2/core/tunables.js';
import { loadWinProbModel } from '../ai/h2/core/winprob.js';
import { computeStanding } from '../ai/h2/services/standing.js';
import { ALL_MODULES, evaluateDecision, resolveModules } from '../ai/h2/core/registry.js';
import { listScenarioIds, loadScenario, scenarioView } from '../ai/h2/scenario-store.js';
import { binomialTolerance, rolloutStrike } from '../ai/h2/calibrate.js';
import { claimedStrikeOutcomes } from '../ai/h2/modules/combat/combat.js';
import type { StrikeOutcome } from '../ai/h2/modules/combat/strike-model.js';

const args = parseCliArgs(process.argv.slice(2));
setEngineConsoleLog(false);
const rollouts = numberFlag(args, 'rollouts', 5000);
const seed = numberFlag(args, 'seed', 20260727);
const moduleFilter = stringFlag(args, 'module') ?? 'combat';
const only = stringFlag(args, 'scenario');

if (moduleFilter !== 'combat') {
  // Each module claims a different shape of outcome, so each needs its own
  // classifier in the harness. Only `combat` has one so far; pretending
  // otherwise would report a vacuous pass.
  console.error(`calibrate: no outcome classifier for module "${moduleFilter}" — only 'combat' is supported`);
  process.exit(2);
}

const cardPool = loadCardPool();
const model = loadWinProbModel();
const modules = resolveModules(moduleFilter, ALL_MODULES);
const ids = only ? [only] : listScenarioIds();

/** Key an outcome by its structured fate pair, the vocabulary both sides share. */
function key(outcome: Pick<StrikeOutcome, 'character' | 'strike'>): string {
  return `${outcome.strike}/${outcome.character}`;
}

let checked = 0;
let failures = 0;
let skipped = 0;

for (const id of ids) {
  const scenario = loadScenario(id);
  const view = scenarioView(scenario);
  const legalActions = view.legalActions.filter(e => e.viable).map(e => e.action);
  const standing = computeStanding(view, model, DEFAULT_TUNABLES);
  const context = { view, cardPool, legalActions, tunables: DEFAULT_TUNABLES, standing };
  const { module } = evaluateDecision(modules, context);
  if (!module) continue;

  console.log(`\n${id}  (${scenario.description})`);

  for (const action of legalActions) {
    const claimed = claimedStrikeOutcomes(action, context);
    if (!claimed) {
      skipped++;
      continue;
    }

    const counts = new Map<string, number>();
    let resolved = 0;
    // One continuous RNG stream across all rollouts of this action; see
    // `rolloutStrike` for why re-seeding per rollout would bias the dice.
    let rng = createRng(seed);
    for (let i = 0; i < rollouts; i++) {
      const result = rolloutStrike(scenario.state, action, rng);
      rng = result.rng;
      if (!result.outcome) continue;
      resolved++;
      const k = key(result.outcome);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    if (resolved === 0) {
      console.log(`  ${action.type}: no rollout resolved — skipped`);
      skipped++;
      continue;
    }

    console.log(`  ${describeAction(action)}  (${resolved} rollouts)`);
    // Every outcome either side believes in is checked, so a branch the module
    // forgot shows up as a claim of zero against a non-zero frequency.
    const allKeys = new Set([...claimed.map(key), ...counts.keys()]);
    for (const k of [...allKeys].sort()) {
      const p = claimed.filter(o => key(o) === k).reduce((sum, o) => sum + o.p, 0);
      const hits = counts.get(k) ?? 0;
      const observed = hits / resolved;
      const tolerance = binomialTolerance(p, resolved);
      const within = Math.abs(observed - p) <= tolerance;
      checked++;
      if (!within) failures++;
      console.log(
        `    ${within ? 'ok  ' : 'FAIL'} ${k.padEnd(22)} claimed ${(p * 100).toFixed(2).padStart(6)}%`
        + `  observed ${(observed * 100).toFixed(2).padStart(6)}%  ±${(tolerance * 100).toFixed(2)}%`,
      );
    }
  }
}

/** Compact one-line label for an action, without needing the describer. */
function describeAction(action: GameAction): string {
  const need = (action as unknown as { need?: number }).need;
  const tap = (action as unknown as { tapToFight?: boolean }).tapToFight;
  const suffix = tap === undefined ? '' : tap ? ' (tap to fight)' : ' (stay untapped)';
  return `${action.type}${suffix}${need === undefined ? '' : `, need ${need}`}`;
}

console.log('');
console.log(`${checked - failures}/${checked} claims within the 99% interval at ${rollouts} rollouts`
  + `${skipped > 0 ? `, ${skipped} action(s) not dice-modelled` : ''}`);
if (failures > 0) process.exit(1);
