/**
 * @module cli/route-compare
 *
 * Where is this company *going*, as opposed to where is it going next?
 *
 * `human-compare` scores one decision against one decision, and on movement it
 * has now returned three negatives in a row: H2's destinations play *more* of
 * its hand than the human's (3.41 marshalling points against 2.59), are no more
 * dangerous by any measure that separates them, and admit an identical set of
 * keyed creatures (35.2 worst threat against 35.2). Every attribute of the
 * destination fails to explain a choice the two sides make differently half the
 * time.
 *
 * That is the signature of measuring the wrong object. A company's route is a
 * **sequence** — this site, then the site it makes reachable, then the haven it
 * can retreat to — and a per-decision instrument compares steps while the
 * players may be choosing paths. This module compares the sequences.
 *
 * ## Teacher-forced, because a route cannot be simulated
 *
 * H2's route cannot be rolled forward: the moment it picks a different site the
 * position leaves the corpus, and the opponent's replies are no longer
 * recorded. So the company follows the **human's** actual route, and at every
 * movement decision along it H2 is asked where it would go. That yields two
 * sequences over the same positions: what the human did, and what H2 wanted at
 * each point.
 *
 * The limitation is worth stating plainly, because it bounds every number
 * below: H2's sequence is *not a route it would have walked*. It is the
 * sequence of first steps it would have taken from the human's positions. A
 * plan that only pays off when its own second step is reachable will look
 * incoherent here through no fault of its own — but an agent choosing steps
 * with no route in mind will look incoherent too, and the metrics separate
 * those two cases by asking whether the *human's* sequence shows structure that
 * H2's lacks.
 *
 * ## What is measured
 *
 * - **commitment** — how often a company's consecutive destinations stay in one
 *   region. A player working a plan returns to the same corner of the map; a
 *   player scoring each turn independently wanders.
 * - **revisits** — how often a destination has already been visited by that
 *   company. Routes in this game are circuits: a company clears a site, returns
 *   to a haven, and comes back out.
 * - **haven cadence** — moves between haven visits. The rules make a haven the
 *   only place to heal, untap and re-equip, so a route is punctuated by them.
 * - **distinct sites** — how much of the map a company touches, which
 *   distinguishes a tour from a shuttle.
 *
 * None of these is a valuation. They are descriptions of shape, and the point
 * is to find out whether the two sides' shapes differ at all before anyone
 * prices a route.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadCardPool, reduce, setEngineConsoleLog } from '@meccg/shared';
import { projectPlayerView } from '@meccg/game-server';
import type { CardDefinition, GameAction, PlayerId } from '@meccg/shared';
import { readGameLog } from '../ai/h2/game-log.js';
import { hashState, withStandardCardPool } from '../ai/h2/scenario-store.js';
import { forwardActions } from '../ai/regress.js';
import { cliPreamble, numberFlag, stringFlag, resolveAgent } from './common.js';

const USAGE = `route-compare — does the company have somewhere to be?

Replays recorded human games and reconstructs, per company, the *sequence* of
destinations the human chose. At each movement decision it also asks an agent
where it would have gone, giving two sequences over the same positions.

Teacher-forced by construction: the company follows the human's route, because
an agent's own route leaves the corpus at its first disagreement. So the agent's
sequence is its first steps from the human's positions, not a route it walked.

Usage:
  npm run route-compare -w @meccg/sim -- --dir <corpus> [options]

Options:
  --dir <path>     corpus root holding games/ and logs/games/
  --games <n>      how many games to sample (default 12)
  --agent <spec>   agent to poll (default h2)
  --json           machine-readable summary
  --help           this message
`;

/** The fields this instrument reads off a site definition. */
interface SiteFacts {
  readonly region: string;
  readonly siteType: string;
}

/** One company's ordered destinations, as chosen by one side. */
interface Route {
  readonly sites: string[];
}

