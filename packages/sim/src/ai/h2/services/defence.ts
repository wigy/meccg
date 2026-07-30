/**
 * @module ai/h2/services/defence
 *
 * What a company of ours would suffer from the hazards its own size invites.
 *
 * The hazard limit *is* the company size. That single rule is what makes
 * company shape a real decision rather than a bookkeeping one: a company of
 * five hands the opponent five slots to spend on it, and a five-character
 * company split into two and three hands them two and three — the same total,
 * aimed at rosters that answer very differently. Which is better is not
 * obvious, and it is exactly the kind of question that should be computed
 * rather than assumed.
 *
 * So this service answers one question: what does a roster expect to lose when
 * `slots` hazards are spent against it? The answer is a function of the *set* of
 * characters and nothing else — see the canonical ordering in `expectedHarm`,
 * which is what makes `Σ harm(company)` a potential that shape changes can be
 * measured against. Without it a shape change and its undo could both look like
 * an improvement, which is not a rounding error but an infinite loop. It is the mirror image of `denial` —
 * same enumeration, same degradation between attacks, opposite seat — and it
 * prices harm through `character-value`, so the cost of tapping a particular
 * character is the same number `combat` pays when it taps him in a strike.
 *
 * **The typical attack.** Pricing needs a creature, and the honest source is
 * what the opponent has already shown: creatures in their discard, kill and
 * out-of-play piles and in play are all public, and the *median* of what they
 * have played is a fair description of what they play. With nothing shown yet
 * it falls back to the median hazard creature in the card pool — a statement
 * about the game rather than about their deck, which is the most that can be
 * said before they have played anything. Which of the two was used is reported,
 * because a number taken from four observed creatures deserves less weight than
 * one taken from twenty.
 *
 * **And the board's own modifiers are part of it.** A company facing Orcs while
 * Minions Stir is out is facing *stronger* Orcs — +1 strike and +1 prowess each,
 * +2 while Doors of Night is also out — and a typical attack that ignores that
 * under-states every harm this service reports, which is every company-shape
 * comparison, every enter-site cost and every Stealth. The modifier is applied
 * to each sampled creature by its own race *before* the median is taken, so the
 * answer stays a whole number the dice tables can be indexed by. `hazards`
 * reads the same declared modifiers from the other side of the table, through
 * the same service, so the two seats cannot disagree about what an Orc is.
 */

import type { CardDefinition, PlayerView } from '@meccg/shared';
import { memoizeOnFirst } from '../core/memo.js';
import type { Tunables } from '../core/tunables.js';
import { boostForRace, boostInPlay } from './attack-modifiers.js';
import type { Standing } from './standing.js';
import type { StrikeTarget } from './strike/prowess.js';
import type { AttackProfile } from './strike/sequence.js';
import { resolveAttacks } from './strike/sequence.js';

/** The attack a company is assumed to face, and where it came from. */
export interface TypicalAttack {
  /** Median prowess of the creatures it is modelled on. */
  readonly prowess: number;
  /** Median strike count, at least one. */
  readonly strikes: number;
  /** Median body, or null when the sample is bodyless. */
  readonly body: number | null;
  /** How many creatures the median was taken over. */
  readonly seen: number;
  /** True when the opponent has shown none and the card pool supplied it. */
  readonly fromPool: boolean;
  /**
   * What the hazard events in play added to it, for the rationale that spends
   * this number. Zero when the board carries no attack modifier.
   */
  readonly boosted: { readonly prowess: number; readonly strikes: number };
}

/** Expected harm to our own companies. */
export interface Defence {
  /** Expected TSD lost by a roster facing `slots` typical attacks. */
  expectedHarm(roster: readonly StrikeTarget[], slots: number): number;
  /**
   * Expected TSD lost by a roster facing named attacks, in order.
   *
   * The form for threats that are *published* rather than guessed at: a site
   * prints its automatic attacks with their strikes, prowess and body, so
   * entering it can be priced against the real thing instead of against a
   * median creature.
   */
  harmFrom(roster: readonly StrikeTarget[], profiles: readonly AttackProfile[]): number;
  /**
   * Expected TSD lost by a roster once one card in play is gone.
   *
   * The question a removal asks: taking the opponent's Minions Stir off the
   * board makes every Orc attack weaker again, and what that is worth is the
   * harm it stops. Answered here rather than by the module that reads it,
   * because the typical attack is this service's number and a second copy of it
   * would be a second opinion.
   */
  harmWithout(instanceId: string, roster: readonly StrikeTarget[], slots: number): number;
  /** The attack the harm was computed against when none is named. */
  readonly typical: TypicalAttack;
}

