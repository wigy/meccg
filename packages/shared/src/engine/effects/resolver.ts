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
} from '../../index.js';
import { matchesCondition } from '../../index.js';
import { resolveInstanceId } from '../../types/state.js';
import { evaluateExpr } from './expression-eval.js';

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
 * A collected effect paired with its source card definition,
 * so we know where it came from.
 */
interface CollectedEffect {
  readonly effect: CardEffect;
  readonly sourceDef: CardDefinition;
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
  context: ResolverContext,
  results: CollectedEffect[],
): void {
  if (!('effects' in def) || !def.effects) return;
  for (const effect of def.effects) {
    if (effect.when && !matchesCondition(effect.when, context as unknown as Record<string, unknown>)) {
      continue;
    }
    results.push({ effect, sourceDef: def });
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
    if (charDef) collectFromDef(charDef, context, results);

    // Item effects
    for (const item of char.items) {
      const itemDef = resolveDef(state, item.instanceId);
      if (itemDef) collectFromDef(itemDef, context, results);
    }

    // Ally effects
    for (const ally of char.allies) {
      const allyDef = resolveDef(state, ally.instanceId);
      if (allyDef) collectFromDef(allyDef, context, results);
    }

    // Hazard card effects (corruption cards, Foolish Words, etc.)
    for (const hazard of char.hazards) {
      const hDef = resolveDef(state, hazard.instanceId);
      if (hDef) collectFromDef(hDef, context, results);
    }
  }

  // Cards in play (permanent events, long-events, factions, etc.)
  for (const card of player.cardsInPlay) {
    const cardDef = resolveDef(state, card.instanceId);
    if (cardDef) collectFromDef(cardDef, context, results);
  }

  return results;
}

/**
 * Collects global effects from all events and cards in play across both players.
 *
 * Walks through `state.eventsInPlay` and each player's `cardsInPlay`, gathering
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

  // Events in play (long-events, permanent events)
  for (const event of state.eventsInPlay) {
    const def = resolveDef(state, event.instanceId);
    if (!def || !('effects' in def) || !def.effects) continue;
    for (const effect of def.effects) {
      if (!('target' in effect) || (effect as { target?: string }).target !== targetScope) continue;
      if (effect.when && !matchesCondition(effect.when, context as unknown as Record<string, unknown>)) {
        continue;
      }
      results.push({ effect, sourceDef: def });
    }
  }

  // Both players' cards in play (factions, permanent resources, etc.)
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = resolveDef(state, card.instanceId);
      if (!def || !('effects' in def) || !def.effects) continue;
      for (const effect of def.effects) {
        if (!('target' in effect) || (effect as { target?: string }).target !== targetScope) continue;
        if (effect.when && !matchesCondition(effect.when, context as unknown as Record<string, unknown>)) {
          continue;
        }
        results.push({ effect, sourceDef: def });
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
  if (charDef) collectFromDef(charDef, context, results);

  // Item effects
  for (const item of char.items) {
    const itemDef = resolveDef(state, item.instanceId);
    if (itemDef) collectFromDef(itemDef, context, results);
  }

  // Hazard card effects
  for (const hazard of char.hazards) {
    const hDef = resolveDef(state, hazard.instanceId);
    if (hDef) collectFromDef(hDef, context, results);
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
 * - If multiple overrides target the same base, only the last one wins.
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
    .map(e => e.effect)
    .filter((e): e is StatModifierEffect => e.type === 'stat-modifier' && e.stat === stat);

  // Separate base effects (with id) and overrides
  const baseEffects = new Map<string, StatModifierEffect>();
  const overrides = new Map<string, StatModifierEffect>();
  const unconditional: StatModifierEffect[] = [];

  for (const effect of statEffects) {
    if (effect.id) {
      baseEffects.set(effect.id, effect);
    }
    if (effect.overrides) {
      overrides.set(effect.overrides, effect);
    }
    if (!effect.id && !effect.overrides) {
      unconditional.push(effect);
    }
  }

  // Resolve which effects actually apply: overrides replace base effects
  const activeEffects: StatModifierEffect[] = [...unconditional];
  for (const [id, base] of baseEffects) {
    const override = overrides.get(id);
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
): number {
  let total = 0;
  for (const { effect } of effects) {
    if (effect.type === 'check-modifier' && effect.check === check) {
      total += typeof effect.value === 'number' ? effect.value : 0;
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
 * Resolves attack prowess by applying global `all-attacks` effects.
 *
 * Collects all effects with `target: "all-attacks"` from events and cards
 * in play, evaluates their conditions against the provided context (which
 * includes `inPlay` for environment card checks), and sums prowess modifiers.
 *
 * @param state - The full game state.
 * @param baseProwess - The creature's or automatic attack's base prowess.
 * @param inPlayNames - Names of all cards currently in play (for `inPlay` conditions).
 * @returns The modified prowess value after applying all-attacks effects.
 */
export function resolveAttackProwess(
  state: GameState,
  baseProwess: number,
  inPlayNames: readonly string[],
): number {
  const context: ResolverContext = {
    reason: 'combat',
    inPlay: inPlayNames,
  };
  const globalEffects = collectGlobalEffects(state, 'all-attacks', context);
  return resolveStatModifiers(globalEffects, 'prowess', baseProwess, context);
}
