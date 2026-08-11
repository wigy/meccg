/**
 * @module cli/scoring-loop
 *
 * Where does the marshalling-point loop break?
 *
 * The 107 recorded human-versus-AI games in the live corpus are 107–0, and the
 * per-category breakdown says why in a way no aggregate score does. Against
 * humans averaging 6.7 item and 5.7 faction MP a game, the AI averages 0.7 and
 * 1.0, and scores *zero* item MP in 77 of 102 games, zero faction in 67, zero
 * ally in 94. The one category where it keeps pace is `kill`, which is the
 * passive one — it happens to you when a hazard connects.
 *
 * That is not a ranking problem, and `compare` and `divergence-cost` are the
 * wrong instruments for it: both measure *which* candidate an agent prefers,
 * and the finding here is that a whole class of candidate is never taken at
 * all. MECCG's scoring loop is a chain — hold a resource worth playing, build a
 * company that can carry it, route that company to a site where it is
 * playable, play it, come home — and a chain is diagnosed by finding the
 * earliest broken link, not by pricing decisions downstream of the break.
 *
 * So this replays games and reports the chain as a funnel, per agent:
 *
 * - **MP by category**, final, against the human corpus's medians.
 * - **Offered vs taken** for every scoring action — `play-hero-resource`,
 *   `play-minor-item`, `faction-influence-roll`, `influence-attempt`,
 *   `rescue-prisoner`, `play-revealed-card` — plus the movement and
 *   `enter-site` actions that have to happen first for those to be offered at
 *   all.
 *
 * The distinction the funnel exists to draw is between *never offered* and
 * *offered and declined*. A scoring action that never appears among the
 * candidates is a break upstream — the company is not where it needs to be, or
 * the card was never kept — and no amount of work on the module that owns the
 * action will produce a single point. One that is offered hundreds of times and
 * taken twice is a valuation bug in that module, and the mean rank when it is
 * declined says how badly it is mispriced.
 *
 * Usage:
 *   npm run scoring-loop -w @meccg/sim -- [options]
 *
 * Options:
 *   --games <n>       games to play (default 4)
 *   --seed <n>        base seed (default 1)
 *   --agents <a,b>    the agent under test and its opponent (default h2,heuristic)
 *   --decks <a,b>     deck IDs
 *   --max-decisions <n>  abort a game after this many decisions (default 25000)
 *   --json            emit the report as JSON
 *   --help            this message
 */

import { loadCardPool, setEngineConsoleLog } from '@meccg/shared';
import type { MarshallingPointTotals, PlayerId } from '@meccg/shared';
import { playGame } from '../runner.js';
import { parseCliArgs, numberFlag, resolvePair, resolveAgent, resolveDecks } from './common.js';
import type { DecisionRecord, GameObserver, GameResultRecord, TransitionRecord } from '../types.js';

/** Flag reference, printed by `--help`. */
const USAGE = `scoring-loop — where does the marshalling-point loop break?

Replays games and reports the scoring chain as a funnel: how often each
MP-scoring action was offered to the agent, and how often it was taken. An
action never offered is a break upstream; one offered and declined is a
valuation bug in the module that owns it.

Usage:
  npm run scoring-loop -w @meccg/sim -- [options]

Options:
  --games <n>          games to play (default 4)
  --seed <n>           base seed (default 1)
  --agents <a,b>       agent under test and opponent (default h2,heuristic)
  --decks <a,b>        deck IDs
  --max-decisions <n>  abort a game after this many decisions (default 25000)
  --json               emit the report as JSON
  --help               this message
`;

/**
 * The actions that put marshalling points on the board.
 *
 * `place-on-guard` and the combat actions are deliberately absent: they defend
 * points rather than earning them, and `kill` MP is the category the AI already
 * matches humans on precisely because nothing has to be chosen for it.
 */
const SCORING_ACTIONS = [
  'play-hero-resource',
  'play-minor-item',
  'faction-influence-roll',
  'influence-attempt',
  'rescue-prisoner',
  'play-revealed-card',
] as const;

/**
 * The actions that have to happen before a scoring action can be offered.
 *
 * Listed separately because their take-rates are read differently: declining a
 * scoring action is always a cost, while declining a movement is often correct.
 * What matters here is the *absolute* count — a game with no `enter-site` at
 * all cannot have scored, whatever the rates downstream look like.
 */
