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
  FactionCard,
  Alignment,
} from '../index.js';
import { MarshallingCategory, ZERO_MARSHALLING_POINTS, isCharacterCard, isItemCard } from '../index.js';
import {
  buildBearerContext,
  collectCharacterEffects,
  collectGlobalEffects,
  resolveStatModifiers,
  resolveDef,
} from './effects/index.js';
import { matchesContext } from '../effects/condition-matcher.js';
import type { ResolverContext } from './effects/index.js';
import { playerById, findCharacterCompany } from './reducer-utils.js';
import { pickActiveItemsForCharacter } from './item-slots.js';
import { manifestIdOf } from './manifestations.js';
import { ownerOf } from '../types/state.js';

/**
 * Returns the MP multiplier for a cross-alignment item (MELE Part IV).
 *
 * A Ringwraith player's hero items and a Wizard player's minion items are
 * worth only half their normal marshalling points (rounded up). All other
 * combinations return 1.0 (full value).
 */
function crossAlignmentItemMpFactor(
  playerAlignment: Alignment,
  itemCardType: string,
): number {
  if (playerAlignment === 'ringwraith' && itemCardType === 'hero-resource-item') return 0.5;
  if (playerAlignment === 'wizard' && itemCardType === 'minion-resource-item') return 0.5;
  return 1.0;
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
 * Adds an item card's marshalling points to the running totals, applying the
 * cross-alignment half-MP rule (MELE Part IV) when the player's alignment
 * does not match the item's alignment.
 */
function addItemMP(
  totals: MarshallingPointTotals,
  def: CardDefinition,
  playerAlignment: Alignment,
): MarshallingPointTotals {
  if (!('marshallingPoints' in def) || !('marshallingCategory' in def)) return totals;
  const baseMp = (def as { marshallingPoints: number }).marshallingPoints;
  if (baseMp === 0) return totals;
  const cat = (def as { marshallingCategory: MarshallingCategory }).marshallingCategory;
  const factor = crossAlignmentItemMpFactor(playerAlignment, def.cardType);
  const mp = factor < 1 ? Math.ceil(baseMp * factor) : baseMp;
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
 * Builds the list of card names in play that belong to a specific
 * player. Used to populate the `controller.inPlay` resolver context so
 * DSL conditions can reference factions controlled by the influencing
 * player only (e.g. LE Standard Modifications like "Grey Mountain
 * Goblins (+2)", which apply only when the same player controls both
 * factions).
 */
export function buildControllerInPlayNames(
  state: GameState,
  playerId: import('../index.js').PlayerId,
): readonly string[] {
  const names: string[] = [];
  const player = playerById(state, playerId);
  if (!player) return names;
  for (const card of player.cardsInPlay) {
    const def = resolveDef(state, card.instanceId);
    if (def && 'name' in def) names.push((def as { name: string }).name);
  }
  return names;
}

/**
 * Flattens a faction's `playableAt` entries to a list of site names and
 * site types. Site entries contribute their `site` name; site-type
 * entries contribute their `siteType`. Conditions like
 * `{ "faction.playableAt": "Dunnish Clan-hold" }` (AS-4 Perchen) match
 * when the corresponding site name appears in this array.
 */
export function buildFactionPlayableAt(def: FactionCard): readonly string[] {
  return def.playableAt.map(entry => 'region' in entry ? `region:${entry.region}` : 'site' in entry ? entry.site : entry.siteType);
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
  const charInfo = buildBearerContext(charDef);
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
    // Company-scoped stat-modifiers (e.g. The One Ring +1 CP) are collected
    // via collectCompanyItemEffects inside collectCharacterEffects and flow
    // through here as normal stat-modifier entries.
    const cpFromEffects = resolveStatModifiers(collected, 'corruption-points', 0, context);
    corruptionPoints = cpFromEffects;
  } else {
    // Fallback: use the old hardcoded approach for cards without effects
    prowess = charDef.prowess;
    body = charDef.body;
    directInfluence = charDef.directInfluence;
  }

  // Per rule 9.15: prowess/body modifiers from items only apply while
  // the item is in use (one per slot). Corruption points come from
  // bearing the card and apply to every borne item regardless.
  //
  // The structural `prowessModifier` / `bodyModifier` fields are a
  // legacy way to declare what would otherwise be `stat-modifier` DSL
  // effects. Apply them only for items that haven't migrated to DSL
  // for those stats — checked per item, not per character. (The
  // character may have other DSL effects without preempting an item's
  // structural fallback; ditto for unrelated DSL effects on the item
  // itself, e.g. `item-play-site`.)
  const activeItems = pickActiveItemsForCharacter(state, char);
  for (const item of char.items) {
    const itemDef = resolveDef(state, item.instanceId);
    if (isItemCard(itemDef)) {
      const itemEffects = itemDef.effects ?? [];
      const itemHasStatMod = itemEffects.some(e => e.type === 'stat-modifier');
      if (!itemHasStatMod && activeItems.has(item.instanceId as string)) {
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

  // MELE §8.37: trophy bonus — sum total printed MPs on all trophy cards.
  // Trophies are creature cards stored by definitionId; look them up directly
  // in the card pool rather than via resolveDef (which requires an instance
  // lookup that may fail for synthetically-placed trophies in tests).
  if (char.trophies && char.trophies.length > 0) {
    let totalTrophyMp = 0;
    for (const trophy of char.trophies) {
      const trophyDef = state.cardPool[trophy.definitionId as string];
      if (trophyDef && 'killMarshallingPoints' in trophyDef) {
        totalTrophyMp += (trophyDef as { killMarshallingPoints: number }).killMarshallingPoints;
      }
    }
    if (totalTrophyMp >= 4) {
      directInfluence += 2;
      prowess = Math.min(prowess + 2, 9);
    } else if (totalTrophyMp === 3) {
      directInfluence += 2;
      prowess = Math.min(prowess + 1, 9);
    } else if (totalTrophyMp === 2) {
      directInfluence += 1;
      prowess = Math.min(prowess + 1, 9);
    } else if (totalTrophyMp === 1) {
      directInfluence += 1;
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
  let generalInfluenceBonus = 0;
  let mp = ZERO_MARSHALLING_POINTS;
  let charactersChanged = false;
  const newCharacters: Record<string, CharacterInPlay> = {};

  for (const [key, char] of Object.entries(player.characters)) {
    const charDef = resolveDef(state, char.instanceId);
    if (!isCharacterCard(charDef)) {
      newCharacters[key] = char;
      continue;
    }

    // Prisoners cost 0 GI and are worth negative MPs (CoE rule 8.35).
    const isPrisoner = state.activeConstraints.some(
      c => c.target.kind === 'character'
        && c.target.characterId === char.instanceId
        && c.kind.type === 'character-is-prisoner',
    );

    // General influence: prisoners cost 0 GI; others under GI count normally.
    // Effective mind is computed with company context so companion-based mind
    // reductions (e.g. troll trio: Wûluag's mind -1 when Bûrat/Tûma is present)
    // are reflected in the GI cost.
    if (!isPrisoner && char.controlledBy === 'general' && charDef.mind !== null) {
      // Build companion context for mind modifiers
      const charCompany = findCharacterCompany(player.companies, char.instanceId);
      const companionDefinitionIds = (charCompany?.characters ?? [])
        .filter(id => id !== char.instanceId)
        .map(id => {
          const compChar = player.characters[id as string];
          if (!compChar) return null;
          return compChar.definitionId as string;
        })
        .filter((id): id is string => id !== null);
      const mindContext: ResolverContext = {
        reason: 'effective-stats',
        bearer: {
          ...buildBearerContext(charDef),
          companionDefinitionIds,
        },
        inPlay: inPlayNames,
      };
      const mindEffects = collectCharacterEffects(state, char, mindContext);
      // Only compute effective mind if there are mind modifiers; otherwise use base
      const hasMindModifiers = mindEffects.some(
        e => e.effect.type === 'stat-modifier' && (e.effect as { stat?: string }).stat === 'mind',
      );
      const effectiveMind = hasMindModifiers
        ? resolveStatModifiers(mindEffects, 'mind', charDef.mind, mindContext)
        : charDef.mind;
      generalInfluenceUsed += Math.max(0, effectiveMind);
    }

    // Character MPs: prisoners contribute negative MPs
    if (isPrisoner) {
      const charMp = charDef.marshallingPoints ?? 0;
      const cat = (charDef.marshallingCategory ?? 'character') as import('../index.js').MarshallingCategory;
      mp = { ...mp, [cat]: mp[cat] - charMp };
    } else {
      mp = addMP(mp, charDef);
    }

    // Item MPs (cross-alignment items are worth half MP, rounded up — MELE Part IV)
    for (const item of char.items) {
      const itemDef = resolveDef(state, item.instanceId);
      if (!itemDef) continue;
      mp = addItemMP(mp, itemDef, player.alignment);
      // Apply bearer-conditional mp-modifier effects on items
      // (e.g. Durin's Axe: +2 MP if held by a Dwarf)
      const itemEffects = (itemDef as { effects?: readonly CardEffect[] }).effects;
      if (itemEffects) {
        const bearerCtx = { bearer: { race: charDef.race } };
        for (const effect of itemEffects) {
          if (effect.type !== 'mp-modifier' || typeof effect.value !== 'number' || !effect.when) continue;
          if (!matchesContext(effect.when, bearerCtx)) continue;
          const cat = 'marshallingCategory' in itemDef
            ? (itemDef as { marshallingCategory: MarshallingCategory }).marshallingCategory
            : 'item' as MarshallingCategory;
          mp = { ...mp, [cat]: mp[cat] + effect.value };
        }
      }
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

  // General-influence bonus: sum stat-modifier general-influence effects from character items.
  for (const char of Object.values(player.characters)) {
    for (const item of char.items) {
      const itemDef = resolveDef(state, item.instanceId);
      const effects = itemDef && 'effects' in itemDef
        ? (itemDef as { effects?: readonly CardEffect[] }).effects ?? []
        : [];
      for (const effect of effects) {
        if (effect.type === 'stat-modifier' && (effect as { stat?: string }).stat === 'general-influence') {
          const val = (effect as { value?: number }).value ?? 0;
          generalInfluenceBonus += typeof val === 'number' ? val : 0;
        }
      }
    }
  }

  // Cards in play: factions, permanent events, etc.
  for (const card of player.cardsInPlay) {
    const def = resolveDef(state, card.instanceId);
    if (def) mp = addMP(mp, def);
  }

  // Kill pile: defeated creatures earn kill MP — except, per METD §4.1,
  // a player who defeats a manifestation they themselves played awards
  // no MPs. Owner is derivable in O(1) from the instance ID prefix.
  for (const card of player.killPile) {
    const def = resolveDef(state, card.instanceId);
    if (!def || !('killMarshallingPoints' in def)) continue;
    const killMP = (def as { killMarshallingPoints: number }).killMarshallingPoints;
    if (killMP === 0) continue;
    const mid = manifestIdOf(def);
    if (mid && ownerOf(card.instanceId) === player.id) continue;
    mp = { ...mp, kill: mp.kill + killMP };
  }

  // Out-of-play pile: holds eliminated characters, items stored at sites,
  // and sites stored via stolen-knowledge.
  // - Items with a `storable-at` effect earn their override MP (or base MP).
  // - Sites with `stolen-knowledge` earn misc MPs as declared in the effect.
  // - Eliminated cards may carry `mp-modifier` effects with reason "elimination".
  for (const card of player.outOfPlayPile) {
    const def = resolveDef(state, card.instanceId);
    if (!def) continue;
    const effects = (def as { effects?: readonly CardEffect[] }).effects;

    // Stored items: storable-at effect grants MP (overriding base MP when set).
    const storableEffect = effects?.find(e => e.type === 'storable-at') as
      | { type: 'storable-at'; marshallingPoints?: number }
      | undefined;
    if (storableEffect) {
      if (storableEffect.marshallingPoints !== undefined) {
        // Stored items with an explicit storable-at MP override still apply the
        // cross-alignment half-MP rule (MELE Part IV): the override MP counts
        // at the declared value, not at the card's base MP, but is halved when
        // the player's alignment does not match the item's alignment.
        const factor = crossAlignmentItemMpFactor(player.alignment, def.cardType);
        const finalMp = factor < 1 ? Math.ceil(storableEffect.marshallingPoints * factor) : storableEffect.marshallingPoints;
        const cat = ('marshallingCategory' in def)
          ? (def as { marshallingCategory: MarshallingCategory }).marshallingCategory
          : 'item' as MarshallingCategory;
        mp = { ...mp, [cat]: mp[cat] + finalMp };
      } else {
        mp = addItemMP(mp, def, player.alignment);
      }
      continue;
    }

    // Sites stored via stolen-knowledge earn misc MPs.
    const stolenKnowledgeEffect = effects?.find(e => e.type === 'site-rule' && e.rule === 'stolen-knowledge') as
      | { type: 'site-rule'; rule: 'stolen-knowledge'; marshallingPoints: number }
      | undefined;
    if (stolenKnowledgeEffect) {
      mp = { ...mp, misc: mp.misc + stolenKnowledgeEffect.marshallingPoints };
      continue;
    }

    // Eliminated cards: mp-modifier effects with reason "elimination".
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

  // Skip update if nothing changed
  if (
    !charactersChanged &&
    player.generalInfluenceUsed === generalInfluenceUsed &&
    player.generalInfluenceBonus === generalInfluenceBonus &&
    player.marshallingPoints === mp
  ) {
    return player;
  }

  return {
    ...player,
    characters: charactersChanged ? newCharacters : player.characters,
    generalInfluenceUsed,
    generalInfluenceBonus,
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
  const charInfo = buildBearerContext(charDef);
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
