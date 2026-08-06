/**
 * @module engine/location-magic-restriction
 *
 * The `location-magic-restriction` play-lock: while a card carrying that
 * effect is in play, a character standing at (or transiting through) a
 * matching region may not play a magic-class card — one carrying any of
 * `keywords` (default `spell` / `sorcery` / `spirit-magic` / `shadow-magic` /
 * `light-enchantment` / `ritual`).
 *
 * Models In the Heart of his Realm (dm-67): "No character at a site in a
 * Dark-domain [{d}] or Gorgoroth, or moving with a Dark-domain [{d}] or
 * Gorgoroth in his site path, can use spells, light enchantments, or
 * rituals."
 *
 * Enforcement is central, mirroring {@link applyCardPlayProhibitions}
 * (`card-play-prohibition.ts`): `computeLegalActions` runs every candidate
 * action through this filter, so the lock reaches every window a magic card
 * can be played from — reactive `cancel-attack`/`cancel-influence` spells and
 * `play-target`-bound permanent-event rituals/light-enchantments alike. Only
 * actions that name an acting character via one of a handful of well-known
 * fields (`characterId`, `scoutInstanceId`, `targetCharacterId`,
 * `targetScoutInstanceId`) can be evaluated; an action with none of those is
 * left alone (no location to check against).
 */

import type { CardDefinition, CardInstanceId, EvaluatedAction, GameState, PlayerId } from '../index.js';
import type { LocationMagicRestrictionEffect } from '../types/effects.js';
import { resolveInstanceId } from '../types/state.js';
import { characterLocation, defById, getCardEffects, locationMatchesSpec } from './reducer-utils.js';
import { notPlayable } from './legal-actions/action-builders.js';
import { logDetail } from './legal-actions/log.js';

/** Card keywords considered "magic" when a `location-magic-restriction` effect declares no `keywords` of its own. */
const DEFAULT_MAGIC_KEYWORDS = ['spell', 'sorcery', 'spirit-magic', 'shadow-magic', 'light-enchantment', 'ritual'] as const;

function isRestrictedMagicCard(def: CardDefinition | undefined, keywords: readonly string[] | undefined): boolean {
  if (!def || !('keywords' in def)) return false;
  const cardKeywords = (def as { keywords?: readonly string[] }).keywords ?? [];
  return (keywords ?? DEFAULT_MAGIC_KEYWORDS).some(k => cardKeywords.includes(k));
}

/** Every `location-magic-restriction` effect currently active on either side of the table. */
function activeLocationMagicRestrictions(state: GameState): readonly LocationMagicRestrictionEffect[] {
  const found: LocationMagicRestrictionEffect[] = [];
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      for (const eff of getCardEffects(defById(state, card.definitionId))) {
        if (eff.type === 'location-magic-restriction') found.push(eff);
      }
    }
  }
  return found;
}

/** Action fields, checked in order, that may carry the acting/casting character's instance ID. */
const ACTING_CHARACTER_FIELDS = ['characterId', 'scoutInstanceId', 'targetCharacterId', 'targetScoutInstanceId'] as const;

/**
 * Replaces every *viable* action that plays a magic-class card from a
 * location under an active `location-magic-restriction` with a single
 * `not-playable` entry.
 */
export function applyLocationMagicRestriction(
  state: GameState,
  playerId: PlayerId,
  evaluated: readonly EvaluatedAction[],
): EvaluatedAction[] {
  const restrictions = activeLocationMagicRestrictions(state);
  if (restrictions.length === 0) return [...evaluated];

  return evaluated.map(ea => {
    if (!ea.viable) return ea;
    const a = ea.action as unknown as Record<string, unknown>;
    const instId = a['cardInstanceId'];
    if (typeof instId !== 'string') return ea;
    const defId = resolveInstanceId(state, instId as CardInstanceId);
    const def = defId ? defById(state, defId) : undefined;

    let charInstId: string | undefined;
    for (const field of ACTING_CHARACTER_FIELDS) {
      const v = a[field];
      if (typeof v === 'string') { charInstId = v; break; }
    }
    if (!charInstId) return ea;
    const loc = characterLocation(state, charInstId as CardInstanceId);
    if (!loc) return ea;

    const blockedBy = restrictions.find(eff => {
      if (!isRestrictedMagicCard(def, eff.keywords)) return false;
      if (eff.noEffectOnMinion && loc.minion) return false;
      return locationMatchesSpec(loc, eff);
    });
    if (!blockedBy) return ea;

    const name = def?.name ?? (defId as string);
    logDetail(`location-magic-restriction: ${name} may not be used — caster's location is under a magic restriction`);
    return notPlayable(playerId, instId as CardInstanceId, `${name}: cannot be used here — magic is suppressed in this region`);
  });
}