const ENABLING_ACTIONS = ['plan-movement', 'declare-path', 'enter-site'] as const;

/** Human-corpus medians, for the comparison column. Source: `~/backup/ai-meccg.com/games`. */
const HUMAN_MEDIAN: Readonly<Record<string, number>> = {
  character: 7, item: 6, faction: 5, ally: 2, kill: 2, misc: 2,
};

/** MP categories, in the order the game summaries report them. */
const CATEGORIES = ['character', 'item', 'faction', 'ally', 'kill', 'misc'] as const;

/** Offered/taken tallies for one action type. */
interface ActionTally {
  /** Contested decisions where at least one candidate had this type. */
  offered: number;
  /** Decisions where the agent chose an action of this type. */
  taken: number;
  /**
   * Sum of the best candidate's fractional rank, over decisions where the type
   * was offered and declined. Zero is "top of the ranking", one is "bottom" —
   * fractional because branching factors vary by two orders of magnitude and an
   * absolute rank of 8 means different things at 10 candidates and at 1000.
   */
  declinedRankSum: number;
  /** Decisions counted into `declinedRankSum`. */
  declinedRanked: number;
}

/** Everything measured for one agent over the whole run. */
interface AgentReport {
  readonly spec: string;
  readonly player: PlayerId;
  /** Final MP by category, summed over games — reported as a per-game mean. */
  readonly mp: Record<string, number>;
  /** Games where this agent finished with zero in each category. */
  readonly zeroGames: Record<string, number>;
  readonly actions: Map<string, ActionTally>;
  /** Games in which at least one scoring action was taken. */
  scoringGames: number;
}

const args = parseCliArgs(process.argv.slice(2));
if (args.flags['help'] === true || args.flags['h'] === true) {
  console.log(USAGE);
  process.exit(0);
}
setEngineConsoleLog(false);

const games = numberFlag(args, 'games', 4);
const baseSeed = numberFlag(args, 'seed', 1);
const maxDecisions = numberFlag(args, 'max-decisions', 25000);
const asJson = args.flags['json'] === true;
const specs = resolvePair(args, 'agents', ['h2', 'heuristic']);
const decks = resolveDecks(args);
loadCardPool();

/** Seat order, matching the runner's own — see `runner.ts`. */
const PLAYERS: readonly PlayerId[] = ['p1' as PlayerId, 'p2' as PlayerId];

function emptyTally(): ActionTally {
  return { offered: 0, taken: 0, declinedRankSum: 0, declinedRanked: 0 };
}

const reports: AgentReport[] = PLAYERS.map((player, i) => ({
  spec: specs[i],
  player,
  mp: Object.fromEntries(CATEGORIES.map(c => [c, 0])),
  zeroGames: Object.fromEntries(CATEGORIES.map(c => [c, 0])),
  actions: new Map([...SCORING_ACTIONS, ...ENABLING_ACTIONS].map(t => [t, emptyTally()])),
  scoringGames: 0,
}));

const outcomes = new Map<string, number>();

for (let g = 0; g < games; g++) {
  /** Last MP totals seen per player — the transition stream carries them, so
   * the final ones are whatever the last transition reported. That is more
   * robust than reading the result record, which is absent on a game that hit
   * the decision limit — and those games are exactly the interesting ones. */
  const lastMp = new Map<PlayerId, MarshallingPointTotals>();
  const scoredThisGame = new Set<PlayerId>();

  const observer: GameObserver = {
    onDecision(record: DecisionRecord): void {
      const report = reports.find(r => r.player === record.player);
      if (!report) return;
      const candidates = record.candidates ?? [];
      if (candidates.length <= 1) return;

      // Rank by descending weight once, then find each tracked type's best
      // position in that order. `candidates` arrives in the agent's own order,
      // which is not guaranteed sorted.
      const ranked = [...candidates].sort((a, b) => b.weight - a.weight);
      const bestRankOf = new Map<string, number>();
      ranked.forEach((candidate, index) => {
        if (!bestRankOf.has(candidate.type)) bestRankOf.set(candidate.type, index);
      });

      for (const [type, rank] of bestRankOf) {
        const tally = report.actions.get(type);
        if (!tally) continue;
        tally.offered++;
        if (record.action.type === type) {
          tally.taken++;
          if ((SCORING_ACTIONS as readonly string[]).includes(type)) {
            scoredThisGame.add(record.player);
          }
        } else if (ranked.length > 1) {
          tally.declinedRankSum += rank / (ranked.length - 1);
          tally.declinedRanked++;
        }
      }
    },
    onTransition(record: TransitionRecord): void {
      PLAYERS.forEach((player, i) => lastMp.set(player, record.marshallingPoints[i]));
    },
    onResult(record: GameResultRecord): void {
      outcomes.set(record.outcome, (outcomes.get(record.outcome) ?? 0) + 1);
    },
  };

  playGame({
    agents: [resolveAgent(specs[0]), resolveAgent(specs[1])],
    decks,
    seed: baseSeed + g,
    maxDecisions,
    observers: [observer],
  });

  for (const report of reports) {
    const mp = lastMp.get(report.player);
    for (const category of CATEGORIES) {
      const value = mp?.[category] ?? 0;
      report.mp[category] += value;
      if (value === 0) report.zeroGames[category]++;
    }
    if (scoredThisGame.has(report.player)) report.scoringGames++;
  }
  process.stderr.write(`  … ${g + 1}/${games} games\n`);
}

