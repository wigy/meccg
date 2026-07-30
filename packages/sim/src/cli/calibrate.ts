/**
 * @module cli/calibrate
 *
 * Check the H2 modules' claimed probabilities against the real reducer.
 *
 * Usage:
 *   npm run calibrate -w @meccg/sim -- [--module combat] [--scenario <id>]
 *     [--rollouts 5000]
 *
 * For every scenario a module claims, every dice action it offers is replayed
 * through the engine `--rollouts` times with a fresh seed, and the observed
 * frequency of each outcome is compared against the module's claim using a 99%
 * binomial interval. Exits non-zero when any claim falls outside its interval,
 * so this is usable as a gate and not only as a report.
 *
 * **Everything with a classifier runs by default.** It used to default to
 * `combat`, which was right when combat was the only module the harness could
 * classify — and stayed after four more classifiers were added, so the bare
 * command reported `36/36 claim(s) matched` while ten claims from `corruption`,
 * `factions`, `grants` and `resources` went unmeasured. A green line that
 * silently covers a fifth of what it names is worse than a red one. The summary
 * now breaks the count down per module, so a module that contributes nothing is
 * visible instead of being averaged away.
 */

import { createRng, loadCardPool, setEngineConsoleLog } from '@meccg/shared';
import type { GameAction } from '@meccg/shared';
import { parseCliArgs, numberFlag, stringFlag } from './common.js';
import { DEFAULT_TUNABLES } from '../ai/h2/core/tunables.js';
import { loadWinProbModel } from '../ai/h2/core/winprob.js';
import { computeStanding } from '../ai/h2/services/standing.js';
import { ALL_MODULES, evaluateDecision, resolveModules } from '../ai/h2/core/registry.js';
import { listScenarioIds, loadScenario, scenarioView } from '../ai/h2/scenario-store.js';
import {
  binomialTolerance, rolloutCorruptionCheck, rolloutDeterministicPlay, rolloutGrantedAction,
  rolloutInfluenceAttempt, rolloutStrike,
} from '../ai/h2/calibrate.js';
import { claimedStrikeOutcomes } from '../ai/h2/modules/combat/combat.js';
import type { StrikeOutcome } from '../ai/h2/services/strike/strike-model.js';

/** Flag reference, printed by `--help`. */
const USAGE = `calibrate — check an H2 module's claimed probabilities against the real reducer

A module claims P(wounded) = 2.31%. Every dice action it offers is replayed
through the engine, the outcome is classified from the engine's own record,
and the observed frequency is compared against the claim with a 99% binomial
interval. Exits non-zero on any claim outside its interval, so it gates.

Usage:
  npm run calibrate -w @meccg/sim -- [options]

Options:
  --module <a,b>      modules to check (default: every module with an outcome
                      classifier — combat, corruption, factions, grants,
                      resources)
  --scenario <id>     check one scenario instead of the whole corpus
  --rollouts <n>      rollouts per action (default 5000)
  --seed <n>          RNG seed for the rollout stream, so a run is reproducible
  --help              this message
`;

/**
 * Modules this harness knows how to classify the outcome of.
 *
 * Each claims a different shape of outcome and needs its own classifier, so
 * this list is the harness's own coverage rather than the module registry's.
 * Running a module without one would report a vacuous pass.
 */
const CLASSIFIED = ['combat', 'corruption', 'factions', 'grants', 'resources'] as const;

const args = parseCliArgs(process.argv.slice(2));
if (args.flags['help'] === true || args.flags['h'] === true) {
  console.log(USAGE);
  process.exit(0);
}
setEngineConsoleLog(false);
const rollouts = numberFlag(args, 'rollouts', 5000);
const seed = numberFlag(args, 'seed', 20260727);
const moduleFilter = stringFlag(args, 'module') ?? CLASSIFIED.join(',');
const requested = moduleFilter.split(',').map(name => name.trim()).filter(name => name.length > 0);
const only = stringFlag(args, 'scenario');

if (requested.includes('travel')) {
  // Not an omission. `travel` claims what a destination will be *worth* — the
  // cards that become playable once the company arrives — and none of that
  // moves marshalling points at the moment `plan-movement` is applied. The
  // deterministic classifier would measure a change of zero against a claim of
  // several tsd and report a failure that is really a category error.
  //
  // Checking `travel` needs a horizon test (plan §6.4): does the predicted
  // delta correlate with the realized score change some turns later, across
  // replayed games? That is a different harness from this one.
  console.error('calibrate: `travel` cannot be checked here — its claim is about future value, not '
    + 'points that move now. It needs the horizon test of plan §6.4, which does not exist yet.');
  process.exit(2);
}

const unclassified = requested.filter(name => !(CLASSIFIED as readonly string[]).includes(name));
if (unclassified.length > 0) {
  // Each module claims a different shape of outcome, so each needs its own
  // classifier in the harness. Claiming to check one without a classifier
  // would report a vacuous pass.
  console.error(`calibrate: no outcome classifier for module(s) "${unclassified.join(', ')}" — `
    + `${CLASSIFIED.join(', ')} are supported`);
  process.exit(2);
}

