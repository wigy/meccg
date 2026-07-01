/**
 * @module reducer-utils
 *
 * Shared utility functions used by multiple reducer phase handlers.
 * Includes state cloning, dice rolling, deck exhaustion, company management,
 * and card effect resolution helpers.
 */

import type { GameState, PlayerState, PlayerId, CardInstanceId, CardInstance, CardInPlay, CardDefinitionId, CompanyId, GameAction, Company, CombatState, CharacterInPlay, ItemInPlay, AllyInPlay, CardDefinition, TwoDiceSix, DieRoll, GameEffect, DiceRollEffect, Alignment, RegionType } from '../index.js';
import type { CardEffect, OnEventEffect, Condition, HazardMaintenanceEffect, DuplicationLimitEffect, PlayConditionEffect } from '../types/effects.js';
import type { ResolutionScope, ActiveConstraint, SiteFlag } from '../types/pending.js';
import { GENERAL_INFLUENCE } from '../constants.js';
import { hasPlayFlag } from '../effects/play-flags.js';
import { shuffle, nextInt } from '../rng.js';
import { getPlayerIndex } from '../state-utils.js';
import { isSiteCard, isAvatarCharacter, isCharacterCard, isAllyCard, isHalfOrc, isResourceEventCard, isItemCard } from '../types/cards.js';
import { CardStatus, Race, Skill } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { resolveInstanceId } from '../types/state.js';
import { logHeading, logDetail } from './legal-actions/log.js';
import { matchesCondition } from '../effects/index.js';
import { resolveDef } from './effects/index.js';
import { enqueueCorruptionCheck } from './pending.js';

/**
 * Result of applying a {@link GameAction} to a {@link GameState}.
 * If `error` is present, `state` is returned unchanged.
 */
export interface ReducerResult {
  readonly state: GameState;
  /** Human-readable error message if the action was rejected. */
  readonly error?: string;
  /** Visual effects to broadcast to clients (dice rolls, etc.). */
  readonly effects?: readonly GameEffect[];
}


/**
 * True if `def` is a character carrying the `agent` keyword. Agents are
 * restricted during normal play (home-site-only) and, for Fallen-wizards,
 * during the character draft (rule 1.42) unless an enabling Stage resource
 * (e.g. Thrall of the Voice) has been drafted.
 */
export function isAgentCharacter(def: CardDefinition | undefined): boolean {
  return isCharacterCard(def) && (def.keywords ?? []).includes('agent');
}

/**
 * True if `def` is a Fallen-wizard "Stage" resource drafted during the
 * character draft — Thrall of the Voice (wh-82), Hidden Haven (wh-75): a
 * resource event flagged as a `starting-item`. Such cards are neither
 * characters nor minor items, so they ride in
 * {@link DraftPlayerState.draftedStageResources} rather than `drafted` and do
 * not consume the starting-company budget.
 */
export function isStageResourceCard(def: CardDefinition | undefined): boolean {
  return isResourceEventCard(def) && (def.keywords ?? []).includes('starting-item');
}

/**
 * True if `def` carries a `recruitment-vehicle` effect (Thrall of the Voice).
 * Drafting such a Stage resource lifts the Fallen-wizard restriction on
 * drafting characters with mind > 5 (rule 1.44) or agent characters (rule
 * 1.42). Detected by effect, not card id, so future enablers work unchanged.
 */
export function hasRecruitmentVehicleEffect(def: CardDefinition | undefined): boolean {
  const effects = (def as { effects?: readonly { type: string }[] } | undefined)?.effects ?? [];
  return effects.some(e => e.type === 'recruitment-vehicle');
}

/**
 * Count the minor items a player has placed on their starting characters.
 *
 * Only true minor items (item cards) count toward the starting-item budget of
 * two (CoE 1.9: "play up to two minor items from their pool"). Fallen-wizard
 * Stage resources such as Thrall of the Voice (wh-82) are *placed with* a
 * character — they ride in {@link CharacterInPlay.items} so their effects (e.g.
 * the −1 mind reduction) apply — but they are resource-events, not minor items,
 * and are governed by the separate "exactly three stage points" pool rule
 * (CoE 1.7.F1 / 1.9.F4). They must therefore never consume the two-item budget.
 */
export function countStartingMinorItems(state: GameState, player: PlayerState): number {
  let count = 0;
  for (const char of Object.values(player.characters)) {
    for (const item of char.items) {
      if (isItemCard(defById(state, item.definitionId))) count++;
    }
  }
  return count;
}

/**
 * Roll 2d6, respecting an optional cheat roll target. If `cheatRollTotal` is
 * set on the state, produces dice that sum to that total (using RNG to pick
 * the split) and clears the cheat field. Otherwise uses normal RNG.
 *
 * Returns the roll, updated RNG, and the new cheatRollTotal (null after use).
 */
export function roll2d6(state: GameState): { roll: TwoDiceSix; rng: typeof state.rng; cheatRollTotal: number | null } {
  let rng = state.rng;
  let d1: DieRoll;
  let d2: DieRoll;
  let cheatRollTotal: number | null = state.cheatRollTotal;

  if (cheatRollTotal !== null && cheatRollTotal >= 2 && cheatRollTotal <= 12) {
    // Pick a random valid split for the target total
    const minD1 = Math.max(1, cheatRollTotal - 6);
    const maxD1 = Math.min(6, cheatRollTotal - 1);
    const range = maxD1 - minD1 + 1;
    const [pick, rng2] = nextInt(rng, range);
    rng = rng2;
    d1 = (minD1 + pick) as DieRoll;
    d2 = (cheatRollTotal - d1) as DieRoll;
    cheatRollTotal = null;  // consumed
  } else {
    const [d1raw, rng2] = nextInt(rng, 6);
    const [d2raw, rng3] = nextInt(rng2, 6);
    rng = rng3;
    d1 = (d1raw + 1) as DieRoll;
    d2 = (d2raw + 1) as DieRoll;
  }

  return { roll: { die1: d1, die2: d2 }, rng, cheatRollTotal };
}

/**
 * Build a `dice-roll` visual effect for a 2d6 result. Centralizes the
 * repeated `{ effect: 'dice-roll', playerName, die1: roll.die1, die2: roll.die2, label }`
 * object literal used throughout the reducers to broadcast roll animations.
 */
export function diceRollEffect(playerName: string, roll: TwoDiceSix, label: string, total?: number): DiceRollEffect {
  return total !== undefined
    ? { effect: 'dice-roll', playerName, die1: roll.die1, die2: roll.die2, label, total }
    : { effect: 'dice-roll', playerName, die1: roll.die1, die2: roll.die2, label };
}

/**
 * Build the {@link ResolutionScope} for a corruption check or other resolution
 * enqueued during a company's combat. Companies resolve hazards in the
 * movement/hazard phase and automatic attacks in the site phase; each phase
 * has its own subphase scope so the queue is swept at the correct boundary.
 * Centralizes the repeated `phase === MovementHazard ? company-mh-subphase :
 * company-site-subphase` selection used across the combat reducers.
 */
export function companySubphaseScope(phase: Phase, companyId: CompanyId): ResolutionScope {
  return phase === Phase.MovementHazard
    ? { kind: 'company-mh-subphase', companyId }
    : { kind: 'company-site-subphase', companyId };
}

/** Creates a mutable copy of the 2-player tuple, preserving the tuple type. */
export function clonePlayers(state: GameState): [PlayerState, PlayerState] {
  return [{ ...state.players[0] }, { ...state.players[1] }];
}

/**
 * Look up a player by their {@link PlayerId}, or `undefined` if no player
 * matches. Centralizes the ubiquitous `state.players.find(p => p.id === id)`
 * lookup. A `null`/`undefined` id (e.g. `state.activePlayer` before a player
 * is active) never matches and yields `undefined`, mirroring the raw `.find`
 * behavior. Callers that know the id is valid (e.g. it came from a validated
 * action or phase state) can assert the result with `!`.
 */
export function playerById(state: GameState, id: PlayerId | null | undefined): PlayerState | undefined {
  return state.players.find(p => p.id === id);
}

/**
 * Look up the active player's state — the player whose id matches
 * `state.activePlayer`. Centralizes the ubiquitous
 * `playerById(state, state.activePlayer)` lookup, mirroring {@link hazardPlayer}
 * for the active side.
 *
 * Returns `undefined` when no player is active yet (e.g. before setup assigns
 * the active player), matching the underlying {@link playerById} behavior.
 * Callers that need the player must handle the `undefined` case explicitly.
 */
export function activePlayerState(state: GameState): PlayerState | undefined {
  return playerById(state, state.activePlayer);
}

/**
 * Look up the hazard player — the non-active player in a two-player game.
 * Centralizes the ubiquitous `state.players.find(p => p.id !== state.activePlayer)!`
 * lookup used wherever a hazard/opponent reference is needed (auto-attacks,
 * on-guard reveals, attacker-chosen defenders, etc.).
 *
 * `activePlayerId` defaults to `state.activePlayer`, but can be passed
 * explicitly when the active player is tracked in a local variable rather
 * than on the state. The result is asserted non-null because every game has
 * exactly two players and the active player is always one of them.
 */
export function hazardPlayer(state: GameState, activePlayerId: PlayerId | null | undefined = state.activePlayer): PlayerState {
  return state.players.find(p => p.id !== activePlayerId)!;
}

/**
 * Immutably update a single player's state.
 *
 * Replaces the common 4-line pattern:
 *   const newPlayers = clonePlayers(state);
 *   newPlayers[i] = { ...player, field: value };
 *   return { ...state, players: newPlayers };
 * with:
 *   return updatePlayer(state, i, p => ({ ...p, field: value }));
 */
export function updatePlayer(
  state: GameState,
  playerIndex: number,
  updater: (p: PlayerState) => PlayerState,
): GameState {
  const players: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  players[playerIndex] = updater(state.players[playerIndex]);
  return { ...state, players };
}

/**
 * Immutably update a single character in a player's `characters` map.
 * Returns the player unchanged if `charId` is not found.
 */
export function updateCharacter(
  player: PlayerState,
  charId: CardInstanceId | string,
  updater: (c: CharacterInPlay) => CharacterInPlay,
): PlayerState {
  const key = charId as CardInstanceId;
  const char = player.characters[key];
  if (!char) return player;
  return {
    ...player,
    characters: { ...player.characters, [key]: updater(char) },
  };
}

/**
 * Result of locating an item or ally among a player's characters:
 * the immutably updated player, the host character's instance id, and the
 * attachment as it was found (pre-update) so callers can validate it
 * (status, definition effects) and name it in logs before committing.
 */
export interface AttachmentUpdate<A> {
  readonly player: PlayerState;
  readonly charId: CardInstanceId;
  readonly attachment: A;
}

/**
 * Locate an item or ally by instance ID among a player's characters.
 * Returns the host character's id, the attachment, and its index within
 * the host's `items`/`allies` array — or `null` when no character bears it.
 */
export function findAttachment(player: PlayerState, kind: 'items', attachmentId: CardInstanceId): { charId: CardInstanceId; attachment: ItemInPlay; index: number } | null;
export function findAttachment(player: PlayerState, kind: 'allies', attachmentId: CardInstanceId): { charId: CardInstanceId; attachment: AllyInPlay; index: number } | null;
export function findAttachment(
  player: PlayerState,
  kind: 'items' | 'allies',
  attachmentId: CardInstanceId,
): { charId: CardInstanceId; attachment: ItemInPlay | AllyInPlay; index: number } | null {
  for (const [charId, char] of characterEntries(player)) {
    const attachments: readonly (ItemInPlay | AllyInPlay)[] = char[kind];
    const index = attachments.findIndex(a => a.instanceId === attachmentId);
    if (index >= 0) return { charId, attachment: attachments[index], index };
  }
  return null;
}

/**
 * Find an item or ally by instance ID among a player's characters and
 * replace it via `updater`, returning the updated player plus the host and
 * the original attachment. Returns `null` when no character bears it.
 * Centralizes the recurring search-host / copy-array / updateCharacter
 * sequence used by tap-to-activate and similar reducers.
 */
