/**
 * @module ai/h2/services/strike/ability
 *
 * What a character is worth striking **for his abilities**, rather than for his
 * prowess or his marshalling points.
 *
 * The attack model priced a strike target by two things: how likely it was to
 * beat the strike (`needAgainst`) and what harming it denied the opponent's
 * site phase (`denial`). Both are blind to the character's card text, and the
 * blindness has a name — Fatty Bolger (tw-495), prowess 1, body 8, who "can tap
 * to cancel a strike against another Hobbit in his company". The defender would
 * never assign him to a strike, so the old defender-assigns model never struck
 * him at all; and had it struck him, tapping him would have been priced as the
 * loss of a prowess-1 scout's resource play, which is close to nothing. Both
 * readings miss the point of aiming at him, which is that a *tapped* Fatty
 * cannot pay the tap that cancels strikes for the rest of the combat.
 *
 * So this classifies a character definition's effects into what striking him
 * takes away, and — deliberately — it classifies rather than prices. The output
 * is structural: which abilities he has, and what removes each one. Turning
 * that into TSD is `denial`'s job, because the conversion needs `Tunables` and
 * a `Standing`, and `rosterOf` (which attaches this to every strike target) has
 * neither and should not grow them.
 *
 * **What removes an ability.** Two answers, and the difference is the whole
 * reason to aim at a character rather than simply to kill him:
 *
 * - **A tap.** An ability costing `{ tap: "self" }` needs an untapped bearer to
 *   pay it. Tapping him is therefore as good as removing it for this combat,
 *   at a fraction of the prowess a kill would need. This is the Fatty case, and
 *   it is why a two-strike attack that chooses its targets is worth so much
 *   more than its prowess suggests.
 * - **Leaving play.** Everything the card was doing goes with it, tap-gated or
 *   passive. A wound is priced between the two: he is not gone, but he does not
 *   untap at the end of the turn, so the tap-gated abilities stay unavailable
 *   into the opponent's next turn as well.
 *
 * **What is deliberately not counted.** `stat-modifier` on a character is his
 * *own* stat — the DSL gives it no way to reach a company-mate, which is what
 * `company-modifier` is for, and no character in the pool carries one. Those
 * modifiers are already folded into `effectiveStats.prowess`, which `rosterOf`
 * reads straight onto the target, so counting them here would price the same
 * prowess twice. The same goes for `mp-modifier`: what a character's points are
 * worth on elimination is `denial`'s `characterMp`, not an ability.
 */

import type { CardDefinition } from '@meccg/shared';

/**
 * How an ability is taken away.
 *
 * Ordered by what it costs the attacker to achieve, which is also the order the
 * pricer credits them in: a tap is the cheapest thing a strike can do.
 */
export type AbilityRemoval =
  /** Needs an untapped bearer to pay `{ tap: "self" }`; a tap suffices. */
  | 'tap'
  /** Passive while the card is in play; only leaving play stops it. */
  | 'leaves-play';

/** One combat-relevant ability, and what removes it. */
export interface AbilityNote {
  /** The effect type it came from, which is what a reader wants to see. */
  readonly kind: string;
  /** What takes it away. */
  readonly removal: AbilityRemoval;
  /** Why this counts, for the rationale that spends it. */
  readonly reason: string;
}

/** The combat-relevant abilities a strike target carries. */
export interface CombatAbilities {
  /** Abilities a tap alone takes away. */
  readonly tapGated: readonly AbilityNote[];
  /** Abilities that persist until the card leaves play. */
  readonly passive: readonly AbilityNote[];
}

/** A target with no card text worth striking for. */
export const NO_ABILITIES: CombatAbilities = { tapGated: [], passive: [] };

/**
 * Effect types whose whole purpose is to blunt an attack.
 *
 * Listed by effect type rather than by card name, which is the project's
 * standing rule for this kind of table: a new card printing `cancel-strike` is
 * priced the day its data lands, without this module hearing about it.
 */
