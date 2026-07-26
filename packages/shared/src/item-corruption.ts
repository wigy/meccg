/**
 * @module item-corruption
 *
 * Effective corruption points of an item that is in play.
 *
 * An item's corruption is not always the number printed on the card: a
 * permanent event in either player's `cardsInPlay` may carry an
 * `in-play-item-modifier` effect that raises the corruption points of every
 * item matching its `itemFilter` — *Scorba at Home* (td-65) gives "each major
 * item ... an additional corruption point", *Itangast at Home* (td-38) does the
 * same for greater items, and *Rumor of the One* (le-224) for ring items — or
 * that *scales* it via `corruptionMultiplier` (*Bane of the Ithil-stone* tw-13,
 * "Corruption points for Palantíri are doubled").
 *
 * A modifier may also carry a `bearerFilter` restricting it to items borne by
 * characters of a matching player (tw-13 again: "This card has no effect on a
 * minion player"), which is why the helpers here take the bearer's alignment.
 *
 * The engine folds that delta into each bearer's corruption total when it
 * recomputes derived stats, so corruption checks already use the raised value.
 * These helpers expose the same per-item arithmetic to the clients, so the CP
 * badge the UI paints on an item agrees with the number the engine rolls
 * against. They intentionally parallel `company-attachments.ts` /
 * `site-attachments.ts`: a single rule shared by engine and clients rather
 * than a re-implementation on each side.
 */

import type { CardDefinition } from './types/cards.js';
import type { CardEffect, Condition } from './types/effects.js';
import { Alignment } from './types/common.js';
import { matchesContext } from './effects/condition-matcher.js';

/** One in-play global item-stat modifier (from an `in-play-item-modifier` effect). */
export interface InPlayItemModifier {
  /** Which items the modifier reaches; absent means every item. */
  readonly itemFilter?: Condition;
  /**
   * Which bearers the modifier reaches, matched against the bearer's
   * controlling player; absent means every bearer (Bane of the Ithil-stone
   * tw-13 "has no effect on a minion player").
   */
  readonly bearerFilter?: Condition;
  /** Corruption points added to each matching item. */
  readonly corruptionPoints: number;
  /** Marshalling points added to each matching item. */
  readonly marshallingPoints: number;
  /** Factor applied to a matching item's corruption *after* the flat delta (1 = none). */
  readonly corruptionMultiplier: number;
}

/** The effects declared by a card definition, or an empty list. */
function effectsOf(def: CardDefinition | null | undefined): readonly CardEffect[] {
  if (!def || !('effects' in def)) return [];
  return (def as { readonly effects?: readonly CardEffect[] }).effects ?? [];
}

/**
 * Collects every `in-play-item-modifier` effect carried by the given in-play
 * card definitions (both players' `cardsInPlay` — these effects reach "all"
 * items, not only their controller's). Returns an empty array when none is in
 * play, so the per-item scan short-circuits.
 */
export function collectItemModifiersFromDefs(
  defs: readonly (CardDefinition | null | undefined)[],
): InPlayItemModifier[] {
  const out: InPlayItemModifier[] = [];
  for (const def of defs) {
    for (const effect of effectsOf(def)) {
      if (effect.type !== 'in-play-item-modifier') continue;
      out.push({
        itemFilter: effect.itemFilter,
        bearerFilter: effect.bearerFilter,
        corruptionPoints: effect.corruptionPoints ?? 0,
        marshallingPoints: effect.marshallingPoints ?? 0,
        corruptionMultiplier: effect.corruptionMultiplier ?? 1,
      });
    }
  }
  return out;
}

/**
 * Sums the corruption-point and marshalling-point deltas that the in-play
 * global item modifiers grant to a single item, matching each modifier's
 * optional `itemFilter` against a per-item context `{ item: { keywords, name,
 * cardType, subtype } }` and its optional `bearerFilter` against the bearer's
 * controlling player `{ bearer: { alignment, minion } }`. Returns
 * `{ cp: 0, mp: 0, cpMultiplier: 1 }` when nothing matches.
 *
 * `cpMultiplier` is the product of every matching modifier's
 * `corruptionMultiplier` and must be applied by the caller *after* the `cp`
 * delta, so "Palantíri corruption doubled" (Bane of the Ithil-stone tw-13)
 * stacks sensibly on top of a flat "+1 corruption per greater item" (td-38).
 *
 * `bearerAlignment` is omitted only where no bearer is in scope (e.g. an item's
 * own MP delta); a modifier carrying a `bearerFilter` then does not apply.
 */
export function itemModifierDeltas(
  itemDef: CardDefinition,
  mods: readonly InPlayItemModifier[],
  bearerAlignment?: Alignment,
): { cp: number; mp: number; cpMultiplier: number } {
  if (mods.length === 0) return { cp: 0, mp: 0, cpMultiplier: 1 };
  const ctx = {
    item: {
      keywords: (itemDef as { keywords?: readonly string[] }).keywords ?? [],
      name: itemDef.name,
      cardType: itemDef.cardType,
      subtype: (itemDef as { subtype?: string }).subtype,
    },
    bearer: bearerAlignment === undefined ? undefined : {
      alignment: bearerAlignment,
      minion: bearerAlignment === Alignment.Ringwraith || bearerAlignment === Alignment.Balrog,
    },
  };
  let cp = 0;
  let mp = 0;
  let cpMultiplier = 1;
  for (const m of mods) {
    if (m.itemFilter && !matchesContext(m.itemFilter, ctx)) continue;
    if (m.bearerFilter && (bearerAlignment === undefined || !matchesContext(m.bearerFilter, ctx))) continue;
    cp += m.corruptionPoints;
    mp += m.marshallingPoints;
    cpMultiplier *= m.corruptionMultiplier;
  }
  return { cp, mp, cpMultiplier };
}

/**
 * The corruption points an item in play actually contributes to its bearer:
 * the printed value plus every matching `in-play-item-modifier` delta from the
 * given in-play card definitions, the sum then scaled by every matching
 * multiplier. This is the number the clients must show on an item's CP badge —
 * showing the printed value instead makes the badges disagree with the
 * corruption check the engine computes (e.g. *Glamdring* reads 1 CP but costs 2
 * while *Scorba at Home* is in play).
 *
 * Bearer-specific exclusions (the Balrog avatar's borne items contribute no
 * corruption) are not applied here; they belong to the bearer's total, not to
 * the item's own value.
 *
 * `bearerAlignment` is the alignment of the player controlling the item's
 * bearer; pass it wherever it is known so that modifiers restricted by a
 * `bearerFilter` (Bane of the Ithil-stone tw-13 doubles Palantír corruption,
 * but "has no effect on a minion player") are honoured. Omitting it skips
 * every bearer-filtered modifier.
 */
export function effectiveItemCorruptionPoints(
  itemDef: CardDefinition,
  inPlayDefs: readonly (CardDefinition | null | undefined)[],
  bearerAlignment?: Alignment,
): number {
  const printed = (itemDef as { corruptionPoints?: number }).corruptionPoints ?? 0;
  const deltas = itemModifierDeltas(itemDef, collectItemModifiersFromDefs(inPlayDefs), bearerAlignment);
  return (printed + deltas.cp) * deltas.cpMultiplier;
}