export function updateAttachment(player: PlayerState, kind: 'items', attachmentId: CardInstanceId, updater: (a: ItemInPlay) => ItemInPlay): AttachmentUpdate<ItemInPlay> | null;
export function updateAttachment(player: PlayerState, kind: 'allies', attachmentId: CardInstanceId, updater: (a: AllyInPlay) => AllyInPlay): AttachmentUpdate<AllyInPlay> | null;
export function updateAttachment(
  player: PlayerState,
  kind: 'items' | 'allies',
  attachmentId: CardInstanceId,
  updater: (a: never) => ItemInPlay | AllyInPlay,
): AttachmentUpdate<ItemInPlay | AllyInPlay> | null {
  const found = findAttachment(player, kind as 'items', attachmentId);
  if (!found) return null;
  const updated = [...player.characters[found.charId][kind]];
  updated[found.index] = updater(found.attachment as never);
  return {
    player: updateCharacter(player, found.charId, c => ({ ...c, [kind]: updated })),
    charId: found.charId,
    attachment: found.attachment,
  };
}

/**
 * Find an item or ally by instance ID among a player's characters and
 * remove it from its host, returning the updated player plus the host and
 * the removed attachment (for the caller to place into a pile via
 * `toCardInstance`). Returns `null` when no character bears it.
 */
export function removeAttachment(player: PlayerState, kind: 'items', attachmentId: CardInstanceId): AttachmentUpdate<ItemInPlay> | null;
export function removeAttachment(player: PlayerState, kind: 'allies', attachmentId: CardInstanceId): AttachmentUpdate<AllyInPlay> | null;
export function removeAttachment(
  player: PlayerState,
  kind: 'items' | 'allies',
  attachmentId: CardInstanceId,
): AttachmentUpdate<ItemInPlay | AllyInPlay> | null {
  const found = findAttachment(player, kind as 'items', attachmentId);
  if (!found) return null;
  const updated = player.characters[found.charId][kind].filter((_, i) => i !== found.index);
  return {
    player: updateCharacter(player, found.charId, c => ({ ...c, [kind]: updated })),
    charId: found.charId,
    attachment: found.attachment,
  };
}

/**
 * Produce a {@link ReducerResult} rejecting an action whose `type` did not
 * match the expected value. When `context` is supplied the message names the
 * step the rejection happened in (e.g. `during draw-cards step`).
 */
export function wrongActionType(
  state: GameState,
  action: GameAction,
  expected: GameAction['type'],
  context?: string,
): ReducerResult {
  const msg = context
    ? `Expected '${expected}' during ${context}, got '${action.type}'`
    : `Expected ${expected} action`;
  return { state, error: msg };
}

/**
 * Extract the minimal `{ instanceId, definitionId }` tuple from any card-like
 * object (CardInstance, CardInPlay, CharacterInPlay, etc.). Used when moving
 * a card between piles — downstream piles only care about the tuple, not
 * whatever status/attachment bookkeeping the source location carried.
 */
export function toCardInstance(c: { readonly instanceId: CardInstance['instanceId']; readonly definitionId: CardInstance['definitionId'] }): CardInstance {
  return { instanceId: c.instanceId, definitionId: c.definitionId };
}

/**
 * Look up a card definition from the card pool by its {@link CardDefinitionId}.
 *
 * The pool is keyed by plain `string`, so indexing it with a branded
 * `CardDefinitionId` otherwise requires an `as string` cast at every call site.
 * This helper centralizes that cast and the intent ("get the definition for this
 * id"). Returns `undefined` for an unknown definition id. Complements
 * {@link resolveDef}, which resolves a definition from a {@link CardInstanceId}.
 */
export function defById(state: GameState, definitionId: CardDefinitionId): CardDefinition | undefined {
  return state.cardPool[definitionId];
}

/**
 * True if a character counts as only half a character for company-size
 * purposes (CoE rule 3.24): every Hobbit and every Orc scout.
 *
 * Centralises the half-size predicate so the four company-size call sites
 * (organization grant-action checks, company-formation, and the M/H
 * `maxCompanySize` gates on both the legal-action and reducer sides) stay
 * in agreement. Previously two of those copies omitted the Orc-scout half,
 * mis-sizing minion companies for `maxCompanySize`-gated cards.
 */
function countsAsHalfCharacter(def: CardDefinition): boolean {
  if (!isCharacterCard(def)) return false;
  const isHobbit = def.race === Race.Hobbit;
  const isOrcScout = def.race === Race.Orc && def.skills.includes(Skill.Scout);
  return isHobbit || isOrcScout;
}

/**
 * Compute a company's effective size per CoE rule 3.24: each Hobbit or Orc
 * scout counts as half a character, all others as one, and the running total
 * is rounded up. Non-character or unresolved instances count as a full
 * character (defensive — companies should only hold characters).
 *
 * This is the single source of truth for company size; all call sites
 * (grant-action play checks, company formation, and `maxCompanySize` hazard
 * gates) must route through it rather than re-deriving the half rule inline.
 */
export function companyEffectiveSize(state: GameState, company: Company): number {
  return companyEffectiveSizeOf(state, company.characters);
}

/**
 * Variant of {@link companyEffectiveSize} that operates on a raw list of
 * character instance IDs, for callers that have the roster but not a full
 * {@link Company} (e.g. while a company is being assembled).
 */
export function companyEffectiveSizeOf(state: GameState, charInstIds: readonly CardInstanceId[]): number {
  let halfCount = 0;
  let fullCount = 0;
  for (const charInstId of charInstIds) {
    const defId = resolveInstanceId(state, charInstId);
    const def = defId ? defById(state, defId) : undefined;
    if (def && isCharacterCard(def) && countsAsHalfCharacter(def)) {
      halfCount++;
      logDetail(`  ${def.name} (${def.race}${def.race === Race.Orc ? '/scout' : ''}) counts as half`);
    } else {
      fullCount++;
    }
  }
  const size = Math.ceil(fullCount + halfCount / 2);
  logDetail(`Company size: ${fullCount} full + ${halfCount} half = ${size}`);
  return size;
}

/**
 * Variant of {@link companyEffectiveSizeOf} that exempts up to
 * `exemptLeaderCount` Leader-keyword characters from the count before
 * applying CoE rule 3.24's half-character rounding (used by *Orders from the
 * Great Demon*, ba-70, whose `extra-leader-slot` effect exempts one Leader
 * per copy in play from the company-size maximum).
 */
export function companyEffectiveSizeExemptingLeaders(
  state: GameState,
  charInstIds: readonly CardInstanceId[],
  exemptLeaderCount: number,
): number {
  if (exemptLeaderCount <= 0) return companyEffectiveSizeOf(state, charInstIds);
  let remaining = exemptLeaderCount;
  const counted: CardInstanceId[] = [];
  for (const charInstId of charInstIds) {
    const defId = resolveInstanceId(state, charInstId);
    const def = defId ? defById(state, defId) : undefined;
    if (remaining > 0 && def && isCharacterCard(def) && (def.keywords?.includes('Leader') ?? false)) {
      remaining--;
      logDetail(`  ${def.name} exempted from company-size maximum (extra-leader-slot)`);
      continue;
    }
    counted.push(charInstId);
  }
  return companyEffectiveSizeOf(state, counted);
}

/**
 * Look up a card's display name from the card pool by its definition ID.
 *
 * Every {@link CardDefinition} carries a `name`, so the only failure case is
 * an unknown definition ID. When the card is not in the pool, returns
 * `fallback` if provided, otherwise the definition ID as a string. Used
 * throughout the engine for human-readable log labels.
 */
export function cardName(
  state: GameState,
  definitionId: CardDefinitionId,
  fallback?: string,
): string {
  return defById(state, definitionId)?.name ?? fallback ?? (definitionId as string);
}

/**
 * Evaluate a DSL {@link Condition} filter against a {@link CardDefinition}.
 *
 * Card definitions are matched as plain objects so that filters can reference
 * any definition field (name, race, type, keywords, …) via dot paths. The
 * {@link matchesCondition} context type is the structural `Record<string, unknown>`
 * shape, so a definition needs a structural cast at the call boundary; this
 * helper centralizes that cast and the intent ("does this card match the filter?").
 */
export function matchesDefinition(def: CardDefinition, condition: Condition): boolean {
  return matchesCondition(condition, def as unknown as Record<string, unknown>);
}

/**
 * Resolve the {@link RegionType} of the region a site sits in.
 *
 * A site definition records its containing region only by name (`region`);
 * the region's type lives on the separate region card. This joins the two via
 * the card pool. Used to gate plays that care about a site's own region type —
 * e.g. Hidden Haven (wh-75), "Playable on a … Ruins & Lairs in a Wilderness,
 * Border-land, or Shadow-land" — which a filter over the site definition alone
 * cannot express. Returns `undefined` when the site has no region or the region
 * card is absent from the pool.
 */
export function siteRegionTypeOf(state: GameState, siteDef: CardDefinition | undefined): RegionType | undefined {
  if (!siteDef || !isSiteCard(siteDef) || !siteDef.region) return undefined;
  for (const card of Object.values(state.cardPool)) {
    if (card.cardType === 'region' && card.name === siteDef.region) {
      return (card as { regionType?: RegionType }).regionType;
    }
  }
  return undefined;
}

/**
 * Find the first element matching `id` in a read-only array of card-like
 * objects, or `undefined` if none matches. Centralizes the ubiquitous
 * `pile.find(c => c.instanceId === id)` lookup used to locate a card instance
 * within a specific pile/zone. Complements {@link removeById}.
 */
export function findById<T extends { readonly instanceId: CardInstance['instanceId'] }>(
  arr: readonly T[],
  id: CardInstance['instanceId'],
): T | undefined {
  return arr.find(c => c.instanceId === id);
}

/**
 * Remove the first element matching `id` from a read-only array of card-like
 * objects. Returns the unchanged array reference if no match is found, so
 * callers can short-circuit when nothing changed.
 */
export function removeById<T extends { readonly instanceId: CardInstance['instanceId'] }>(
  arr: readonly T[],
  id: CardInstance['instanceId'],
): readonly T[] {
  const idx = arr.findIndex(c => c.instanceId === id);
  if (idx === -1) return arr;
  return [...arr.slice(0, idx), ...arr.slice(idx + 1)];
}

/**
 * Returns all `on-event` effects from a card definition that match `eventName`.
 * Handles `null`/`undefined` and cards without an `effects` field. Replaces the
 * verbose triple-check `!def || !('effects' in def) || !def.effects` + manual
 * `if (effect.type !== 'on-event') continue; if (effect.event !== X) continue;` pattern.
 */
export function getOnEventEffects(
  def: CardDefinition | null | undefined,
  eventName: string,
): readonly OnEventEffect[] {
  return getCardEffects(def).filter((e): e is OnEventEffect => e.type === 'on-event' && e.event === eventName);
}

/**
 * True when a triggered-action `apply` is a "discard this card" move — the
 * `move` shape `{ select: 'self', to: 'discard' }` that replaced the legacy
 * `discard-self` verb. Event sweepers and on-event handlers use this to detect
 * "discard the bearer when the event fires" uniformly.
 *
 * The slot-specific removal stays inline in each sweeper, because the move
 * locator (`reducer-move`) does not scan every attachment slot — e.g. allies.
 * Matches `select`/`to` only (not `from`): the bearer is located by the calling
 * sweeper, so the source zone is immaterial to the detection.
 */
export function isSelfDiscardMove(
  apply: { readonly type?: string; readonly select?: string; readonly to?: string } | undefined,
): boolean {
  return apply?.type === 'move' && apply.select === 'self' && apply.to === 'discard';
}

/**
 * Returns the effects array from a card definition, or an empty array if the
 * card has no effects or the definition is absent.
 *
 * Eliminates the verbose triple-check `!def || !('effects' in def) || !def.effects`
 * that precedes every `for (const effect of def.effects)` loop.
 */
