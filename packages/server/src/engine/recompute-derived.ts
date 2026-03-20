/**
 * @module recompute-derived
 *
 * Recomputes derived player values from the authoritative game state after
 * every action. Instead of incrementally tracking values like marshalling
 * points and general influence in each reducer handler, this module
 * recalculates them from the ground truth (characters in play, items, etc.).
 *
 * Effective stats are computed using the card effects resolver — the DSL
 * effects on each character and their items are evaluated in context to
 * produce final prowess, body, direct influence, and corruption point values.
 *
 * This is called once after each successful reducer step, ensuring derived
 * values are always consistent regardless of which phase handler ran.
 */

import type {
  GameState,
  PlayerState,
  MarshallingPointTotals,
  EffectiveStats,
  CharacterInPlay,
  CardDefinition,
  CardInstanceId,
  HeroCharacterCard,
} from '@meccg/shared';
import { MarshallingCategory, ZERO_MARSHALLING_POINTS } from '@meccg/shared';
import {
  collectCharacterEffects,
  resolveStatModifiers,
} from './effects/index.js';
import type { ResolverContext } from './effects/index.js';

/**
 * Looks up a card definition from an instance ID through the instance map.
 */
function resolveDef(state: GameState, instanceId: CardInstanceId): CardDefinition | undefined {
  const inst = state.instanceMap[instanceId as string];
  if (!inst) return undefined;
  return state.cardPool[inst.definitionId as string];
}

/**
 * Adds a card's marshalling points to the running totals by its category.
 */
function addMP(
  totals: MarshallingPointTotals,
  def: CardDefinition,
): MarshallingPointTotals {
  if (!('marshallingPoints' in def) || !('marshallingCategory' in def)) return totals;
  const mp = (def as { marshallingPoints: number }).marshallingPoints;
  if (mp === 0) return totals;
  const cat = (def as { marshallingCategory: MarshallingCategory }).marshallingCategory;
  return { ...totals, [cat]: totals[cat] + mp };
}

/**
 * Builds a {@link ResolverContext} for computing a character's effective stats.
 */
function buildEffectiveStatsContext(charDef: HeroCharacterCard): ResolverContext {
  return {
    reason: 'effective-stats',
    bearer: {
      race: charDef.race,
      skills: charDef.skills,
      baseProwess: charDef.prowess,
      baseBody: charDef.body,
      baseDirectInfluence: charDef.directInfluence,
      name: charDef.name,
    },
  };
}

/**
 * Computes effective stats for a character using the card effects resolver.
 *
 * Collects all effects from the character's card definition and their
 * equipped items, then resolves stat modifiers for each stat. Falls back
 * to the old hardcoded approach for items without effects arrays.
 */
function computeEffectiveStats(
  state: GameState,
  char: CharacterInPlay,
  charDef: HeroCharacterCard,
): EffectiveStats {
  const context = buildEffectiveStatsContext(charDef);
  const collected = collectCharacterEffects(state, char, context);

  // If we have DSL effects, use the resolver for prowess, body, and DI
  const hasAnyEffects = collected.length > 0;

  let prowess: number;
  let body: number;
  let directInfluence: number;
  let corruptionPoints = 0;

  if (hasAnyEffects) {
    prowess = resolveStatModifiers(collected, 'prowess', charDef.prowess, context);
    body = resolveStatModifiers(collected, 'body', charDef.body, context);
    directInfluence = resolveStatModifiers(collected, 'direct-influence', charDef.directInfluence, context);

    // Corruption: sum from stat-modifier effects on corruption-points,
    // plus direct corruptionPoints from items and corruption cards that
    // don't have effects arrays yet.
    const cpFromEffects = resolveStatModifiers(collected, 'corruption-points', 0, context);
    corruptionPoints = cpFromEffects;

    // Also sum company-modifier corruption effects (e.g. The One Ring +1 CP to company)
    // These will be applied at a higher level, not per-character.
  } else {
    // Fallback: use the old hardcoded approach for cards without effects
    prowess = charDef.prowess;
    body = charDef.body;
    directInfluence = charDef.directInfluence;
  }

  // Always add corruption from items and corruption cards directly
  // (these are structural fields, not DSL effects)
  for (const item of char.items) {
    const itemDef = resolveDef(state, item.instanceId);
    if (itemDef && itemDef.cardType === 'hero-resource-item') {
      if (!hasAnyEffects) {
        prowess += itemDef.prowessModifier;
        body += itemDef.bodyModifier;
      }
      corruptionPoints += itemDef.corruptionPoints;
    }
  }

  for (const ccId of char.corruptionCards) {
    const ccDef = resolveDef(state, ccId);
    if (ccDef && ccDef.cardType === 'hazard-corruption') {
      corruptionPoints += ccDef.corruptionPoints;
    }
  }

  return { prowess, body, directInfluence, corruptionPoints };
}

/** Returns true if two EffectiveStats are identical. */
function statsEqual(a: EffectiveStats, b: EffectiveStats): boolean {
  return a.prowess === b.prowess && a.body === b.body &&
    a.directInfluence === b.directInfluence && a.corruptionPoints === b.corruptionPoints;
}

function recomputePlayer(state: GameState, player: PlayerState): PlayerState {
  let generalInfluenceUsed = 0;
  let mp = ZERO_MARSHALLING_POINTS;
  let charactersChanged = false;
  const newCharacters: Record<string, CharacterInPlay> = {};

  for (const [key, char] of Object.entries(player.characters)) {
    const charDef = resolveDef(state, char.instanceId);
    if (!charDef || charDef.cardType !== 'hero-character') {
      newCharacters[key] = char;
      continue;
    }

    // General influence: only characters under GI count
    if (char.controlledBy === 'general' && charDef.mind !== null) {
      generalInfluenceUsed += charDef.mind;
    }

    // Character MPs
    mp = addMP(mp, charDef);

    // Item MPs
    for (const item of char.items) {
      const itemDef = resolveDef(state, item.instanceId);
      if (itemDef) mp = addMP(mp, itemDef);
    }

    // Ally MPs
    for (const ally of char.allies) {
      const allyDef = resolveDef(state, ally.instanceId);
      if (allyDef) mp = addMP(mp, allyDef);
    }

    // Effective stats
    const newStats = computeEffectiveStats(state, char, charDef);
    if (statsEqual(char.effectiveStats, newStats)) {
      newCharacters[key] = char;
    } else {
      newCharacters[key] = { ...char, effectiveStats: newStats };
      charactersChanged = true;
    }
  }

  // Skip update if nothing changed
  if (
    !charactersChanged &&
    player.generalInfluenceUsed === generalInfluenceUsed &&
    player.marshallingPoints === mp
  ) {
    return player;
  }

  return {
    ...player,
    characters: charactersChanged ? newCharacters : player.characters,
    generalInfluenceUsed,
    marshallingPoints: mp,
  };
}

/**
 * Recomputes all derived values for both players in the game state.
 *
 * Should be called after every successful reducer step. Returns the
 * original state object unchanged if no derived values differ (avoids
 * unnecessary object allocation).
 */
export function recomputeDerived(state: GameState): GameState {
  const p0 = recomputePlayer(state, state.players[0]);
  const p1 = recomputePlayer(state, state.players[1]);

  // Avoid new object if nothing changed
  if (p0 === state.players[0] && p1 === state.players[1]) {
    return state;
  }

  return {
    ...state,
    players: [p0, p1],
  };
}
