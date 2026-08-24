/**
 * @module cli/hand-flow
 *
 * What is in hand when the company arrives, and how many sites it reaches.
 *
 * `scoring-loop` answered "is the scoring action ever offered" and the plan
 * layer moved that number a long way: `enter-site` went from a 23.4% take-rate
 * to 42.0%, against `heuristic`'s 44.0%. The entering decision is a tie now.
 * And the score did not move — H2 scores 0.7 item MP a game against
 * `heuristic`'s 4.5.
 *
 * The head-to-head funnel says where the rest of the gap is, and it is not in
 * any decision the plan layer touches. Per twenty games `heuristic` is offered
 * `play-hero-resource` **91 times against H2's 27**, and reaches **534
 * `enter-site` opportunities against 345**. Normalised: 0.39 plays per site
 * entered against 0.19. It gets to more sites, and when it arrives it is twice
 * as likely to be holding something it can play.
 *
 * Those are two different failures and they need separating before anything is
 * built, which is the whole reason this exists rather than a fix:
 *
 * - **Hand flow.** The company arrives and the hand has nothing playable *at
 *   this site*. That is a drawing, keeping and discarding problem — `hand`'s
 *   shadow price, and what the deck is made of.
 * - **Site-deck flow.** The company arrives at fewer sites per game. That is a
 *   movement-cadence problem: sites are spent when reached, and a company that
 *   dawdles or shuttles between two havens burns turns without turning the
 *   deck over.
 *
 * So this reports, per agent, at every arrival — every decision where
 * `enter-site` is on the table:
 *
 * - how many cards in hand are playable **at that site**, and the share of
 *   arrivals where that is zero;
 * - what the hand is made of, by card class;
 * - how many *distinct* sites the agent enters per game, and how far the site
 *   deck is turned over by the end.
 *
 * Usage:
 *   npm run hand-flow -w @meccg/sim -- [--games N] [--agents a,b] [--json]
 */

import { CardStatus, loadCardPool, setEngineConsoleLog } from '@meccg/shared';
import {
  isAllyCard, isCharacterCard, isFactionCard, isItemCard, isResourceEventCard,
} from '@meccg/shared';
import type { CardDefinition, PlayerView } from '@meccg/shared';
import { playGame } from '../runner.js';
import { cliPreamble, numberFlag, resolvePair, resolveAgent, resolveDecks } from './common.js';
import { resourcePlayableAt } from '../ai/evaluators/common.js';
import { forwardActions } from '../ai/regress.js';
import type { Agent, AgentContext } from '../types.js';

/** Flag reference, printed by `--help`. */
const USAGE = `hand-flow — what is in hand on arrival, and how many sites are reached

Separates the two halves of the gap \`scoring-loop\` leaves open: arriving with
nothing playable (hand flow) and arriving fewer times (site-deck flow).

Usage:
  npm run hand-flow -w @meccg/sim -- [options]

Options:
  --games <n>       games to play (default 10)
  --seed <n>        base seed (default 1)
  --agents <a,b>    the two agents (default h2,heuristic)
  --decks <a,b>     deck IDs
  --max-decisions <n>  abort a game after this many decisions (default 25000)
  --json            emit the report as JSON
  --help            this message
`;

/** Hand card classes, in the order the report prints them. */
const CLASSES = ['item', 'faction', 'ally', 'character', 'resource-event', 'other'] as const;
type CardClass = typeof CLASSES[number];

/** Which class a definition falls into. Hazards and anything else are `other`. */
function classOf(def: CardDefinition | undefined): CardClass {
  if (isItemCard(def)) return 'item';
  if (isFactionCard(def)) return 'faction';
  if (isAllyCard(def)) return 'ally';
  if (isCharacterCard(def)) return 'character';
  if (isResourceEventCard(def)) return 'resource-event';
  return 'other';
}

/** Everything measured for one agent. */
interface Report {
  readonly spec: string;
  /** Decisions where `enter-site` was on the table. */
  arrivals: number;
  /** Arrivals where the agent went in. */
  entered: number;
  /** Arrivals where nothing in hand was playable at that site. */
  arrivalsWithNothing: number;
  /** Sum of playable-at-this-site counts over arrivals. */
  playableSum: number;
  /** Sum of hand sizes over arrivals. */
  handSum: number;
  /** Sum of untapped characters in the arriving company. */
  untappedSum: number;
  /** Arrivals where the company had nobody left to tap for a play. */
  arrivalsTappedOut: number;
  /** Sum of each class's count over arrivals. */
  readonly classSum: Record<CardClass, number>;
  /** Distinct site definitions entered, per game. */
  distinctSites: number[];
  /** Site-deck size at the last decision seen, per game. */
  siteDeckLeft: number[];
  /** Times any company's current site changed, per game. */
  siteChanges: number[];
  /** Turns in which at least one movement was planned, per game. */
  movingTurns: number[];
  /** Turns seen, per game. */
  turnsSeen: number[];
}