export function getCardEffects(
  def: CardDefinition | null | undefined,
): readonly CardEffect[] {
  if (!def || !('effects' in def)) return [];
  return (def as { readonly effects?: readonly CardEffect[] }).effects ?? [];
}

/**
 * Total stage points a single card definition contributes (MEWH §1): the sum of
 * its `stage-points` effect values (usually one, may be zero). Used both by the
 * derived per-player total and by the discard-stage-resource legality check.
 */
export function stagePointsOfCard(def: CardDefinition | null | undefined): number {
  let total = 0;
  for (const effect of getCardEffects(def)) {
    if (effect.type === 'stage-points') total += effect.value;
  }
  return total;
}

/**
 * True when an active `wizardhaven-conversion` constraint (Hidden Haven, wh-75)
 * has turned the site with `siteDefinitionId` into a Wizardhaven for `playerId`.
 *
 * The conversion is player-scoped (matched on the constraint's player target),
 * so an opponent's company sharing the same site does not gain haven benefits —
 * the card grants "one of *your* Wizardhavens".
 */
/**
 * True when a site-only {@link SiteFlag} marker is active for the given site
 * (matched by definition id across all versions of the site). Returns false
 * when no site is supplied. Use for flags whose effect ignores the
 * constraint's player `target` (e.g. `skip-automatic-attacks`,
 * `cancel-attacks-at-site`, `site-nothing-playable-as-written`).
 */
export function hasSiteFlag(
  constraints: readonly ActiveConstraint[],
  flag: SiteFlag,
  siteDefinitionId: CardDefinitionId | undefined,
): boolean {
  if (!siteDefinitionId) return false;
  return constraints.some(
    c => c.kind.type === 'site-flag' && c.kind.flag === flag && c.kind.siteDefinitionId === siteDefinitionId,
  );
}

/**
 * True when a player-gated {@link SiteFlag} marker is active for the given site.
 * `match` selects whether the constraint's player `target` must be `playerId`
 * (`'self'`, the controller-gated flags — `wizardhaven-conversion`,
 * `cross-alignment-resources-unlocked`, `technology-item-unlocked`) or anyone
 * *other* than `playerId` (`'opponent'`, the `site-protected` protection flag).
 * Returns false when no site is supplied.
 */
export function hasSiteFlagForPlayer(
  constraints: readonly ActiveConstraint[],
  flag: SiteFlag,
  siteDefinitionId: CardDefinitionId | undefined,
  playerId: PlayerId,
  match: 'self' | 'opponent' = 'self',
): boolean {
  if (!siteDefinitionId) return false;
  return constraints.some(
    c =>
      c.kind.type === 'site-flag'
      && c.kind.flag === flag
      && c.kind.siteDefinitionId === siteDefinitionId
      && c.target.kind === 'player'
      && (match === 'self' ? c.target.playerId === playerId : c.target.playerId !== playerId),
  );
}

export function isWizardhavenConversionFor(
  state: GameState,
  siteDefinitionId: CardDefinitionId | undefined,
  playerId: PlayerId,
): boolean {
  return hasSiteFlagForPlayer(state.activeConstraints, 'wizardhaven-conversion', siteDefinitionId, playerId);
}

/**
 * True when the given player controls a **protected Wizardhaven** — a site that
 * is both (a) one of their Wizardhavens (a Fallen-wizard haven, or a site
 * converted into one via `wizardhaven-conversion`) and (b) protected for them
 * by a `site-protected` constraint (e.g. The Fortress of Isen wh-68, Fortress
 * of the Towers wh-69, Guarded Haven wh-74). Used by play-conditions such as A
 * Strident Spawn (wh-61) / An Untimely Brood (wh-62), which require "a protected
 * Wizardhaven".
 */
export function playerHasProtectedWizardhaven(state: GameState, playerId: PlayerId): boolean {
  for (const c of state.activeConstraints) {
    if (!(c.kind.type === 'site-flag' && c.kind.flag === 'site-protected')) continue;
    if (c.target.kind !== 'player' || c.target.playerId !== playerId) continue;
    const siteDefId = c.kind.siteDefinitionId;
    const siteDef = state.cardPool[siteDefId];
    if (!isSiteCard(siteDef)) continue;
    const isFwHaven = siteDef.siteType === 'haven' && siteDef.alignment === 'fallen-wizard';
    if (isFwHaven || isWizardhavenConversionFor(state, siteDefId, playerId)) return true;
  }
  return false;
}

/**
 * Whether `siteDef` functions as a *haven* for a player of the given alignment
 * (MEWH §3, "Wizardhavens").
 *
 * For most alignments a haven is simply any site whose `siteType` is `haven`
 * (each side plays at its own havens/darkhavens). A **Fallen-wizard** is the
 * exception: his havens are his own Wizardhaven sites only (the fallen-wizard
 * haven sites Isengard, The White Towers and Rhosgobel). METW Havens (Grey
 * Havens, Rivendell, Lórien, Edhellond) and MELE Darkhavens (Minas Morgul, Dol
 * Guldur, Carn Dûm, Geann a-Lisch) are **not** havens for him even though their
 * `siteType` is `haven` — so haven-only effects (healing, bringing characters
 * into play, etc.) do not apply to a Fallen-wizard standing there.
 *
 * Use this in place of a bare `siteDef.siteType === 'haven'` check wherever the
 * haven property is consumed *for a particular player*.
 *
 * A site dynamically converted into a Wizardhaven by Hidden Haven (wh-75) is
 * also a haven — but only for the Fallen-wizard who converted it, and only at
 * the bound site. Pass the `conversion` context (state + the site's definition
 * id + the player) so this returns true for the converting player even though
 * the site's printed type is Ruins & Lairs and its alignment is not
 * `fallen-wizard`. See {@link isWizardhavenConversionFor}.
 */
export function isHavenForPlayer(
  siteDef: CardDefinition | undefined,
  alignment: Alignment,
  conversion?: { state: GameState; siteDefinitionId: CardDefinitionId | undefined; playerId: PlayerId },
): boolean {
  if (!siteDef || !isSiteCard(siteDef)) return false;
  if (conversion && isWizardhavenConversionFor(conversion.state, conversion.siteDefinitionId, conversion.playerId)) {
    return true;
  }
  if (siteDef.siteType !== 'haven') return false;
  if (alignment === 'fallen-wizard') return siteDef.alignment === 'fallen-wizard';
  return true;
}

/**
 * CvCC alignment matrix (CoE rule 8.41, MEWH §8 "attack permissions" and the
 * Special Orc & Troll overt rule).
 *
 * Returns true if a company of `attackerAlignment` may legally attack a company
 * of `defenderAlignment`, given each side's covert/overt status (`attackerCovert`
 * / `defenderCovert`). Overt status comes from {@link isCovertCompany} at the
 * call site (a Fallen-wizard company with an Orc/Troll, or a named overt ally,
 * is overt).
 *
 * Key MEWH rules:
 * - An **overt** Fallen-wizard company may attack **any** opponent company, and
 *   any company may attack an **overt** Fallen-wizard company ("…and vice versa").
 * - **Non-overt** Fallen-wizard companies and **Wizard** companies may **not**
 *   attack each other.
 * - Fallen-wizard ↔ Ringwraith may always attack (MELE p. 80).
 */
export function canAttackAlignment(
  attackerAlignment: Alignment,
  defenderAlignment: Alignment,
  attackerCovert = true,
  defenderCovert = true,
): boolean {
  // An overt Fallen-wizard attacks anyone; anyone attacks an overt Fallen-wizard.
  if (attackerAlignment === 'fallen-wizard' && !attackerCovert) return true;
  if (defenderAlignment === 'fallen-wizard' && !defenderCovert) return true;

  switch (attackerAlignment) {
    case 'wizard':
      // Wizard can attack Ringwraith / Balrog. A Fallen-wizard defender is
      // reachable only when overt (handled above); a covert one is off-limits.
      return defenderAlignment === 'ringwraith' || defenderAlignment === 'balrog';
    case 'ringwraith':
      // Ringwraith can attack Wizard / Fallen-wizard (FW ↔ Ringwraith always).
      return defenderAlignment === 'wizard' || defenderAlignment === 'fallen-wizard';
    case 'fallen-wizard':
      // Covert Fallen-wizard can attack Ringwraith / Balrog, but not a Wizard.
      return defenderAlignment === 'ringwraith' || defenderAlignment === 'balrog';
    case 'balrog':
      // Balrog can attack Wizard / Fallen-wizard.
      return defenderAlignment === 'wizard' || defenderAlignment === 'fallen-wizard';
    default:
      return false;
  }
}

/**
 * The result of a corruption check on a character, before any cards are moved.
 *
 * - `success` — the roll exceeded the corruption point total; nothing happens.
 * - `tap-success` — a roll of CP or CP-1 on a character resolved as a *minion*
 *   (a minion character or the Fallen-wizard avatar): the character taps and the
 *   check is **considered successful** (so a store/transfer it gated still
 *   succeeds). CoE 7.1.
 * - `discard` — a roll of CP or CP-1 on a hero character: it is discarded.
 * - `eliminate` — a roll of CP or CP-1 on a Wizard avatar, or any roll two or
 *   more below CP on any character: the character is eliminated.
 */
export type CorruptionOutcome = 'success' | 'tap-success' | 'discard' | 'eliminate';

/** True when `charDef` is the Wizard avatar (eliminated on any failed check, CoE 10.01). */
function isWizardAvatarChar(charDef: CardDefinition | undefined): boolean {
  return !!charDef && isCharacterCard(charDef) && isAvatarCharacter(charDef)
    && charDef.alignment === 'wizard';
}

/**
 * Whether a character resolves corruption checks as a *minion* — i.e. taps (and
 * the check is considered successful) on a roll of CP or CP-1 rather than being
 * discarded/eliminated (CoE 7.1, 7.1.F1).
 *
 * - The **Fallen-wizard avatar** always taps like a minion.
 * - For a **Fallen-wizard** player, only **Orc/Troll** characters are minions;
 *   all his other characters are treated as hero characters (MEWH "all of your
 *   non-Orc/Troll characters are considered hero characters"), so a minion-typed
 *   Man he controls still resolves as a hero.
 * - For **Ringwraith/Balrog** players, any **minion-character** card is a minion.
 */
function isCorruptionMinionMode(
  charDef: CardDefinition | undefined,
  ownerAlignment: Alignment,
): boolean {
  if (!charDef || !isCharacterCard(charDef)) return false;
  if (isAvatarCharacter(charDef) && charDef.alignment === 'fallen-wizard') return true;
  if (ownerAlignment === 'fallen-wizard') {
    return charDef.race === Race.Orc || charDef.race === Race.Troll;
  }
  return charDef.cardType === 'minion-character';
}

/**
 * Classifies the outcome of a corruption check from the modified roll `total`,
 * the corruption point total `cp`, the character definition, and the alignment
 * of the player who controls it. Implements CoE 7.1 (with the MEWH minion/
 * Fallen-wizard tap rule and 7.1.F1 Orc/Troll handling). Pure — moves no cards.
 */
export function classifyCorruptionOutcome(
  charDef: CardDefinition | undefined,
  ownerAlignment: Alignment,
  total: number,
  cp: number,
): CorruptionOutcome {
  if (total > cp) return 'success';
  if (total >= cp - 1) {
    // Roll of CP or CP-1: alignment/type dependent.
    if (isCorruptionMinionMode(charDef, ownerAlignment)) return 'tap-success';
    if (isWizardAvatarChar(charDef)) return 'eliminate';
    return 'discard';
  }
  // Two or more below CP: eliminated regardless of alignment.
  return 'eliminate';
}

/**
 * Returns the `leader-control` effect on a faction definition, or `undefined`.
 * Carried by LE "Orcs of Udûn"-style factions (le-262, le-275, le-279, le-281,
 * le-282, le-291) that an Orc or Troll leader may place under their control.
 */
