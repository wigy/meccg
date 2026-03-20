/**
 * @module recompute-derived
 *
 * Recomputes derived player values from the authoritative game state after
 * every action. Instead of incrementally tracking values like marshalling
 * points and general influence in each reducer handler, this module
 * recalculates them from the ground truth (characters in play, items, etc.).
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
} from '@meccg/shared';
import { MarshallingCategory, ZERO_MARSHALLING_POINTS } from '@meccg/shared';

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
 * Recomputes all derived values for a single player from their in-play state.
 *
 * Currently recomputes:
 * - {@link PlayerState.generalInfluenceUsed} — sum of mind values of all
 *   characters controlled under general influence.
 * - {@link PlayerState.marshallingPoints} — per-category MP totals from
 *   characters, items, allies, and other in-play scoring cards.
 */
/**
 * Computes effective stats for a character from base card definition
 * plus modifiers from equipped items and attached corruption cards.
 */
function computeEffectiveStats(
  state: GameState,
  char: CharacterInPlay,
  charDef: { prowess: number; body: number; directInfluence: number },
): EffectiveStats {
  let prowess = charDef.prowess;
  let body = charDef.body;
  const directInfluence = charDef.directInfluence;
  let corruptionPoints = 0;

  for (const itemId of char.items) {
    const itemDef = resolveDef(state, itemId);
    if (itemDef && itemDef.cardType === 'hero-resource-item') {
      prowess += itemDef.prowessModifier;
      body += itemDef.bodyModifier;
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
    for (const itemId of char.items) {
      const itemDef = resolveDef(state, itemId);
      if (itemDef) mp = addMP(mp, itemDef);
    }

    // Ally MPs
    for (const allyId of char.allies) {
      const allyDef = resolveDef(state, allyId);
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
