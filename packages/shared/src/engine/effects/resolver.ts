/**
 * @module resolver
 *
 * The card effects resolver — the central engine that evaluates all card
 * effects in context to produce final computed values.
 *
 * At each decision point (stat computation, check rolls, combat, etc.),
 * the game engine builds a {@link ResolverContext} describing the situation,
 * then calls resolver functions to:
 * 1. Collect all effects from all cards in play
 * 2. Filter by `when` conditions
 * 3. Resolve `overrides` chains
 * 4. Evaluate value expressions
 * 5. Apply modifiers and caps
 *
 * This keeps card-specific logic in JSON data rather than scattered across
 * phase handlers. The engine only needs to know the 12 effect type primitives.
 */

import type {
  GameState,
  PlayerState,
  CharacterInPlay,
  CardDefinition,
  CardEffect,
  StatModifierEffect,
  CardInstanceId,
  SiteCard,
} from '../../index.js';
import { matchesCondition, HAND_SIZE, isCharacterCard } from '../../index.js';
import { resolveInstanceId } from '../../types/state.js';
import { evaluateExpr } from './expression-eval.js';
import { pickActiveItemsForCharacter } from '../item-slots.js';

/**
 * Context object passed to conditions and expressions when resolving effects.
 *
 * The resolver populates this with all information relevant to the current
 * calculation. Not all fields are present in every context — e.g. `enemy`
 * is only set during combat resolution.
 */
export interface ResolverContext {
  /** What is being calculated (e.g. "effective-stats", "combat", "faction-influence-check"). */
  readonly reason: string;
  /** The character whose stats are being computed or who is acting. */
  readonly bearer?: {
    readonly race: string;
    readonly skills: readonly string[];
    readonly baseProwess: number;
    readonly baseBody: number;
    readonly baseDirectInfluence: number;
    readonly name: string;
  };
  /** The enemy creature/hazard (in combat contexts). */
  readonly enemy?: {
    readonly race: string;
    readonly name: string;
    readonly prowess: number;
    readonly body: number | null;
  };
  /** The faction being influenced (in faction influence check contexts). */
  readonly faction?: {
    readonly name: string;
    readonly race: string;
    /**
     * Names of sites (and/or site types) at which the faction is playable,
     * flattened from the faction card's `playableAt` entries. Used by DSL
     * conditions like `{ "faction.playableAt": "Variag Camp" }` to target
     * bonuses at factions tied to a specific site (e.g. AS-4 Perchen
     * grants +3 DI against any faction playable at Dunnish Clan-hold).
     */
    readonly playableAt: readonly string[];
  };
  /** The target of an influence check (character being controlled). */
  readonly target?: {
    readonly name: string;
    readonly race: string;
  };
  /** Additional context properties for extensibility. */
  readonly [key: string]: unknown;
}

/**
 * A collected effect paired with its source card definition and instance,
 * so we know where it came from. The instance ID is needed to disambiguate
 * multiple copies of the same card in play (e.g. two Eye of Sauron each
 * stack their +1 prowess to automatic-attacks).
 */
export interface CollectedEffect {
  readonly effect: CardEffect;
  readonly sourceDef: CardDefinition;
  readonly sourceInstance: CardInstanceId;
}

/**
 * Resolves a card definition from an instance ID by looking up the instance
 * map and then the card pool. Returns undefined if the instance is missing.
 */
export function resolveDef(state: GameState, instanceId: CardInstanceId): CardDefinition | undefined {
  const defId = resolveInstanceId(state, instanceId);
  if (!defId) return undefined;
  return state.cardPool[defId as string];
}

/**
 * Collects effects from a single card definition, filtering by conditions.
 */
function collectFromDef(
  def: CardDefinition,
  instanceId: CardInstanceId,
  context: ResolverContext,
  results: CollectedEffect[],
): void {
  if (!('effects' in def) || !def.effects) return;
  for (const effect of def.effects) {
    if (effect.when && !matchesCondition(effect.when, context as unknown as Record<string, unknown>)) {
      continue;
    }
    results.push({ effect, sourceDef: def, sourceInstance: instanceId });
  }
}

/**
 * Collects all matching effects from all cards a player has in play.
 *
 * Walks through all characters, their items, allies, corruption cards,
 * and any events in play, gathering effects whose `when` conditions
 * match the given context.
 */