/** The creature fields this service averages. */
interface CreatureStats {
  readonly prowess: number;
  readonly strikes: number;
  readonly body: number | null;
  /** The race the board's modifiers are keyed to. */
  readonly race: string | null;
}

/** A creature definition's stats, or null when it is not a creature. */
function creatureStats(def: CardDefinition | undefined): CreatureStats | null {
  const fields = def as unknown as {
    cardType?: string; prowess?: number; strikes?: number; body?: number | null; race?: string;
  } | undefined;
  if (!fields || fields.cardType !== 'hazard-creature') return null;
  return {
    prowess: fields.prowess ?? 0,
    strikes: fields.strikes ?? 1,
    body: fields.body ?? null,
    race: fields.race ?? null,
  };
}

/** The middle value of a sample, rounded to a whole number. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  // Whole numbers, because the dice tables are indexed by the 2d6 target: a
  // fractional prowess makes a fractional one, which reads as an unreachable
  // roll and silently prices every attack at zero harm.
  return Math.round(value);
}

/**
 * The typical creature in a sample.
 *
 * The median rather than the mean, because "typical" is what is wanted and the
 * mean is not it: the card pool's creatures run from Wolves at prowess 4 to
 * dragons in the teens, and averaging them describes a threat nobody plays.
 */
function typicalOf(samples: readonly CreatureStats[]): CreatureStats | null {
  if (samples.length === 0) return null;
  const bodies = samples.map(s => s.body).filter((b): b is number => b !== null);
  return {
    prowess: median(samples.map(s => s.prowess)) ?? 0,
    strikes: Math.max(1, median(samples.map(s => s.strikes)) ?? 1),
    body: median(bodies),
    race: null,
  };
}

/** The creatures the opponent has publicly shown. */
function shownCreatures(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): CreatureStats[] {
  const samples: CreatureStats[] = [];
  for (const zone of [
    view.opponent.discardPile, view.opponent.killPile,
    view.opponent.outOfPlayPile, view.opponent.cardsInPlay,
  ]) {
    for (const card of zone) {
      const stats = creatureStats(cardPool[card.definitionId]);
      if (stats) samples.push(stats);
    }
  }
  return samples;
}

/**
 * Every hazard creature in the card pool — the prior, when nothing is shown.
 *
 * Memoised on the pool: it is a scan of several thousand definitions for an
 * answer that is the same all game, and it was being run once per candidate.
 */
const poolCreatures = memoizeOnFirst((cardPool: Readonly<Record<string, CardDefinition>>): CreatureStats[] => {
  const samples: CreatureStats[] = [];
  for (const def of Object.values(cardPool)) {
    const stats = creatureStats(def);
    if (stats) samples.push(stats);
  }
  return samples;
});

/**
 * Build the defence service.
 *
 * The typical attack is computed once — it is a property of the position, not
 * of the roster being asked about — so comparing two company shapes compares
 * them against the same threat, which is the only way the comparison means
 * anything.
 */
