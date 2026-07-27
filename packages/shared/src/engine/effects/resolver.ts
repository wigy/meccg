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
  CharacterInPlay,
  CardDefinition,
  CharacterCard,
  CardEffect,
  StatModifierEffect,
  CheckModifierEffect,
  CompanyModifierEffect,
  CardInstanceId,
  SiteCard,
  CompanyId,
  PlayerId,
} from '../../index.js';
import { Race } from '../../types/common.js';
import { HAND_SIZE } from '../../constants.js';
import { matchesCondition, matchesContext } from '../../effects/condition-matcher.js';
import { isCharacterCard } from '../../types/cards.js';
import { resolveInstanceId } from '../../types/state.js';
import { evaluateExpr } from './expression-eval.js';
import { pickActiveItemsForCharacter } from '../item-slots.js';
import { getCardEffects, findPlayerAndCompany, isCardNameInPlayForPlayer } from '../reducer-utils.js';
import { logDetail } from '../legal-actions/log.js';

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
    readonly race: Race;
    readonly skills: readonly string[];
    readonly baseProwess: number;
    readonly baseBody: number;
    readonly baseDirectInfluence: number;
    /**
     * The character's printed mind value. Absent for avatars (mind === null).
     * Exposed so value expressions can compute mind-relative modifiers, e.g.
     * Awaiting the Call (le-165) halves the bearer's mind:
     * `"floor(bearer.baseMind / 2) - bearer.baseMind"`.
     */
    readonly baseMind?: number;
    /**
     * The character's *effective* prowess (after items and modifiers).
     * Populated in the `influence-check` and `opponent-influence-check`
     * contexts so conditions can compare a target's stats against the live
     * bearer, e.g. Whip (le-348) "+2 direct influence against one character
     * with … prowess less than the bearer's":
     * `{ "target.prowess": { "$lt": "bearer.prowess" } }`.
     */
    readonly prowess?: number;
    readonly name: string;
    /**
     * The character's keyword tags (e.g. `"half-orc"`, `"leader"`). Exposed so
     * conditions can gate on keywords that are not captured by `race`, e.g.
     * A Strident Spawn (wh-61) targets Half-orcs via
     * `{ "target.keywords": { "$includes": "half-orc" } }` (Half-orcs have
     * race `"orc"`).
     */
    readonly keywords?: readonly string[];
    /**
     * Definition IDs of other characters in the same company.
     * Used by conditions like `{ "bearer.companionDefinitionIds": { "$includes": "as-1" } }`
     * to gate effects on company membership (e.g. troll-trio mind reduction).
     */
    readonly companionDefinitionIds?: readonly string[];
    /**
     * The Ringwraith mode currently established for the bearer's company by an
     * in-play mode card (Black Rider / Fell Rider / Heralded Lord). Used by
     * Ringwraith avatar per-mode stat modifiers, e.g.
     * `{ "bearer.ringwraithMode": "heralded-lord" }` (Hoarmûrath le-53).
     */
    readonly ringwraithMode?: 'black-rider' | 'fell-rider' | 'heralded-lord';
    /**
     * True when this character is a follower — controlled by another
     * character's direct influence (`controlledBy` is a character instance ID,
     * not `"general"`). Exposed so effects can exclude followers, e.g.
     * So You've Come Back (le-138) raises the mind of "each other
     * **non-follower** … character" via `{ "bearer.isFollower": { "$ne": true } }`.
     */
    readonly isFollower?: boolean;
    /**
     * True when the character's company is currently at a Haven/Darkhaven
     * (`siteType === "haven"`). Populated only in the effective-stats context.
     * Used by organization-phase self-discard conditions, e.g.
     * So You've Come Back (le-138).
     */
    readonly atHaven?: boolean;
    /**
     * True when the character's company is at, moving to, or moving from an
     * Under-deeps site (its `currentSite`, planned `destinationSite`, or
     * `siteOfOrigin` carries the `under-deeps` keyword). Populated only in the
     * effective-stats context. Used by environments that spare characters near
     * the Under-deeps, e.g. The Sun Shone Fiercely (ba-25):
     * `{ "bearer.atOrMovingUnderDeeps": { "$ne": true } }`.
     */
    readonly atOrMovingUnderDeeps?: boolean;
    /**
     * The running stage-point total (MEWH §1) of the player controlling this
     * character. Populated in the effective-stats context — computed *before*
     * the per-character pass so an effect can read the same total the card it
     * rides on has already contributed to — and in the three influence-check
     * contexts (`faction-influence-check`, `opponent-influence-check`). Used by
     * modifiers that scale with a Fallen-wizard's progress, e.g. Inner Rot
     * (wh-23) corruption tiers and Fool's Bane (wh-19) influence tiers:
     * `{ "bearer.stagePoints": { "$gt": 11 } }`.
     */
    readonly stagePoints?: number;
  };
  /** The enemy creature/hazard (in combat contexts). */
  readonly enemy?: {
    /** The attacker's canonical race. Absent for attacks that name no race (e.g. Vile Fumes' "Gas") and for raceless targets. */
    readonly race?: Race;
    /**
     * Every race the attacker counts as, for the few creatures that print more
     * than one attack type (Goblin-faces wh-13 "Orcs. Men."). Lets a condition
     * match any of them via `{ "enemy.races": { "$includes": "man" } }`, where
     * `enemy.race` would only ever equal the primary race. Absent for the
     * single-race majority.
     */
    readonly races?: readonly Race[];
    readonly name: string;
    readonly prowess: number;
    readonly body: number | null;
  };
  /** The faction being influenced (in faction influence check contexts). */
  readonly faction?: {
    readonly name: string;
    readonly race: Race;
    /**
     * Names of sites (and/or site types) at which the faction is playable,
     * flattened from the faction card's `playableAt` entries. Used by DSL
     * conditions like `{ "faction.playableAt": "Variag Camp" }` to target
     * bonuses at factions tied to a specific site (e.g. AS-4 Perchen
     * grants +3 DI against any faction playable at Dunnish Clan-hold).
     */
    readonly playableAt: readonly string[];
    /**
     * Geographic regions in which the faction can be played, resolved from its
     * named `playableAt` sites (each site's `region`) plus explicit `region:`
     * entries. Used by DSL conditions like
     * `{ "faction.playableRegions": { "$includes": "Lamedon" } }` to target
     * bonuses at factions tied to a set of regions (e.g. Firiel dm-10 grants
     * +2 DI against factions playable in five Southern-Gondor regions).
     */
    readonly playableRegions?: readonly string[];
  };
  /**
   * The card an influence check is being made **against**, in whichever
   * influence check is running: the faction being brought into play
   * (`faction-influence-check`) or the opponent's card being influenced away
   * (`opponent-influence-check`). Unlike `faction` / `target` — each of which
   * is populated in only one of those contexts — this sub-object is present in
   * both, so a modifier that applies to "influence checks against <kind of
   * card>" needs a single condition rather than one per path.
   *
   * Used by Fool's Bane (wh-19): "influence checks he makes against hero
   * resources are modified by …" —
   * `{ "influenceTarget.alignment": "hero", "influenceTarget.kind": { "$ne": "character" } }`
   * (a character is not a resource card, CoE §"resource cards … and character
   * cards").
   */
  readonly influenceTarget?: {
    /**
     * The alignment of the card being influenced, derived from its card type:
     * `"hero"`, `"minion"`, `"fallen-wizard"`, or `"balrog"`. Absent when the
     * card type carries no alignment prefix.
     */
    readonly alignment?: string;
    /** What kind of card is being influenced: `"faction"`, `"character"`, `"ally"`, or `"item"`. */
    readonly kind: string;
    /** The card's name, for name-gated modifiers. */
    readonly name?: string;
    /** The card's race, when it has one (factions and characters). */
    readonly race?: string;
  };
  /** The target of an influence check (character being controlled). */
  readonly target?: {
    readonly name: string;
    /** The target's canonical race. Absent for allies and items, which carry no race. */
    readonly race?: Race;
    /**
     * The kind of card being influenced in an opponent-influence attempt:
     * `"character"`, `"ally"`, `"faction"`, or `"item"`. Exposed so an
     * opponent-influence booster can gate on the target type, e.g. Mine or No
     * One's (ba-68) applies only to an item/ally/faction target.
     */
    readonly kind?: string;
    /** Home site names parsed from the character's `homesite` string, for conditions like `{ "target.homesite": { "$includes": "Edoras" } }`. */
    readonly homesite?: readonly string[];
    /** The target character's keyword tags, for conditions like `{ "target.keywords": { "$includes": "balrog-specific" } }`. */
    readonly keywords?: readonly string[];
    /**
     * The target character's mind. Absent for avatars (mind === null), so a
     * "with a mind" gate like Whip's (le-348) is simply
     * `{ "target.mind": { "$gt": 0 } }` — it fails against a Ringwraith.
     * Effective mind for an in-play target (opponent-influence-check),
     * printed mind for a definition-only target (influence-check).
     */
    readonly mind?: number;
    /**
     * The target character's prowess — effective for an in-play target
     * (opponent-influence-check), printed for a definition-only target
     * (influence-check). Compared against the bearer via a path operand,
     * e.g. Whip (le-348): `{ "target.prowess": { "$lt": "bearer.prowess" } }`.
     */
    readonly prowess?: number;
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
  return state.cardPool[defId];
}