export function collectEffects(
  state: GameState,
  player: PlayerState,
  context: ResolverContext,
): CollectedEffect[] {
  const results: CollectedEffect[] = [];

  for (const char of Object.values(player.characters)) {
    // Character's own effects
    const charDef = resolveDef(state, char.instanceId);
    if (charDef) collectFromDef(charDef, char.instanceId, context, results);

    // Item effects
    for (const item of char.items) {
      const itemDef = resolveDef(state, item.instanceId);
      if (itemDef) collectFromDef(itemDef, item.instanceId, context, results);
    }

    // Ally effects
    for (const ally of char.allies) {
      const allyDef = resolveDef(state, ally.instanceId);
      if (allyDef) collectFromDef(allyDef, ally.instanceId, context, results);
    }

    // Hazard card effects (corruption cards, Foolish Words, etc.)
    for (const hazard of char.hazards) {
      const hDef = resolveDef(state, hazard.instanceId);
      if (hDef) collectFromDef(hDef, hazard.instanceId, context, results);
    }
  }

  // Cards in play (permanent events, long-events, factions, etc.)
  for (const card of player.cardsInPlay) {
    const cardDef = resolveDef(state, card.instanceId);
    if (cardDef) collectFromDef(cardDef, card.instanceId, context, results);
  }

  return results;
}

/**
 * Collects global effects from all events and cards in play across both players.
 *
 * Walks through each player's `cardsInPlay`, gathering
 * effects whose `when` conditions match the given context. Only effects with a
 * matching `target` scope are included (e.g. `"all-characters"` for character
 * stat computation, `"all-attacks"` for attack prowess).
 *
 * @param state - The full game state.
 * @param targetScope - The target scope to filter for (e.g. "all-characters").
 * @param context - The resolver context for condition evaluation.
 */
export function collectGlobalEffects(
  state: GameState,
  targetScope: string,
  context: ResolverContext,
): CollectedEffect[] {
  const results: CollectedEffect[] = [];

  // Both players' cards in play (events, factions, permanent resources, etc.)
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = resolveDef(state, card.instanceId);
      if (!def || !('effects' in def) || !def.effects) continue;
      for (const effect of def.effects) {
        if (!('target' in effect) || (effect as { target?: string }).target !== targetScope) continue;
        if (effect.when && !matchesCondition(effect.when, context as unknown as Record<string, unknown>)) {
          continue;
        }
        results.push({ effect, sourceDef: def, sourceInstance: card.instanceId });
      }
    }
  }

  return results;
}

/**
 * Collects effects only from a specific character and their equipment.
 *
 * Used when computing effective stats for a single character — we only
 * want effects from that character's own card and their items, not from
 * all cards in play. (Global effects like events are handled separately.)
 */
export function collectCharacterEffects(
  state: GameState,
  char: CharacterInPlay,
  context: ResolverContext,
): CollectedEffect[] {
  const results: CollectedEffect[] = [];

  // Character's own effects
  const charDef = resolveDef(state, char.instanceId);
  if (charDef) collectFromDef(charDef, char.instanceId, context, results);

  // Item effects — rule 9.15: for slotted items (helmet, etc.), only the
  // first item per slot is "in use" and contributes effects.
  const active = pickActiveItemsForCharacter(state, char);
  for (const item of char.items) {
    if (!active.has(item.instanceId as string)) continue;
    const itemDef = resolveDef(state, item.instanceId);
    if (itemDef) collectFromDef(itemDef, item.instanceId, context, results);
  }

  // Hazard card effects
  for (const hazard of char.hazards) {
    const hDef = resolveDef(state, hazard.instanceId);
    if (hDef) collectFromDef(hDef, hazard.instanceId, context, results);
  }

  return results;
}

/**
 * Resolves stat modifiers from collected effects, handling the override
 * mechanism and applying value caps.
 *
 * The override mechanism works as follows:
 * - Effects with an `id` field are "base" effects that can be overridden.
 * - Effects with an `overrides` field replace the named base effect.
 * - The id/overrides namespace is **scoped per source card instance**, so
 *   two copies of the same card in play each contribute their own modifier
 *   (e.g. two Eye of Sauron each give +1 prowess), and a card's `overrides`
 *   only replaces the matching base effect on that same card instance.
 * - If multiple overrides target the same base on one instance, the last wins.
 * - Non-override effects are always applied.
 *
 * @param effects - All collected effects (pre-filtered by condition).
 * @param stat - Which stat to resolve (e.g. "prowess", "body").
 * @param baseValue - The character's base stat value (from card definition).
 * @param context - The resolver context for expression evaluation.
 * @returns The final stat value after all modifiers and caps.
 */