const cardPool = loadCardPool();
const model = loadWinProbModel();
const modules = resolveModules(requested.join(','), ALL_MODULES);
const ids = only ? [only] : listScenarioIds();

/** Key an outcome by its structured fate pair, the vocabulary both sides share. */
function key(outcome: Pick<StrikeOutcome, 'character' | 'strike'>): string {
  return `${outcome.strike}/${outcome.character}`;
}

let checked = 0;
let failures = 0;
let skipped = 0;
/**
 * Claims measured per module, so the summary can say who was actually checked.
 *
 * Seeded with every requested module at zero: a module that produced no claim
 * at all is the interesting case, and a map built only from what was measured
 * would hide exactly that.
 */
const perModule = new Map<string, { checked: number; failures: number }>(
  requested.map(name => [name, { checked: 0, failures: 0 }]),
);

/** Count one measured claim against the module that made it. */
function record(module: string, within: boolean): void {
  checked++;
  if (!within) failures++;
  const entry = perModule.get(module) ?? { checked: 0, failures: 0 };
  entry.checked++;
  if (!within) entry.failures++;
  perModule.set(module, entry);
}

for (const id of ids) {
  const scenario = loadScenario(id);
  const view = scenarioView(scenario);
  const legalActions = view.legalActions.filter(e => e.viable).map(e => e.action);
  const standing = computeStanding(view, model, DEFAULT_TUNABLES);
  const context = { view, cardPool, legalActions, tunables: DEFAULT_TUNABLES, standing };
  const decision = evaluateDecision(modules, context);
  if (decision.modules.length === 0) continue;
  // One evaluation per candidate, looked up rather than recomputed: every
  // branch below needs the module's claim about the action it is checking, and
  // re-running the whole decision per branch was both wasteful and a way for
  // two branches to disagree about the same position.
  const evaluationOf = new Map(decision.evaluations.map(e => [e.action, e]));

  console.log(`\n${id}  (${scenario.description})`);

  for (const action of legalActions) {
    if (action.type === 'play-hero-resource' || action.type === 'play-minor-item') {
      // A deterministic claim: no interval, just whether the arithmetic
      // matches what the engine's own totals do. One rollout is enough.
      const evaluation = evaluationOf.get(action);
      const claimedGain = evaluation
        ? Number(findGain(evaluation.rationale))
        : Number.NaN;
      if (!Number.isFinite(claimedGain)) { skipped++; continue; }
      const measured = rolloutDeterministicPlay(scenario.state, action, createRng(seed));
      if (measured.tsdChange === null) { skipped++; continue; }
      const within = Math.abs(measured.tsdChange - claimedGain) < 1e-9;
      record(evaluation?.module ?? 'resources', within);
      console.log(`  ${action.type}`);
      console.log(`    ${within ? 'ok  ' : 'FAIL'} ${'marshalling-point gain'.padEnd(22)} `
        + `claimed ${claimedGain.toFixed(2).padStart(6)}  `
        + `engine ${measured.tsdChange.toFixed(2).padStart(6)}  (tsd, exact)`);
      continue;
    }

    if (action.type === 'activate-granted-action') {
      // The most directly falsifiable claim any module makes: the probability
      // comes straight off the threshold the engine publishes, with no
      // modelling assumption between the number and the dice.
      const evaluation = evaluationOf.get(action);
      const success = evaluation?.outcomes.find(o => !o.label.includes('the roll fails'));
      if (!success) { skipped++; continue; }
      let landed = 0;
      let resolved = 0;
      let rngG = createRng(seed);
      for (let i = 0; i < rollouts; i++) {
        const result = rolloutGrantedAction(scenario.state, action, rngG);
        rngG = result.rng;
        if (result.succeeded === null) continue;
        resolved++;
        if (result.succeeded) landed++;
      }
      if (resolved === 0) { skipped++; continue; }
      const observed = landed / resolved;
      const tolerance = binomialTolerance(success.p, resolved);
      const within = Math.abs(observed - success.p) <= tolerance;
      record(evaluation?.module ?? 'grants', within);
      console.log(`  ${action.type}`);
      console.log(`    ${within ? 'ok  ' : 'FAIL'} ${'the roll succeeds'.padEnd(22)} `
        + `claimed ${(success.p * 100).toFixed(1).padStart(5)}%  `
        + `engine ${(observed * 100).toFixed(1).padStart(5)}%  ±${(tolerance * 100).toFixed(1)}%  `
        + `(${resolved} rollouts)`);
      continue;
    }

    if (action.type === 'influence-attempt') {
      const evaluation = evaluationOf.get(action);
      const success = evaluation?.outcomes.find(o => o.label.includes('influenced'));
      if (!success) continue;
      let landed = 0;
      let resolvedAttempts = 0;
      let rngA = createRng(seed);
      for (let i = 0; i < rollouts; i++) {
        const result = rolloutInfluenceAttempt(scenario.state, action, rngA);
        rngA = result.rng;
        if (result.succeeded === null) continue;
        resolvedAttempts++;
        if (result.succeeded) landed++;
      }
      if (resolvedAttempts === 0) { skipped++; continue; }
      const observed = landed / resolvedAttempts;
      const tolerance = binomialTolerance(success.p, resolvedAttempts);
      const within = Math.abs(observed - success.p) <= tolerance;
      record(evaluation?.module ?? 'factions', within);
      console.log(`  influence-attempt  (${resolvedAttempts} rollouts)`);
      console.log(`    ${within ? 'ok  ' : 'FAIL'} ${'influenced'.padEnd(22)} `
        + `claimed ${(success.p * 100).toFixed(2).padStart(6)}%  `
        + `observed ${(observed * 100).toFixed(2).padStart(6)}%  ±${(tolerance * 100).toFixed(2)}%`);
      continue;
    }

    if (action.type === 'corruption-check') {
      // The module's claim is one number: how often the check holds. The
      // engine's own verdict is whether the character is still there.
      const evaluation = evaluationOf.get(action);
      const held = evaluation?.outcomes.find(o => o.label.includes('holds'));
      if (!held) continue;
      let survived = 0;
      let resolvedChecks = 0;
      let rng = createRng(seed);
      for (let i = 0; i < rollouts; i++) {
        const result = rolloutCorruptionCheck(scenario.state, action, rng);
        rng = result.rng;
        if (result.survived === null) continue;
        resolvedChecks++;
        if (result.survived) survived++;
      }
      if (resolvedChecks === 0) { skipped++; continue; }
      const observed = survived / resolvedChecks;
      const tolerance = binomialTolerance(held.p, resolvedChecks);
      const within = Math.abs(observed - held.p) <= tolerance;
      record(evaluation?.module ?? 'corruption', within);
      console.log(`  corruption-check  (${resolvedChecks} rollouts)`);
      console.log(`    ${within ? 'ok  ' : 'FAIL'} ${'check holds'.padEnd(22)} `
        + `claimed ${(held.p * 100).toFixed(2).padStart(6)}%  `
        + `observed ${(observed * 100).toFixed(2).padStart(6)}%  ±${(tolerance * 100).toFixed(2)}%`);
      continue;
    }

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
      record(evaluationOf.get(action)?.module ?? 'combat', within);
      console.log(
        `    ${within ? 'ok  ' : 'FAIL'} ${k.padEnd(22)} claimed ${(p * 100).toFixed(2).padStart(6)}%`
        + `  observed ${(observed * 100).toFixed(2).padStart(6)}%  ±${(tolerance * 100).toFixed(2)}%`,
      );
    }
  }
}

