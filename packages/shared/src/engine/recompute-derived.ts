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
  CharacterCard,
  CardEffect,
} from '../index.js';
import { MarshallingCategory, ZERO_MARSHALLING_POINTS, isCharacterCard, isItemCard } from '../index.js';
import {
  collectCharacterEffects,
  collectGlobalEffects,
  resolveStatModifiers,
  resolveDef,
} from './effects/index.js';
import type { ResolverContext } from './effects/index.js';

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
 * Builds the list of card names currently in play as events or other cards.
 * Used to populate the `inPlay` context field so DSL conditions
 * like `{ "inPlay": "Gates of Morning" }` can be evaluated.
 */
export function buildInPlayNames(state: GameState): readonly string[] {
  const names: string[] = [];
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = resolveDef(state, card.instanceId);
      if (def && 'name' in def) names.push((def as { name: string }).name);
    }
  }
  return names;
}

/**
 * Builds a {@link ResolverContext} for computing a character's effective stats.
 *
 * Includes `bearer` (the character), `target` (same character, for global
 * effects that filter by `target.race` etc.), and `inPlay` (names of all
 * events/cards in play for condition checking).
 */
function buildEffectiveStatsContext(
  charDef: CharacterCard,
  inPlayNames: readonly string[],
): ResolverContext {
  const charInfo = {
    race: charDef.race,
    skills: charDef.skills,
    baseProwess: charDef.prowess,
    baseBody: charDef.body,
    baseDirectInfluence: charDef.directInfluence,
    name: charDef.name,
  };
  return {
    reason: 'effective-stats',
    bearer: charInfo,
    target: charInfo,
    inPlay: inPlayNames,
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
  charDef: CharacterCard,
  inPlayNames: readonly string[],
): EffectiveStats {
  const context = buildEffectiveStatsContext(charDef, inPlayNames);
  const charEffects = collectCharacterEffects(state, char, context);
  const globalEffects = collectGlobalEffects(state, 'all-characters', context);
  const collected = [...charEffects, ...globalEffects];

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
    if (isItemCard(itemDef)) {
      if (!hasAnyEffects) {
        prowess += itemDef.prowessModifier;
        body += itemDef.bodyModifier;
      }
      corruptionPoints += itemDef.corruptionPoints;
    }
  }

  for (const hazard of char.hazards) {
    const hDef = resolveDef(state, hazard.instanceId);
    if (hDef && hDef.cardType === 'hazard-corruption') {
      corruptionPoints += hDef.corruptionPoints;
    }
  }

  return { prowess, body, directInfluence, corruptionPoints };
}

/** Returns true if two EffectiveStats are identical. */
function statsEqual(a: EffectiveStats, b: EffectiveStats): boolean {
  return a.prowess === b.prowess && a.body === b.body &&
    a.directInfluence === b.directInfluence && a.corruptionPoints === b.corruptionPoints;
}