export function getLeaderControlEffect(
  def: CardDefinition | null | undefined,
): import('../types/effects.js').LeaderControlEffect | undefined {
  return getCardEffects(def).find(
    (e): e is import('../types/effects.js').LeaderControlEffect => e.type === 'leader-control',
  );
}

/**
 * True when `charDef` is eligible to take `factionDef` under its control:
 * the faction carries a `leader-control` effect and the character's race is in
 * the effect's `races` list and it carries the required keyword (e.g. an Orc or
 * Troll leader). Shared by the legal-action generator (which offers the control
 * variant) and the influence resolver (which validates it on success).
 */
export function leaderControlEligibility(
  factionDef: CardDefinition | null | undefined,
  charDef: CardDefinition | null | undefined,
): boolean {
  const effect = getLeaderControlEffect(factionDef);
  if (!effect || !charDef || !isCharacterCard(charDef)) return false;
  const raceOk = effect.races.includes(charDef.race as unknown as string);
  const keywordOk = (charDef.keywords ?? []).includes(effect.requiresKeyword as never);
  return raceOk && keywordOk;
}

/**
 * Returns the first `hazard-maintenance` effect on the card, or `undefined` if
 * none exists. Centralizes the recurring pattern of iterating a card's effects
 * to find the maintenance trigger, used both when computing available legal
 * actions and when validating the chosen payment.
 */
export function findHazardMaintenanceEffect(
  def: CardDefinition | null | undefined,
): HazardMaintenanceEffect | undefined {
  return getCardEffects(def).find(
    (e): e is HazardMaintenanceEffect => e.type === 'hazard-maintenance',
  );
}

/**
 * Returns the card's `duplication-limit` effect for the given {@link
 * DuplicationLimitEffect.scope}, or `undefined` if none matches. Centralizes
 * the recurring `effects.find(...)` type-guard used across the legal-action
 * handlers to enforce per-scope copy limits (e.g. one per turn, one per
 * company, one per active check).
 */
export function findDuplicationLimitEffect(
  def: CardDefinition | null | undefined,
  scope: DuplicationLimitEffect['scope'],
): DuplicationLimitEffect | undefined {
  return getCardEffects(def).find(
    (e): e is DuplicationLimitEffect => e.type === 'duplication-limit' && e.scope === scope,
  );
}

/**
 * Returns the card's `play-condition` effect for the given {@link
 * PlayConditionEffect.requires}, or `undefined` if none matches. Centralizes
 * the recurring `effects.find(...)` type-guard used across the legal-action
 * handlers to gate playability on a specific prerequisite kind (site type,
 * card-not-in-play, player state, etc.).
 */
export function findPlayConditionEffect(
  def: CardDefinition | null | undefined,
  requires: PlayConditionEffect['requires'],
): PlayConditionEffect | undefined {
  return getCardEffects(def).find(
    (e): e is PlayConditionEffect => e.type === 'play-condition' && e.requires === requires,
  );
}

/**
 * Returns the player's avatar character (wizard/ringwraith/fallen-wizard/balrog),
 * or `undefined` if the player has no avatar in play. Matches the first character
 * whose definition has `mind === null` and who is controlled under general
 * influence: a Ringwraith follower (an avatar card played under another
 * Ringwraith's control, CoE 2.II.2.1.R5) counts as an avatar card but does
 * not count as its player's avatar.
 */
export function findPlayerAvatar(
  state: GameState,
  player: { readonly characters: Readonly<Record<string, CharacterInPlay>> },
): CharacterInPlay | undefined {
  for (const char of Object.values(player.characters)) {
    if (char.controlledBy !== 'general') continue;
    const def = resolveDef(state, char.instanceId);
    if (isAvatarCharacter(def)) return char;
  }
  return undefined;
}

/**
 * Returns the name of the Fallen-wizard a player counts "as" for the play of
 * Stage resources (CoE 2.2.F2), or `undefined` if the player has no such
 * identity. Used to evaluate the `player.avatar` predicate of "Playable if you
 * are Alatar, Pallando, or Saruman"-style Stage cards (The Fortress of Isen
 * wh-68, A Strident Spawn wh-61, etc.).
 *
 * Unlike {@link findPlayerAvatar}, this does **not** require the avatar
 * character to currently be in play. A Fallen-wizard declares their specific
 * avatar at the start of the game (CoE 1.8.F1, at least one copy must be in the
 * deck) and counts "as" that wizard for non-specific Stage resources from then
 * on. The identity is lost only when the avatar is *eliminated* (CoE 2.2.F2):
 * an eliminated avatar goes to the player's removed-from-play pile and the
 * player can never reveal another (CoE 2.2). Merely not having played the
 * avatar yet — or having it leave play without elimination — does not revoke
 * the identity.
 *
 * Resolution order:
 * - If the avatar character is in play, its name is returned (covers every
 *   alignment, preserving the in-play-avatar semantics for non-Fallen-wizards).
 * - Otherwise, for a Fallen-wizard whose avatar has not been eliminated, the
 *   declared avatar is read off the avatar card present elsewhere in the
 *   player's card pool (hand, play deck, discard pile, or sideboard).
 */
export function findFallenWizardAvatarName(
  state: GameState,
  player: PlayerState,
): string | undefined {
  const inPlay = findPlayerAvatar(state, player);
  if (inPlay) {
    const def = resolveDef(state, inPlay.instanceId);
    return def?.name;
  }
  if (player.alignment !== 'fallen-wizard') return undefined;
  // An eliminated avatar sits in the removed-from-play pile (CoE 2.2); once
  // eliminated the player no longer counts as that Fallen-wizard (CoE 2.2.F2).
  for (const card of player.outOfPlayPile) {
    if (isAvatarCharacter(defById(state, card.definitionId))) return undefined;
  }
  // The declared avatar persists in the player's deck/hand/discard/sideboard
  // even before it is first played (CoE 1.8.F1 guarantees at least one copy).
  for (const card of [...player.hand, ...player.playDeck, ...player.discardPile, ...player.sideboard]) {
    const def = defById(state, card.definitionId);
    if (isAvatarCharacter(def)) return def?.name;
  }
  return undefined;
}

/**
 * Iterates a player's characters-in-play, yielding each `[instanceId, char]`
 * pair with the key correctly typed as a {@link CardInstanceId}.
 *
 * The characters map is keyed by instance ID, but `Object.entries` types the
 * keys as plain `string`, forcing callers to cast each key back to a branded
 * `CardInstanceId`. This helper centralizes that cast so phase handlers can
 * iterate characters without per-call-site assertions.
 */
export function characterEntries(
  player: { readonly characters: Readonly<Record<string, CharacterInPlay>> },
): [CardInstanceId, CharacterInPlay][] {
  return Object.entries(player.characters) as [CardInstanceId, CharacterInPlay][];
}

/**
 * Returns the instance IDs of a player's characters-in-play, correctly typed
 * as {@link CardInstanceId}s rather than plain `string`s. See
 * {@link characterEntries} for why the cast is needed.
 */
export function characterIds(
  player: { readonly characters: Readonly<Record<string, CharacterInPlay>> },
): CardInstanceId[] {
  return Object.keys(player.characters) as CardInstanceId[];
}

/**
 * Returns the company that contains the given character, or `undefined` if no
 * company holds it. Centralizes the recurring `companies.find(c =>
 * c.characters.includes(charId))` lookup so phase handlers can locate a
 * character's company without repeating the membership predicate.
 */
export function findCharacterCompany(
  companies: readonly Company[],
  characterId: CardInstanceId,
): Company | undefined {
  return companies.find(c => c.characters.includes(characterId));
}

/**
 * Returns the company with the given id, or `undefined` if none matches.
 * Centralizes the ubiquitous `companies.find(c => c.id === companyId)` lookup
 * used across combat, organization, and pending-resolution handlers to locate a
 * company by its {@link CompanyId}.
 */
export function companyById(
  companies: readonly Company[],
  id: CompanyId,
): Company | undefined {
  return companies.find(c => c.id === id);
}

/**
 * Finds the player and company containing the given character across all players.
 *
 * Each character belongs to exactly one player's company. This helper replaces the
 * recurring nested-loop pattern that iterates `state.players` to find which player
 * and company a character belongs to — used in effect collection where we need to
 * walk the rest of the company's members.
 *
 * Returns `undefined` if the character is not currently in any company (e.g. it
 * has been eliminated or is between phase transitions).
 */
export function findPlayerAndCompany(
  state: GameState,
  characterId: CardInstanceId,
): { readonly player: PlayerState; readonly playerIndex: number; readonly company: Company } | undefined {
  for (let i = 0; i < state.players.length; i++) {
    const player = state.players[i];
    const company = findCharacterCompany(player.companies, characterId);
    if (company) return { player, playerIndex: i, company };
  }
  return undefined;
}

/**
 * Filters a sideboard to the cards whose definitions match `predicate`,
 * returning `{ instanceId, name }` pairs for legal-action generation. Cards
 * whose definitions cannot be resolved from the card pool are skipped.
 */
export function filterSideboardByDef(
  state: GameState,
  sideboard: readonly CardInstance[],
  predicate: (def: CardDefinition) => boolean,
): { instanceId: CardInstanceId; name: string }[] {
  const result: { instanceId: CardInstanceId; name: string }[] = [];
  for (const card of sideboard) {
    const def = state.cardPool[card.definitionId];
    if (def && predicate(def)) {
      result.push({ instanceId: card.instanceId, name: def.name });
    }
  }
  return result;
}

/**
 * Counts how many cards with the given name are currently in any player's
 * `cardsInPlay`. Used when checking `duplication-limit` constraints with
 * `scope: "game"` to prevent more than the allowed number of copies being
 * in play simultaneously.
 */
/**
 * Returns the effective general-influence pool for the player.
 *
 * The base pool is 20 (CoE 1.54). A Fallen-wizard is the exception (CoE 3.09 /
 * CRF-22 "MEWH"): the white-hand number printed on the left side of his avatar
 * card *is* his general influence once that avatar is in play, replacing the
 * base 20 for as long as it stays in play. Before the avatar is revealed (and
 * for every other alignment) the pool is the base 20. On top of either base,
 * permanent events (e.g. Bade to Rule: +5) contribute `generalInfluenceBonus`.
 */
export function effectiveGeneralInfluence(state: GameState, playerId: PlayerId): number {
  const player = playerById(state, playerId);
  if (!player) return GENERAL_INFLUENCE;
  const bonus = player.generalInfluenceBonus ?? 0;
  const avatar = findPlayerAvatar(state, player);
  if (avatar) {
    const def = resolveDef(state, avatar.instanceId);
    if (isCharacterCard(def) && def.alignment === 'fallen-wizard'
      && 'generalInfluence' in def && typeof def.generalInfluence === 'number') {
      return def.generalInfluence + bonus;
    }
  }
  return GENERAL_INFLUENCE + bonus;
}

export function countCopiesInPlay(state: GameState, name: string): number {
  return state.players.reduce((count, p) =>
    count + p.cardsInPlay.filter(c => defById(state, c.definitionId)?.name === name).length,
  0);
}

/**
 * Count cards named `name` that `player` holds: copies in their `cardsInPlay`
 * (non-attached permanent events like Great Patron wh-72) plus copies among
 * their characters' `items`. Backs `duplication-limit` checks with
 * `scope: "player"` ("cannot be duplicated by a given player").
 */
export function countPlayerHeldCopies(state: GameState, player: PlayerState, name: string): number {
  const inPlay = player.cardsInPlay.filter(c => defById(state, c.definitionId)?.name === name).length;
  return Object.values(player.characters).reduce(
    (count, ch) => count + ch.items.filter(item => defById(state, item.definitionId)?.name === name).length,
    inPlay,
  );
}

/**
 * Count cards named `name` attached to the company's characters (their
 * `items` or `allies`). Backs `duplication-limit` checks with
 * `scope: "company"` for attachable cards ("cannot be duplicated in a
 * given company").
 */