// ---- Report ----

function mean(total: number, n: number): number {
  return n === 0 ? 0 : total / n;
}

function rate(taken: number, offered: number): string {
  return offered === 0 ? '     —' : `${((taken / offered) * 100).toFixed(1).padStart(5)}%`;
}

if (asJson) {
  console.log(JSON.stringify({
    games,
    seeds: [baseSeed, baseSeed + games - 1],
    decks: decks.map(d => d.id),
    outcomes: Object.fromEntries(outcomes),
    agents: reports.map(r => ({
      spec: r.spec,
      player: r.player,
      meanMp: Object.fromEntries(CATEGORIES.map(c => [c, mean(r.mp[c], games)])),
      zeroGames: r.zeroGames,
      scoringGames: r.scoringGames,
      actions: Object.fromEntries([...r.actions].map(([type, t]) => [type, {
        offered: t.offered,
        taken: t.taken,
        takeRate: t.offered === 0 ? null : t.taken / t.offered,
        meanDeclinedRank: t.declinedRanked === 0 ? null : t.declinedRankSum / t.declinedRanked,
      }])),
    })),
  }, null, 2));
} else {
  console.log(`\nscoring-loop: ${games} games, ${specs.join(' vs ')}, `
    + `decks ${decks.map(d => d.id).join(' vs ')}, seeds ${baseSeed}..${baseSeed + games - 1}`);
  console.log(`outcomes: ${JSON.stringify(Object.fromEntries(outcomes))}`);

  console.log('\n── Marshalling points, mean per game ──\n');
  const header = ['category', ...reports.map(r => `${r.spec} (${r.player})`), 'human median'];
  console.log(`${header[0].padEnd(12)}${header.slice(1, -1).map(h => h.padStart(20)).join('')}${header[header.length - 1].padStart(15)}`);
  for (const category of CATEGORIES) {
    const cells = reports.map(r => {
      const zero = r.zeroGames[category];
      return `${mean(r.mp[category], games).toFixed(1)} (0 in ${zero}/${games})`.padStart(20);
    });
    console.log(`${category.padEnd(12)}${cells.join('')}${String(HUMAN_MEDIAN[category]).padStart(15)}`);
  }

  for (const report of reports) {
    console.log(`\n── ${report.spec} (${report.player}) — the chain ──\n`);
    console.log(`games where any scoring action was taken: ${report.scoringGames}/${games}\n`);
    console.log('action                     offered    taken   take-rate   mean rank when declined');
    const rows = (types: readonly string[]): void => {
      for (const type of types) {
        const t = report.actions.get(type);
        if (!t) continue;
        const declined = t.declinedRanked === 0
          ? '—'
          : (t.declinedRankSum / t.declinedRanked).toFixed(2);
        console.log(`  ${type.padEnd(24)}${String(t.offered).padStart(7)}`
          + `${String(t.taken).padStart(9)}   ${rate(t.taken, t.offered)}`
          + `${declined.padStart(27)}`);
      }
    };
    console.log('  — enabling —');
    rows(ENABLING_ACTIONS);
    console.log('  — scoring —');
    rows(SCORING_ACTIONS);
  }
  console.log('\nA scoring action never offered is a break upstream of the module that owns it.');
  console.log('One offered often and taken rarely is a valuation bug; the rank says how badly.\n');
}