function recomputePlayer(state: GameState, player: PlayerState, inPlayNames: readonly string[]): PlayerState {
  let generalInfluenceUsed = 0;
  let mp = ZERO_MARSHALLING_POINTS;
  let charactersChanged = false;
  const newCharacters: Record<string, CharacterInPlay> = {};

  for (const [key, char] of Object.entries(player.characters)) {
    const charDef = resolveDef(state, char.instanceId);
    if (!isCharacterCard(charDef)) {
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
    const newStats = computeEffectiveStats(state, char, charDef, inPlayNames);
    if (statsEqual(char.effectiveStats, newStats)) {
      newCharacters[key] = char;
    } else {
      newCharacters[key] = { ...char, effectiveStats: newStats };
      charactersChanged = true;
    }
  }

  // Stored items: items moved to storedItems pile via store-item
  for (const card of player.storedItems) {
    const def = resolveDef(state, card.instanceId);
    if (def) {
      const effects = (def as { effects?: readonly CardEffect[] }).effects;
      const storableEffect = effects?.find(e => e.type === 'storable-at') as
        | { type: 'storable-at'; marshallingPoints?: number }
        | undefined;
      if (storableEffect?.marshallingPoints !== undefined) {
        const cat = ('marshallingCategory' in def)
          ? (def as { marshallingCategory: MarshallingCategory }).marshallingCategory
          : 'item' as MarshallingCategory;
        mp = { ...mp, [cat]: mp[cat] + storableEffect.marshallingPoints };
      } else {
        mp = addMP(mp, def);
      }
    }
  }

  // Cards in play: factions, permanent events, etc.
  for (const card of player.cardsInPlay) {
    const def = resolveDef(state, card.instanceId);
    if (def) mp = addMP(mp, def);
  }

  // Kill pile: defeated creatures earn kill MP
  for (const card of player.killPile) {
    const def = resolveDef(state, card.instanceId);
    if (def && 'killMarshallingPoints' in def) {
      const killMP = (def as { killMarshallingPoints: number }).killMarshallingPoints;
      if (killMP !== 0) {
        mp = { ...mp, kill: mp.kill + killMP };
      }
    }
  }

  // Eliminated pile: apply mp-modifier effects with reason "elimination"
  for (const card of player.eliminatedPile) {
    const def = resolveDef(state, card.instanceId);
    if (def && 'effects' in def) {
      const effects = (def as { effects?: readonly CardEffect[] }).effects;
      if (effects) {
        for (const effect of effects) {
          if (effect.type === 'mp-modifier' && typeof effect.value === 'number'
            && effect.when && 'reason' in effect.when && effect.when.reason === 'elimination') {
            const cat = 'marshallingCategory' in def
              ? (def as { marshallingCategory: MarshallingCategory }).marshallingCategory
              : 'character' as MarshallingCategory;
            mp = { ...mp, [cat]: mp[cat] + effect.value };
          }
        }
      }
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
  const inPlayNames = buildInPlayNames(state);
  const p0 = recomputePlayer(state, state.players[0], inPlayNames);
  const p1 = recomputePlayer(state, state.players[1], inPlayNames);

  // Avoid new object if nothing changed
  if (p0 === state.players[0] && p1 === state.players[1]) {
    return state;
  }

  return {
    ...state,
    players: [p0, p1],
  };
}

/**
 * Recomputes a character's effective prowess in combat context.
 *
 * During normal stat computation (`reason: 'effective-stats'`), combat-conditional
 * effects like Glamdring's "max 9 against Orcs" are not evaluated because there is
 * no enemy context. This function re-resolves prowess with `reason: 'combat'` and
 * the attacking creature's race, so conditional weapon bonuses apply correctly.
 *
 * @param state - The current game state (with combat active).
 * @param char - The character in play whose prowess to compute.
 * @param charDef - The character's card definition.
 * @param creatureRace - The lowercase race of the attacking creature (e.g. "orc").
 * @returns The character's prowess value including combat-conditional effects.
 */
export function computeCombatProwess(
  state: GameState,
  char: CharacterInPlay,
  charDef: CharacterCard,
  creatureRace: string,
): number {
  const inPlayNames = buildInPlayNames(state);
  const charInfo = {
    race: charDef.race,
    skills: charDef.skills,
    baseProwess: charDef.prowess,
    baseBody: charDef.body,
    baseDirectInfluence: charDef.directInfluence,
    name: charDef.name,
  };
  const context: ResolverContext = {
    reason: 'combat',
    bearer: charInfo,
    target: charInfo,
    inPlay: inPlayNames,
    enemy: { race: creatureRace, name: '', prowess: 0, body: null },
  };

  const charEffects = collectCharacterEffects(state, char, context);
  const globalEffects = collectGlobalEffects(state, 'all-characters', context);
  const collected = [...charEffects, ...globalEffects];

  if (collected.length > 0) {
    return resolveStatModifiers(collected, 'prowess', charDef.prowess, context);
  }
  return charDef.prowess;
}