export function countAttachedInCompany(
  state: GameState,
  player: PlayerState,
  company: Company,
  name: string,
  kind: 'items' | 'allies',
): number {
  return company.characters.reduce((count, charInstId) => {
    const ch = player.characters[charInstId];
    if (!ch) return count;
    return count + ch[kind].filter(att => defById(state, att.definitionId)?.name === name).length;
  }, 0);
}

/**
 * Count cards named `name` in any player's `cardsInPlay` that are bound to
 * the given company. Backs `duplication-limit` checks with
 * `scope: "company"` for company-targeting events.
 */
export function countCompanyBoundCopies(state: GameState, name: string, companyId: CompanyId): number {
  return state.players.reduce((count, p) =>
    count + p.cardsInPlay.filter(c =>
      defById(state, c.definitionId)?.name === name
        && (c.companyId as string | undefined) === (companyId as string),
    ).length,
  0);
}

/**
 * Count copies of the permanent event named `name` currently bound to the
 * site identified by `siteDefId`. A copy counts when it is borne as an item by
 * a character whose company occupies that site, or when it is a site-attached
 * permanent event living in `cardsInPlay` with `attachedToSite === siteDefId`.
 * Backs `duplication-limit` checks with `scope: "site"` (e.g. Guarded Haven
 * wh-74 / Saruman's Machinery wh-120: "Cannot be duplicated on a given site").
 */
export function countPermanentEventCopiesAtSite(state: GameState, name: string, siteDefId: CardDefinitionId): number {
  return state.players.reduce((count, p) => {
    for (const co of p.companies) {
      const coSiteDefId = co.currentSite ? resolveInstanceId(state, co.currentSite.instanceId) : undefined;
      if (coSiteDefId !== (siteDefId as string)) continue;
      for (const cId of co.characters) {
        const ch = p.characters[cId];
        if (!ch) continue;
        count += ch.items.filter(item => defById(state, item.definitionId)?.name === name).length;
      }
    }
    count += p.cardsInPlay.filter(c => c.attachedToSite === siteDefId && defById(state, c.definitionId)?.name === name).length;
    return count;
  }, 0);
}

/**
 * Resolve a list of card instances (items, allies, possessions, …) to their
 * definition names, dropping any that fail to resolve. Centralizes the
 * `instances.map(defById(...)?.name).filter(defined)` pattern used to build
 * condition-matcher contexts (`itemNames`, `allyNames`, `possessions`).
 */
export function defNamesOf(state: GameState, instances: readonly { readonly definitionId: CardDefinitionId }[]): string[] {
  return instances
    .map(i => defById(state, i.definitionId)?.name)
    .filter((n): n is string => n != null);
}

/**
 * Collect the combined `keywords` of all given item instances. Used to build
 * the `itemKeywords` field of condition-matcher contexts so filters can gate
 * on an item keyword borne by a character (e.g. `target.itemKeywords`).
 */
export function itemKeywordsOf(state: GameState, items: readonly { readonly definitionId: CardDefinitionId }[]): string[] {
  return items.flatMap(item => {
    const iDef = defById(state, item.definitionId);
    return iDef && 'keywords' in iDef ? (iDef as { keywords?: readonly string[] }).keywords ?? [] : [];
  });
}

/**
 * Collect the `subtype` of all given item instances that declare one. Used to
 * build the `itemSubtypes` field of condition-matcher contexts.
 */
export function itemSubtypesOf(state: GameState, items: readonly { readonly definitionId: CardDefinitionId }[]): string[] {
  return items
    .map(item => {
      const iDef = defById(state, item.definitionId);
      return iDef && 'subtype' in iDef ? (iDef as { subtype?: string }).subtype : undefined;
    })
    .filter((s): s is string => s != null);
}

/**
 * True if any player has a card with the given name among their characters or
 * cards in play. Used for "card-not-in-play" play conditions, where the named
 * blocker may be either a character or a permanent in play.
 */
export function isCardNameInPlayOrCharacters(state: GameState, name: string): boolean {
  return state.players.some(p =>
    Object.values(p.characters).some(ch => defById(state, ch.definitionId)?.name === name) ||
    p.cardsInPlay.some(c => defById(state, c.definitionId)?.name === name),
  );
}

/**
 * Parse a comma-separated homesite string into individual site name tokens.
 * e.g. "Goblin-gate, Mount Gundabad" → ["Goblin-gate", "Mount Gundabad"].
 * An empty or whitespace-only string yields an empty array, so callers can pass
 * `def.homesite ?? ''` without a separate truthiness guard.
 */
export function parseHomesiteNames(homesite: string): string[] {
  return homesite.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * True if a character named `charName` is already in play as a character on
 * either player. Backs the uniqueness check shared by the organization phase
 * and recruit-via-event: a `unique` character cannot be brought into play while
 * a same-named character is already in play. (The `.unique` gate lives at the
 * call site; this only tests name-in-play.)
 */
export function isUniqueCharacterInPlay(state: GameState, charName: string): boolean {
  for (const p of state.players) {
    for (const char of Object.values(p.characters)) {
      const def = resolveDef(state, char.instanceId);
      if (isCharacterCard(def) && def.name === charName) return true;
    }
  }
  return false;
}

/**
 * Enter the deck exhaustion sub-flow: return site cards to location deck,
 * set deckExhaustPending so the player can exchange cards with the sideboard.
 */
export function startDeckExhaust(state: GameState, playerIndex: 0 | 1): GameState {
  const player = state.players[playerIndex];
  logHeading(`Deck exhaustion started for ${player.name}`);
  logDetail(`Returning ${player.siteDiscardPile.length} site card(s) to location deck`);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...player,
    siteDeck: [...player.siteDeck, ...player.siteDiscardPile],
    siteDiscardPile: [],
    deckExhaustPending: true,
    deckExhaustExchangeCount: 0,
  };

  return { ...state, players: newPlayers };
}

/**
 * Complete the deck exhaustion: shuffle the discard pile into a new play deck,
 * increment exhaustion count, and clear the pending flag.
 *
 * Fires `play-deck-exhausted` — discards any permanent event in either
 * player's `cardsInPlay` that declares `on-event: play-deck-exhausted` with a
 * self-discard `move` apply (e.g. Safe from the Shadow, Tokens to Show).
 */
export function completeDeckExhaust(state: GameState, playerIndex: 0 | 1): GameState {
  const player = state.players[playerIndex];
  const newExhaustionCount = player.deckExhaustionCount + 1;
  logHeading(`Deck exhaustion #${newExhaustionCount} complete for ${player.name}`);

  const [newPlayDeck, newRng] = shuffle([...player.discardPile], state.rng);
  logDetail(`Shuffled ${player.discardPile.length} card(s) from discard into new play deck`);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...player,
    playDeck: newPlayDeck,
    discardPile: [],
    deckExhaustionCount: newExhaustionCount,
    deckExhaustPending: false,
    deckExhaustExchangeCount: 0,
  };

  let result: GameState = { ...state, players: newPlayers, rng: newRng };

  // Fire play-deck-exhausted: discard permanent events that auto-discard on deck exhaustion.
  for (let pi = 0; pi < 2; pi++) {
    const p = result.players[pi];
    const toDiscard: typeof p.cardsInPlay[0][] = [];
    for (const card of p.cardsInPlay) {
      const def = defById(result, card.definitionId);
      if (getOnEventEffects(def, 'play-deck-exhausted').some(e => isSelfDiscardMove(e.apply))) {
        toDiscard.push(card);
      }
    }
    if (toDiscard.length === 0) continue;
    const discardIds = new Set(toDiscard.map(c => c.instanceId));
    const updatedPlayers = result.players.map((pl, idx) => {
      if (idx !== pi) return pl;
      const remaining = pl.cardsInPlay.filter(c => !discardIds.has(c.instanceId));
      const discarded = pl.discardPile.concat(toDiscard.map(c => ({ instanceId: c.instanceId, definitionId: c.definitionId })));
      logDetail(`play-deck-exhausted: discarding ${toDiscard.map(c => cardName(result, c.definitionId)).join(', ')} from player ${pl.name} cardsInPlay`);
      return { ...pl, cardsInPlay: remaining, discardPile: discarded };
    });
    result = { ...result, players: updatedPlayers as unknown as typeof result.players };
  }

  return result;
}

/**
 * Handle exchange-sideboard during deck exhaustion sub-flow.
 * Swaps one card between discard pile and sideboard.
 */
export function handleExchangeSideboard(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'exchange-sideboard') return { state, error: 'Expected exchange-sideboard action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  if (!player.deckExhaustPending) {
    return { state, error: 'No deck exhaustion sub-flow active' };
  }
  if (player.deckExhaustExchangeCount >= 5) {
    return { state, error: 'Already exchanged 5 cards' };
  }

  const discardIdx = player.discardPile.findIndex(c => c.instanceId === action.discardCardInstanceId);
  if (discardIdx === -1) {
    return { state, error: 'Card not found in discard pile' };
  }
  const sideboardIdx = player.sideboard.findIndex(c => c.instanceId === action.sideboardCardInstanceId);
  if (sideboardIdx === -1) {
    return { state, error: 'Card not found in sideboard' };
  }

  const discardCard = player.discardPile[discardIdx];
  const sideboardCard = player.sideboard[sideboardIdx];
  const discardName = cardName(state, discardCard.definitionId, '?');
  const sideboardName = cardName(state, sideboardCard.definitionId, '?');
  logDetail(`Exchange: ${discardName} (discard → sideboard) ↔ ${sideboardName} (sideboard → discard)`);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...player,
    discardPile: [...removeById(player.discardPile, discardCard.instanceId), sideboardCard],
    sideboard: [...removeById(player.sideboard, sideboardCard.instanceId), discardCard],
    deckExhaustExchangeCount: player.deckExhaustExchangeCount + 1,
  };

  return { state: { ...state, players: newPlayers } };
}

/**
 * Auto-joins the active player's companies that end up at the same
 * non-haven site at the end of all movement/hazard phases (CoE rule
 * 2.IV.6: "The resource player must immediately join any companies at
 * the same non-haven site at the end of a turn's movement/hazard
 * phases"). Companies sharing a haven are left alone — joining havens
 * is always a player choice.
 *
 * Companies are joined in declaration order: the first company at each
 * non-haven site becomes the target, and every subsequent company there
 * has its characters folded into the target and is removed. The merged
 * company keeps `siteCardOwned=true` if any of the merging companies
 * held the physical site card.
 */
export function autoMergeNonHavenCompanies(state: GameState, playerIndex: number): GameState {
  const player = state.players[playerIndex];
  if (player.companies.length < 2) return state;

  // Group companies by site instance id, preserving encounter order.
  const groups = new Map<string, number[]>();
  for (let i = 0; i < player.companies.length; i++) {
    const c = player.companies[i];
    if (!c.currentSite) continue;
    const key = c.currentSite.instanceId as string;
    const existing = groups.get(key);
    if (existing) {
      existing.push(i);
    } else {
      groups.set(key, [i]);
    }
  }

  // Collect indices to remove and the target index per group.
  const mergeMap = new Map<number, number[]>(); // target idx → source idxs to fold in
  for (const [siteInstanceId, indices] of groups) {
    if (indices.length < 2) continue;
    const firstIdx = indices[0];
    const siteDef = state.cardPool[player.companies[firstIdx].currentSite!.definitionId];
    const isHaven = siteDef && isSiteCard(siteDef) && siteDef.siteType === 'haven';
    if (isHaven) continue;
    mergeMap.set(firstIdx, indices.slice(1));
    logDetail(`Auto-merge rule 2.IV.6: ${indices.length} companies at non-haven site ${siteDef?.name ?? siteInstanceId} → joining into company ${player.companies[firstIdx].id as string}`);
  }

  if (mergeMap.size === 0) return state;

  const toRemove = new Set<number>();
  for (const sources of mergeMap.values()) for (const s of sources) toRemove.add(s);

  const companies: Company[] = [];
  for (let i = 0; i < player.companies.length; i++) {
    if (toRemove.has(i)) continue;
    const c = player.companies[i];
    const folds = mergeMap.get(i);
    if (!folds || folds.length === 0) {
      companies.push(c);
      continue;
    }
    let characters = [...c.characters];
    let siteCardOwned = c.siteCardOwned;
    let onGuardCards = [...c.onGuardCards];
    let hazards = [...c.hazards];
    for (const srcIdx of folds) {
      const src = player.companies[srcIdx];
      characters = [...characters, ...src.characters];
      siteCardOwned = siteCardOwned || src.siteCardOwned;
      onGuardCards = [...onGuardCards, ...src.onGuardCards];
      hazards = [...hazards, ...src.hazards];
    }
    companies.push({ ...c, characters, siteCardOwned, onGuardCards, hazards });
  }

  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[playerIndex] = { ...player, companies };
  return sweepAutoDiscardResourceEvents(sweepAutoDiscardHazards({ ...state, players: newPlayers }));
}