/**
 * Builds the `bearer` sub-object of a {@link ResolverContext} from a character
 * card definition, mapping the card's stat fields to the resolver naming
 * convention (`prowess` → `baseProwess`, etc.).
 *
 * Used wherever a character's stats are passed into effect evaluation — ensures
 * the mapping is applied consistently rather than repeated inline.
 */
export function buildBearerContext(charDef: CharacterCard): NonNullable<ResolverContext['bearer']> {
  return {
    race: charDef.race,
    skills: charDef.skills,
    baseProwess: charDef.prowess,
    baseBody: charDef.body,
    baseDirectInfluence: charDef.directInfluence,
    // Avatars have mind === null; omit baseMind for them so expressions that
    // reference it are never evaluated against a non-numeric value.
    ...(charDef.mind !== null ? { baseMind: charDef.mind } : {}),
    name: charDef.name,
    keywords: (charDef as { keywords?: readonly string[] }).keywords ?? [],
  };
}

/**
 * Builds the `influenceTarget` sub-object of a {@link ResolverContext} for the
 * card an influence check is being made against.
 *
 * The alignment is read off the card type's prefix (`hero-resource-faction` →
 * `"hero"`, `minion-character` → `"minion"`, …), which is the only alignment
 * marker a card definition carries. Card types with no alignment prefix (sites,
 * hazards) yield an undefined alignment rather than a made-up one.
 *
 * `kind` is passed by the caller because it is a property of the *attempt*, not
 * of the card: the same faction card can be the target of a faction-influence
 * check (bringing it into play) or of an opponent-influence attempt.
 */
export function buildInfluenceTargetContext(
  def: CardDefinition | undefined,
  kind: string,
): NonNullable<ResolverContext['influenceTarget']> {
  const cardType = def?.cardType ?? '';
  const alignment = ['hero', 'minion', 'fallen-wizard', 'balrog'].find(a => cardType.startsWith(`${a}-`));
  return {
    kind,
    ...(alignment !== undefined ? { alignment } : {}),
    ...(def && 'name' in def ? { name: def.name } : {}),
    ...(def && 'race' in def ? { race: (def as { race?: string }).race } : {}),
  };
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
  for (const effect of getCardEffects(def)) {
    if (effect.when && !matchesContext(effect.when, context)) continue;
    results.push({ effect, sourceDef: def, sourceInstance: instanceId });
  }
}


/**
 * Collects global effects from all events and cards in play across both players.
 *
 * Walks through each player's `cardsInPlay`, gathering
 * effects whose `when` conditions match the given context. Only effects with a
 * matching `target` scope are included (e.g. `"all-characters"` for character
 * stat computation, `"all-attacks"` for attack prowess).
 *
 * When `defenderCompanyId` is provided (attack resolution), company-bound cards
 * are filtered: only effects from cards bound to `defenderCompanyId` are included.
 * When `defenderCompanyId` is omitted, company-bound cards are skipped entirely
 * so their targeted effects do not apply globally to all companies.
 *
 * @param state - The full game state.
 * @param targetScope - The target scope to filter for (e.g. "all-characters").
 * @param context - The resolver context for condition evaluation.
 * @param defenderCompanyId - Optional ID of the company being attacked; scopes
 *   company-bound card effects to only that company.
 */
