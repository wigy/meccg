/**
 * @module cli/compare
 *
 * Side-by-side comparison of two agents: how often do they actually choose
 * differently, and where?
 *
 * It measures *difference*, not quality. Agreement with Heuristics 1 is not
 * evidence that a choice is right — H1 is the weight soup Heuristics 2 exists
 * to replace, and converging on it is as likely to mean H2 has picked up its
 * faults. The only thing this number decides is whether a gate has anything to
 * measure.
 *
 * It exists because a strength gate is an expensive way to learn that two
 * agents mostly agree. The `search-h2` gate cost 90 minutes to return an
 * interval ±126 Elo wide, and the first question afterwards was whether the
 * two agents had ever diverged enough for a gate to resolve anything. That
 * question is answerable in seconds, and answering it first is what decides
 * whether the gate is worth buying and how many games it needs.
 *
 * The measurement is a **shadow poll**: one agent drives the game while the
 * other is asked, at every decision, what it would have done. Both are read at
 * their argmax rather than their sampled choice — the sampling temperature is
 * a property of the harness, not of the opinion, and comparing samples would
 * measure the dice.
 *
 * ## What a divergence is worth
 *
 * A count of divergences says how much a gate has to measure and nothing about
 * which of them matter. But the driver has already ranked the candidates, and
 * publishes that ranking as `considered` weights — so the *gap* between what it
 * scored its own pick and what it scored the shadow's is a price, in the
 * driver's own units, of taking the shadow's move instead.
 *
 * For the default driver those units are meaningful: `mc` reports each
 * candidate's mean playout TSD above the worst candidate, so a difference of
 * weights is a difference of mean TSD, estimated by playing both moves forward
 * through the real reducer. That turns "these two agents disagree 200 times a
 * game" into a work list ordered by measured loss rather than by how often an
 * action type happens to come up — which is the ordering `coverage` can give
 * and this one cannot.
 *
 * It costs no extra rollouts. The number is already computed; it was being
 * thrown away.
 *
 * The report is split by `AgentDecision.weightUnit`, because one agent does not
 * have one set of units: `mc` delegates every view it cannot determinize and
 * returns the fallback's weights, so a combat row and an organization row would
 * otherwise be added together as though both were score. See
 * `cli/divergence-cost`.
 *
 * Three honesty notes travel with the number. It is the *driver's* estimate, so
 * it inherits whatever the driver is wrong about — against `mc` that is a
 * handful of uniform-random playouts, which §2.3 of the rollout spec is explicit
 * cannot execute a plan. It is biased in the driver's favour, because the driver
 * chose the argmax of its own noisy scores; driving with the same agent on both
 * sides measures that floor. And a shortlisting driver may not have scored the
 * shadow's move at all; those are counted separately as `unranked` rather than
 * priced at zero, because "I did not look at it" is not "it is worth nothing".
 *
 * Usage:
 *   npm run compare -w @meccg/sim -- --agents heuristic,h2 [--games 4]
 *   npm run compare -w @meccg/sim -- --scenarios [--agents heuristic,h2]
 */

import {
  buildCompanyNames, buildInstanceLookup, describeAction, loadCardPool,
  setEngineConsoleLog, stripCardMarkers,
} from '@meccg/shared';
import type { GameAction, PlayerView } from '@meccg/shared';
import { playGame } from '../runner.js';
import { cliPreamble, numberFlag, resolveAgent, resolvePair, resolveDecks } from './common.js';
import type { Agent, AgentContext, AgentDecision } from '../types.js';
import { DivergenceCost, preferred } from './divergence-cost.js';
import type { CostBucket } from './divergence-cost.js';
import { listScenarioIds, loadScenario, scenarioView } from '../ai/h2/scenario-store.js';

/** Flag reference, printed by `--help`. */
const USAGE = `compare — how often do two agents actually choose differently, and where?

Usage:
  npm run compare -w @meccg/sim -- --agents heuristic,h2 [--games 4]
  npm run compare -w @meccg/sim -- --scenarios [--agents heuristic,h2]

Options:
  --agents <a,b>      the two agent specs (default mc,h2 — the Monte-Carlo
                      agent is the strongest reference available). The first
                      drives the game; the second is polled in its shadow.
  --games <n>         self-play games to poll over (default 4)
  --seed <n>          base seed (default 1)
  --decks <a,b>       deck IDs (default challenge-deck-a,challenge-deck-b)
  --scenarios         compare on the checked-in scenario corpus instead
  --top <n>           action types in the cost table (default 12)
  --worst <n>         individual divergences to print, dearest first (default 8)
  --help              this message
`;

const args = cliPreamble(USAGE);
setEngineConsoleLog(false);