/**
 * Removes companies with no characters and returns their site cards
 * to the player's site deck.
 */
export function cleanupEmptyCompanies(state: GameState): GameState {
  const newPlayers = state.players.map(player => {
    const emptyCompanies = player.companies.filter(c => c.characters.length === 0);
    const keptCompanies = player.companies.filter(c => c.characters.length > 0);

    // Build a set of site instance IDs still occupied by a kept company.
    // If another company is at the same site, the site stays in play (CoE rule 2.07).
    const occupiedSiteIds = new Set(
      keptCompanies.map(c => c.currentSite?.instanceId as string).filter(Boolean),
    );

    // Return sites from empty companies: tapped sites go to discard, untapped to site deck.
    // Skip if another company from the same player is still at that site.
    const untappedSites: CardInstance[] = [];
    const tappedSites: CardInstance[] = [];
    for (const c of emptyCompanies) {
      if (c.currentSite) {
        if (occupiedSiteIds.has(c.currentSite.instanceId as string)) {
          logDetail(`cleanupEmptyCompanies: site ${c.currentSite.instanceId as string} still occupied by another company — leaving in play`);
          continue;
        }
        const siteCardInst = toCardInstance(c.currentSite);
        if (c.currentSite.status === CardStatus.Tapped) {
          tappedSites.push(siteCardInst);
        } else {
          untappedSites.push(siteCardInst);
        }
      }
    }
    const newSiteDeck = [...player.siteDeck, ...untappedSites];

    // CoE rule 2.07: permanent-events bound to a now-empty company are discarded.
    const emptyCompanyIds = new Set(emptyCompanies.map(c => c.id as string));
    const boundToEmpty = player.cardsInPlay.filter(c => c.companyId && emptyCompanyIds.has(c.companyId as string));
    const remainingCardsInPlay = player.cardsInPlay.filter(c => !c.companyId || !emptyCompanyIds.has(c.companyId as string));
    if (boundToEmpty.length > 0) {
      logDetail(`cleanupEmptyCompanies: discarding ${boundToEmpty.length} permanent-event(s) bound to empty company/companies`);
    }

    const newDiscardPile = [...player.discardPile, ...tappedSites, ...boundToEmpty.map(toCardInstance)];

    return { ...player, companies: keptCompanies, siteDeck: newSiteDeck, discardPile: newDiscardPile, cardsInPlay: remainingCardsInPlay };
  });

  return { ...state, players: [newPlayers[0], newPlayers[1]] };
}

/**
 * Fires the `company-composition-changed` event against every attached
 * hazard carrying an `on-event` + self-discard `move` effect for that event.
 * When the effect's `when` condition is met, the hazard is discarded to
 * its owner's discard pile — the same pattern Treebeard uses for
 * `company-arrives-at-site`, reused here for hazards that care about
 * company size (e.g. Alone and Unadvised).
 */
export function sweepAutoDiscardHazards(state: GameState): GameState {
  let changed = false;
  const newPlayers = clonePlayers(state);

  for (let pi = 0; pi < 2; pi++) {
    const player = newPlayers[pi];
    for (const company of player.companies) {
      const companyCharCount = company.characters.length;
      for (const charId of company.characters) {
        const char = player.characters[charId];
        if (!char) continue;
        const toDiscard: CardInstanceId[] = [];
        for (const hazard of char.hazards) {
          const hDef = defById(state, hazard.definitionId);
          // Match a self-discard `move` (the hazard discards itself to its
          // owner's discard pile) gated on the company-size `when` condition.
          const ctx = { company: { characterCount: companyCharCount } };
          const trigger = getOnEventEffects(hDef, 'company-composition-changed').find(
            e => isSelfDiscardMove(e.apply) && !!e.when && matchesCondition(e.when, ctx),
          );
          if (trigger) {
            logDetail(`self-discard move: "${hDef?.name}" on ${charId as string} (company size ${companyCharCount})`);
            toDiscard.push(hazard.instanceId);
          }
        }
        if (toDiscard.length > 0) {
          changed = true;
          const discardSet = new Set(toDiscard as string[]);
          const discarded = char.hazards.filter(h => discardSet.has(h.instanceId as string));
          const remaining = char.hazards.filter(h => !discardSet.has(h.instanceId as string));
          // Remove hazards from the character
          newPlayers[pi] = {
            ...newPlayers[pi],
            characters: {
              ...newPlayers[pi].characters,
              [charId]: { ...newPlayers[pi].characters[charId], hazards: remaining },
            },
          };
          // Hazards are owned by the opponent (hazard player = 1 - pi)
          const hazOwnerIdx = 1 - pi;
          newPlayers[hazOwnerIdx] = {
            ...newPlayers[hazOwnerIdx],
            discardPile: [...newPlayers[hazOwnerIdx].discardPile, ...discarded.map(toCardInstance)],
          };
        }
      }
    }
  }

  return changed ? { ...state, players: [newPlayers[0], newPlayers[1]] as unknown as typeof state.players } : state;
}

/**
 * Sweeps resource permanent events attached to characters' `items` slots that
 * carry `on-event: company-composition-changed` + a `move self→discard` apply.
 *
 * Mirrors {@link sweepAutoDiscardHazards} but for resource-side events. The
 * context extended with `company.hasHigherMindThanBearer` lets cards like
 * *By the Ringwraith's Word* declare a conditional auto-discard.
 *
 * `hasHigherMindThanBearer` is `true` when any other character in the bearer's
 * company has a non-null `mind` value strictly greater than the bearer's own
 * non-null `mind`. Both sides must have numeric minds; null-mind avatars do not
 * participate in the comparison.
 *
 * Call after any action that changes a company's character roster.
 */
export function sweepAutoDiscardResourceEvents(state: GameState): GameState {
  let changed = false;
  const newPlayers = clonePlayers(state);

  for (let pi = 0; pi < 2; pi++) {
    const player = newPlayers[pi];
    for (const company of player.companies) {
      const companyCharCount = company.characters.length;

      // Pre-compute mind values for all characters in this company
      const companyMinds: number[] = [];
      for (const chId of company.characters) {
        const ch = player.characters[chId];
        if (!ch) continue;
        const chDef = state.cardPool[ch.definitionId];
        const mind = chDef && 'mind' in chDef && typeof (chDef as { mind: unknown }).mind === 'number'
          ? (chDef as { mind: number }).mind
          : null;
        if (mind !== null) companyMinds.push(mind);
      }

      for (const charId of company.characters) {
        const char = player.characters[charId];
        if (!char) continue;

        // Determine bearer's mind for higher-mind comparison
        const bearerDef = state.cardPool[char.definitionId];
        const bearerMind = bearerDef && 'mind' in bearerDef && typeof (bearerDef as { mind: unknown }).mind === 'number'
          ? (bearerDef as { mind: number }).mind
          : null;
        const hasHigherMindThanBearer = bearerMind !== null
          && companyMinds.some(m => m > bearerMind);

        const ctx = { company: { characterCount: companyCharCount, hasHigherMindThanBearer } };

        const toDiscard: string[] = [];
        for (const item of char.items) {
          const itemDef = defById(state, item.definitionId);
          const trigger = getOnEventEffects(itemDef, 'company-composition-changed').find(
            e => isSelfDiscardMove(e.apply) && !!e.when && matchesCondition(e.when, ctx),
          );
          if (trigger) {
            logDetail(`sweepAutoDiscardResourceEvents: "${itemDef?.name}" on ${charId as string} (hasHigherMind=${hasHigherMindThanBearer})`);
            toDiscard.push(item.instanceId as string);
          }
        }

        if (toDiscard.length > 0) {
          changed = true;
          const discardSet = new Set(toDiscard);
          const discarded = char.items.filter(i => discardSet.has(i.instanceId as string));
          const remaining = char.items.filter(i => !discardSet.has(i.instanceId as string));
          newPlayers[pi] = {
            ...newPlayers[pi],
            characters: {
              ...newPlayers[pi].characters,
              [charId]: { ...newPlayers[pi].characters[charId], items: remaining },
            },
            discardPile: [...newPlayers[pi].discardPile, ...discarded.map(toCardInstance)],
          };
        }
      }
    }
  }

  return changed ? { ...state, players: [newPlayers[0], newPlayers[1]] as unknown as typeof state.players } : state;
}

/**
 * Post-action housekeeping primitive: discard every in-play card matching
 * `predicate` from each player's `cardsInPlay` into that **same** player's
 * `discardPile`. Returns the (possibly unchanged) state together with the
 * instance ids that were discarded, so callers that must also prune dependent
 * state (e.g. {@link discardOrphanedSiteAttachedEvents}, which clears the
 * discarded cards' `activeConstraints`) can do so.
 *
 * When nothing matches, the returned `state` is the **same reference** as the
 * input (no allocation), preserving reducer identity for no-op sweeps.
 * `onDiscard` is invoked once per matched card, in `cardsInPlay` order, before
 * the card is moved — use it for per-card logging.
 *
 * Centralizes the "partition `cardsInPlay` by a predicate, route matches to
 * discard" skeleton shared by the company/leader/orphan-event sweeps. The
 * no-card-may-disappear invariant is upheld: every card removed from
 * `cardsInPlay` is appended to `discardPile`.
 */
export function discardCardsInPlayWhere(
  state: GameState,
  predicate: (card: CardInPlay, player: PlayerState) => boolean,
  onDiscard?: (card: CardInPlay, player: PlayerState) => void,
): { readonly state: GameState; readonly removedInstanceIds: readonly CardInstanceId[] } {
  let changed = false;
  const removedInstanceIds: CardInstanceId[] = [];
  const newPlayers = clonePlayers(state);

  for (let pi = 0; pi < 2; pi++) {
    const player = newPlayers[pi];
    const matched = player.cardsInPlay.filter(c => predicate(c, player));
    if (matched.length === 0) continue;
    changed = true;
    const matchedSet = new Set(matched.map(c => c.instanceId as string));
    for (const card of matched) {
      removedInstanceIds.push(card.instanceId);
      onDiscard?.(card, player);
    }
    newPlayers[pi] = {
      ...player,
      cardsInPlay: player.cardsInPlay.filter(c => !matchedSet.has(c.instanceId as string)),
      discardPile: [...player.discardPile, ...matched.map(toCardInstance)],
    };
  }

  if (!changed) return { state, removedInstanceIds };
  return {
    state: { ...state, players: [newPlayers[0], newPlayers[1]] as unknown as typeof state.players },
    removedInstanceIds,
  };
}

/**
 * Fires the `company-membership-changes` event against every company-targeted
 * permanent event (cardsInPlay with a matching `companyId`) that carries an
 * `on-event: company-membership-changes` + self-discard `move` effect. Used by
 * Fellowship, which must be discarded whenever any character or ally joins or
 * leaves the company it was played on.
 *
 * Call after any action that changes a company's character or ally roster,
 * passing every affected company ID.
 */