const args = cliPreamble(USAGE);
setEngineConsoleLog(false);

const games = numberFlag(args, 'games', 10);
const baseSeed = numberFlag(args, 'seed', 1);
const maxDecisions = numberFlag(args, 'max-decisions', 25000);
const asJson = args.flags['json'] === true;
const specs = resolvePair(args, 'agents', ['h2', 'heuristic']);
const decks = resolveDecks(args);
const cardPool = loadCardPool();

function emptyReport(spec: string): Report {
  return {
    spec,
    arrivals: 0,
    entered: 0,
    arrivalsWithNothing: 0,
    playableSum: 0,
    handSum: 0,
    untappedSum: 0,
    arrivalsTappedOut: 0,
    classSum: Object.fromEntries(CLASSES.map(c => [c, 0])) as Record<CardClass, number>,
    distinctSites: [],
    siteDeckLeft: [],
    siteChanges: [],
    movingTurns: [],
    turnsSeen: [],
  };
}

const reports = specs.map(emptyReport);

/** Cards in hand playable at the site the company is standing on. */
function playableHere(view: PlayerView, siteDefinitionId: string): number {
  const siteDef = cardPool[siteDefinitionId];
  if (!siteDef) return 0;
  let count = 0;
  for (const card of view.self.hand) {
    const def = cardPool[card.definitionId];
    if (def && resourcePlayableAt(def, siteDef as never, view.self.alignment)) count++;
  }
  return count;
}

for (let g = 0; g < games; g++) {
  const perGameSites = specs.map(() => new Set<string>());
  const lastSiteDeck = specs.map(() => 0);
  // Where each company last stood, so a change of site is counted once rather
  // than once per decision made while standing there.
  const lastSiteOf = specs.map(() => new Map<string, string>());
  const changes = specs.map(() => 0);
  const movingTurns = specs.map(() => new Set<number>());
  const turnsSeen = specs.map(() => new Set<number>());

  /** Wrap an agent so the arrival measurements see the view it acted on. */
  const spy = (index: number): Agent => {
    const inner = resolveAgent(specs[index]);
    const report = reports[index];
    return {
      name: inner.name,
      startGame: () => inner.startGame?.(),
      chooseAction(context: AgentContext) {
        const decision = inner.chooseAction(context);
        lastSiteDeck[index] = context.view.self.siteDeck.length;
        turnsSeen[index].add(context.view.turnNumber);
        if (decision.action.type === 'plan-movement') movingTurns[index].add(context.view.turnNumber);
        // Movement cadence, counted from the board rather than from the
        // action: a company that plans a move and never completes it has not
        // reached anywhere, and `plan-movement` alone cannot tell them apart.
        for (const c of context.view.self.companies) {
          const here = c.currentSite?.definitionId;
          if (here === undefined) continue;
          const key = c.id as unknown as string;
          if (lastSiteOf[index].get(key) !== here) {
            if (lastSiteOf[index].has(key)) changes[index]++;
            lastSiteOf[index].set(key, here);
          }
        }

        // The engine's marked undos are dropped, as every agent drops them, so
        // an arrival is counted where the agent really had the choice.
        const legalActions = forwardActions(context.legalActions);
        const enter = legalActions.find(a => a.type === 'enter-site') as
          unknown as { companyId?: string } | undefined;
        if (!enter) return decision;
        const company = context.view.self.companies.find(
          c => (c.id as unknown as string) === enter.companyId,
        );
        const siteDefinitionId = company?.currentSite?.definitionId;
        if (!siteDefinitionId) return decision;

        report.arrivals++;
        const playable = playableHere(context.view, siteDefinitionId);
        report.playableSum += playable;
        if (playable === 0) report.arrivalsWithNothing++;
        report.handSum += context.view.self.hand.length;
        // Playing a resource needs someone untapped to tap for it. A company
        // that arrives spent cannot score however good its hand is, and that
        // is invisible to every count above.
        const untapped = (company?.characters ?? []).filter(id => {
          const character = context.view.self.characters[id];
          return character !== undefined && character.status === CardStatus.Untapped;
        }).length;
        report.untappedSum += untapped;
        if (untapped === 0) report.arrivalsTappedOut++;
        for (const card of context.view.self.hand) {
          report.classSum[classOf(cardPool[card.definitionId])]++;
        }
        if (decision.action.type === 'enter-site') {
          report.entered++;
          perGameSites[index].add(siteDefinitionId);
        }
        return decision;
      },
    };
  };

  playGame({
    agents: [spy(0), spy(1)],
    decks,
    seed: baseSeed + g,
    maxDecisions,
  });
  reports.forEach((report, i) => {
    report.distinctSites.push(perGameSites[i].size);
    report.siteDeckLeft.push(lastSiteDeck[i]);
    report.siteChanges.push(changes[i]);
    report.movingTurns.push(movingTurns[i].size);
    report.turnsSeen.push(turnsSeen[i].size);
  });
  process.stderr.write(`  … ${g + 1}/${games} games\n`);
}