/** Shape statistics for a set of routes. */
interface Shape {
  /** Consecutive destinations that stayed in the same region. */
  sameRegion: number;
  /** Consecutive pairs considered, so `sameRegion` has a denominator. */
  transitions: number;
  /** Destinations the company had already visited. */
  revisits: number;
  /** Destinations that are havens. */
  havens: number;
  /** Total destinations. */
  moves: number;
  /** Distinct destinations, summed per company. */
  distinct: number;
  /** Companies contributing to the above. */
  companies: number;
}

/** An empty tally, so the two sides start identical. */
function emptyShape(): Shape {
  return { sameRegion: 0, transitions: 0, revisits: 0, havens: 0, moves: 0, distinct: 0, companies: 0 };
}

/** Fold one company's route into a running tally. */
function measure(route: Route, facts: (definitionId: string) => SiteFacts, into: Shape): void {
  if (route.sites.length === 0) return;
  into.companies++;
  into.moves += route.sites.length;
  into.distinct += new Set(route.sites).size;
  const seen = new Set<string>();
  let previous: string | null = null;
  for (const site of route.sites) {
    if (seen.has(site)) into.revisits++;
    seen.add(site);
    if (facts(site).siteType === 'haven') into.havens++;
    if (previous !== null) {
      into.transitions++;
      if (facts(previous).region === facts(site).region) into.sameRegion++;
    }
    previous = site;
  }
}

/** Per-company routes for both sides, keyed by company id. */
interface GameRoutes {
  readonly human: Map<string, Route>;
  readonly agent: Map<string, Route>;
  /** Decisions where both sides named a destination. */
  attributed: number;
  /** …and named the same one. */
  agreed: number;
}

const args = cliPreamble(USAGE);

setEngineConsoleLog(false);
const cardPool = loadCardPool();
const corpus = stringFlag(args, 'dir') ?? path.join(process.env.HOME ?? '', 'backup', 'ai-meccg.com');
const gameLimit = numberFlag(args, 'games', 12);
const agent = resolveAgent(stringFlag(args, 'agent') ?? 'h2');

/** Printed region and site type, defaulted, for a site definition. */
function siteFacts(definitionId: string): SiteFacts {
  const def = cardPool[definitionId] as CardDefinition | undefined;
  const record = def as unknown as { region?: string; siteType?: string } | undefined;
  return { region: record?.region ?? 'unknown', siteType: record?.siteType ?? 'unknown' };
}

/** Walk one game, collecting both sides' destination sequences per company. */
function routesOf(gameId: string, humanId: string): GameRoutes | null {
  const logPath = path.join(corpus, 'logs', 'games', `${gameId}.jsonl`);
  if (!fs.existsSync(logPath)) return null;
  const records = readGameLog(logPath).filter(r => r.event === 'state');
  const human = new Map<string, Route>();
  const agentRoutes = new Map<string, Route>();
  let attributed = 0;
  let agreed = 0;
  agent.startGame?.();

  for (let i = 0; i < records.length - 1; i++) {
    const offered = (records[i] as unknown as {
      legalActions?: Record<string, { action: GameAction; reason?: string }[]>;
    }).legalActions?.[humanId];
    if (!offered) continue;
    const candidates = forwardActions(offered.filter(e => e.reason === undefined).map(e => e.action));
    const moves = candidates.filter(a => a.type === 'plan-movement');
    if (moves.length < 2) continue;

    const state = withStandardCardPool(records[i].state);
    const nextHash = hashState(withStandardCardPool(records[i + 1].state));
    const matched = moves.filter(action => {
      try {
        const result = reduce(state, action);
        return !result.error && hashState(result.state) === nextHash;
      } catch { return false; }
    });
    if (matched.length !== 1) continue;

    const view = projectPlayerView(state, humanId as PlayerId);
    let played: GameAction;
    try {
      played = agent.chooseAction({
        view, cardPool, legalActions: candidates, evaluated: view.legalActions, random: () => 0.5,
      } as never).action;
    } catch { continue; }
    if (played.type !== 'plan-movement') continue;

    // The action names a site *instance* in the player's own site deck; the
    // route is a sequence of definitions, because two instances of one site are
    // the same place.
    const destinationOf = (action: GameAction): string | undefined => {
      const instanceId = String((action as unknown as { destinationSite?: string }).destinationSite);
      return view.self.siteDeck?.find(c => String(c.instanceId) === instanceId)?.definitionId as string | undefined;
    };
    const companyId = String((matched[0] as unknown as { companyId?: string }).companyId ?? 'company');
    const humanSite = destinationOf(matched[0]);
    const agentSite = destinationOf(played);
    if (!humanSite || !agentSite) continue;

    attributed++;
    if (humanSite === agentSite) agreed++;
    if (!human.has(companyId)) human.set(companyId, { sites: [] });
    if (!agentRoutes.has(companyId)) agentRoutes.set(companyId, { sites: [] });
    human.get(companyId)!.sites.push(humanSite);
    agentRoutes.get(companyId)!.sites.push(agentSite);
  }
  return { human, agent: agentRoutes, attributed, agreed };
}