export function resolveStatModifiers(
  effects: readonly CollectedEffect[],
  stat: string,
  baseValue: number,
  context: ResolverContext,
): number {
  const statEffects = effects
    .filter((e): e is CollectedEffect & { effect: StatModifierEffect } =>
      e.effect.type === 'stat-modifier' && e.effect.stat === stat,
    );

  // Separate base effects (with id) and overrides. Both are keyed per
  // source card instance so duplicates of the same card each stack their
  // own modifier and overrides only affect the matching base on the same
  // instance.
  const baseEffects = new Map<string, StatModifierEffect>();
  const overrides = new Map<string, StatModifierEffect>();
  const unconditional: StatModifierEffect[] = [];

  for (const { effect, sourceInstance } of statEffects) {
    if (effect.id) {
      baseEffects.set(`${sourceInstance}::${effect.id}`, effect);
    }
    if (effect.overrides) {
      overrides.set(`${sourceInstance}::${effect.overrides}`, effect);
    }
    if (!effect.id && !effect.overrides) {
      unconditional.push(effect);
    }
  }

  // Resolve which effects actually apply: overrides replace base effects
  // (within the same source card instance).
  const activeEffects: StatModifierEffect[] = [...unconditional];
  for (const [key, base] of baseEffects) {
    const override = overrides.get(key);
    activeEffects.push(override ?? base);
  }

  // Apply modifiers
  const exprContext = context as unknown as Record<string, unknown>;
  let result = baseValue;
  for (const effect of activeEffects) {
    const value = evaluateExpr(effect.value, exprContext);
    result += value;
    if (effect.max !== undefined) {
      const maxVal = evaluateExpr(effect.max, exprContext);
      result = Math.min(result, maxVal);
    }
  }

  return result;
}

/**
 * Resolves check modifiers — sums all matching check-modifier effects
 * for a given check type.
 *
 * @param effects - All collected effects (pre-filtered by condition).
 * @param check - Which check type (e.g. "corruption", "faction-influence").
 * @returns The total modifier to add to the check roll.
 */
export function resolveCheckModifier(
  effects: readonly CollectedEffect[],
  check: string,
  context?: Record<string, unknown>,
): number {
  let total = 0;
  for (const { effect } of effects) {
    if (effect.type !== 'check-modifier') continue;
    // The `check` field is either a single kind string or an array of
    // kind strings (METD §1.2 — one effect can target multiple check
    // kinds, e.g. Foolish Words covers influence/riddling/offering).
    const matches = Array.isArray(effect.check)
      ? (effect.check as readonly string[]).includes(check)
      : effect.check === check;
    if (!matches) continue;
    if (typeof effect.value === 'number') {
      total += effect.value;
    } else if (typeof effect.value === 'string' && context) {
      total += evaluateExpr(effect.value, context);
    }
  }
  return total;
}

/**
 * Resolves company-wide modifiers for a given stat.
 *
 * @param effects - All collected effects (pre-filtered by condition).
 * @param stat - Which stat to check for company-wide modifiers.
 * @returns The total company modifier value.
 */
export function resolveCompanyModifier(
  effects: readonly CollectedEffect[],
  stat: string,
): number {
  let total = 0;
  for (const { effect } of effects) {
    if (effect.type === 'company-modifier' && effect.stat === stat) {
      total += typeof effect.value === 'number'
        ? effect.value
        : 0;
    }
  }
  return total;
}

/**
 * Resolves draw-modifier effects for a given draw pool (hazard or resource).
 *
 * Collects all `draw-modifier` effects matching the pool and sums their
 * values. Returns the total adjustment and the strictest minimum floor.
 *
 * @param effects - All collected effects (pre-filtered by condition).
 * @param draw - Which draw pool to resolve (`"hazard"` or `"resource"`).
 * @returns An object with the total adjustment and the effective minimum.
 */