// ---- Report ----

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

function per(total: number, n: number): number {
  return n === 0 ? 0 : total / n;
}

if (asJson) {
  console.log(JSON.stringify(reports.map(r => ({
    spec: r.spec,
    arrivals: r.arrivals,
    entered: r.entered,
    arrivalsWithNothingPlayable: r.arrivalsWithNothing,
    meanPlayableAtArrival: per(r.playableSum, r.arrivals),
    meanHandSize: per(r.handSum, r.arrivals),
    meanUntappedInCompany: per(r.untappedSum, r.arrivals),
    arrivalsTappedOut: r.arrivalsTappedOut,
    handComposition: Object.fromEntries(
      CLASSES.map(c => [c, per(r.classSum[c], r.arrivals)]),
    ),
    meanDistinctSitesEntered: mean(r.distinctSites),
    meanSiteDeckLeft: mean(r.siteDeckLeft),
    meanSiteChanges: mean(r.siteChanges),
    meanMovingTurns: mean(r.movingTurns),
    meanTurns: mean(r.turnsSeen),
  })), null, 2));
} else {
  console.log(`\nhand-flow: ${games} games, ${specs.join(' vs ')}, `
    + `decks ${decks.map(d => d.id).join(' vs ')}, seeds ${baseSeed}..${baseSeed + games - 1}\n`);
  const label = (text: string): string => text.padEnd(34);
  const cells = (fn: (r: Report) => string): string => reports.map(r => fn(r).padStart(16)).join('');

  console.log(`${label('')}${reports.map(r => r.spec.padStart(16)).join('')}`);
  console.log(`${label('arrivals (enter-site offered)')}${cells(r => String(r.arrivals))}`);
  console.log(`${label('  … entered')}${cells(r => `${r.entered} (${(per(r.entered, r.arrivals) * 100).toFixed(1)}%)`)}`);
  console.log(`${label('  … nothing playable there')}${cells(r => `${r.arrivalsWithNothing} (${(per(r.arrivalsWithNothing, r.arrivals) * 100).toFixed(1)}%)`)}`);
  console.log(`${label('mean playable at arrival')}${cells(r => per(r.playableSum, r.arrivals).toFixed(2))}`);
  console.log(`${label('mean hand size at arrival')}${cells(r => per(r.handSum, r.arrivals).toFixed(2))}`);
  console.log(`${label('mean untapped in that company')}${cells(r => per(r.untappedSum, r.arrivals).toFixed(2))}`);
  console.log(`${label('  … arrivals with nobody to tap')}${cells(r => `${r.arrivalsTappedOut} (${(per(r.arrivalsTappedOut, r.arrivals) * 100).toFixed(1)}%)`)}`);
  console.log('');
  console.log(`${label('hand composition at arrival')}`);
  for (const cardClass of CLASSES) {
    console.log(`${label(`  ${cardClass}`)}${cells(r => per(r.classSum[cardClass], r.arrivals).toFixed(2))}`);
  }
  console.log('');
  console.log(`${label('distinct sites entered / game')}${cells(r => mean(r.distinctSites).toFixed(1))}`);
  console.log(`${label('site deck left at end')}${cells(r => mean(r.siteDeckLeft).toFixed(1))}`);
  console.log(`${label('site changes / game')}${cells(r => mean(r.siteChanges).toFixed(1))}`);
  console.log(`${label('turns / game')}${cells(r => mean(r.turnsSeen).toFixed(1))}`);
  console.log(`${label('  … turns that planned a move')}${cells(r => `${mean(r.movingTurns).toFixed(1)} (${(mean(r.movingTurns) / Math.max(1, mean(r.turnsSeen)) * 100).toFixed(0)}%)`)}`);
  console.log('\nArriving with nothing playable is a hand-flow failure; arriving fewer');
  console.log('times is a site-deck-flow one. They need different fixes.\n');
}