const COMBAT_EFFECTS: Readonly<Record<string, string>> = {
  'cancel-strike': 'can cancel a strike',
  'cancel-attack': 'can cancel an attack',
  'enemy-modifier': 'weakens attacking creatures',
  'agent-attack-modifier': 'weakens agent attacks',
  'flee-from-strike': 'can flee a strike',
};

/**
 * Check kinds that are resolved *inside* combat.
 *
 * A body check is the roll that decides whether a strike wounds or kills, so a
 * character who modifies one is defending the whole company against the strike
 * sequence. A corruption check is not combat, and its modifier is not counted.
 */
const COMBAT_CHECKS: ReadonlySet<string> = new Set(['body']);

/** The fields of an effect this needs, without depending on the whole DSL union. */
interface EffectShape {
  readonly type?: string;
  readonly cost?: { readonly tap?: string };
  readonly check?: string;
  readonly action?: string;
  readonly scope?: string;
}

/**
 * Whether this creature's own printed rule lets the **attacker** assign its
 * strikes ("Attacker chooses defending characters").
 *
 * The `scope: "all-attacks"` form of the same effect is a hazard *event*
 * granting the rule to every attack on the board rather than a creature
 * printing it for itself, and `chain-reducer.ts` draws the line in exactly this
 * place — so the same test is used here, and a creature is not credited with a
 * rule that some event elsewhere is providing.
 *
 * Nineteen creatures in the pool carry it, Cave-drake (le-66 / tw-020) among
 * them. The legacy `attackerChooses` column on the card data is null throughout
 * and is deliberately not read.
 */
export function attackerChoosesDefenders(def: CardDefinition | undefined): boolean {
  const effects = (def as unknown as { effects?: readonly EffectShape[] } | undefined)?.effects;
  if (!effects) return false;
  return effects.some(e => e.type === 'combat-attacker-chooses-defenders' && e.scope !== 'all-attacks');
}

/**
 * Whether an effect's cost requires the bearer to be untapped.
 *
 * `{ tap: "self" }` on a character *is* the character, so a tapped bearer can
 * no longer pay it. The other `tap` targets name someone else (`bearer` on an
 * item, a sage elsewhere in the company), and tapping this character does not
 * stop those — so they are passive as far as striking him goes.
 */
function needsUntapped(effect: EffectShape): boolean {
  return effect.cost?.tap === 'self';
}

/**
 * The combat abilities a character definition carries.
 *
 * A `grant-action` is included only when it is tap-gated. That is not a claim
 * that every tap-gated granted action matters in combat — most do not — but the
 * option it represents is genuinely lost when the bearer taps, and pricing the
 * whole family at one modest tunable is more honest than reading each apply
 * verb and guessing. The pricer names the tunable, so the assumption is visible
 * where it is spent rather than buried here.
 */
export function combatAbilitiesOf(def: CardDefinition | undefined): CombatAbilities {
  const effects = (def as unknown as { effects?: readonly EffectShape[] } | undefined)?.effects;
  if (!effects || effects.length === 0) return NO_ABILITIES;

  const tapGated: AbilityNote[] = [];
  const passive: AbilityNote[] = [];

  for (const effect of effects) {
    const type = effect.type;
    if (!type) continue;

    const combatReason = COMBAT_EFFECTS[type]
      ?? (type === 'check-modifier' && effect.check && COMBAT_CHECKS.has(effect.check)
        ? 'modifies body checks in combat'
        : type === 'grant-action' && needsUntapped(effect)
          ? 'has a tap-gated granted action'
          : null);
    if (!combatReason) continue;

    const note: AbilityNote = {
      kind: type,
      removal: needsUntapped(effect) ? 'tap' : 'leaves-play',
      reason: combatReason,
    };
    if (note.removal === 'tap') tapGated.push(note);
    else passive.push(note);
  }

  if (tapGated.length === 0 && passive.length === 0) return NO_ABILITIES;
  return { tapGated, passive };
}