export function sweepCompanyMembershipChangedEvents(
  state: GameState,
  affectedCompanyIds: readonly CompanyId[],
): GameState {
  if (affectedCompanyIds.length === 0) return state;
  const affected = new Set(affectedCompanyIds.map(id => id as string));
  return discardCardsInPlayWhere(
    state,
    card => {
      if (!affected.has(card.companyId as string)) return false;
      const def = defById(state, card.definitionId);
      return getOnEventEffects(def, 'company-membership-changes').some(
        e => isSelfDiscardMove(e.apply),
      );
    },
    card => {
      const def = state.cardPool[card.definitionId] as { name?: string } | undefined;
      logDetail(`company-membership-changes: discarding "${def?.name}" (company ${card.companyId as string})`);
    },
  ).state;
}

/**
 * Fires the `leader-leaves-company` event against every company-targeted
 * permanent event (cardsInPlay with a matching `companyId`) that carries an
 * `on-event: leader-leaves-company` + self-discard `move` apply. Used by
 * *Orders from Lugbúrz* (as-94), which must be discarded whenever a leader
 * leaves the company it was played on.
 *
 * Call after any action that removes a leader character from a company,
 * passing every affected company ID.
 */
export function sweepLeaderLeavesCompanyEvents(
  state: GameState,
  affectedCompanyIds: readonly CompanyId[],
): GameState {
  if (affectedCompanyIds.length === 0) return state;
  const affected = new Set(affectedCompanyIds.map(id => id as string));
  return discardCardsInPlayWhere(
    state,
    card => {
      if (!affected.has(card.companyId as string)) return false;
      const def = defById(state, card.definitionId);
      return getOnEventEffects(def, 'leader-leaves-company').some(
        e => isSelfDiscardMove(e.apply),
      );
    },
    card => {
      const def = state.cardPool[card.definitionId] as { name?: string } | undefined;
      logDetail(`leader-leaves-company: discarding "${def?.name}" (company ${card.companyId as string})`);
    },
  ).state;
}

/**
 * Discard any faction held under a leader's control (`controlledBy` set, the LE
 * "Orcs of Udûn"-style factions) whose controlling character is no longer in
 * that player's `characters` — i.e. the leader has **left play** (eliminated,
 * influenced away, etc.). Implements "Discard the faction if the leader … leaves
 * play." Runs as post-action housekeeping so every removal path is covered by a
 * single chokepoint; the "leader moves" half is handled at M/H step 8.
 */
export function discardOrphanedControlledFactions(state: GameState): GameState {
  return discardCardsInPlayWhere(
    state,
    (card, player) => card.controlledBy !== undefined && !player.characters[card.controlledBy],
    card => {
      const def = state.cardPool[card.definitionId] as { name?: string } | undefined;
      logDetail(`leader-control: discarding "${def?.name ?? card.definitionId}" — controlling leader left play`);
    },
  ).state;
}

/**
 * Discards site-bound permanent events whose site has left play. A card with
 * `attachedToSite` set models a permanent event that transforms a specific
 * site (Hold Rebuilt and Repaired, as-88 — "Discard this card when the site
 * is discarded or returned to its location deck"). The site is considered
 * gone once no company on either side has a `currentSite` of that definition
 * id (M/H step 8 returns an untapped non-haven origin to the location deck or
 * discards a tapped one). When a bound card is discarded, every active
 * constraint it sourced (the site-type override and the auto-attacks-detainment
 * flag) is cleared so the transformation does not outlive the card.
 *
 * Runs as a post-action sweep alongside {@link discardOrphanedControlledFactions}.
 */
/**
 * The prisoners that the player at `playerIndex` may rescue at the company's
 * current site (CoE rule 8.36): a hazard host whose `rescueSiteCard` matches
 * the company's current site location and that holds at least one prisoner who
 * is a member of the active company. Returns the host instance and the
 * rescuable prisoner ids, or null if no rescue is available. Shared by the
 * legal-action layer (which offers `rescue-prisoner`) and the reducer (which
 * resolves it).
 */
export function rescuablePrisonersAtSite(
  state: GameState,
  playerIndex: number,
  companyIndex: number,
): { hostInstanceId: CardInstanceId; prisonerIds: readonly CardInstanceId[] } | null {
  const player = state.players[playerIndex];
  const company = player.companies[companyIndex];
  if (!company?.currentSite) return null;
  const siteDefId = company.currentSite.definitionId;
  const companyChars = new Set(company.characters.map(c => c as string));
  for (const host of state.hazardHosts) {
    if (host.prisoners.length === 0) continue;
    if (host.rescueSiteCard.definitionId !== siteDefId) continue;
    const prisonerIds = host.prisoners.filter(p => companyChars.has(p as string));
    if (prisonerIds.length > 0) {
      return { hostInstanceId: host.hostCard.instanceId, prisonerIds };
    }
  }
  return null;
}

export function discardOrphanedSiteAttachedEvents(state: GameState): GameState {
  const occupied = new Set<string>();
  for (const p of state.players) {
    for (const co of p.companies) {
      if (co.currentSite) occupied.add(co.currentSite.definitionId as string);
    }
  }

  // A site-attached event that is currently holding prisoners (e.g. Troll-purse
  // dm-95) must persist while its prisoners are held — discarding it would
  // orphan their `character-is-prisoner` constraints. Such hosts are exempt
  // from the orphan sweep.
  const activeHosts = new Set<string>();
  for (const host of state.hazardHosts) {
    if (host.prisoners.length > 0) activeHosts.add(host.hostCard.instanceId as string);
  }

  const { state: next, removedInstanceIds } = discardCardsInPlayWhere(
    state,
    card => card.attachedToSite !== undefined
      && !occupied.has(card.attachedToSite as string)
      && !activeHosts.has(card.instanceId as string),
    card => {
      const def = state.cardPool[card.definitionId] as { name?: string } | undefined;
      logDetail(`site-attached event: discarding "${def?.name ?? card.definitionId}" — bound site ${card.attachedToSite as string} left play`);
    },
  );

  if (removedInstanceIds.length === 0) return state;
  const removedSources = new Set(removedInstanceIds.map(id => id as string));
  return {
    ...next,
    activeConstraints: next.activeConstraints.filter(c => !removedSources.has(c.source as string)),
  };
}

/**
 * Saruman's Machinery (wh-120): returns true when an active
 * `technology-item-unlocked` constraint binds `siteDefId` and is owned by
 * `playerId`. While such a constraint is active, the owning player may play one
 * Technology-keyword item at that site during the site phase whether the site is
 * tapped or untapped (the per-phase limit is tracked separately by
 * `SitePhaseState.technologyItemPlayed`). Shared by the legal-action layer
 * (`legal-actions/site.ts`, which offers the play) and the reducer
 * (`reducer-site.ts`, which records the play and leaves the site untapped).
 */
export function siteHasTechnologyItemUnlock(
  state: GameState,
  siteDefId: CardDefinitionId | undefined,
  playerId: PlayerId,
): boolean {
  return hasSiteFlagForPlayer(state.activeConstraints, 'technology-item-unlocked', siteDefId, playerId);
}

/**
 * Discard "placed with the creature" events whose converted-creature ally has
 * left play. A `convert-creature-to-ally` event (Ready to His Will le-220) is
 * kept in cards-in-play with `attachedTo` set to the ally created from the
 * converted creature. When that ally is eliminated or otherwise removed from
 * every company, the event is orphaned and must be discarded (it can no longer
 * score its ally marshalling point). Mirrors
 * {@link discardOrphanedSiteAttachedEvents}.
 */
export function discardOrphanedConvertedAllyEvents(state: GameState): GameState {
  // Collect every ally instance currently in play.
  const allyIds = new Set<string>();
  for (const p of state.players) {
    for (const ch of Object.values(p.characters)) {
      for (const ally of ch.allies) allyIds.add(ally.instanceId as string);
    }
  }

  return discardCardsInPlayWhere(
    state,
    card => {
      if (card.attachedTo === undefined || allyIds.has(card.attachedTo as string)) return false;
      const def = resolveDef(state, card.instanceId);
      const effects = def ? getCardEffects(def) : [];
      return effects.some(e => e.type === 'convert-creature-to-ally');
    },
    card => {
      const def = state.cardPool[card.definitionId] as { name?: string } | undefined;
      logDetail(`converted-ally event: discarding "${def?.name ?? card.definitionId}" — its converted-creature ally left play`);
    },
  ).state;
}

/**
 * The active player's companies that have not yet been handled this phase,
 * offered as `select-company` actions. Shared by the site phase and the
 * movement/hazard phase: the resource player picks which unhandled company
 * resolves next. Only the active player may select; the opponent receives no
 * actions during this step. `handledCompanyIds` is the phase state's running
 * set of already-resolved companies (`SitePhaseState.handledCompanyIds` /
 * `MovementHazardPhaseState.handledCompanyIds`).
 */
