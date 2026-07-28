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
import { parseCliArgs, numberFlag, resolveAgent, resolvePair, resolveDecks } from './common.js';
import type { Agent, AgentContext, AgentDecision, ConsideredAction } from '../types.js';
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
  --help              this message
`;

const args = parseCliArgs(process.argv.slice(2));
if (args.flags['help'] === true || args.flags['h'] === true) {
  console.log(USAGE);
  process.exit(0);
}
setEngineConsoleLog(false);

// Default to the Monte-Carlo agent rather than Heuristics 1: it is the
// strongest opponent available, so a difference against it is worth something,
// where a difference against H1 only says the two disagree.
const [driverSpec, shadowSpec] = resolvePair(args, 'agents', ['mc', 'h2']);

/** The action an agent prefers, ignoring the harness's sampling. */
function preferred(decision: AgentDecision): GameAction {
  const considered: readonly ConsideredAction[] | undefined = decision.considered;
  if (!considered || considered.length === 0) return decision.action;
  return considered.reduce((best, c) => (c.weight > best.weight ? c : best), considered[0]).action;
}

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
    const a = preferred(driver.chooseAction(context));
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
    console.log(`${same ? 'same' : 'DIFF'} ${id}`);
    console.log(`  ${driverSpec.padEnd(12)} ${describe(a)}`);
    if (!same) console.log(`  ${shadowSpec.padEnd(12)} ${describe(b)}`);
  }
  report(tally);
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
        const same = preferred(decision) === preferred(shadow.chooseAction(context));
        tally.decisions++;
        if (context.legalActions.length === 1) tally.forced++;
        if (same) tally.agreed++;
        if (context.view.combat) {
          tally.combatDecisions++;
          if (same) tally.combatAgreed++;
        }
        return decision;
      },
    };
    playGame({ agents: [spy, resolveAgent(driverSpec)], decks, seed: baseSeed + i });
  }
  report(tally);
}
