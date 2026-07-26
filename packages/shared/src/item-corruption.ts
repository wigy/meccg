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
 * same for greater items, and *Rumor of the One* (le-224) for ring items.
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
import { matchesContext } from './effects/condition-matcher.js';

/** One in-play global item-stat modifier (from an `in-play-item-modifier` effect). */
export interface InPlayItemModifier {
  /** Which items the modifier reaches; absent means every item. */
  readonly itemFilter?: Condition;
  /** Corruption points added to each matching item. */
  readonly corruptionPoints: number;
  /** Marshalling points added to each matching item. */
  readonly marshallingPoints: number;
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
        corruptionPoints: effect.corruptionPoints ?? 0,
        marshallingPoints: effect.marshallingPoints ?? 0,
      });
    }
  }
  return out;
}

/**
 * Sums the corruption-point and marshalling-point deltas that the in-play
 * global item modifiers grant to a single item, matching each modifier's
 * optional `itemFilter` against a per-item context `{ item: { keywords, name,
 * cardType, subtype } }`. Returns `{ cp: 0, mp: 0 }` when nothing matches.
 */
export function itemModifierDeltas(
  itemDef: CardDefinition,
  mods: readonly InPlayItemModifier[],
): { cp: number; mp: number } {
  if (mods.length === 0) return { cp: 0, mp: 0 };
  const ctx = {
    item: {
      keywords: (itemDef as { keywords?: readonly string[] }).keywords ?? [],
      name: itemDef.name,
      cardType: itemDef.cardType,
      subtype: (itemDef as { subtype?: string }).subtype,
    },
  };
  let cp = 0;
  let mp = 0;
  for (const m of mods) {
    if (m.itemFilter && !matchesContext(m.itemFilter, ctx)) continue;
    cp += m.corruptionPoints;
    mp += m.marshallingPoints;
  }
  return { cp, mp };
}

/**
 * The corruption points an item in play actually contributes to its bearer:
 * the printed value plus every matching `in-play-item-modifier` delta from the
 * given in-play card definitions. This is the number the clients must show on
 * an item's CP badge — showing the printed value instead makes the badges
 * disagree with the corruption check the engine computes (e.g. *Glamdring*
 * reads 1 CP but costs 2 while *Scorba at Home* is in play).
 *
 * Bearer-specific exclusions (the Balrog avatar's borne items contribute no
 * corruption) are not applied here; they belong to the bearer's total, not to
 * the item's own value.
 */
export function effectiveItemCorruptionPoints(
  itemDef: CardDefinition,
  inPlayDefs: readonly (CardDefinition | null | undefined)[],
): number {
  const printed = (itemDef as { corruptionPoints?: number }).corruptionPoints ?? 0;
  return printed + itemModifierDeltas(itemDef, collectItemModifiersFromDefs(inPlayDefs)).cp;
}