export function collectGlobalEffects(
  state: GameState,
  targetScope: string,
  context: ResolverContext,
  defenderCompanyId?: CompanyId,
  ownerPlayerId?: PlayerId,
): CollectedEffect[] {
  const results: CollectedEffect[] = [];
  const baseRecordContext = context as unknown as Record<string, unknown>;

  // Both players' cards in play (events, factions, permanent resources, etc.)
  for (const player of state.players) {
    // `own-characters`-scoped effects only apply to characters controlled by
    // the player who controls the source card (e.g. A Strident Spawn wh-61
    // reduces only *your* Half-orcs' control cost). Skip other players' cards.
    if (targetScope === 'own-characters' && ownerPlayerId !== undefined && player.id !== ownerPlayerId) continue;
    for (const card of player.cardsInPlay) {
      // A `trigger-attack-on-play` card in play whose self-inflicted attacks
      // are still resolving (Descent through Fire ba-56) must not yet apply its
      // ongoing effects — the "+1 prowess" bonus only takes hold once the card
      // is kept after the attacks (see CardInPlay.pendingTriggerAttack).
      if (card.pendingTriggerAttack) continue;
      // Company-bound cards: only include when the defending company matches.
      // Without a defender context, skip company-bound cards entirely to
      // prevent their targeted effects from applying globally.
      if (card.companyId) {
        if (!defenderCompanyId || card.companyId !== defenderCompanyId) continue;
      }

      const def = resolveDef(state, card.instanceId);
      if (!def) continue;
      const effects = getCardEffects(def);
      if (effects.length === 0) continue;

      // Build a card-specific condition context if the card has linked
      // GoM/DoN overrides (Crown of Flowers pairing). The paired resource
      // sees "Gates of Morning" as in-play and "Doors of Night" as absent,
      // regardless of the actual in-play events.
      let conditionContext: Record<string, unknown>;
      if ((card.assumeInPlay && card.assumeInPlay.length > 0) ||
          (card.assumeNotInPlay && card.assumeNotInPlay.length > 0)) {
        const baseInPlay = (baseRecordContext.inPlay as readonly string[] | undefined) ?? [];
        let adjusted = [...baseInPlay];
        for (const name of card.assumeInPlay ?? []) {
          if (!adjusted.includes(name)) adjusted.push(name);
        }
        adjusted = adjusted.filter(n => !(card.assumeNotInPlay ?? []).includes(n));
        conditionContext = { ...baseRecordContext, inPlay: adjusted };
      } else {
        conditionContext = baseRecordContext;
      }

      for (const effect of effects) {
        if (!('target' in effect) || (effect as { target?: string }).target !== targetScope) continue;
        if (effect.when && !matchesCondition(effect.when, conditionContext)) {
          continue;
        }
        results.push({ effect, sourceDef: def, sourceInstance: card.instanceId });
      }
    }
  }

  // Items attached to characters in play can also carry global target effects
  // (e.g. The Arkenstone: +1 mind to all Dwarves while held by anyone). These
  // items live in character.items, not in cardsInPlay, so we scan them separately.
  for (const player of state.players) {
    if (targetScope === 'own-characters' && ownerPlayerId !== undefined && player.id !== ownerPlayerId) continue;
    for (const char of Object.values(player.characters)) {
      for (const item of char.items) {
        const def = resolveDef(state, item.instanceId);
        if (!def) continue;
        const effects = getCardEffects(def);
        if (effects.length === 0) continue;
        for (const effect of effects) {
          if (!('target' in effect) || (effect as { target?: string }).target !== targetScope) continue;
          if (effect.when && !matchesCondition(effect.when, baseRecordContext)) continue;
          results.push({ effect, sourceDef: def, sourceInstance: item.instanceId });
        }
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
 *
 * `stat-modifier` effects with `target: "company"` on items are excluded
 * from the per-bearer item pass and instead collected uniformly via
 * {@link collectCompanyItemEffects} so that every character in the company
 * (not just the bearer) receives the bonus.
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
  // Skip stat-modifier effects with target "company" — handled below.
  const active = pickActiveItemsForCharacter(state, char);
  for (const item of char.items) {
    if (!active.has(item.instanceId as string)) continue;
    const itemDef = resolveDef(state, item.instanceId);
    if (!itemDef) continue;
    const itemResults: CollectedEffect[] = [];
    collectFromDef(itemDef, item.instanceId, context, itemResults);
    for (const r of itemResults) {
      if (r.effect.type === 'stat-modifier' && r.effect.target === 'company') continue;
      // Company-scoped check-modifiers are re-collected for every company
      // member (including the bearer) by collectCompanyItemEffects below;
      // skip here to avoid double-counting on the bearer.
      if (r.effect.type === 'check-modifier' && r.effect.target === 'company') continue;
      results.push(r);
    }

    // Item-attached permanent events (Barrow-blade dm-119, "play this with the
    // Dagger"): a CardInPlay in either player's cardsInPlay bound to this active
    // item via `attachedToItem`. Its effects flow to the item's bearer, exactly
    // as if they were printed on the item itself.
    for (const p of state.players) {
      for (const cip of p.cardsInPlay) {
        if (cip.attachedToItem !== item.instanceId) continue;
        const evDef = resolveDef(state, cip.instanceId);
        if (evDef) collectFromDef(evDef, cip.instanceId, context, results);
      }
    }
  }

  // Hazard card effects. Company-scoped stat/check modifiers on an attached
  // hazard (Diminish and Depart ba-17: "All Elves and Hobbits in the target's
  // company have +1 mind, and a Wizard in the company has -1 direct influence")
  // are skipped here and re-collected for every company member — including the
  // bearer — by collectCompanyItemEffects below, exactly as item company-target
  // modifiers are handled above (avoids double-counting on the bearer).
  for (const hazard of char.hazards) {
    const hDef = resolveDef(state, hazard.instanceId);
    if (!hDef) continue;
    const hazardResults: CollectedEffect[] = [];
    collectFromDef(hDef, hazard.instanceId, context, hazardResults);
    for (const r of hazardResults) {
      if (r.effect.type === 'stat-modifier' && r.effect.target === 'company') continue;
      if (r.effect.type === 'check-modifier' && r.effect.target === 'company') continue;
      results.push(r);
    }
  }

  // `company-others` stat-modifiers never apply to their own bearer ("each
  // *other* character in his company"). Strip any that leaked in from this
  // character's own card / items / hazards; they are re-collected from every
  // *other* company member below.
  for (let i = results.length - 1; i >= 0; i--) {
    const eff = results[i].effect;
    if (eff.type === 'stat-modifier' && eff.target === 'company-others') results.splice(i, 1);
  }

  // `company-others` stat-modifiers carried by *other* characters' attached
  // hazards/items in the same company (So You've Come Back le-138: an attached
  // hazard raises the mind of every other company member). Filtered by each
  // effect's `when` against this character's own context.
  const companyOthersEffects = collectCompanyOthersEffects(state, char, context);
  results.push(...companyOthersEffects);

  // Company-scoped stat-modifier effects from items on all characters in
  // the same company (e.g. The One Ring adds +1 CP to every company member).
  const companyItemEffects = collectCompanyItemEffects(state, char, context);
  results.push(...companyItemEffects);

  // Company-scoped stat boosts applied via active constraints (e.g.
  // Orc-draughts grants +1 prowess to every character in its bearer's
  // company for the turn). Synthesise equivalent stat-modifier effects
  // so they flow through the normal override/cap pipeline.
  const companyConstraints = collectCompanyStatModifierEffects(state, char);
  results.push(...companyConstraints);

  // Company-targeting permanent events (e.g. Fellowship) bound to the
  // character's company via CardInPlay.companyId. Their `company-modifier`
  // effects are synthesised into stat-modifier / check-modifier entries
  // so they flow through the normal resolution pipeline.
  const permanentEventEffects = collectCompanyPermanentEventEffects(state, char, context);
  results.push(...permanentEventEffects);

  // Character-scoped stat boosts applied via active constraints (e.g.
  // Vilya grants +4 prowess / +2 body / +6 direct-influence to Elrond
  // for the turn). Synthesise equivalent stat-modifier effects.
  const charConstraints = collectCharacterStatModifierEffects(state, char);
  results.push(...charConstraints);

  // Whip of Many Thongs (ba-82): a weapon whose effects have been cancelled for
  // the current company-vs-company combat contributes nothing "until the end of
  // the combat". Drop every effect sourced from a suppressed weapon instance so
  // its bearer's derived prowess/body (and the CvCC values that read them, plus
  // the creature-combat `computeCombatProwess`/`resolveEnemyBody` paths) reflect
  // the cancellation. The suppression list lives on `state.combat` and so clears
  // automatically when combat finalizes.
  const suppressed = state.combat?.suppressedWeaponInstanceIds;
  if (suppressed && suppressed.length > 0) {
    const suppressedSet = new Set(suppressed.map(i => i as string));
    return results.filter(r => !suppressedSet.has(r.sourceInstance as string));
  }

  return results;
}

/**
 * Collects effects from a single player's own `cardsInPlay`, filtering by each
 * effect's `when` condition against the given context.
 *
 * Unlike {@link collectGlobalEffects} (which walks both players and filters by
 * a target scope), this gathers *all* effects — of any type — from one player's
 * in-play events/environments so a downstream resolver can pick the type it
 * cares about. Used by the movement/hazard draw step: a resource long-event
 * such as A Short Rest (td-95) sits in the moving player's `cardsInPlay` and
 * contributes a `draw-modifier` to that player's own moving companies.
 *
 * Scoping to a single player is what keeps the effect from ever benefiting the
 * opponent: the draw step collects from the *active* (moving) player only, so a
 * long-event lingering in one player's `cardsInPlay` across the opponent's turn
 * never touches the opponent's draws.
 */
export function collectPlayerInPlayEffects(
  state: GameState,
  playerIndex: number,
  context: ResolverContext,
): CollectedEffect[] {
  const results: CollectedEffect[] = [];
  const player = state.players[playerIndex];
  if (!player) return results;
  for (const card of player.cardsInPlay) {
    const def = resolveDef(state, card.instanceId);
    if (def) collectFromDef(def, card.instanceId, context, results);
  }
  return results;
}

/**
 * Collects `company-modifier` effects from permanent events in `cardsInPlay`
 * that are bound to the same company as `char` (via `CardInPlay.companyId`).
 *
 * Synthesises each effect into either a {@link StatModifierEffect} (for `stat`
 * variants like prowess) or a {@link CheckModifierEffect} (for `check` variants
 * like corruption-check bonuses), so they flow through the standard resolver
 * pipeline alongside item and constraint-based modifiers.
 *
 * Used by Fellowship (tw-240) and similar company-bound permanent events.
 */
function collectCompanyPermanentEventEffects(
  state: GameState,
  char: CharacterInPlay,
  context: ResolverContext,
): CollectedEffect[] {
  const results: CollectedEffect[] = [];
  const baseCtx = context as unknown as Record<string, unknown>;

  const found = findPlayerAndCompany(state, char.instanceId);
  if (!found) return results;
  const charCompanyId = found.company.id as string;

  // Scan both players' cardsInPlay for company-bound events
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      if ((card.companyId as string | undefined) !== charCompanyId) continue;
      const def = resolveDef(state, card.instanceId);
      if (!def) continue;
      for (const effect of getCardEffects(def) as CompanyModifierEffect[]) {
        if (effect.type !== 'company-modifier') continue;
        if (effect.when && !matchesCondition(effect.when, baseCtx)) continue;
        if (effect.stat) {
          // Synthesise a stat-modifier so caps and overrides work normally
          const synthesized: StatModifierEffect = {
            type: 'stat-modifier',
            stat: effect.stat,
            value: effect.value,
          };
          results.push({ effect: synthesized, sourceDef: def, sourceInstance: card.instanceId });
        } else if (effect.check) {
          // Synthesise a check-modifier for corruption/influence check bonuses
          const synthesized: CheckModifierEffect = {
            type: 'check-modifier',
            check: effect.check,
            value: effect.value,
          };
          results.push({ effect: synthesized, sourceDef: def, sourceInstance: card.instanceId });
        }
      }
    }
  }
  return results;
}

/**
 * Collects `stat-modifier` effects with `target: "company-others"` from the
 * attached hazards and items of **every other** character in the same company
 * as `char`.
 *
 * Unlike {@link collectCompanyItemEffects} (`target: "company"`, which applies
 * to the bearer too), a `company-others` modifier explicitly excludes its own
 * bearer — so when computing character X's stats we look at the hazards/items
 * on companions Y ≠ X. Each effect's `when` is evaluated against X's context
 * (`bearer.*`), letting the source card exclude e.g. followers or avatars.
 *
 * Used by So You've Come Back (le-138): the attached hazard raises the mind of
 * "each other non-follower, non-Ringwraith, non-Wizard character in his
 * company" by one.
 */
function collectCompanyOthersEffects(
  state: GameState,
  char: CharacterInPlay,
  context: ResolverContext,
): CollectedEffect[] {
  const results: CollectedEffect[] = [];
  const baseCtx = context as unknown as Record<string, unknown>;
  const found = findPlayerAndCompany(state, char.instanceId);
  if (!found) return results;
  const { player, company } = found;
  for (const companyCharId of company.characters) {
    if (companyCharId === char.instanceId) continue; // "each *other* character"
    const other = player.characters[companyCharId];
    if (!other) continue;
    const attached = [...other.hazards, ...other.items];
    for (const card of attached) {
      const def = resolveDef(state, card.instanceId);
      if (!def) continue;
      for (const effect of getCardEffects(def)) {
        if (effect.type !== 'stat-modifier' || effect.target !== 'company-others') continue;
        if (effect.when && !matchesCondition(effect.when, baseCtx)) continue;
        results.push({ effect, sourceDef: def, sourceInstance: card.instanceId });
      }
    }
  }
  return results;
}

/**
 * Collects company-scoped effects (`stat-modifier` and `check-modifier` with
 * `target: "company"`) from the items **and attached hazards** of every
 * character in the same company as `char`.
 *
 * This ensures that a company-scoped bonus/penalty applies uniformly to all
 * company members regardless of who bears the source card: a company-scoped
 * item bonus (e.g. The One Ring's +1 corruption, or I'll Be At Your Heels' +1
 * to company corruption checks), or a company-scoped hazard penalty (Diminish
 * and Depart ba-17: +1 mind to Elves/Hobbits, -1 direct influence to a Wizard).
 * Each effect's `when` is evaluated against the modified character's context.
 */
function collectCompanyItemEffects(
  state: GameState,
  char: CharacterInPlay,
  context: ResolverContext,
): CollectedEffect[] {
  const results: CollectedEffect[] = [];
  const baseCtx = context as unknown as Record<string, unknown>;
  const found = findPlayerAndCompany(state, char.instanceId);
  if (!found) return results;
  const { player, company } = found;
  for (const companyCharId of company.characters) {
    const companyChar = player.characters[companyCharId];
    if (!companyChar) continue;
    const active = pickActiveItemsForCharacter(state, companyChar);
    // Company-scoped item modifiers (The One Ring, I'll Be At Your Heels).
    for (const item of companyChar.items) {
      if (!active.has(item.instanceId as string)) continue;
      const itemDef = resolveDef(state, item.instanceId);
      if (!itemDef) continue;
      for (const effect of getCardEffects(itemDef)) {
        const isCompanyStat = effect.type === 'stat-modifier' && effect.target === 'company';
        const isCompanyCheck = effect.type === 'check-modifier' && effect.target === 'company';
        if (!isCompanyStat && !isCompanyCheck) continue;
        if (effect.when && !matchesCondition(effect.when, baseCtx)) continue;
        results.push({ effect, sourceDef: itemDef, sourceInstance: item.instanceId });
      }
    }
    // Company-scoped modifiers on an attached hazard (Diminish and Depart
    // ba-17): the hazard raises the mind of every Elf/Hobbit and lowers a
    // Wizard's direct influence throughout the target's whole company.
    for (const hazard of companyChar.hazards) {
      const hazardDef = resolveDef(state, hazard.instanceId);
      if (!hazardDef) continue;
      for (const effect of getCardEffects(hazardDef)) {
        const isCompanyStat = effect.type === 'stat-modifier' && effect.target === 'company';
        const isCompanyCheck = effect.type === 'check-modifier' && effect.target === 'company';
        if (!isCompanyStat && !isCompanyCheck) continue;
        if (effect.when && !matchesCondition(effect.when, baseCtx)) continue;
        results.push({ effect, sourceDef: hazardDef, sourceInstance: hazard.instanceId });
      }
    }
  }
  return results;
}

/**
 * Collects effects from allies attached to any character in the same
 * company as `char`. Used for company-wide ally abilities like The
 * Warg-king's "+2 to any influence attempt by a character in his
 * company against a Wolf faction" — the ally is attached to a single
 * host but the bonus must be available to every influencing character
 * in the company.
 *
 * Each ally's effects are filtered by its own `when` against the caller
 * context, identical to {@link collectCharacterEffects}.
 */
export function collectCompanyAllyEffects(
  state: GameState,
  char: CharacterInPlay,
  context: ResolverContext,
): CollectedEffect[] {
  const results: CollectedEffect[] = [];
  const found = findPlayerAndCompany(state, char.instanceId);
  if (!found) return results;
  const { player, company } = found;
  for (const companyCharId of company.characters) {
    const companyChar = player.characters[companyCharId];
    if (!companyChar) continue;
    for (const ally of companyChar.allies) {
      const allyDef = resolveDef(state, ally.instanceId);
      if (allyDef) collectFromDef(allyDef, ally.instanceId, context, results);
    }
  }
  return results;
}

/**
 * Synthesise {@link StatModifierEffect}s from active
 * `company-stat-modifier` constraints whose target company contains the
 * given character. Returns one entry per matching constraint so caps /
 * overrides are evaluated uniformly with JSON-declared effects.
 */
function collectCompanyStatModifierEffects(
  state: GameState,
  char: CharacterInPlay,
): CollectedEffect[] {
  if (state.activeConstraints.length === 0) return [];
  const results: CollectedEffect[] = [];
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type !== 'company-stat-modifier') continue;
    if (constraint.target.kind !== 'company') continue;
    const company = findCompanyById(state, constraint.target.companyId);
    if (!company || !company.characters.includes(char.instanceId)) continue;
    const sourceDef = state.cardPool[constraint.sourceDefinitionId];
    if (!sourceDef) continue;
    const synthesized: StatModifierEffect = {
      type: 'stat-modifier',
      stat: constraint.kind.stat,
      value: constraint.kind.value,
    };
    results.push({
      effect: synthesized,
      sourceDef,
      sourceInstance: constraint.source,
    });
  }
  return results;
}