const humanShape = emptyShape();
const agentShape = emptyShape();
let attributed = 0;
let agreed = 0;
let games = 0;

for (const file of fs.readdirSync(path.join(corpus, 'games'))) {
  if (games >= gameLimit) break;
  const summary = JSON.parse(fs.readFileSync(path.join(corpus, 'games', file), 'utf-8')) as {
    gameId?: string;
    players?: { playerId?: string; human?: boolean }[];
  };
  const seat = summary.players?.find(p => p.human === true);
  if (!summary.gameId || !seat?.playerId) continue;
  const routes = routesOf(summary.gameId, seat.playerId);
  if (routes === null) continue;
  games++;
  attributed += routes.attributed;
  agreed += routes.agreed;
  for (const route of routes.human.values()) measure(route, siteFacts, humanShape);
  for (const route of routes.agent.values()) measure(route, siteFacts, agentShape);
}

/** A percentage with a denominator that may be zero. */
function share(part: number, whole: number): string {
  return whole === 0 ? '—' : `${(part / whole * 100).toFixed(1)}%`;
}

/** A per-company mean. */
function per(total: number, companies: number): string {
  return companies === 0 ? '—' : (total / companies).toFixed(2);
}

if (args.flags.json === true) {
  console.log(JSON.stringify({ games, attributed, agreed, human: humanShape, agent: agentShape }, null, 2));
} else {
  console.log(`route-compare: ${agent.name} against ${games} recorded human game(s)\n`);
  console.log(`  movement decisions attributed  ${attributed}`);
  console.log(`  same destination               ${agreed}  (${share(agreed, attributed)})`);
  console.log(`  companies with a route          human ${humanShape.companies}   agent ${agentShape.companies}\n`);
  console.log('── route shape ──\n');
  console.log('                                        human      agent');
  console.log(`  consecutive moves in one region     ${share(humanShape.sameRegion, humanShape.transitions).padStart(7)}    ${share(agentShape.sameRegion, agentShape.transitions).padStart(7)}`);
  console.log(`  destinations already visited        ${share(humanShape.revisits, humanShape.moves).padStart(7)}    ${share(agentShape.revisits, agentShape.moves).padStart(7)}`);
  console.log(`  destinations that are havens        ${share(humanShape.havens, humanShape.moves).padStart(7)}    ${share(agentShape.havens, agentShape.moves).padStart(7)}`);
  console.log(`  distinct sites per company          ${per(humanShape.distinct, humanShape.companies).padStart(7)}    ${per(agentShape.distinct, agentShape.companies).padStart(7)}`);
  console.log(`  moves per company                   ${per(humanShape.moves, humanShape.companies).padStart(7)}    ${per(agentShape.moves, agentShape.companies).padStart(7)}`);
  console.log('\nThe agent\'s sequence is its first steps from the human\'s positions,');
  console.log('not a route it walked. Read it as shape, not as a route it would take.');
}