export function resolveDrawModifier(
  effects: readonly CollectedEffect[],
  draw: 'hazard' | 'resource',
): { adjustment: number; min: number } {
  let adjustment = 0;
  let min = 0;
  for (const { effect } of effects) {
    if (effect.type === 'draw-modifier' && effect.draw === draw) {
      adjustment += effect.value;
      if (effect.min !== undefined && effect.min > min) {
        min = effect.min;
      }
    }
  }
  return { adjustment, min };
}

/**
 * Maps site automatic attack `creatureType` values (e.g. "Wolves", "Orcs")
 * to the lowercase singular race identifiers used in creature card data
 * and DSL conditions (e.g. "wolf", "orc").
 */
const CREATURE_TYPE_TO_RACE: Record<string, string> = {
  wolves: 'wolf',
  orcs: 'orc',
  trolls: 'troll',
  undead: 'undead',
  men: 'man',
  animals: 'animal',
  spiders: 'spider',
  dragon: 'dragon',
  dragons: 'dragon',
  hobbits: 'hobbit',
  'dúnedain': 'dunadan',
  elves: 'elf',
  'pûkel-creature': 'pukel-creature',
};

/**
 * Normalizes a site automatic attack's `creatureType` (e.g. "Wolves") to the
 * lowercase singular race identifier used in creature card data and DSL
 * conditions (e.g. "wolf").
 *
 * Creature cards already use the normalized form in their `race` field, so
 * this is only needed for automatic attacks.
 */
export function normalizeCreatureRace(creatureType: string): string {
  return CREATURE_TYPE_TO_RACE[creatureType.toLowerCase()] ?? creatureType.toLowerCase();
}

/**
 * Options for creature self-effect resolution during attack prowess/strikes
 * computation. When provided, the creature's own stat-modifier effects are
 * included alongside global all-attacks effects.
 */
export interface CreatureSelfContext {
  /** The creature card's effects array. */
  readonly effects: readonly CardEffect[];
  /** Creature races the defending company has already faced this turn. */
  readonly companyFacedRaces: readonly string[];
  /**
   * Alignment of the defending player (e.g. "hero", "ringwraith"). Exposed
   * as `defender.alignment` in the self-effect context so conditions can
   * key on the attacked company's alignment — used by cards like
   * *Elf-lord Revealed in Wrath* ("+4 prowess versus Ringwraiths").
   */
  readonly defenderAlignment?: string;
}

/**
 * Builds the resolver context used for attack stat resolution.
 *
 * Includes `reason: 'combat'`, `inPlay` (names of events/cards in play),
 * and optionally `enemy.race` when the creature's race is known.
 * When `companyFacedRaces` is provided, populates `company.facedRaces`
 * so creature self-effects can condition on prior attacks.
 *
 * @param inPlayNames - Names of all cards currently in play.
 * @param creatureRace - The lowercase singular race of the attacking creature (e.g. "wolf", "orc").
 * @param companyFacedRaces - Creature races the defending company has already faced.
 */
function buildAttackContext(
  inPlayNames: readonly string[],
  creatureRace?: string,
  companyFacedRaces?: readonly string[],
  defenderAlignment?: string,
): ResolverContext {
  const context: ResolverContext = {
    reason: 'combat',
    inPlay: inPlayNames,
  };
  const withCompany = companyFacedRaces
    ? { ...context, company: { facedRaces: companyFacedRaces } }
    : context;
  const withDefender = defenderAlignment
    ? { ...withCompany, defender: { alignment: defenderAlignment } }
    : withCompany;
  if (creatureRace) {
    return { ...withDefender, enemy: { race: creatureRace, name: '', prowess: 0, body: null } };
  }
  return withDefender;
}

/**
 * Resolves attack prowess by applying global attack effects.
 *
 * Collects effects with `target: "all-attacks"` (which apply to both automatic
 * attacks and hazard creatures) from events and cards in play. When
 * `isAutomaticAttack` is true, also collects `target: "all-automatic-attacks"`
 * effects that only apply to site automatic-attacks.
 *
 * When `creatureSelf` is provided, the creature's own `stat-modifier` effects
 * (without a target scope) are also included, enabling creatures like
 * Orc-lieutenant to boost their own prowess conditionally.
 *
 * @param state - The full game state.
 * @param baseProwess - The creature's or automatic attack's base prowess.
 * @param inPlayNames - Names of all cards currently in play (for `inPlay` conditions).
 * @param creatureRace - The lowercase singular race of the attacking creature (e.g. "wolf", "orc").
 * @param isAutomaticAttack - Whether this is a site automatic-attack (not a hazard creature).
 * @param creatureSelf - Creature self-effects and company context for self-modifiers.
 * @returns The modified prowess value after applying attack effects.
 */