/**
 * Synthesise {@link StatModifierEffect}s from active
 * `character-stat-modifier` constraints that target the given character
 * instance (e.g. Vilya's +4 prowess / +2 body / +6 direct-influence on
 * Elrond for the turn).
 */
function collectCharacterStatModifierEffects(
  state: GameState,
  char: CharacterInPlay,
): CollectedEffect[] {
  if (state.activeConstraints.length === 0) return [];
  const results: CollectedEffect[] = [];
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type !== 'character-stat-modifier') continue;
    if (constraint.kind.characterId !== char.instanceId) continue;
    // "while <card> is in play" gate (Heart of Dark Fire ba-63): the bonus only
    // applies while the named card remains in play for the character's owner.
    const requiresCardInPlay = constraint.kind.requiresCardInPlay;
    if (requiresCardInPlay) {
      const owner = findPlayerAndCompany(state, char.instanceId)?.player;
      if (!owner || !isCardNameInPlayForPlayer(state, owner, requiresCardInPlay)) continue;
    }
    const sourceDef = state.cardPool[constraint.sourceDefinitionId];
    if (!sourceDef) continue;
    const synthesized: StatModifierEffect = {
      type: 'stat-modifier',
      stat: constraint.kind.stat,
      value: constraint.kind.value,
    };
    results.push({
      effect: synthesized,
      sourceDef,
      sourceInstance: constraint.source,
    });
  }
  return results;
}