// Default to the Monte-Carlo agent rather than Heuristics 1: it is the
// strongest opponent available, so a difference against it is worth something,
// where a difference against H1 only says the two disagree.
const [driverSpec, shadowSpec] = resolvePair(args, 'agents', ['mc', 'h2']);

/** A describer for one view, so a divergence reads as two choices not two types. */
function makeDescriber(view: PlayerView): (action: GameAction) => string {
  const pool = loadCardPool();
  const lookup = buildInstanceLookup(view);
  const companies = buildCompanyNames(view.self.companies, view.self.characters, pool);
  const names: Record<string, string> = {
    [view.self.id as string]: view.self.name,
    [view.opponent.id as string]: view.opponent.name,
  };
  return action => stripCardMarkers(describeAction(action, pool, lookup, companies, names));
}

/** Agreement counts, split by whether the decision was in combat. */
interface Tally {
  decisions: number;
  agreed: number;
  combatDecisions: number;
  combatAgreed: number;
  /** Decisions where only one candidate existed — agreement there is free. */
  forced: number;
}

const cost = new DivergenceCost();

/** Print one unit system's cost table and its dearest divergences. */
function reportBucket(
  unit: string, bucket: CostBucket,
  driverName: string, shadowName: string, top: number, worstCount: number,
): void {
  const entries = bucket.ranked();
  if (entries.length === 0) return;
  console.log('');
  console.log(`What ${shadowName}'s picks cost, priced by ${driverName}'s own ranking — `
    + `${bucket.divergences()} divergence(s) scored in ${unit}:`);
  console.log('');
  console.log(`  ${'action type'.padEnd(28)} ${'diverged'.padStart(8)} ${'priced'.padStart(6)} `
    + `${'total'.padStart(9)} ${'mean'.padStart(7)} ${'unranked'.padStart(8)}`);
  for (const [type, entry] of entries.slice(0, top)) {
    const mean = entry.priced === 0 ? '   n/a' : (entry.total / entry.priced).toFixed(2);
    console.log(
      `  ${type.padEnd(28)} ${String(entry.divergences).padStart(8)} ${String(entry.priced).padStart(6)} `
      + `${entry.total.toFixed(2).padStart(9)} ${mean.padStart(7)} ${String(entry.unranked).padStart(8)}`,
    );
  }
  console.log('');
  if (unit === 'tsd') {
    console.log(`  total ${bucket.total().toFixed(2)} tsd — mean playout tournament-score`);
    console.log('  differential, so a row reads as "score the shadow gave up, by rollouts');
    console.log('  through the real reducer".');
  } else {
    console.log(`  total ${bucket.total().toFixed(2)} in weights that carry no unit: the driver`);
    console.log('  published a sampling distribution, so only the *ordering* means anything and');
    console.log('  these sums are not score. With `mc` driving this bucket is the decisions it');
    console.log('  could not determinize and delegated — combat, chains, pending effects.');
  }

  if (worstCount > 0 && bucket.priced.length > 0) {
    console.log('');
    console.log(`  the dearest single divergences (${unit}):`);
    for (const item of [...bucket.priced].sort((a, b) => b.cost - a.cost).slice(0, worstCount)) {
      console.log(`  ${item.cost.toFixed(2).padStart(8)}  ${item.type}`);
      console.log(`            ${driverName.padEnd(12)} ${item.driver}`);
      console.log(`            ${shadowName.padEnd(12)} ${item.shadow}`);
    }
  }
}

/** Print a cost table per unit system, quantified ones first. */
function reportCost(driverName: string, shadowName: string, top: number, worstCount: number): void {
  const units = cost.units();
  if (units.length === 0) return;
  for (const unit of units) {
    reportBucket(unit, cost.buckets.get(unit)!, driverName, shadowName, top, worstCount);
  }
  console.log('');
  console.log('Every price is the driver\'s own estimate and inherits whatever the driver is');
  console.log('wrong about, and it is biased in the driver\'s favour: the driver picked the');
  console.log('argmax of its own noisy scores, so disagreeing with it looks costly even when');
  console.log('the disagreement is the noise. Drive with the *same* agent on both sides to');
  console.log('measure that floor. `unranked` is a move the driver never scored, not one');
  console.log('worth zero.');
}