export function resolveAttackProwess(
  state: GameState,
  baseProwess: number,
  inPlayNames: readonly string[],
  creatureRace?: string,
  isAutomaticAttack = false,
  creatureSelf?: CreatureSelfContext,
): number {
  const context = buildAttackContext(inPlayNames, creatureRace, creatureSelf?.companyFacedRaces, creatureSelf?.defenderAlignment);
  const globalEffects = collectGlobalEffects(state, 'all-attacks', context);
  if (isAutomaticAttack) {
    globalEffects.push(...collectGlobalEffects(state, 'all-automatic-attacks', context));
  }
  if (creatureSelf) {
    for (const effect of creatureSelf.effects) {
      if (effect.type !== 'stat-modifier') continue;
      if ('target' in effect && (effect as { target?: string }).target) continue;
      if (effect.when && !matchesCondition(effect.when, context as unknown as Record<string, unknown>)) {
        continue;
      }
      globalEffects.push({ effect, sourceDef: {} as CardDefinition, sourceInstance: '' as CardInstanceId });
    }
  }
  return resolveStatModifiers(globalEffects, 'prowess', baseProwess, context);
}

/**
 * Resolves attack strikes by applying global `all-attacks` effects.
 *
 * Collects all effects with `target: "all-attacks"` from events and cards
 * in play, evaluates conditions against the context (including `enemy.race`
 * for creature-type filtering), and sums strikes modifiers.
 *
 * @param state - The full game state.
 * @param baseStrikes - The creature's or automatic attack's base number of strikes.
 * @param inPlayNames - Names of all cards currently in play (for `inPlay` conditions).
 * @param creatureRace - The lowercase singular race of the attacking creature (e.g. "wolf", "orc").
 * @returns The modified strikes value after applying all-attacks effects.
 */
export function resolveAttackStrikes(
  state: GameState,
  baseStrikes: number,
  inPlayNames: readonly string[],
  creatureRace?: string,
): number {
  const context = buildAttackContext(inPlayNames, creatureRace);
  const globalEffects = collectGlobalEffects(state, 'all-attacks', context);
  return resolveStatModifiers(globalEffects, 'strikes', baseStrikes, context);
}

/**
 * Builds a {@link ResolverContext} for resolving character combat effects.
 *
 * Used during strike resolution to re-resolve character prowess with
 * enemy information, enabling conditional bonuses like Éowyn's +6 vs Nazgûl.
 */
function buildCombatContext(
  char: { race: string; skills: readonly string[]; baseProwess: number; baseBody: number; baseDirectInfluence: number; name: string },
  enemy: { race: string; name: string; prowess: number; body: number | null },
  inPlayNames: readonly string[],
): ResolverContext {
  return {
    reason: 'combat',
    bearer: char,
    enemy,
    inPlay: inPlayNames,
  };
}

/**
 * Resolves a character's combat prowess bonus from conditional effects.
 *
 * During strike resolution, character prowess starts from `effectiveStats.prowess`
 * (computed without combat context). This function collects effects from the
 * character and their items that have `when: { reason: "combat", ... }` conditions
 * and returns the additional prowess bonus (which may be 0 if no combat-specific
 * effects match).
 *
 * @param state - The full game state.
 * @param char - The character in play.
 * @param enemy - The enemy creature info (race, prowess, body).
 * @param inPlayNames - Names of all cards currently in play.
 * @returns The additional prowess bonus from combat-specific effects.
 */