/** Locate a company by ID across all players. */
function findCompanyById(
  state: GameState,
  companyId: import('../../types/common.js').CompanyId,
): import('../../types/state-cards.js').Company | undefined {
  for (const player of state.players) {
    for (const company of player.companies) {
      if (company.id === companyId) return company;
    }
  }
  return undefined;
}

/**
 * Context for applying `creature-attack-boost` constraints during attack
 * resolution. When provided, the resolver checks active constraints targeting
 * the given company and applies prowess/strike bonuses to matching attacks.
 *
 * `creatureInstanceId` — when set, any constraint whose source matches this
 * instance is skipped (Chill Douser cannot boost itself).
 */
export interface CreatureAttackBoostContext {
  /** The company being attacked. */
  readonly companyId: import('../../types/common.js').CompanyId;
  /** The current attacker's instance ID (to skip self-boost). */
  readonly creatureInstanceId?: CardInstanceId;
}

/**
 * Synthesises {@link StatModifierEffect}s from active `creature-attack-boost`
 * constraints targeting the given company. Filters by race, and skips the
 * constraint whose source is `creatureInstanceId` (prevents self-boost).
 */
function collectCreatureAttackBoostEffects(
  state: GameState,
  stat: 'prowess' | 'strikes',
  creatureRace: Race | undefined,
  ctx: CreatureAttackBoostContext,
): CollectedEffect[] {
  if (state.activeConstraints.length === 0) return [];
  const results: CollectedEffect[] = [];
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type !== 'creature-attack-boost') continue;
    if (constraint.target.kind !== 'company') continue;
    if (constraint.target.companyId !== ctx.companyId) continue;
    if (ctx.creatureInstanceId && constraint.source === ctx.creatureInstanceId) continue;
    if (creatureRace && constraint.kind.race !== creatureRace) continue;
    const value = stat === 'prowess' ? constraint.kind.prowess : constraint.kind.strikes;
    if (value === 0) continue;
    const sourceDef = state.cardPool[constraint.sourceDefinitionId];
    if (!sourceDef) continue;
    const synthesized: StatModifierEffect = { type: 'stat-modifier', stat, value };
    results.push({ effect: synthesized, sourceDef, sourceInstance: constraint.source });
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

  // Apply modifiers in three passes. `op: "set"` effects run first: they
  // replace the printed base outright (Radagast's Shapeshifter forms adopting
  // a new attribute line), so ordinary bonuses stack on the adopted value
  // rather than the printed one. Additive (`op` absent or `"add"`) effects run
  // next; multiplicative (`op: "multiply"`) effects run last so that
  // "doubled"-style modifiers (e.g. Plague of Wights doubling Undead strikes)
  // act on the already-modified total rather than the raw base.
  const exprContext = context as unknown as Record<string, unknown>;
  const setEffects = activeEffects.filter((e) => e.op === 'set');
  const orderedEffects = [
    ...setEffects,
    ...activeEffects.filter((e) => e.op !== 'multiply' && e.op !== 'set'),
    ...activeEffects.filter((e) => e.op === 'multiply'),
  ];
  let result = baseValue;
  for (const effect of orderedEffects) {
    const value = evaluateExpr(effect.value, exprContext);
    if (effect.op === 'set') result = value;
    else if (effect.op === 'multiply') result = result * value;
    else result = result + value;
    if (effect.max !== undefined) {
      const maxVal = evaluateExpr(effect.max, exprContext);
      result = Math.min(result, maxVal);
    }
    if (effect.min !== undefined) {
      const minVal = evaluateExpr(effect.min, exprContext);
      result = Math.max(result, minVal);
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
 * Returns `true` if the collected effects include an `auto-influence-faction`
 * grant matching the given faction name — i.e. the influencer may bring that
 * faction into play with no 2d6 influence check (Red Arrow tw-312: "Bearer may
 * automatically influence the Riders of Rohan").
 *
 * Names are compared exactly, matching the faction-name gating used elsewhere
 * (e.g. the `faction.name` condition path).
 */
export function resolveAutoInfluenceFaction(
  effects: readonly CollectedEffect[],
  factionName: string,
): boolean {
  for (const { effect } of effects) {
    if (effect.type === 'auto-influence-faction' && effect.faction === factionName) {
      return true;
    }
  }
  return false;
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
  context?: Record<string, unknown>,
): { adjustment: number; min: number } {
  let adjustment = 0;
  let min = 0;
  for (const { effect } of effects) {
    if (effect.type === 'draw-modifier' && effect.draw === draw) {
      if (typeof effect.value === 'number') {
        adjustment += effect.value;
      } else if (typeof effect.value === 'string' && context) {
        adjustment += evaluateExpr(effect.value, context);
      }
      if (effect.min !== undefined && effect.min > min) {
        min = effect.min;
      }
    }
  }
  return { adjustment, min };
}

/**
 * Maps a site automatic attack's printed `creatureType` label (e.g. "Wolves",
 * "Orcs", "Nazgûl") to the single canonical {@link Race} identifier used
 * everywhere else in the game.
 *
 * The labels are card text and are therefore plural, capitalized and
 * accented; races are not. This table is the *only* place the two vocabularies
 * meet — card data itself never stores a plural race (see {@link Race}).
 */
const CREATURE_TYPE_TO_RACE: Record<string, Race> = {
  animal: Race.Animal,
  animals: Race.Animal,
  'awakened plant': Race.AwakenedPlant,
  'awakened-plant': Race.AwakenedPlant,
  balrog: Race.Balrog,
  bear: Race.Bear,
  bears: Race.Bear,
  dragon: Race.Dragon,
  dragons: Race.Dragon,
  drake: Race.Drake,
  drakes: Race.Drake,
  dwarf: Race.Dwarf,
  dwarves: Race.Dwarf,
  dunadan: Race.Dunadan,
  'dúnadan': Race.Dunadan,
  'dúnedain': Race.Dunadan,
  eagle: Race.Eagle,
  eagles: Race.Eagle,
  elf: Race.Elf,
  elves: Race.Elf,
  ent: Race.Ent,
  ents: Race.Ent,
  giant: Race.Giant,
  giants: Race.Giant,
  hobbit: Race.Hobbit,
  hobbits: Race.Hobbit,
  maia: Race.Maia,
  maiar: Race.Maia,
  man: Race.Man,
  men: Race.Man,
  'nazgûl': Race.Ringwraith,
  nazgul: Race.Ringwraith,
  ringwraith: Race.Ringwraith,
  orc: Race.Orc,
  orcs: Race.Orc,
  'pûkel-creature': Race.PukelCreature,
  'pukel-creature': Race.PukelCreature,
  spawn: Race.Spawn,
  spider: Race.Spider,
  spiders: Race.Spider,
  troll: Race.Troll,
  trolls: Race.Troll,
  undead: Race.Undead,
  wolf: Race.Wolf,
  wolves: Race.Wolf,
  wose: Race.Wose,
  woses: Race.Wose,
};

/**
 * Maps a faction's lowercase singular `race` to the capitalized plural
 * `creatureType` label used on automatic-attacks (e.g. `"orc"` → `"Orcs"`,
 * `"man"` → `"Men"`). The inverse of {@link normalizeCreatureRace} for the
 * races factions actually carry. Used by `faction-siege` (Long Grievous Siege
 * ba-40): "an additional automatic-attack: same type as your target faction".
 * Unmapped races fall back to the capitalized race name.
 */
const FACTION_RACE_TO_ATTACK_TYPE: Partial<Record<Race, string>> = {
  orc: 'Orcs',
  man: 'Men',
  troll: 'Trolls',
  wolf: 'Wolves',
  dwarf: 'Dwarves',
  elf: 'Elves',
  dunadan: 'Dúnedain',
  hobbit: 'Hobbits',
  spider: 'Spiders',
  dragon: 'Dragon',
  animal: 'Animals',
  giant: 'Giants',
  undead: 'Undead',
  wose: 'Woses',
  ent: 'Ents',
  eagle: 'Eagles',
};

/** See {@link FACTION_RACE_TO_ATTACK_TYPE}. */
export function factionRaceToAttackType(race: Race): string {
  return FACTION_RACE_TO_ATTACK_TYPE[race]
    ?? race.charAt(0).toUpperCase() + race.slice(1);
}

/**
 * Normalizes a site automatic attack's printed `creatureType` label (e.g.
 * "Wolves") to the canonical {@link Race} identifier used in card data and DSL
 * conditions (e.g. `"wolf"`).
 *
 * Card data already stores canonical races, so this is only needed for the
 * attack labels printed on sites. A handful of automatic-attacks name no race
 * at all — Vile Fumes' "Gas", and injected attacks with an empty label — and
 * those return `undefined`, matching no race condition. Returning `undefined`
 * rather than the lowercased label keeps non-race text out of every
 * {@link Race}-typed slot, so "gas" can never be compared against a race.
 */
export function normalizeCreatureRace(creatureType: string): Race | undefined {
  return CREATURE_TYPE_TO_RACE[creatureType.toLowerCase()];
}

/**
 * Builds the race half of a {@link ResolverContext.enemy} entry from a combat.
 *
 * Keeps `enemy.race` (the single primary race) and `enemy.races` (every race
 * the attacker counts as, present only for multi-race creatures) populated
 * consistently wherever an enemy context is assembled, so a DSL condition sees
 * the same vocabulary regardless of which code path built the context.
 */
export function enemyRaceContext(
  combat: { readonly creatureRace?: Race; readonly creatureRaces?: readonly Race[] },
): { race?: Race; races?: readonly Race[] } {
  return {
    ...(combat.creatureRace !== undefined ? { race: combat.creatureRace } : {}),
    ...(combat.creatureRaces !== undefined ? { races: combat.creatureRaces } : {}),
  };
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
  readonly companyFacedRaces: readonly Race[];
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
 * @param defenderAlignment - Alignment of the defending player, for self-effect conditions.
 * @param siteType - Effective site type of the site whose automatic-attack is being
 *   resolved, exposed as `site.siteType`. Populated only for site automatic-attacks,
 *   so global effects can gate on the site type (e.g. Awaken Minions tw-10 doubles
 *   automatic-attack strikes at Shadow-hold / Dark-hold sites).
 */
function buildAttackContext(
  inPlayNames: readonly string[],
  creatureRace?: Race,
  companyFacedRaces?: readonly Race[],
  defenderAlignment?: string,
  siteType?: string,
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
  // Expose the defending company's effective site type so global
  // `all-automatic-attacks` modifiers can gate on it (Awaken Minions tw-10 /
  // Awaken Defenders le-103: "strikes … at a Shadow-hold / Free-hold …
  // doubled"). Populated only for automatic-attacks (the only attacks keyed to
  // a site), via the effective site type threaded in by the caller.
  const withSite = siteType
    ? { ...withDefender, site: { siteType } }
    : withDefender;
  if (creatureRace) {
    return { ...withSite, enemy: { race: creatureRace, name: '', prowess: 0, body: null } };
  }
  return withSite;
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
  creatureRace?: Race,
  isAutomaticAttack = false,
  creatureSelf?: CreatureSelfContext,
  attackBoostCtx?: CreatureAttackBoostContext,
): number {
  const context = buildAttackContext(inPlayNames, creatureRace, creatureSelf?.companyFacedRaces, creatureSelf?.defenderAlignment);
  const globalEffects = collectGlobalEffects(state, 'all-attacks', context, attackBoostCtx?.companyId);
  if (isAutomaticAttack) {
    globalEffects.push(...collectGlobalEffects(state, 'all-automatic-attacks', context, attackBoostCtx?.companyId));
  }
  if (creatureSelf) {
    for (const effect of creatureSelf.effects) {
      if (effect.type !== 'stat-modifier') continue;
      if ('target' in effect && (effect as { target?: string }).target) continue;
      if (effect.when && !matchesContext(effect.when, context)) {
        continue;
      }
      globalEffects.push({ effect, sourceDef: {} as CardDefinition, sourceInstance: '' as CardInstanceId });
    }
  }
  if (attackBoostCtx) {
    globalEffects.push(...collectCreatureAttackBoostEffects(state, 'prowess', creatureRace, attackBoostCtx));
  }
  return resolveStatModifiers(globalEffects, 'prowess', baseProwess, context);
}

/**
 * Resolves attack strikes by applying global `all-attacks` effects.
 *
 * Collects all effects with `target: "all-attacks"` from events and cards
 * in play, evaluates conditions against the context (including `enemy.race`
 * for creature-type filtering), and sums strikes modifiers. When
 * `isAutomaticAttack` is true, also collects `target: "all-automatic-attacks"`
 * effects that only apply to site automatic-attacks (e.g. Redoubled Force's
 * +3 strikes to Orc/Troll automatic-attacks). When `attackBoostCtx` is
 * provided, also applies active `creature-attack-boost` constraints targeting
 * the defending company.
 *
 * @param state - The full game state.
 * @param baseStrikes - The creature's or automatic attack's base number of strikes.
 * @param inPlayNames - Names of all cards currently in play (for `inPlay` conditions).
 * @param creatureRace - The lowercase singular race of the attacking creature (e.g. "wolf", "orc").
 * @param isAutomaticAttack - Whether this is a site automatic-attack (not a hazard creature).
 * @param attackBoostCtx - Optional company/creature context for constraint-based boosts.
 * @param siteType - Effective site type of the site whose automatic-attack is being
 *   resolved (only for site automatic-attacks), exposed as `site.siteType` so global
 *   effects can gate on it (e.g. Awaken Minions tw-10 doubles strikes at Shadow-hold /
 *   Dark-hold sites).
 * @returns The modified strikes value after applying all-attacks effects.
 */
export function resolveAttackStrikes(
  state: GameState,
  baseStrikes: number,
  inPlayNames: readonly string[],
  creatureRace?: Race,
  isAutomaticAttack = false,
  attackBoostCtx?: CreatureAttackBoostContext,
  siteType?: string,
): number {
  const context = buildAttackContext(inPlayNames, creatureRace, undefined, undefined, siteType);
  const globalEffects = collectGlobalEffects(state, 'all-attacks', context, attackBoostCtx?.companyId);
  if (isAutomaticAttack) {
    globalEffects.push(...collectGlobalEffects(state, 'all-automatic-attacks', context, attackBoostCtx?.companyId));
  }
  if (attackBoostCtx) {
    globalEffects.push(...collectCreatureAttackBoostEffects(state, 'strikes', creatureRace, attackBoostCtx));
  }
  return resolveStatModifiers(globalEffects, 'strikes', baseStrikes, context);
}

/**
 * Resolves attack body by applying global `all-attacks` stat-modifier effects
 * with `stat: "body"` from events and cards in play. A lower body value means
 * the creature is eliminated more easily (body check must exceed body).
 *
 * @param state - The full game state.
 * @param baseBody - The creature's or automatic attack's base body (null means
 *   no body check; returned as-is).
 * @param inPlayNames - Names of all cards currently in play.
 * @param creatureRace - The lowercase singular race of the attacking creature.
 * @param attackBoostCtx - Optional company context for company-scoped modifiers.
 * @returns The modified body value (minimum 0), or null if baseBody was null.
 */
export function resolveAttackBody(
  state: GameState,
  baseBody: number | null,
  inPlayNames: readonly string[],
  creatureRace?: Race,
  attackBoostCtx?: CreatureAttackBoostContext,
): number | null {
  if (baseBody === null) return null;
  const context = buildAttackContext(inPlayNames, creatureRace);
  const globalEffects = collectGlobalEffects(state, 'all-attacks', context, attackBoostCtx?.companyId);
  const modified = resolveStatModifiers(globalEffects, 'body', baseBody, context);
  return Math.max(0, modified);
}

/**
 * Builds a {@link ResolverContext} for resolving character combat effects.
 *
 * Used during strike resolution to re-resolve character prowess with
 * enemy information, enabling conditional bonuses like Éowyn's +6 vs Nazgûl.
 */
function buildCombatContext(
  char: { race: Race; skills: readonly string[]; baseProwess: number; baseBody: number; baseDirectInfluence: number; name: string },
  enemy: { race?: Race; name: string; prowess: number; body: number | null },
  inPlayNames: readonly string[],
  strikeMode?: 'tap' | 'untap' | 'dodge' | 'reroll',
): ResolverContext {
  return {
    reason: 'combat',
    bearer: char,
    enemy,
    inPlay: inPlayNames,
    // Exposed only when the caller knows how the character faced the strike, so
    // an `enemy-modifier` can gate on "when tapping to face a strike"
    // (Mechanical Bow wh-53). Absent otherwise — the condition then never matches.
    ...(strikeMode ? { combat: { strikeMode } } : {}),
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
  enemy: { race?: Race; name: string; prowess: number; body: number | null },
  inPlayNames: readonly string[],
): number {
  const charDef = resolveDef(state, char.instanceId);
  if (!charDef || !isCharacterCard(charDef)) return 0;
  const charInfo = buildBearerContext(charDef);

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

  const combatProwess = resolveStatModifiers(combatEffects, 'prowess', charDef.prowess, combatContext);
  const baseProwess = resolveStatModifiers(baseEffects, 'prowess', charDef.prowess, baseContext);

  return combatProwess - baseProwess;
}

/**
 * Resolves enemy body modifications from character effects.
 *
 * Collects `enemy-modifier` effects from a character and their items
 * that match the combat context, and applies them to the enemy's body value.
 * Supports the `halve-round-up` and `subtract` operations.
 *
 * @param state - The full game state.
 * @param char - The character fighting the enemy.
 * @param enemy - The enemy creature info.
 * @param baseBody - The enemy's base body value.
 * @param inPlayNames - Names of all cards currently in play.
 * @param strikeMode - How the character faced the strike, exposed as
 *   `combat.strikeMode` so a modifier can gate on "if he taps to face the
 *   strike" (Mechanical Bow wh-53). Omit for contexts with no strike-facing
 *   mode (e.g. the CvCC attacker path) — the gate then never matches.
 * @returns The modified enemy body value.
 */
export function resolveEnemyBody(
  state: GameState,
  char: CharacterInPlay,
  enemy: { race?: Race; name: string; prowess: number; body: number | null },
  baseBody: number,
  inPlayNames: readonly string[],
  strikeMode?: 'tap' | 'untap' | 'dodge' | 'reroll',
): number {
  const charDef = resolveDef(state, char.instanceId);
  if (!charDef || !isCharacterCard(charDef)) return baseBody;
  const charInfo = buildBearerContext(charDef);
  const context = buildCombatContext(charInfo, enemy, inPlayNames, strikeMode);
  const effects = collectCharacterEffects(state, char, context);

  let body = baseBody;
  for (const { effect } of effects) {
    if (effect.type === 'enemy-modifier' && effect.stat === 'body') {
      if (effect.op === 'halve-round-up') {
        body = Math.ceil(body / 2);
      } else if (effect.op === 'subtract' && typeof effect.value === 'number') {
        body = Math.max(0, body - effect.value);
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
 * The bearer context additionally carries the player's `stagePoints` total, so
 * a card attached to a character can tier its modifier by how far along its
 * Fallen-wizard bearer is — Cruel Claw Perceived (wh-16) reduces the
 * Fallen-wizard's hand size by 1 above 10 SPs and by 1 more above 20.
 *
 * @param state - The full game state.
 * @param playerIndex - Which player (0 or 1) to compute for.
 * @returns The effective hand size (base + all matching modifiers).
 */
export function resolveHandSize(state: GameState, playerIndex: number): number {
  const player = state.players[playerIndex];
  let total = HAND_SIZE;

  for (const company of player.companies) {
    // Determine the site name (and whether it is a Darkhaven) for this company.
    // A Darkhaven is a dark-side haven (minion or balrog), as opposed to a hero
    // haven. Hand-size effects keyed to "at a Darkhaven" (e.g. Hoarmûrath le-53)
    // gate on `self.atDarkhaven` rather than a specific site name.
    let siteName: string | undefined;
    let atDarkhaven = false;
    if (company.currentSite) {
      const siteDef = state.cardPool[company.currentSite.definitionId];
      if (siteDef && 'name' in siteDef) {
        siteName = (siteDef as SiteCard).name;
        const site = siteDef as SiteCard;
        atDarkhaven = site.siteType === 'haven'
          && (site.cardType === 'minion-site' || site.cardType === 'balrog-site');
      }
    }

    for (const charInstanceId of company.characters) {
      const char = player.characters[charInstanceId];
      if (!char) continue;

      const charDef = resolveDef(state, char.instanceId);
      if (!charDef || !isCharacterCard(charDef)) continue;

      // Build context with self.location / self.atDarkhaven for condition matching
      const context: ResolverContext = {
        reason: 'hand-size',
        self: { location: siteName, atDarkhaven },
        bearer: { ...buildBearerContext(charDef), stagePoints: player.stagePoints },
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

  // Sum player-scoped hand-size-modifier active constraints (e.g. Book of Mazarbul tap).
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type !== 'hand-size-modifier') continue;
    if (constraint.target.kind !== 'player') continue;
    if (constraint.target.playerId !== player.id) continue;
    total += constraint.kind.value;
  }

  // Sum hand-size-modifier effects carried by bare permanent-events sitting in
  // the player's `cardsInPlay` (not attached to any character). The Lidless Eye
  // (le-203): "You may keep one more card than normal in your hand." Such a card
  // is a general permanent event, so its modifier is not reached by the
  // per-character collection above. (Set-aside hosts are skipped — their effects
  // are dormant.)
  for (const card of player.cardsInPlay) {
    if (card.setAsideHost !== undefined) continue;
    const def = resolveDef(state, card.instanceId);
    for (const effect of getCardEffects(def)) {
      if (effect.type === 'hand-size-modifier') {
        const delta = typeof effect.value === 'number' ? effect.value : 0;
        if (delta !== 0) {
          logDetail(`Hand-size: +${delta} from ${(def as { name?: string }).name ?? '?'} in play`);
          total += delta;
        }
      }
    }
  }

  return total;
}

/**
 * Returns the skills granted to a character by their attached items via
 * {@link GrantSkillEffect}. Combine with `charDef.skills` to get the full
 * set of skills the character possesses while those items are borne.
 *
 * Used wherever `target.skills` or company skill aggregations are built for
 * play-target DSL condition evaluation so that items like Magic Ring of Stealth
 * are correctly counted (e.g. a non-scout bearing the ring counts as a scout
 * for Stealth card targeting and sage+scout pair checks).
 */
export function getItemGrantedSkills(
  state: GameState,
  charData: CharacterInPlay,
): readonly string[] {
  const granted: string[] = [];
  for (const item of charData.items) {
    const itemDef = state.cardPool[item.definitionId];
    for (const eff of getCardEffects(itemDef)) {
      if (eff.type === 'grant-skill') {
        granted.push(eff.skill);
      }
    }
  }
  return granted;
}

/**
 * Returns the skills a character actually has right now: their printed skills
 * (or the replacement set imposed by an {@link OverrideSkillsEffect} borne on
 * them) plus every skill granted by an attached card via {@link GrantSkillEffect}.
 *
 * This is the single place the two skill primitives compose, and it is what
 * every consumer should ask rather than spreading `charDef.skills` with
 * {@link getItemGrantedSkills} by hand:
 *
 * - `grant-skill` **adds** (Magic Ring of Stealth tw-274 makes any bearer a scout).
 * - `override-skills` **replaces** the printed set (Shifter of Hues wh-115:
 *   "Radagast's skills become Warrior/Diplomat" — his printed Scout and Ranger
 *   are gone while the form is on him).
 *
 * Grants still stack on top of an override: the override speaks for the
 * character card, not for other cards' contributions.
 */
export function getEffectiveSkills(
  state: GameState,
  charData: CharacterInPlay,
  charDef: { readonly skills?: readonly string[] } | undefined,
): readonly string[] {
  let base: readonly string[] = charDef?.skills ?? [];
  for (const attached of charData.items) {
    const def = state.cardPool[attached.definitionId];
    for (const eff of getCardEffects(def)) {
      if (eff.type === 'override-skills') base = eff.skills;
    }
  }
  return [...base, ...getItemGrantedSkills(state, charData)];
}