/** Print a tally as an agreement report. */
function report(tally: Tally): void {
  const share = (n: number, d: number): string => (d === 0 ? '   n/a' : `${((n / d) * 100).toFixed(1)}%`);
  const contested = tally.decisions - tally.forced;
  const contestedAgreed = tally.agreed - tally.forced;
  console.log('');
  console.log(`decisions:          ${tally.decisions}`);
  console.log(`  forced (1 option) ${tally.forced} — agreement there is free`);
  console.log(`  contested         ${contested}`);
  console.log('');
  console.log('Agreement is a sizing number, not a verdict: matching the other agent is');
  console.log('evidence of nothing on its own.');
  console.log('');
  console.log(`agreement, all:       ${share(tally.agreed, tally.decisions)}`);
  console.log(`agreement, contested: ${share(contestedAgreed, contested)}`);
  console.log(`agreement, in combat: ${share(tally.combatAgreed, tally.combatDecisions)} `
    + `(${tally.combatDecisions} decisions)`);
  console.log('');
  const divergences = contested - contestedAgreed;
  console.log(`divergences:        ${divergences} of ${contested} contested`);
  if (divergences === 0) {
    console.log('  The two agents never chose differently. No strength gate can separate');
    console.log('  them on this deck pair — the experiment needs a different design.');
  } else {
    // Rough sizing: a gate needs enough games that the divergences accumulate
    // into a measurable strength difference. This is the honest denominator.
    const perGame = divergences / Math.max(1, games);
    console.log(`  ~${perGame.toFixed(1)} per game — that is the rate at which a gate can accumulate`);
    console.log('  a difference; everything else is identical play and pure variance.');
  }
}

const tally: Tally = { decisions: 0, agreed: 0, combatDecisions: 0, combatAgreed: 0, forced: 0 };
const games = numberFlag(args, 'games', 4);
const top = numberFlag(args, 'top', 12);
const worstCount = numberFlag(args, 'worst', 8);

if (args.flags['scenarios'] === true) {
  // Corpus mode (plan §5.5): a per-position side-by-side, which is what
  // catches an agent doing something unreasonable in an area nobody watched.
  const cardPool = loadCardPool();
  const driver = resolveAgent(driverSpec);
  const shadow = resolveAgent(shadowSpec);
  console.log(`Comparing ${driverSpec} vs ${shadowSpec} on the scenario corpus`);
  for (const id of listScenarioIds()) {
    const scenario = loadScenario(id);
    const view = scenarioView(scenario);
    const legalActions = view.legalActions.filter(e => e.viable).map(e => e.action);
    if (legalActions.length === 0) continue;
    const context: AgentContext = {
      view, cardPool, legalActions, evaluated: view.legalActions, random: () => 0,
    };
    const decision = driver.chooseAction(context);
    const a = preferred(decision);
    const b = preferred(shadow.chooseAction(context));
    const same = a === b;
    tally.decisions++;
    if (legalActions.length === 1) tally.forced++;
    if (same) tally.agreed++;
    if (view.combat) {
      tally.combatDecisions++;
      if (same) tally.combatAgreed++;
    }
    // Printing the action *type* alone is useless here: the interesting
    // disagreements are two `resolve-strike`s that differ in tap mode.
    const describe = makeDescriber(view);
    if (!same && legalActions.length > 1) cost.record(decision, b, describe);
    console.log(`${same ? 'same' : 'DIFF'} ${id}`);
    console.log(`  ${driverSpec.padEnd(12)} ${describe(a)}`);
    if (!same) console.log(`  ${shadowSpec.padEnd(12)} ${describe(b)}`);
  }
  report(tally);
  reportCost(driverSpec, shadowSpec, top, worstCount);
} else {
  const baseSeed = numberFlag(args, 'seed', 1);
  const decks = resolveDecks(args);
  console.log(`Comparing ${driverSpec} (driving) vs ${shadowSpec} (shadow) over ${games} games, `
    + `decks ${decks[0].id}/${decks[1].id}`);

  for (let i = 0; i < games; i++) {
    const driver = resolveAgent(driverSpec);
    const shadow = resolveAgent(shadowSpec);
    const spy: Agent = {
      name: driver.name,
      startGame: () => { driver.startGame?.(); shadow.startGame?.(); },
      chooseAction(context: AgentContext): AgentDecision {
        const decision = driver.chooseAction(context);
        // The shadow is asked about the same position but never acts, so the
        // trajectory stays the driver's own and the comparison is like-for-like.
        const shadowPick = preferred(shadow.chooseAction(context));
        const same = preferred(decision) === shadowPick;
        tally.decisions++;
        if (context.legalActions.length === 1) tally.forced++;
        if (same) tally.agreed++;
        if (context.view.combat) {
          tally.combatDecisions++;
          if (same) tally.combatAgreed++;
        }
        // Describing costs a card-pool load and an instance lookup per call,
        // so it is paid only where there is something to describe.
        if (!same && context.legalActions.length > 1) {
          cost.record(decision, shadowPick, makeDescriber(context.view));
        }
        return decision;
      },
    };
    playGame({ agents: [spy, resolveAgent(driverSpec)], decks, seed: baseSeed + i });
  }
  report(tally);
  reportCost(driverSpec, shadowSpec, top, worstCount);
}