export function resolveCombatProwessBonus(
  state: GameState,
  char: CharacterInPlay,
  enemy: { race: string; name: string; prowess: number; body: number | null },
  inPlayNames: readonly string[],
): number {
  const charDef = resolveDef(state, char.instanceId);
  if (!charDef || !('prowess' in charDef)) return 0;

  const cd = charDef as { race: string; skills: readonly string[]; prowess: number; body: number; directInfluence: number; name: string };
  const charInfo = {
    race: cd.race,
    skills: cd.skills,
    baseProwess: cd.prowess,
    baseBody: cd.body,
    baseDirectInfluence: cd.directInfluence,
    name: cd.name,
  };

  // Resolve prowess with combat context (includes enemy info)
  const combatContext = buildCombatContext(charInfo, enemy, inPlayNames);
  const combatEffects = collectCharacterEffects(state, char, combatContext);

  // Resolve prowess with effective-stats context (no enemy info) — the baseline
  const baseContext: ResolverContext = {
    reason: 'effective-stats',
    bearer: charInfo,
    target: charInfo,
    inPlay: inPlayNames,
  };
  const baseEffects = collectCharacterEffects(state, char, baseContext);

  const combatProwess = resolveStatModifiers(combatEffects, 'prowess', cd.prowess, combatContext);
  const baseProwess = resolveStatModifiers(baseEffects, 'prowess', cd.prowess, baseContext);

  return combatProwess - baseProwess;
}

/**
 * Resolves enemy body modifications from character effects.
 *
 * Collects `enemy-modifier` effects from a character and their items
 * that match the combat context, and applies them to the enemy's body value.
 * Currently supports the `halve-round-up` operation.
 *
 * @param state - The full game state.
 * @param char - The character fighting the enemy.
 * @param enemy - The enemy creature info.
 * @param baseBody - The enemy's base body value.
 * @param inPlayNames - Names of all cards currently in play.
 * @returns The modified enemy body value.
 */
export function resolveEnemyBody(
  state: GameState,
  char: CharacterInPlay,
  enemy: { race: string; name: string; prowess: number; body: number | null },
  baseBody: number,
  inPlayNames: readonly string[],
): number {
  const charDef = resolveDef(state, char.instanceId);
  if (!charDef || !('prowess' in charDef)) return baseBody;

  const cd = charDef as { race: string; skills: readonly string[]; prowess: number; body: number; directInfluence: number; name: string };
  const charInfo = {
    race: cd.race,
    skills: cd.skills,
    baseProwess: cd.prowess,
    baseBody: cd.body,
    baseDirectInfluence: cd.directInfluence,
    name: cd.name,
  };

  const context = buildCombatContext(charInfo, enemy, inPlayNames);
  const effects = collectCharacterEffects(state, char, context);

  let body = baseBody;
  for (const { effect } of effects) {
    if (effect.type === 'enemy-modifier' && effect.stat === 'body') {
      if (effect.op === 'halve-round-up') {
        body = Math.ceil(body / 2);
      }
    }
  }
  return body;
}

/**
 * Resolves the effective hand size for a player by evaluating
 * `hand-size-modifier` effects from all characters in play.
 *
 * Each character's effects are evaluated in a context where `self.location`
 * is the name of the character's current site. This supports conditions
 * like Elrond's "+1 hand size when at Rivendell".
 *
 * @param state - The full game state.
 * @param playerIndex - Which player (0 or 1) to compute for.
 * @returns The effective hand size (base + all matching modifiers).
 */
export function resolveHandSize(state: GameState, playerIndex: number): number {
  const player = state.players[playerIndex];
  let total = HAND_SIZE;

  for (const company of player.companies) {
    // Determine the site name for this company
    let siteName: string | undefined;
    if (company.currentSite) {
      const siteDef = state.cardPool[company.currentSite.definitionId as string];
      if (siteDef && 'name' in siteDef) {
        siteName = (siteDef as SiteCard).name;
      }
    }

    for (const charInstanceId of company.characters) {
      const char = player.characters[charInstanceId as string];
      if (!char) continue;

      const charDef = resolveDef(state, char.instanceId);
      if (!charDef || !isCharacterCard(charDef)) continue;

      // Build context with self.location for condition matching
      const context: ResolverContext = {
        reason: 'hand-size',
        self: { location: siteName },
        bearer: {
          race: charDef.race,
          skills: charDef.skills,
          baseProwess: charDef.prowess,
          baseBody: charDef.body,
          baseDirectInfluence: charDef.directInfluence,
          name: charDef.name,
        },
      };

      // Collect effects from this character and their items
      const collected = collectCharacterEffects(state, char, context);

      // Sum hand-size-modifier values
      for (const { effect } of collected) {
        if (effect.type === 'hand-size-modifier') {
          total += typeof effect.value === 'number' ? effect.value : 0;
        }
      }
    }
  }

  return total;
}
