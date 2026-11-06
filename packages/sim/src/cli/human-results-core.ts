/**
 * @module cli/human-results-core
 *
 * The arithmetic of `human-results`, apart from the files it reads.
 */

/** The marshalling-point categories a completed game reports per seat. */
export const CATEGORIES = ['character', 'item', 'faction', 'ally', 'kill', 'misc'] as const;

/** The fields read of one seat in a completed-game summary. */
export interface FinishedSeat {
  readonly playerId: string;
  readonly name: string;
  readonly human: boolean;
  readonly finalScore: number;
  readonly mp: Readonly<Record<string, number>>;
}

/** The fields read of a completed-game summary. */
export interface FinishedGame {
  readonly gameId: string;
  readonly startedAt: string;
  readonly winner: string | null;
  readonly winReason: string;
  readonly players: readonly FinishedSeat[];
}

/** One game's raw points at the start of each turn. */
export type Pace = ReadonlyMap<number, { readonly human: number; readonly ai: number }>;

/** The two seats of a human-versus-AI game, or null for any other game. */
export function seatsOf(game: FinishedGame): { human: FinishedSeat; ai: FinishedSeat } | null {
  const humans = game.players.filter(p => p.human);
  const ais = game.players.filter(p => !p.human);
  return humans.length === 1 && ais.length === 1 ? { human: humans[0], ai: ais[0] } : null;
}

/** Whether a game was played out: a forfeited game has no value, whoever left. */
export function playedOut(game: FinishedGame): boolean {
  return game.winReason !== 'concession';
}

/** The median, the upper-middle average of an even count included. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Results per month and AI, counting only games finished on marshalling points. */
export function resultsByMonth(games: readonly FinishedGame[]): {
  month: string; agent: string; finished: number; aiWins: number; medianMargin: number;
}[] {
  const groups = new Map<string, { month: string; agent: string; aiWins: number; margins: number[] }>();
  for (const game of games) {
    const seats = seatsOf(game);
    if (!seats || game.winReason !== 'marshalling-points') continue;
    const month = game.startedAt.slice(0, 7);
    const key = `${month}/${seats.ai.name}`;
    const group = groups.get(key) ?? { month, agent: seats.ai.name, aiWins: 0, margins: [] };
    if (game.winner === seats.ai.name) group.aiWins++;
    group.margins.push(seats.human.finalScore - seats.ai.finalScore);
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.month.localeCompare(b.month) || a.agent.localeCompare(b.agent))
    .map(g => ({
      month: g.month, agent: g.agent, finished: g.margins.length, aiWins: g.aiWins, medianMargin: median(g.margins),
    }));
}

/** Where each seat's points came from, per category. */
export function categoryTable(games: readonly FinishedGame[]): {
  category: string; humanMedian: number; humanMean: number; aiMedian: number; aiMean: number; aiZero: number;
}[] {
  const pairs = games.map(seatsOf).filter((s): s is NonNullable<typeof s> => s !== null);
  const mean = (values: readonly number[]): number =>
    (values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length);
  return CATEGORIES.map(category => {
    const human = pairs.map(p => p.human.mp?.[category] ?? 0);
    const ai = pairs.map(p => p.ai.mp?.[category] ?? 0);
    return {
      category,
      humanMedian: median(human),
      humanMean: mean(human),
      aiMedian: median(ai),
      aiMean: mean(ai),
      aiZero: ai.filter(points => points === 0).length,
    };
  });
}

/** Median raw points per seat at each even turn, among the games that reached it. */
export function paceTable(paces: readonly Pace[]): { turn: number; human: number; ai: number; games: number }[] {
  const last = Math.max(0, ...paces.flatMap(pace => [...pace.keys()]));
  const rows: { turn: number; human: number; ai: number; games: number }[] = [];
  for (let turn = 2; turn <= last; turn += 2) {
    const here = paces.map(pace => pace.get(turn)).filter((p): p is { human: number; ai: number } => p !== undefined);
    // Below this a median is a story about a few long games.
    if (here.length < 5) break;
    rows.push({ turn, human: median(here.map(p => p.human)), ai: median(here.map(p => p.ai)), games: here.length });
  }
  return rows;
}