function buildComputeDefence(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  standing: Standing,
  tunables: Tunables,
): Defence {
  const shown = shownCreatures(view, cardPool);
  const fromPool = shown.length === 0;
  // The modifiers the hazard events in play declare, applied to each creature
  // by its own race before the median is taken. Boosting the *median* instead
  // would apply an Orc modifier to a sample that is only part Orc.
  const boost = boostInPlay(view, cardPool);
  const withBoard = (samples: readonly CreatureStats[]): CreatureStats[] => samples.map(sample => {
    const added = boostForRace(boost, sample.race);
    return {
      ...sample,
      prowess: sample.prowess + added.prowess,
      strikes: sample.strikes + added.strikes,
    };
  });
  const bare = typicalOf(shown) ?? typicalOf(poolCreatures(cardPool))
    ?? { prowess: 5, strikes: 1, body: 8, race: null };
  /** The typical attack under a given set of board modifiers. */
  const typicalUnder = (under: ReturnType<typeof boostInPlay>): CreatureStats => {
    const applied = (samples: readonly CreatureStats[]): CreatureStats[] => samples.map(sample => {
      const added = boostForRace(under, sample.race);
      return {
        ...sample,
        prowess: sample.prowess + added.prowess,
        strikes: sample.strikes + added.strikes,
      };
    });
    return typicalOf(applied(shown)) ?? typicalOf(applied(poolCreatures(cardPool))) ?? bare;
  };
  const stats = typicalOf(withBoard(shown)) ?? typicalOf(withBoard(poolCreatures(cardPool))) ?? bare;
  const typical: TypicalAttack = {
    prowess: stats.prowess,
    strikes: stats.strikes,
    body: stats.body,
    seen: fromPool ? 0 : shown.length,
    fromPool,
    boosted: {
      prowess: stats.prowess - bare.prowess,
      strikes: stats.strikes - bare.strikes,
    },
  };

  /** What the marshalling points a character carries are worth, in TSD. */
  const ownMpLoss = (target: { readonly definitionId: string; readonly isAlly: boolean }): number => {
    const def = cardPool[target.definitionId] as unknown as {
      marshallingPoints?: number; marshallingCategory?: string;
    } | undefined;
    const points = def?.marshallingPoints ?? 0;
    if (points <= 0) return 0;
    const source = target.isAlly ? 'ally' : (def?.marshallingCategory ?? 'character');
    return standing.tsd - standing.tsdAfter({ [source]: -points });
  };

  return {
    typical,

    expectedHarm(roster: readonly StrikeTarget[], slots: number): number {
      if (roster.length === 0 || slots <= 0) return 0;
      const profile: AttackProfile = {
        strikeProwess: typical.prowess,
        strikes: typical.strikes,
        creatureBody: typical.body,
        detainment: false,
        bodyCheckModifier: 0,
      };
      return this.harmFrom(roster, new Array(slots).fill(profile));
    },

    harmWithout(instanceId: string, roster: readonly StrikeTarget[], slots: number): number {
      if (roster.length === 0 || slots <= 0) return 0;
      const without = typicalUnder(boostInPlay(view, cardPool, { excluding: instanceId }));
      const profile: AttackProfile = {
        strikeProwess: without.prowess,
        strikes: without.strikes,
        creatureBody: without.body,
        detainment: false,
        bodyCheckModifier: 0,
      };
      return this.harmFrom(roster, new Array(slots).fill(profile));
    },

    harmFrom(roster: readonly StrikeTarget[], profiles: readonly AttackProfile[]): number {
      if (roster.length === 0 || profiles.length === 0) return 0;
      // Canonical order, so the answer is a function of *who is in the company*
      // and not of the order they happen to appear in a list. Strike targets are
      // picked by lowest need and ties fall back to array order, so without this
      // the same company scored differently depending on how it was assembled —
      // merging A into B came out at +2.61% and B into A at +2.30% for the
      // identical result. A shape and its undo could then both look like an
      // improvement, and a self-play game spent 4000 decisions proving it,
      // cycling split → plan-movement → merge inside one organization phase.
      const canonical = [...roster].sort((a, b) =>
        (a.instanceId as string) < (b.instanceId as string) ? -1 : 1);
      const result = resolveAttacks(
        canonical, cardPool, profiles,
        (outcome, target) => {
          // Shape-independent by construction: the tempo constants and the
          // character's own printed points. Anything that varies with which
          // company he is in — the influence attempt a tap forfeits, the
          // followers a loss reverts — would make this a function of the shape
          // it is being used to compare, which is how the loop happened.
          switch (outcome.character) {
            case 'tapped':
              return -tunables.tapTempoCost;
            case 'wounded':
              return -tunables.woundTempoCost;
            case 'eliminated':
              return -(tunables.eliminationTempoCost + ownMpLoss(target));
            default:
              return 0;
          }
        },
        { maxStates: tunables.attackStateCap },
      );
      // Harm is reported as a positive quantity: callers subtract it.
      return -result.outcomes.reduce((sum, o) => sum + o.p * o.dtsd, 0);
    },
  };
}

/**
 * Build the service, once per position.
 *
 * The registry asks every module about every candidate on a decision and hands
 * them all the same view, so this would otherwise be rebuilt once per
 * candidate for an answer that cannot differ. See `core/memo`.
 */
export const computeDefence = memoizeOnFirst(buildComputeDefence);