export function selectCompanyActions(
  state: GameState,
  playerId: PlayerId,
  handledCompanyIds: readonly CompanyId[],
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during select-company step`);
    return [];
  }

  const player = playerById(state, playerId)!;
  const handledSet = new Set(handledCompanyIds);

  const actions: GameAction[] = [];
  for (const company of player.companies) {
    if (handledSet.has(company.id)) {
      logDetail(`Company ${company.id} already handled — skipping`);
      continue;
    }
    logDetail(`Company ${company.id} not yet handled — offering select-company`);
    actions.push({ type: 'select-company', player: playerId, companyId: company.id });
  }

  logDetail(`${actions.length} unhandled company(ies) available for selection`);
  return actions;
}

/**
 * Build a fresh {@link CombatState} for a newly-initiated attack, filling the
 * four fields every fresh combat starts with: empty strike assignments, strike
 * index 0, the `assign-strikes` phase, and no body-check target. Callers pass
 * the attack-specific fields (source, players, prowess, body, assignmentPhase,
 * detainment, and any optional flags).
 */
export function makeCombatState(
  fields: Omit<CombatState, 'strikeAssignments' | 'currentStrikeIndex' | 'phase' | 'bodyCheckTarget'>,
): CombatState {
  return {
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    bodyCheckTarget: null,
    ...fields,
  };
}

/**
 * Generate a unique company ID for a player by finding the highest existing
 * index among their companies and incrementing it. This avoids ID collisions
 * that can occur when companies are merged (removing lower-indexed IDs) and
 * then new companies are created.
 */
export function nextCompanyId(player: PlayerState): CompanyId {
  const maxIdx = player.companies.reduce((max, c) => {
    const match = (c.id as string).match(/company-.*-(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, -1);
  return `company-${player.id as string}-${maxIdx + 1}` as CompanyId;
}

/**
 * True when `companyId` has an in-play permanent event (either player's
 * `cardsInPlay`) bound to it that carries the `block-company-joins` play-flag
 * (Fell Rider le-183). While such a card is in play, no ally and no
 * direct-influence follower may join the company.
 */
export function companyBlocksJoins(state: GameState, companyId: CompanyId): boolean {
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      if (card.companyId !== companyId) continue;
      const def = defById(state, card.definitionId);
      if (def && hasPlayFlag(def as { effects?: readonly CardEffect[] }, 'block-company-joins')) return true;
    }
  }
  return false;
}

/**
 * Discards every ally and every direct-influence follower character in the
 * given company (Fell Rider le-183: "Discard all allies and Ringwraith
 * followers in the company"). Allies and follower items go to the controlling
 * player's discard pile; follower hazards go to the opponent's. The company's
 * non-follower members (the Ringwraith avatar and any GI-controlled
 * characters) keep their slots but lose their allies. A company-membership
 * sweep runs afterwards so other company-bound cards react to the departures.
 * Direct-influence usage is recomputed by the top-level reducer.
 */
export function purgeCompanyAlliesAndFollowers(
  state: GameState,
  playerIndex: number,
  companyId: CompanyId,
): GameState {
  const player = state.players[playerIndex];
  const company = player.companies.find(c => c.id === companyId);
  if (!company) return state;
  const opponentIndex = playerIndex === 0 ? 1 : 0;

  const newChars: Record<string, CharacterInPlay> = { ...player.characters };
  const discard: CardInstance[] = [...player.discardPile];
  const oppDiscard: CardInstance[] = [...state.players[opponentIndex].discardPile];

  // Followers in the company = characters controlled by another character.
  const followerSet = new Set<string>();
  for (const id of company.characters) {
    const c = newChars[id as string];
    if (c && c.controlledBy !== 'general') followerSet.add(id as string);
  }

  // Discard every ally borne by any character in the company.
  for (const id of company.characters) {
    const c = newChars[id as string];
    if (!c) continue;
    for (const ally of c.allies) discard.push(toCardInstance(ally));
  }

  // Discard each follower character entirely (items → owner discard, hazards → opponent).
  for (const id of followerSet) {
    const f = newChars[id];
    if (!f) continue;
    for (const item of f.items) discard.push(toCardInstance(item));
    for (const hz of f.hazards) oppDiscard.push(toCardInstance(hz));
    discard.push(toCardInstance(f));
    delete newChars[id];
  }

  // Remaining (non-follower) members keep their slot but lose allies, and drop
  // any discarded follower from their `followers` list.
  for (const id of company.characters) {
    if (followerSet.has(id as string)) continue;
    const c = newChars[id as string];
    if (!c) continue;
    newChars[id as string] = {
      ...c,
      allies: [],
      followers: c.followers.filter(fid => !followerSet.has(fid as string)),
    };
  }

  const newCompanies = player.companies.map(co =>
    co.id === companyId
      ? { ...co, characters: co.characters.filter(id => !followerSet.has(id as string)) }
      : co,
  );

  const updatedPlayers = state.players.map((p, i) =>
    i === playerIndex
      ? { ...player, characters: newChars, companies: newCompanies, discardPile: discard }
      : i === opponentIndex
        ? { ...p, discardPile: oppDiscard }
        : p,
  ) as unknown as readonly [PlayerState, PlayerState];

  const result: GameState = { ...state, players: updatedPlayers };
  return sweepCompanyMembershipChangedEvents(result, [companyId]);
}

export function discardEventCard(state: GameState, cardInstanceId: CardInstanceId, playerIndex: number): GameState {
  const player = state.players[playerIndex];
  const eventCard = findById(player.cardsInPlay, cardInstanceId);
  if (!eventCard) return state;
  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...newPlayers[playerIndex],
    cardsInPlay: removeById(player.cardsInPlay, cardInstanceId),
    discardPile: [...player.discardPile, toCardInstance(eventCard)],
  };
  return {
    ...state,
    players: newPlayers,
  };
}

/**
 * Resolve (skip) the current pending effect and advance to the next one.
 * If no more effects remain, move the event card from cardsInPlay to discard.
 */
export function resolvePendingEffect(state: GameState): ReducerResult {
  const current = state.pendingEffects[0];
  const remaining = state.pendingEffects.slice(1);
  const effectOwner = current.type === 'card-effect' && current.actor
    ? current.actor
    : state.activePlayer!;
  const ownerIndex = getPlayerIndex(state, effectOwner);

  let newState: GameState = { ...state, pendingEffects: remaining };
  if (remaining.length === 0 && current.type === 'card-effect') {
    if (!current.skipDiscard) {
      newState = discardEventCard(newState, current.cardInstanceId, ownerIndex);
    }
    // Enqueue post-fetch corruption check when all picks are resolved (including
    // the pass/skip case). Applies whether skipDiscard is true (grant-action items
    // like Dwarven Ring and Palantír that stay in play) or false (event cards).
    if (current.postCorruptionCheck) {
      newState = enqueueCorruptionCheck(newState, {
        source: current.cardInstanceId,
        actor: effectOwner,
        scope: { kind: 'phase', phase: newState.phaseState.phase },
        characterId: current.postCorruptionCheck.characterId,
        modifier: current.postCorruptionCheck.modifier,
        reason: 'card effect',
      });
    }
  }
  // When skipping a fetch-to-deck effect by passing, emit a text notification
  // so both players see that the optional retrieval was declined.
  const skipEffects: import('../index.js').GameEffect[] = [];
  if (current.type === 'card-effect' && current.effect.type === 'fetch-to-deck') {
    const playerName = (state.players.find(p => p.id === effectOwner) as { name: string } | undefined)?.name ?? effectOwner as string;
    const eventDef = resolveDef(state, current.cardInstanceId) as { name?: string } | undefined;
    const cardName = eventDef?.name ?? current.cardInstanceId as string;
    skipEffects.push({ effect: 'text-notification', message: `${playerName} declines to retrieve a card (${cardName})` });
  }
  return { state: newState, effects: skipEffects.length > 0 ? skipEffects : undefined };
}

/**
 * Handle fetching a card from sideboard or discard pile into the play deck or hand.
 *
 * Part of the fetch-to-deck effect resolution. The current effect is the
 * first entry in {@link GameState.pendingEffects}. After the fetch,
 * the effect is consumed; if no more effects remain, the event card moves
 * from cardsInPlay to the player's discard pile.
 *
 * When the effect's `to` field is `'hand'`, the card is moved into the player's
 * hand instead of being shuffled into the play deck.
 */
export function handleFetchFromPile(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'fetch-from-pile') return { state, error: 'Expected fetch-from-pile action' };

  if (state.pendingEffects.length === 0) {
    return { state, error: 'No effect sub-flow active' };
  }
  const current = state.pendingEffects[0];
  if (current.type !== 'card-effect' || current.effect.type !== 'fetch-to-deck') {
    return { state, error: `Expected fetch-to-deck effect, got ${current.type}` };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  // Find the card in the specified source pile
  const sourcePile = action.source === 'sideboard' ? player.sideboard
    : action.source === 'deck' ? player.playDeck
    : player.discardPile;
  const cardIdx = sourcePile.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIdx === -1) {
    return { state, error: `Card not found in ${action.source as string}` };
  }

  const fetchedCard = sourcePile[cardIdx];
  const def = state.cardPool[fetchedCard.definitionId];

  // Validate card matches filter condition
  if (!def || !matchesDefinition(def, current.effect.filter)) {
    return { state, error: 'Card does not match fetch filter' };
  }

  const fetchTo = current.effect.to ?? 'deck';
  logDetail(`Fetching ${def?.name ?? '?'} from ${action.source as string} → ${fetchTo}${fetchTo === 'deck' ? ', shuffling' : ''}`);

  // Remove from source pile
  const newSourcePile = removeById(sourcePile, fetchedCard.instanceId);

  const newPlayers = clonePlayers(state);
  let nextRng = state.rng;

  if (fetchTo === 'hand') {
    // Place fetched card directly in the player's hand; reshuffle the deck if it was the source
    if (action.source === 'sideboard') {
      newPlayers[playerIndex] = { ...player, sideboard: newSourcePile, hand: [...player.hand, fetchedCard] };
    } else if (action.source === 'deck') {
      const [reshuffledDeck, rng2] = shuffle(newSourcePile, state.rng);
      nextRng = rng2;
      newPlayers[playerIndex] = { ...player, playDeck: reshuffledDeck, hand: [...player.hand, fetchedCard] };
    } else {
      newPlayers[playerIndex] = { ...player, discardPile: newSourcePile, hand: [...player.hand, fetchedCard] };
    }
  } else {
    // Default: place in play deck and shuffle
    const [shuffledDeck, rng2] = shuffle([...player.playDeck, fetchedCard], state.rng);
    nextRng = rng2;
    if (action.source === 'sideboard') {
      newPlayers[playerIndex] = { ...player, sideboard: newSourcePile, playDeck: shuffledDeck };
    } else if (action.source === 'deck') {
      // Re-insert into deck then shuffle (card was removed from deck already)
      newPlayers[playerIndex] = { ...player, playDeck: shuffledDeck };
    } else {
      newPlayers[playerIndex] = { ...player, discardPile: newSourcePile, playDeck: shuffledDeck };
    }
  }

  // Decrement the count; if more picks remain, re-enqueue with count-1 so the
  // player is prompted for the next pick (e.g. Vilya's 3-card fetch).
  const newCount = current.effect.type === 'fetch-to-deck' ? current.effect.count - 1 : 0;
  const remaining = newCount > 0
    ? [{ ...current, effect: { ...current.effect, count: newCount } } as import('../types/state-combat.js').PendingEffect, ...state.pendingEffects.slice(1)]
    : state.pendingEffects.slice(1);
  let newState: GameState = { ...state, players: newPlayers, rng: nextRng, pendingEffects: remaining };
  if (remaining.length === 0) {
    if (current.skipDiscard) {
      if (current.postCorruptionCheck) {
        newState = enqueueCorruptionCheck(newState, {
          source: current.cardInstanceId,
          actor: action.player,
          scope: { kind: 'phase', phase: newState.phaseState.phase },
          characterId: current.postCorruptionCheck.characterId,
          modifier: current.postCorruptionCheck.modifier,
          reason: 'Palantír',
        });
      }
    } else {
      newState = discardEventCard(newState, current.cardInstanceId, playerIndex);
      // For short events that have a postCorruptionCheck (e.g. Vilya), enqueue
      // the corruption check after the card is discarded.
      if (current.postCorruptionCheck) {
        newState = enqueueCorruptionCheck(newState, {
          source: current.cardInstanceId,
          actor: action.player,
          scope: { kind: 'phase', phase: newState.phaseState.phase },
          characterId: current.postCorruptionCheck.characterId,
          modifier: current.postCorruptionCheck.modifier,
          reason: 'card effect',
        });
      }
    }
  }
  return { state: newState };
}

/**
 * Returns true if the given company is covert, false if overt.
 *
 * A company is overt if it contains:
 * - Any character with Race.Orc or Race.Troll (rule glossary: "overt"), EXCEPT
 *   Half-orcs, which never make a company overt (CRF-22: "some allies can make a
 *   company overt, but Half-orcs do not"). See {@link isHalfOrc}.
 * - The Balrog avatar (an avatar character of a Balrog-alignment player).
 * - Any ally carrying a `company-overt` effect (e.g. Regiment of Black Crows,
 *   Great Bats, Great Lord of Goblin-gate, Last Child of Ungoliant).
 *
 * Ringwraith in Fell Rider mode also makes a company overt, but Fell Rider mode
 * is not yet tracked — when it is implemented, add the check here.
 *
 * A company is covert when none of the overt conditions are met (rule glossary:
 * "covert").
 */
export function isCovertCompany(
  company: { readonly characters: readonly CardInstanceId[]; readonly id?: import('../index.js').CompanyId },
  player: PlayerState,
  state: GameState,
): boolean {
  const overtRaces = new Set<Race>([Race.Orc, Race.Troll]);

  for (const charId of company.characters) {
    const charData = player.characters[charId];
    if (!charData) continue;

    const charDef = defById(state, charData.definitionId);
    if (charDef && isCharacterCard(charDef)) {
      // Orc/Troll race makes company overt — but a Half-orc never does
      if (overtRaces.has(charDef.race) && !isHalfOrc(charDef)) return false;
      // Balrog avatar (avatar character in a Balrog-alignment game) makes company overt
      if (isAvatarCharacter(charDef) && player.alignment === 'balrog') return false;
    }

    // Check allies for company-overt effect
    for (const ally of charData.allies) {
      const allyDef = defById(state, ally.definitionId);
      if (!allyDef || !isAllyCard(allyDef)) continue;
      if (getCardEffects(allyDef).some(e => e.type === 'company-overt')) {
        return false; // overt
      }
    }
  }

  // Fell Rider mode card: permanent event bound to this company with a
  // `company-overt` effect makes the Ringwraith company overt (MELE §1.2).
  // We can only check this when the company ID is available.
  if (company.id !== undefined) {
    for (const card of player.cardsInPlay) {
      if (card.companyId !== company.id) continue;
      const cardDef = defById(state, card.definitionId);
      if (!cardDef) continue;
      if (getCardEffects(cardDef).some(e => e.type === 'company-overt')) {
        return false; // overt (e.g. Fell Rider)
      }
    }
  }

  return true; // covert
}