/** The `gain` line a deterministic module reports, in TSD. */
function findGain(rationale: { label: string; value: number | string; children?: readonly unknown[] }): number | undefined {
  if (rationale.label === 'gain' && typeof rationale.value === 'number') return rationale.value;
  for (const child of (rationale.children ?? []) as typeof rationale[]) {
    const found = findGain(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Compact one-line label for an action, without needing the describer. */
function describeAction(action: GameAction): string {
  const need = (action as unknown as { need?: number }).need;
  const tap = (action as unknown as { tapToFight?: boolean }).tapToFight;
  const suffix = tap === undefined ? '' : tap ? ' (tap to fight)' : ' (stay untapped)';
  return `${action.type}${suffix}${need === undefined ? '' : `, need ${need}`}`;
}

console.log('');
if (checked === 0) {
  // "0/0 within the interval" reads like a pass. Nothing was checked, which
  // is a different thing and must exit non-zero: a harness that reports
  // success for measuring nothing is worse than no harness.
  console.log(`NOTHING CHECKED — 0 claims measured at ${rollouts} rollouts`
    + `${skipped > 0 ? `, ${skipped} action(s) skipped` : ''}.`);
  console.log('Either the corpus has no position for this module, or every rollout ended');
  console.log('unresolved and the classifier cannot tell what happened.');
  process.exit(2);
}
// Per module, because a total is what let four modules go unmeasured behind a
// green line. A module the corpus has no position for reports zero here rather
// than disappearing into the sum.
for (const name of requested) {
  const entry = perModule.get(name) ?? { checked: 0, failures: 0 };
  console.log(`  ${name.padEnd(12)} ${entry.checked === 0
    ? 'no claim in the corpus — nothing measured'
    : `${entry.checked - entry.failures}/${entry.checked} matched`}`);
}
// Deterministic claims are exact rather than sampled, so the summary must not
// describe them as interval checks.
console.log(`${checked - failures}/${checked} claim(s) matched at ${rollouts} rollout(s)`
  + `${skipped > 0 ? `, ${skipped} action(s) not modelled` : ''}`);
if (failures > 0) process.exit(1);
