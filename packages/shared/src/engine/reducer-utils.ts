/**
 * @module reducer-utils
 *
 * Shared utility functions used by multiple reducer phase handlers.
 * Includes state cloning, dice rolling, deck exhaustion, company management,
 * and card effect resolution helpers.
 */

import type { GameState, PlayerState, PlayerId, CardInstanceId, CardInstance, CardInPlay, CardDefinitionId, CompanyId, GameAction, Company, CombatState, CharacterInPlay, ItemInPlay, AllyInPlay, CardDefinition, SiteCard, TwoDiceSix, DieRoll, GameEffect, DiceRollEffect, Alignment, RegionType } from '../index.js';
import type { CardEffect, OnEventEffect, Condition, FetchToDeckEffect, HazardMaintenanceEffect, DuplicationLimitEffect, PlayConditionEffect, OpponentInfluenceOverrideEffect, AgentHomeSiteFactionLockEffect, FactionSiegeEffect } from '../types/effects.js';
import { buildMovementMap, regionDistanceInclusive } from '../movement-map.js';
import type { ResolutionScope, ActiveConstraint, SiteFlag } from '../types/pending.js';
import { GENERAL_INFLUENCE } from '../constants.js';
import { hasPlayFlag } from '../effects/play-flags.js';
import { shuffle, nextInt } from '../rng.js';
import { getPlayerIndex, isMinionOrBalrog } from '../state-utils.js';
import { isSiteCard, isAvatarCharacter, isCharacterCard, isAllyCard, isFactionCard, isHalfOrc, isResourceEventCard, isItemCard } from '../types/cards.js';
import { CardStatus, Race, Skill, SiteType, WIZARD_SPECIFIC_KEYWORD_NAMES } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { resolveInstanceId, ownerOf } from '../types/state.js';
import { logHeading, logDetail } from './legal-actions/log.js';
import { matchesCondition, matchesContext } from '../effects/index.js';
import { resolveDef, normalizeCreatureRace, resolveCheckModifier } from './effects/index.js';
import { enqueueCorruptionCheck } from './pending.js';
import { revealInstances } from './visibility.js';

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
 * True if `def` carries an **agent-summons** recruitment-vehicle effect
 * (`agentRecruit: true`) — Open to the Summons (wh-46). Such a card lets a
 * Ringwraith/Fallen-wizard player bring one agent into a company at a Darkhaven
 * and, sitting in the play deck during the character draft, lifts the agent
 * draft-gate for one agent (rules 1.41/1.42). Detected by effect, not card id,
 * so future enablers work unchanged.
 */
export function hasAgentSummonsEffect(def: CardDefinition | undefined): boolean {
  const effects = (def as { effects?: readonly { type: string; agentRecruit?: boolean }[] } | undefined)?.effects ?? [];
  return effects.some(e => e.type === 'recruitment-vehicle' && e.agentRecruit === true);
}

/**
 * Counts the agent-summons enablers (Open to the Summons, wh-46) a player has
 * **drafted** during the character draft. Each such enabler lets the player
 * draft **one** agent as a starting character (rules 1.41/1.42, CoE
 * 1.9.R2/1.9.F1).
 *
 * Only enablers already drafted into {@link DraftPlayerState.draftedStageResources}
 * count. Open to the Summons is brought "in lieu of a minor item" and revealed
 * "as if it were a character" when starting companies are determined, so it must
 * be drafted from the pool as any other card in an earlier round *before* an
 * agent may be drafted — a copy merely sitting undrafted in the pool (or held in
 * the play deck) does NOT lift the gate. Both a Ringwraith and a Fallen-wizard
 * may draft the enabler (it carries the `starting-item` keyword and an
 * agent-summons effect); at finalize {@link resolveThrallCharacterPairings}
 * places it with the drafted agent, reducing that agent's mind.
 */
export function countAgentSummonsEnablersForDraft(
  state: GameState,
  draft: {
    readonly draftedStageResources: readonly { readonly definitionId: CardDefinitionId }[];
  },
): number {
  return draft.draftedStageResources.reduce(
    (n, card) => (hasAgentSummonsEffect(defById(state, card.definitionId)) ? n + 1 : n),
    0,
  );
}

/**
 * Counts how many agent characters a player has already drafted into their
 * starting company (rules 1.41/1.42 — each requires an enabler). Used together
 * with {@link countAgentSummonsEnablersForDraft} to decide whether one more agent
 * may be drafted via an Open-to-the-Summons enabler.
 */
export function countDraftedAgents(
  state: GameState,
  drafted: readonly { readonly definitionId: CardDefinitionId }[],
): number {
  return drafted.reduce(
    (n, card) => (isAgentCharacter(defById(state, card.definitionId)) ? n + 1 : n),
    0,
  );
}

/**
 * True if the player holds any card that "may be played with a starting company
 * in lieu of a minor item" — a `starting-company-placement` effect (Open to the
 * Summons wh-46, Orders from Lugbúrz as-94, Thrall of the Voice wh-82…). Such a
 * card keeps the item-draft step reachable even when the player drafted no minor
 * items, so the placement can still be offered.
 *
 * Both the play deck and the sideboard are scanned: Balrog-specific starting
 * resources (Gangways over the Fire ba-60, Orders from the Great Demon ba-70)
 * are resource-events carrying the `starting-item` keyword, so
 * {@link isStageResourceCard} sinks any that were left in the starting-company
 * pool to the sideboard during {@link applyDraftResults}. They must still be
 * offered for placement from there — otherwise they silently vanish from the
 * starting company.
 */
export function hasStartingCompanyPlacementInDeck(
  state: GameState,
  player: {
    readonly playDeck: readonly { readonly definitionId: CardDefinitionId }[];
    readonly sideboard: readonly { readonly definitionId: CardDefinitionId }[];
  },
): boolean {
  const hasPlacement = (card: { readonly definitionId: CardDefinitionId }): boolean => {
    const effects = (defById(state, card.definitionId) as { effects?: readonly { type: string }[] } | undefined)?.effects ?? [];
    return effects.some(e => e.type === 'starting-company-placement');
  };
  return player.playDeck.some(hasPlacement) || player.sideboard.some(hasPlacement);
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
 * Partition a leaving character's allies into those that return to their
 * owner's hand and those that go to the discard pile.
 *
 * An ally carrying a `return-to-hand` effect whose triggers include
 * `controller-leaves-play` (Radagast's Black Bird wh-114: "You may return … to
 * your hand … if its controlling character leaves active play") is preserved to
 * hand instead of discarded. Every "controlling character leaves active play"
 * site (combat elimination, body-check discard, dice-check eliminate, hazard
 * discard) routes its allies through this helper so the rule fires uniformly.
 */
export function partitionLeavingAllies(
  state: GameState,
  allies: readonly AllyInPlay[],
): { toHand: CardInstance[]; toDiscard: CardInstance[] } {
  const toHand: CardInstance[] = [];
  const toDiscard: CardInstance[] = [];
  for (const ally of allies) {
    const def = defById(state, ally.definitionId);
    const returnsToHand = getCardEffects(def).some(
      e => e.type === 'return-to-hand' && e.during.includes('controller-leaves-play'),
    );
    (returnsToHand ? toHand : toDiscard).push(toCardInstance(ally));
  }
  return { toHand, toDiscard };
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
 * True if the given player's avatar (wizard, ringwraith, fallen-wizard, or
 * Balrog) has been eliminated during the game.
 *
 * Per CoE rule 2.2 an eliminated avatar is placed in its player's
 * removed-from-play pile (`outOfPlayPile`) and applies a standing -5
 * miscellaneous marshalling-point penalty to that player — a penalty that is in
 * effect for the running MP total throughout the game (reflected in the MP
 * display), not merely at final scoring. Avatars are the only characters with
 * `mind === null` (see {@link isAvatarCharacter}), so scanning the pile for such
 * a character is the canonical check. Shared by {@link recomputeDerived} (which
 * folds the -5 into the running misc tally) and the Free Council end-game scorer
 * so both agree on when the penalty applies.
 */
export function hasEliminatedAvatar(state: GameState, playerIndex: number): boolean {
  const player = state.players[playerIndex];
  if (!player) return false;
  return player.outOfPlayPile.some(card => isAvatarCharacter(defById(state, card.definitionId)));
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
    if (remaining > 0 && def && isCharacterCard(def) && (def.keywords?.includes('leader') ?? false)) {
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
 * Returns `true` when the given site definition carries an
 * `allow-creature-by-race` site-rule that grants the given creature definition a
 * keying bypass at the site: the rule's `race` matches the creature's race and,
 * if the rule carries an optional `except` condition, the creature does **not**
 * match it. Shared by the normal hazard-creature keying path
 * (`legal-actions/movement-hazard.ts`) and the `dynamic-auto-attack` eligibility
 * check (`legal-actions/site.ts`) so both honour the same "any <race> (except …)
 * may be keyed to this site" rule (Geann a-Lisch as-138, The Iron-deeps ba-91).
 */
export function siteRuleAllowsCreatureByRace(
  siteDef: CardDefinition | undefined,
  creatureDef: CardDefinition,
): boolean {
  if (!siteDef || !isSiteCard(siteDef) || !siteDef.effects) return false;
  const race = (creatureDef as unknown as { race?: string }).race;
  if (!race) return false;
  return siteDef.effects.some(
    e => e.type === 'site-rule' && e.rule === 'allow-creature-by-race'
      && 'race' in e && e.race === race
      && (!('except' in e) || !e.except || !matchesDefinition(creatureDef, e.except)),
  );
}

/**
 * Build the DSL condition context for a "target company" — the active
 * movement/hazard company a hazard is being evaluated against. Exposes under
 * `company`:
 *
 * - `alignment` — the defending company's alignment label (or null).
 * - `homeSites` — home-site names of the company's characters.
 * - `characterNames` — names of the characters in the company (for
 *   "unless the company contains <named character>" clauses).
 * - `maxUntappedWarriorProwess` — the highest effective prowess among the
 *   company's *untapped Warriors* (0 if none), for "unless the company contains
 *   an untapped warrior with prowess greater than N" clauses.
 *
 * Shared by the creature/short-event targeting checks (`legal-actions/
 * movement-hazard.ts`) and short-event resolution (`chain-reducer.ts`) so both
 * evaluate identical company predicates. `owner` is the player whose company
 * this is — needed for per-character tap status and effective stats.
 */
export function buildTargetCompanyConditionContext(
  state: GameState,
  owner: PlayerState,
  company: { readonly characters: readonly CardInstanceId[] },
  alignment?: string,
): Record<string, unknown> {
  const homeSites: string[] = [];
  const characterNames: string[] = [];
  let maxUntappedWarriorProwess = 0;
  for (const charInstId of company.characters) {
    const inPlay = owner.characters[charInstId];
    const defId = inPlay?.definitionId ?? resolveInstanceId(state, charInstId);
    if (!defId) continue;
    const charDef = defById(state, defId);
    if (!charDef || !isCharacterCard(charDef)) continue;
    characterNames.push(charDef.name);
    if (charDef.homesite) {
      homeSites.push(...charDef.homesite.split(',').map(s => s.trim()));
    }
    if (inPlay && inPlay.status === CardStatus.Untapped && charDef.skills.includes(Skill.Warrior)) {
      const prowess = inPlay.effectiveStats.prowess;
      if (prowess > maxUntappedWarriorProwess) maxUntappedWarriorProwess = prowess;
    }
  }
  return {
    company: { homeSites, characterNames, maxUntappedWarriorProwess, alignment: alignment ?? null },
  };
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
 * True when the given character bears an attached card (stored in its `items` —
 * where a resource permanent-event played "on a character" is kept) whose
 * effects include one of the given `effectType`. Used to detect the continuous
 * markers placed by *Await the Advent of Allies* (dm-117):
 * `general-influence-exempt`, `own-mp-not-counted`, and
 * `company-immobile-while-attached`. Detected by effect type — not card id — so
 * any future card carrying the same marker works unchanged.
 */
export function characterBearsAttachedEffect(
  state: GameState,
  char: CharacterInPlay,
  effectType: CardEffect['type'],
): boolean {
  for (const item of char.items) {
    const def = defById(state, item.definitionId);
    if (getCardEffects(def).some(e => e.type === effectType)) return true;
  }
  return false;
}

/**
 * True when the player at `playerIndex` has any card in play carrying an
 * `extra-under-deeps-mh-phase` effect (Gangways over the Fire, ba-60). Such a
 * card lets each of the player's moving companies take repeated Under-deeps
 * movement/hazard phases. Detected by effect, not card id, so future enablers
 * work unchanged.
 */
export function playerHasExtraUnderDeepsMH(state: GameState, playerIndex: number): boolean {
  const player = state.players[playerIndex];
  if (!player) return false;
  return player.cardsInPlay.some(cip =>
    getCardEffects(defById(state, cip.definitionId)).some(e => e.type === 'extra-under-deeps-mh-phase'),
  );
}

/**
 * Collect any `faction-influence-restriction` environment (e.g. Mordor in Arms
 * dm-72) that applies to a faction influence attempt at a site in
 * `siteRegionName`. Returns the summed check modifier and the set of card names
 * whose one-shot influence boosts are suppressed ("cannot be done with Muster").
 *
 * Restrictions flagged `noEffectOnMinion` are ignored when the influencing
 * (resource) player is a Ringwraith/Sauron (minion) player. Shared by the
 * influence-attempt legal-action generator (for the displayed `need`) and the
 * roll resolver (for the actual modifier) so both agree.
 */
export function collectFactionInfluenceRestriction(
  state: GameState,
  siteRegionName: string | undefined,
  influencerIsMinion: boolean,
): { modifier: number; blockedCardNames: Set<string> } {
  const blockedCardNames = new Set<string>();
  let modifier = 0;
  if (!siteRegionName) return { modifier, blockedCardNames };
  for (const pl of state.players) {
    for (const cip of pl.cardsInPlay) {
      const cdef = defById(state, cip.definitionId);
      for (const eff of getCardEffects(cdef)) {
        if (eff.type !== 'faction-influence-restriction') continue;
        if (eff.noEffectOnMinion && influencerIsMinion) continue;
        if (!eff.regionNames.includes(siteRegionName)) continue;
        modifier += eff.modifier;
        for (const bc of (eff.blockCards ?? [])) blockedCardNames.add(bc);
      }
    }
  }
  return { modifier, blockedCardNames };
}

/**
 * If `def` is a permanent resource event carrying a `reshuffle-from-discard`
 * effect flagged as its **alternative short-event mode** (Great Army of the
 * North ba-38), returns that effect; otherwise `undefined`. Such a card is a
 * "Permanent-event/Short-event" card: it may be played either as a
 * permanent-event (its ongoing effects) or as a resource short-event that
 * resolves the reshuffle and discards the card.
 */
export function altShortEventReshuffleEffect(
  def: CardDefinition | null | undefined,
): import('../types/effects.js').ReshuffleFromDiscardEffect | undefined {
  const rdef = def ?? undefined;
  if (!isResourceEventCard(rdef) || rdef.eventType !== 'permanent') return undefined;
  return getCardEffects(rdef).find(
    (e): e is import('../types/effects.js').ReshuffleFromDiscardEffect =>
      e.type === 'reshuffle-from-discard' && e.altShortEventMode === true,
  );
}

/**
 * True when the playing player has at least one card in their discard pile that
 * matches a `reshuffle-from-discard` effect's `filter` — i.e. the reshuffle
 * short-event mode would actually recycle something (Great Army of the North
 * ba-38: an Orc/Troll faction in the discard).
 */
export function playerHasReshuffleMatch(
  state: GameState,
  player: PlayerState,
  effect: import('../types/effects.js').ReshuffleFromDiscardEffect,
): boolean {
  return player.discardPile.some(c => {
    const def = defById(state, c.definitionId);
    return !!def && matchesDefinition(def, effect.filter);
  });
}

/**
 * Collects the **player-scoped, ongoing** faction-influence `check-modifier`
 * effects (`target: "player-in-play"`) carried by bare permanent resource
 * events in the influencing player's `cardsInPlay` — cards not attached to any
 * character/item/site/agent/company. Each effect's `when` is pre-filtered
 * against the faction-influence resolver context here (mirroring how a faction
 * card's own effects are pre-filtered), so the returned entries can be folded
 * straight into the `resolveCheckModifier` pass at both the display and the
 * roll site. Used by Great Army of the North (ba-38): "+1 to your influence
 * attempts against Orc and Troll factions."
 */
export function collectPlayerInPlayInfluenceEffects(
  state: GameState,
  playerId: PlayerId,
  ctx: import('./effects/resolver.js').ResolverContext,
): import('./effects/resolver.js').CollectedEffect[] {
  const player = playerById(state, playerId);
  if (!player) return [];
  const collected: import('./effects/resolver.js').CollectedEffect[] = [];
  for (const cip of player.cardsInPlay) {
    // Only bare permanent-events in the player's own play area contribute — a
    // card attached to a character/item/site/agent, or bound to a company, is
    // collected through its own attachment path (or is a faction whose
    // "Standard Modifications" are scoped to influencing that faction).
    if (cip.attachedTo !== undefined || cip.attachedToItem !== undefined
      || cip.attachedToSite !== undefined || cip.attachedToAgentId !== undefined
      || cip.companyId !== undefined || cip.setAsideHost !== undefined
      || cip.pendingTriggerAttack) continue;
    const def = defById(state, cip.definitionId);
    if (!isResourceEventCard(def) || def.eventType !== 'permanent') continue;
    for (const effect of getCardEffects(def)) {
      if (effect.type !== 'check-modifier') continue;
      if (effect.target !== 'player-in-play') continue;
      if (effect.when && !matchesContext(effect.when, ctx)) continue;
      collected.push({ effect, sourceDef: def, sourceInstance: cip.instanceId });
    }
  }
  return collected;
}

/**
 * Sums the **game-wide, ongoing** `check-modifier` effects (`target:
 * "all-in-play"`) carried by bare in-play events in *either* player's
 * `cardsInPlay`, for a given {@link CheckKind}. Unlike
 * {@link collectPlayerInPlayInfluenceEffects} (which is scoped to the
 * influencing player's own cards and only benefits that player), an
 * `all-in-play` modifier applies to **every** matching check by **either**
 * player — the reading of a hazard long-event whose text says "*All* … attempts
 * are modified by -3" (Times Are Evil td-76).
 *
 * Only bare, unattached events contribute (a card attached to a
 * character/item/site/agent, or bound to a company, is collected through its
 * own attachment path). Each effect's `when` is evaluated against the check
 * resolver context. Shared by the influence-attempt legal-action generator (for
 * the displayed `need`) and the roll resolver (for the actual modifier) so both
 * agree, mirroring {@link collectFactionInfluenceRestriction}.
 */
export function collectGlobalCheckModifier(
  state: GameState,
  check: import('../types/common.js').CheckKind,
  ctx: import('./effects/resolver.js').ResolverContext,
): number {
  const collected: import('./effects/resolver.js').CollectedEffect[] = [];
  const ctxRecord = ctx as unknown as Record<string, unknown>;
  for (const pl of state.players) {
    for (const cip of pl.cardsInPlay) {
      if (cip.attachedTo !== undefined || cip.attachedToItem !== undefined
        || cip.attachedToSite !== undefined || cip.attachedToAgentId !== undefined
        || cip.companyId !== undefined || cip.setAsideHost !== undefined
        || cip.pendingTriggerAttack) continue;
      const def = defById(state, cip.definitionId);
      if (!def) continue;
      for (const effect of getCardEffects(def)) {
        if (effect.type !== 'check-modifier') continue;
        if (effect.target !== 'all-in-play') continue;
        if (effect.when && !matchesContext(effect.when, ctxRecord)) continue;
        collected.push({ effect, sourceDef: def, sourceInstance: cip.instanceId });
      }
    }
  }
  return resolveCheckModifier(collected, check, ctxRecord);
}

/**
 * Total stage points a single card definition contributes (MEWH §1): the sum of
 * its `stage-points` effect values (usually one, may be zero). Used both by the
 * derived per-player total and by the discard-stage-resource legality check.
 *
 * A `stage-points` effect may carry a `when` condition, in which case the
 * points are only granted while it matches. The condition is evaluated against
 * `context` — for a card attached to a character that is a bearer context, so
 * a card can make its points conditional on who bears it (Inner Rot wh-23:
 * "If he is a Fallen-wizard, he receives 2 stage points", encoded as
 * `{ "bearer.race": "fallen-wizard" }`). Callers with no context (bare in-play
 * cards, the deck-legality check) pass none, and any conditional effect is
 * skipped — its condition cannot be satisfied without a bearer.
 */
export function stagePointsOfCard(
  def: CardDefinition | null | undefined,
  context: object = {},
): number {
  let total = 0;
  for (const effect of getCardEffects(def)) {
    // `whileCompanyAtSite` stage points (Deep Mines wh-55, Rhosgobel wh-57) are
    // granted by *occupying the site*, not by the card being in play, so they
    // are tallied separately from the player's companies — never here.
    if (effect.type !== 'stage-points' || effect.whileCompanyAtSite) continue;
    if (effect.when && !matchesContext(effect.when, context)) continue;
    total += effect.value;
  }
  return total;
}

/**
 * Every **Stage card** the player currently has in play, as card instance IDs.
 *
 * A Stage card is any card whose definition carries `alignment: "stage"` (MEWH
 * §1) — that covers stage permanent-events (`cardsInPlay`), stage
 * permanent-events played *on a character* (which the engine attaches to the
 * bearer's `items`, see `recompute-derived.ts`), stage items and stage allies.
 * Fallen-wizard sites that grant stage points only while occupied (Deep Mines
 * wh-55) are deliberately excluded: they are sites, not Stage cards their
 * controller holds, and they cannot be discarded.
 *
 * Used by the forced stage-card discard (`force-discard-stage-card`, Echoes of
 * the Song wh-17) both to gate the option ("more than one stage card") and to
 * build the candidate list the opponent chooses from.
 */
export function stageCardsInPlay(state: GameState, player: PlayerState): CardInstanceId[] {
  const found: CardInstanceId[] = [];
  const isStage = (definitionId: CardDefinitionId): boolean => {
    const def = defById(state, definitionId);
    return !!def && (def as { alignment?: string }).alignment === 'stage';
  };
  for (const card of player.cardsInPlay) {
    if (isStage(card.definitionId)) found.push(card.instanceId);
  }
  for (const char of Object.values(player.characters)) {
    for (const item of char.items) {
      if (isStage(item.definitionId)) found.push(item.instanceId);
    }
    for (const ally of char.allies) {
      if (isStage(ally.definitionId)) found.push(ally.instanceId);
    }
  }
  return found;
}

/**
 * Stage points a **site** definition grants while a company occupies it (the
 * `whileCompanyAtSite` variant of the `stage-points` effect). Returns 0 for
 * ordinary cards and for stage cards whose points come from being in play.
 * Summed once per distinct occupied site instance in `recompute-derived.ts`.
 */
export function siteOccupancyStagePointsOfCard(def: CardDefinition | null | undefined): number {
  let total = 0;
  for (const effect of getCardEffects(def)) {
    if (effect.type === 'stage-points' && effect.whileCompanyAtSite) total += effect.value;
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
 * True when `player` has an in-play character carrying a `fw-kill-mp-full`
 * effect (Alatar wh-1) — the MEWH §4 kill-MP exemption. Consulted by both the
 * marshalling-point tally (`recompute-derived.ts`, full printed kill MP instead
 * of the flat 1) and combat finalization (`combat-finalize.ts`, routing a
 * defeated **detainment** creature to the kill pile so it scores at all — the
 * "even with *" clause). Only Fallen-wizard players are ever subject to the §4
 * clamp, so this returns `false` for any other alignment.
 */
export function playerHasKillMpExemption(state: GameState, player: PlayerState): boolean {
  if (player.alignment !== 'fallen-wizard') return false;
  for (const char of Object.values(player.characters)) {
    const def = resolveDef(state, char.instanceId);
    for (const effect of getCardEffects(def)) {
      if (effect.type === 'fw-kill-mp-full') return true;
    }
  }
  return false;
}

/**
 * True when `player` has an in-play character carrying a
 * `detainment-attacks-normal` effect (Alatar wh-1) whose stage-point gate is
 * satisfied — the player's `stagePoints` total is strictly greater than the
 * effect's `stagePointsAbove` (default 0). While true, every attack the engine
 * would treat as detainment against the player's companies is resolved as a
 * normal attack instead (see {@link isDetainmentAttack} / its call sites).
 */
export function playerConvertsDetainmentToNormal(state: GameState, player: PlayerState): boolean {
  for (const char of Object.values(player.characters)) {
    const def = resolveDef(state, char.instanceId);
    for (const effect of getCardEffects(def)) {
      if (effect.type !== 'detainment-attacks-normal') continue;
      const threshold = effect.stagePointsAbove ?? 0;
      if (player.stagePoints > threshold) return true;
    }
  }
  return false;
}

/**
 * True when some in-play long hazard-event (either player's `cardsInPlay`)
 * carries an `auto-attacks-normal` effect whose `siteTypes` include
 * `effectiveSiteType` — Awaken Defenders (le-103): "each detainment
 * automatic-attack at a Free-hold or Border-hold becomes a normal
 * automatic-attack." When true, the site's automatic-attacks are resolved as
 * normal attacks (threaded into `isDetainmentAttack` via
 * `defenderForcesNormalAttacks`, mirroring
 * {@link playerConvertsDetainmentToNormal}). Site-type-scoped and global, so it
 * applies to any company entering a matching site regardless of alignment.
 */
export function siteTypeForcesAutoAttacksNormal(
  state: GameState,
  effectiveSiteType: SiteType,
): boolean {
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = resolveDef(state, card.instanceId);
      for (const effect of getCardEffects(def)) {
        if (effect.type !== 'auto-attacks-normal') continue;
        if (effect.siteTypes.includes(effectiveSiteType)) return true;
      }
    }
  }
  return false;
}

/**
 * The `<wizard>-specific` avatar name a site definition binds to (e.g.
 * "Radagast" for Rhosgobel's `radagast-specific` keyword), or `null` when the
 * site carries no such keyword. Kept local to avoid a module cycle with
 * `fallen-wizard-specific.ts` (which depends on this module).
 */
function siteWizardSpecificName(def: CardDefinition | undefined): string | null {
  if (!def || !('keywords' in def)) return null;
  for (const k of (def as { keywords?: readonly string[] }).keywords ?? []) {
    if (k in WIZARD_SPECIFIC_KEYWORD_NAMES) return WIZARD_SPECIFIC_KEYWORD_NAMES[k];
  }
  return null;
}

/**
 * The Fallen-wizard player who **inherently protects** the site with
 * `siteDefinitionId`, or `null` when the site is not an inherently protected
 * Wizardhaven (Rhosgobel wh-57: `site-rule protected-wizardhaven`). The owner is
 * the Fallen-wizard for whom this is a Wizardhaven ({@link isHavenForPlayer}, so
 * a Fallen-wizard haven or a Hidden-Haven conversion) and who counts as the
 * avatar named by the site's `<wizard>-specific` keyword, if any — so only the
 * Radagast player owns Rhosgobel even in the rare Fallen-wizard-vs-Fallen-wizard
 * matchup where both players nominally treat it as a haven.
 */
export function inherentProtectedWizardhavenOwner(
  state: GameState,
  siteDefinitionId: CardDefinitionId | undefined,
): PlayerId | null {
  if (!siteDefinitionId) return null;
  const siteDef = defById(state, siteDefinitionId);
  if (!isSiteCard(siteDef)) return null;
  const isInherentlyProtected = getCardEffects(siteDef).some(
    e => e.type === 'site-rule' && e.rule === 'protected-wizardhaven',
  );
  if (!isInherentlyProtected) return null;
  const requiredWizard = siteWizardSpecificName(siteDef);
  for (const player of state.players) {
    if (!isHavenForPlayer(siteDef, player.alignment, { state, siteDefinitionId, playerId: player.id })) continue;
    if (requiredWizard && findFallenWizardAvatarName(state, player) !== requiredWizard) continue;
    return player.id;
  }
  return null;
}

/**
 * True when the site with `siteDefinitionId` is a **protected site** for the
 * given player — either an active `site-protected` constraint binds it (The
 * Fortress of Isen wh-68 / Guarded Haven wh-74 family) or it is an inherently
 * protected Wizardhaven ({@link inherentProtectedWizardhavenOwner}, Rhosgobel
 * wh-57). `match` selects the protector relationship, mirroring
 * {@link hasSiteFlagForPlayer}: `'self'` (default) tests protection *owned by*
 * `playerId`; `'opponent'` tests protection owned by someone *other than*
 * `playerId` (the marshalling-point block a protected site imposes on the
 * opponent).
 */
export function isSiteProtectedForPlayer(
  state: GameState,
  siteDefinitionId: CardDefinitionId | undefined,
  playerId: PlayerId,
  match: 'self' | 'opponent' = 'self',
): boolean {
  if (hasSiteFlagForPlayer(state.activeConstraints, 'site-protected', siteDefinitionId, playerId, match)) {
    return true;
  }
  const owner = inherentProtectedWizardhavenOwner(state, siteDefinitionId);
  if (owner === null) return false;
  return match === 'self' ? owner === playerId : owner !== playerId;
}

/**
 * True when the given player controls a **protected Wizardhaven** — a site that
 * is both (a) one of their Wizardhavens (a Fallen-wizard haven, or a site
 * converted into one via `wizardhaven-conversion`) and (b) protected for them,
 * either by a `site-protected` constraint (e.g. The Fortress of Isen wh-68,
 * Fortress of the Towers wh-69, Guarded Haven wh-74) or because the site is an
 * inherently protected Wizardhaven one of their companies occupies (Rhosgobel
 * wh-57). Used by play-conditions such as A Strident Spawn (wh-61) / An Untimely
 * Brood (wh-62), which require "a protected Wizardhaven".
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
  // Inherently protected Wizardhaven (Rhosgobel): the player controls it while
  // one of their companies occupies it.
  const player = playerById(state, playerId);
  if (player) {
    for (const company of player.companies) {
      if (inherentProtectedWizardhavenOwner(state, company.currentSite?.definitionId) === playerId) return true;
    }
  }
  return false;
}

/**
 * Counts the **distinct** protected Wizardhaven sites the given player controls
 * — the same predicate as {@link playerHasProtectedWizardhaven}, but returning
 * how many separate sites qualify rather than a boolean. Distinctness is by
 * site {@link CardDefinitionId} so a single site protected by both a constraint
 * and inherent status (or occupied by two companies) is counted once. Used by
 * play-conditions that require *more than one* protected Wizardhaven, e.g. Await
 * the Onset (wh-96): "two protected Wizardhavens [{H}]".
 */
export function protectedWizardhavenCount(state: GameState, playerId: PlayerId): number {
  const sites = new Set<CardDefinitionId>();
  for (const c of state.activeConstraints) {
    if (!(c.kind.type === 'site-flag' && c.kind.flag === 'site-protected')) continue;
    if (c.target.kind !== 'player' || c.target.playerId !== playerId) continue;
    const siteDefId = c.kind.siteDefinitionId;
    const siteDef = state.cardPool[siteDefId];
    if (!isSiteCard(siteDef)) continue;
    const isFwHaven = siteDef.siteType === 'haven' && siteDef.alignment === 'fallen-wizard';
    if (isFwHaven || isWizardhavenConversionFor(state, siteDefId, playerId)) sites.add(siteDefId);
  }
  const player = playerById(state, playerId);
  if (player) {
    for (const company of player.companies) {
      const siteDefId = company.currentSite?.definitionId;
      if (siteDefId && inherentProtectedWizardhavenOwner(state, siteDefId) === playerId) sites.add(siteDefId);
    }
  }
  return sites.size;
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
/**
 * The marshalling-point value to which a newly-played faction should be pinned
 * because the player has a `played-after-faction-mp-pin` card in play (Await the
 * Onset wh-96, "each faction you play after … is worth 1 MP"), or `undefined`
 * when no such card is in play. The value is stamped on the faction instance
 * ({@link CardInPlay.mpPinned}) at influence time so it persists independently of
 * the carrier. At most one such card applies (the carrier is duplication-limited).
 */
export function playedAfterFactionMpPin(state: GameState, player: PlayerState): number | undefined {
  for (const card of player.cardsInPlay) {
    const def = defById(state, card.definitionId);
    if (!def) continue;
    for (const effect of getCardEffects(def)) {
      if (effect.type === 'played-after-faction-mp-pin') return effect.value;
    }
  }
  return undefined;
}

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

/** True for the two minion player alignments (Ringwraith/Sauron and Balrog). */
function isMinionAlignment(alignment: Alignment): boolean {
  return alignment === 'ringwraith' || alignment === 'balrog';
}

/**
 * True when any character in `company` has the Ringwraith race — i.e. the
 * company "contains a Ringwraith" (a Ringwraith avatar or a Ringwraith follower
 * played under another's control, both of which carry `race: ringwraith`).
 */
export function companyHasRingwraith(state: GameState, owner: PlayerState, company: Company): boolean {
  for (const charInstId of company.characters) {
    const defId = owner.characters[charInstId]?.definitionId ?? resolveInstanceId(state, charInstId);
    if (!defId) continue;
    const charDef = defById(state, defId);
    if (charDef && isCharacterCard(charDef) && charDef.race === Race.Ringwraith) return true;
  }
  return false;
}

/**
 * Build the condition-matcher context describing a prospective CvCC attack:
 * `{ attacker: { alignment, isMinion, hasRingwraith }, defender: { … } }`.
 * Shared by `cvcc-attack-permission` (extra permission grants) and the
 * `deny-company-attack` site-rule (site-based prohibitions).
 */
function buildCvCCContext(
  state: GameState,
  attacker: PlayerState,
  attackerCompany: Company,
  defender: PlayerState,
  defenderCompany: Company,
): Record<string, unknown> {
  return {
    attacker: {
      alignment: attacker.alignment,
      isMinion: isMinionAlignment(attacker.alignment),
      hasRingwraith: companyHasRingwraith(state, attacker, attackerCompany),
    },
    defender: {
      alignment: defender.alignment,
      isMinion: isMinionAlignment(defender.alignment),
      hasRingwraith: companyHasRingwraith(state, defender, defenderCompany),
    },
  };
}

/**
 * Whether an in-play permanent-event grants an *extra* CvCC attack permission
 * (beyond {@link canAttackAlignment}) for this specific attacker→defender pair.
 *
 * Scans every in-play permanent-event on both players' `cardsInPlay` for a
 * `cvcc-attack-permission` effect and, for each, matches its optional `when`
 * against a context describing both companies:
 * `{ attacker: { alignment, isMinion, hasRingwraith }, defender: { … } }`.
 * Returns true as soon as one permission matches. Backs Prone to Violence
 * (ba-42): "Any minion company without a Ringwraith may attack another minion
 * company without a Ringwraith."
 */
export function cvccAttackPermitted(
  state: GameState,
  attacker: PlayerState,
  attackerCompany: Company,
  defender: PlayerState,
  defenderCompany: Company,
): boolean {
  const ctx = buildCvCCContext(state, attacker, attackerCompany, defender, defenderCompany);
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = defById(state, card.definitionId);
      if (!def) continue;
      for (const effect of getCardEffects(def)) {
        if (effect.type !== 'cvcc-attack-permission') continue;
        if (effect.when && !matchesCondition(effect.when, ctx)) continue;
        logDetail(`CvCC attack permitted by ${(def as { name?: string }).name ?? (card.definitionId as string)}: ${attacker.alignment} ${attackerCompany.id} → ${defender.alignment} ${defenderCompany.id}`);
        return true;
      }
    }
  }
  return false;
}

/**
 * Whether a `deny-company-attack` site-rule forbids this CvCC attack.
 *
 * CvCC requires both companies at the same location, but each player holds his
 * own version of the site card (hero/minion twins share a name), so the rule is
 * looked up on **both** companies' current site definitions. Each rule's
 * optional `when` is matched against the shared CvCC context
 * (`{ attacker, defender }` — see {@link cvccAttackPermitted}); a match denies
 * the attack outright (site prohibitions beat `cvcc-attack-permission` grants).
 * Backs Rivendell (as-160): "A minion company may not attack another company
 * at this site."
 */
export function siteDeniesCompanyAttack(
  state: GameState,
  attacker: PlayerState,
  attackerCompany: Company,
  defender: PlayerState,
  defenderCompany: Company,
): boolean {
  const ctx = buildCvCCContext(state, attacker, attackerCompany, defender, defenderCompany);
  const siteDefIds = [attackerCompany.currentSite?.definitionId, defenderCompany.currentSite?.definitionId];
  for (const siteDefId of siteDefIds) {
    if (!siteDefId) continue;
    const siteDef = defById(state, siteDefId);
    if (!siteDef || !isSiteCard(siteDef)) continue;
    for (const eff of siteDef.effects ?? []) {
      if (eff.type !== 'site-rule' || eff.rule !== 'deny-company-attack') continue;
      if (eff.when && !matchesCondition(eff.when, ctx)) continue;
      logDetail(`CvCC attack denied by site-rule on ${siteDef.name}: ${attacker.alignment} ${attackerCompany.id} → ${defender.alignment} ${defenderCompany.id}`);
      return true;
    }
  }
  return false;
}

/**
 * Whether a `deny-company-move` site-rule on `siteDef` forbids `company` from
 * declaring movement to that site. The rule's optional `when` is matched
 * against `{ company: { hasRingwraith } }`. Backs Rivendell (as-160):
 * "A Ringwraith may not move to this site."
 */
export function siteDeniesCompanyMove(
  state: GameState,
  player: PlayerState,
  company: Company,
  siteDef: SiteCard,
): boolean {
  for (const eff of siteDef.effects ?? []) {
    if (eff.type !== 'site-rule' || eff.rule !== 'deny-company-move') continue;
    const ctx = { company: { hasRingwraith: companyHasRingwraith(state, player, company) } };
    if (eff.when && !matchesCondition(eff.when, ctx)) continue;
    logDetail(`Movement to ${siteDef.name} denied for company ${company.id as string} by deny-company-move site-rule`);
    return true;
  }
  return false;
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
 * Returns ALL of the card's `play-condition` effects for the given {@link
 * PlayConditionEffect.requires}. A card may carry the same prerequisite kind
 * more than once — Greater Half-orcs (wh-86) requires both "A Strident Spawn"
 * and "Half-orcs" in play via two `card-in-play` conditions — and every one of
 * them must hold, so callers gating on a repeatable prerequisite must iterate
 * this list rather than use {@link findPlayConditionEffect} (which silently
 * checks only the first).
 */
export function findPlayConditionEffects(
  def: CardDefinition | null | undefined,
  requires: PlayConditionEffect['requires'],
): PlayConditionEffect[] {
  return getCardEffects(def).filter(
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
 * True when the player counts as **Sauron** rather than a Ringwraith — i.e. they
 * have a bare permanent-event in `cardsInPlay` carrying a `play-as-sauron`
 * marker (The Lidless Eye le-203; its sibling manifestation Sauron ba-43).
 *
 * While this holds the player "is Sauron, not a Ringwraith": they may not reveal
 * a Ringwraith avatar nor play any Ringwraith follower. Detected by effect type
 * (not card id) so any future card carrying the marker works unchanged. Set-aside
 * hosts are skipped (their effects are dormant).
 */
export function playerPlaysAsSauron(
  state: GameState,
  player: { readonly cardsInPlay: readonly CardInPlay[] },
): boolean {
  for (const card of player.cardsInPlay) {
    if (card.setAsideHost !== undefined) continue;
    const def = defById(state, card.definitionId);
    if (getCardEffects(def).some(e => e.type === 'play-as-sauron')) return true;
  }
  return false;
}

/**
 * True when the player's one-character-play-per-turn limit is lifted — i.e.
 * they have a bare permanent-event in `cardsInPlay` carrying a
 * `no-character-play-limit` marker (Sauron ba-43: "there is no limit to the
 * number of characters you may bring into play").
 *
 * Consumed by the `one-character-per-turn` gate in
 * `organization-characters.ts`, which is skipped entirely while this holds.
 * Detected by effect type (not card id) so any future card carrying the marker
 * works unchanged. Set-aside hosts are skipped (their effects are dormant).
 */
export function playerHasNoCharacterPlayLimit(
  state: GameState,
  player: { readonly cardsInPlay: readonly CardInPlay[] },
): boolean {
  for (const card of player.cardsInPlay) {
    if (card.setAsideHost !== undefined) continue;
    const def = defById(state, card.definitionId);
    if (getCardEffects(def).some(e => e.type === 'no-character-play-limit')) return true;
  }
  return false;
}

/**
 * Keywords that mark a card as a *magic card* (a spell). Any of these on a
 * card's `keywords` list qualifies: the generic `spell` tag plus the three
 * casting classes. Backs Akhôrahil the Ringwraith's (le-51) magic-recycling
 * passive ({@link MagicDiscardToDeckEffect}).
 */
const MAGIC_CARD_KEYWORDS = ['spell', 'sorcery', 'spirit-magic', 'shadow-magic'] as const;

/**
 * True when `def` is a magic card — it carries any {@link MAGIC_CARD_KEYWORDS}.
 */
export function isMagicCard(def: CardDefinition | undefined): boolean {
  if (!def || !('keywords' in def) || !Array.isArray((def as { keywords?: readonly string[] }).keywords)) {
    return false;
  }
  const keywords = (def as { keywords: readonly string[] }).keywords;
  return MAGIC_CARD_KEYWORDS.some(k => keywords.includes(k));
}

/**
 * True when `playerIndex`'s revealed avatar in play carries a
 * `magic-discard-to-deck` passive (Akhôrahil the Ringwraith le-51). Such a
 * player recycles the magic cards they cast back into their play deck instead
 * of discarding them.
 */
export function playerRecyclesMagicToDeck(state: GameState, playerIndex: number): boolean {
  const avatar = findPlayerAvatar(state, state.players[playerIndex]);
  if (!avatar) return false;
  const def = resolveDef(state, avatar.instanceId);
  return getCardEffects(def).some(e => e.type === 'magic-discard-to-deck');
}

/**
 * Dispose of a just-played event `card` for the player at `playerIndex`. By
 * default the card goes to that player's discard pile. But when the card is a
 * magic card ({@link isMagicCard}) and the player's revealed avatar carries the
 * `magic-discard-to-deck` passive ({@link playerRecyclesMagicToDeck}) — i.e.
 * Akhôrahil the Ringwraith (le-51) is their Ringwraith — the card is instead
 * shuffled back into their play deck and the deck reshuffled: "As your
 * Ringwraith, when a magic card used by him has to be discarded, return it to
 * the play deck and reshuffle."
 *
 * Callers pass the already-removed-from-hand event instance; this helper only
 * decides its destination (no card instance disappears: it lands in exactly one
 * of playDeck or discardPile).
 */
export function discardOrRecyclePlayedEvent(
  state: GameState,
  playerIndex: number,
  card: CardInstance,
): GameState {
  const def = defById(state, card.definitionId);
  if (isMagicCard(def) && playerRecyclesMagicToDeck(state, playerIndex)) {
    const player = state.players[playerIndex];
    const [shuffledDeck, nextRng] = shuffle([...player.playDeck, card], state.rng);
    logDetail(
      `${def && 'name' in def ? def.name : (card.definitionId as string)}: magic card returned to ${player.id as string}'s ` +
      `play deck and reshuffled (Akhôrahil the Ringwraith) instead of discarding`,
    );
    return {
      ...updatePlayer(state, playerIndex, p => ({ ...p, playDeck: shuffledDeck })),
      rng: nextRng,
    };
  }
  return updatePlayer(state, playerIndex, p => ({ ...p, discardPile: [...p.discardPile, card] }));
}

/**
 * The name of a player's Wizard avatar in play (e.g. "Radagast", "Gandalf"),
 * or `undefined` when no avatar is in play. Backs faction "Standard
 * Modifications: if <Wizard> is your Wizard (+N)" clauses — exposed on the
 * faction-influence resolver context as `controller.wizard` so a
 * `check-modifier` can gate on `{ "controller.wizard": "Radagast" }`
 * (Wild Hounds wh-40). The avatar is a company character, not a `cardsInPlay`
 * entry, so it is not reachable via `controller.inPlay`.
 */
export function playerWizardName(
  state: GameState,
  player: { readonly characters: Readonly<Record<string, CharacterInPlay>> },
): string | undefined {
  const avatar = findPlayerAvatar(state, player);
  if (!avatar) return undefined;
  const def = resolveDef(state, avatar.instanceId);
  return def && 'name' in def ? (def as { name: string }).name : undefined;
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
 *
 * `generalInfluenceOverride` displaces whichever base would otherwise apply: a
 * Radagast Shapeshifter form (wh-112/115/116) adopts a whole attribute line,
 * so its printed general influence *is* the pool while the form is on him.
 * Ordinary bonuses still stack on top of the adopted number.
 */
export function effectiveGeneralInfluence(state: GameState, playerId: PlayerId): number {
  const player = playerById(state, playerId);
  if (!player) return GENERAL_INFLUENCE;
  const bonus = player.generalInfluenceBonus ?? 0;
  if (player.generalInfluenceOverride !== undefined) return player.generalInfluenceOverride + bonus;
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

/**
 * The portion of a player's general influence that may be spent to control
 * characters (subtract `generalInfluenceUsed` for the remaining capacity).
 * This is the full pool ({@link effectiveGeneralInfluence}) minus any
 * `generalInfluenceControlPenalty` — the part of an in-play GI bonus that is
 * restricted to defensive/unused use only (e.g. Truths of Doom wh-108: +6 to
 * the pool but only +2 usable to control characters). For the common case
 * (no control-restricted bonus) this equals {@link effectiveGeneralInfluence}.
 */
export function generalInfluenceControlLimit(state: GameState, playerId: PlayerId): number {
  const player = playerById(state, playerId);
  const penalty = player?.generalInfluenceControlPenalty ?? 0;
  return effectiveGeneralInfluence(state, playerId) - penalty;
}

export function countCopiesInPlay(state: GameState, name: string): number {
  let count = 0;
  for (const p of state.players) {
    for (const c of p.cardsInPlay) {
      if (defById(state, c.definitionId)?.name === name) count += 1;
    }
    // Stage permanent-events "placed on the avatar" (Give Welcome to the
    // Unexpected wh-99, Pallando's Hood wh-105, Wizard's Myrmidon wh-84) live in
    // a character's `items`, not `cardsInPlay`; count them there too so a unique
    // such card cannot be played a second time while one is already attached.
    for (const char of Object.values(p.characters)) {
      for (const item of char.items) {
        if (defById(state, item.definitionId)?.name === name) count += 1;
      }
    }
  }
  return count;
}

/**
 * Count in-play copies of `name` that are currently being targeted for discard
 * by an unresolved chain entry.
 *
 * CRF 22 Annotation 11 ("Cannot be Duplicated"): a card that cannot be
 * duplicated may still be played while a copy is already in play, *provided
 * that copy is currently being targeted by an effect that will discard it*. The
 * canonical case is a Twilight (tw-106) on the chain canceling an in-play Gates
 * of Morning (tw-243): the moving player may respond with a fresh Gates of
 * Morning because the existing one is about to be discarded.
 *
 * An in-play environment card is "targeted for discard" when an unresolved,
 * un-negated short-event chain entry names its instance id as its target — such
 * an entry cancels and discards the target on resolution (see
 * `resolveEnvironmentCancel` in `chain-reducer.ts`). The count returned here is
 * subtracted from {@link countCopiesInPlay} in the game-scope duplication-limit
 * check so the replacement copy becomes playable.
 */
export function countCopiesInPlayTargetedForDiscard(state: GameState, name: string): number {
  const chain = state.chain;
  if (!chain) return 0;
  const targetedForDiscard = (instanceId: CardInstanceId): boolean =>
    chain.entries.some(
      e => !e.resolved && !e.negated
        && e.payload.type === 'short-event'
        && e.payload.targetInstanceId === instanceId,
    );
  let count = 0;
  for (const p of state.players) {
    for (const c of p.cardsInPlay) {
      if (defById(state, c.definitionId)?.name !== name) continue;
      if (targetedForDiscard(c.instanceId)) count += 1;
    }
  }
  return count;
}

/**
 * True when the card definition `defId` carries the given (lowercased) keyword.
 * Keyword matching is case-insensitive so `"Spawn"` in card data matches
 * `"spawn"`.
 */
function defHasKeyword(state: GameState, defId: CardDefinitionId, keyword: string): boolean {
  const def = defById(state, defId);
  const kws = (def as { keywords?: readonly string[] } | undefined)?.keywords;
  return kws ? kws.some(k => k.toLowerCase() === keyword) : false;
}

/**
 * Count all `spawn`-keyword cards currently in play across both players, backing
 * "the number of Spawn cards in play" (The Reek ba-23, Darkness Made by Malice
 * ba-15, Desire All for Thy Belly ba-16). "Eliminated Spawn do not count" is
 * satisfied automatically: eliminated cards leave the in-play zones for a
 * discard/out-of-play pile, so they are not scanned here.
 *
 * Spawn cards may be in play as characters (The Balrog ba-3), allies (Evil
 * Things Lingering ba-45), attached hazards, or bare permanent-events in
 * `cardsInPlay` (Spawn of Ungoliant ba-24 and its kin). All of these zones are
 * counted.
 */
export function countSpawnCardsInPlay(state: GameState): number {
  let count = 0;
  for (const p of state.players) {
    for (const cip of p.cardsInPlay) {
      if (defHasKeyword(state, cip.definitionId, 'spawn')) count += 1;
    }
    for (const ch of Object.values(p.characters)) {
      if (defHasKeyword(state, ch.definitionId, 'spawn')) count += 1;
      for (const ally of ch.allies) {
        if (defHasKeyword(state, ally.definitionId, 'spawn')) count += 1;
      }
      for (const hazard of ch.hazards) {
        if (defHasKeyword(state, hazard.definitionId, 'spawn')) count += 1;
      }
      for (const item of ch.items) {
        if (defHasKeyword(state, item.definitionId, 'spawn')) count += 1;
      }
    }
  }
  return count;
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
 * Count copies of the permanent event named `name` currently attached to the
 * item instance `itemInstanceId` (an `attachedToItem` binding in any player's
 * `cardsInPlay`). Backs `duplication-limit` checks with `scope: "item"` (e.g.
 * Barrow-blade dm-119: "Cannot be duplicated on a given Dagger").
 */
export function countItemAttachedCopies(state: GameState, itemInstanceId: CardInstanceId, name: string): number {
  return state.players.reduce((count, p) =>
    count + p.cardsInPlay.filter(c => c.attachedToItem === itemInstanceId && defById(state, c.definitionId)?.name === name).length,
  0);
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
 * Evaluate a `play-condition` `requires: 'company-context'` DSL condition
 * against a specific company (the play-target character's company for a
 * character-targeting permanent event).
 *
 * Exposes `{ site: { name, type, isOwnWizardhaven }, company: { characterNames,
 * itemNames, allyNames, playedUniqueHeroFactionAtFreeHold } }`. `itemNames`
 * aggregates every item / attached permanent event borne by any character in
 * the company, so a card can gate on "in the same company as <named card>" (the
 * named card being attached to a company-mate). `playedUniqueHeroFactionAtFreeHold`
 * is the caller-supplied site-phase flag (true only when this company has, this
 * site phase, played a unique hero faction at a Free-hold that is not Bag End).
 * `site.isOwnWizardhaven` is `true` when the company's current site is one of the
 * player's own Wizardhavens (a Fallen-wizard haven, or a site converted into one
 * via Hidden Haven wh-75) — this is what "at one of your Wizardhavens [{H}]"
 * means, distinguishing a Fallen-wizard's own havens from generic METW
 * Havens/MELE Darkhavens that merely share `type: "haven"`.
 *
 * Used by To Fealty Sworn (ba-33) and the Fallen-wizard "squire" companions
 * (Squire of the Hunt wh-95, Gandalf's Friend wh-98, Pallando's Apprentice
 * wh-104).
 */
export function matchesCompanyContextCondition(
  state: GameState,
  player: PlayerState,
  company: Company,
  condition: Condition,
  playedUniqueHeroFactionAtFreeHold: boolean,
  playedFactionHere = false,
): boolean {
  const siteDefId = company.currentSite?.definitionId;
  const siteDef = siteDefId ? defById(state, siteDefId) : undefined;
  const siteName = siteDef?.name;
  const siteType = siteDef && isSiteCard(siteDef) ? siteDef.siteType : undefined;
  const isOwnWizardhaven = isHavenForPlayer(
    siteDef,
    player.alignment,
    siteDefId ? { state, siteDefinitionId: siteDefId, playerId: player.id } : undefined,
  );

  const characterNames: string[] = [];
  const itemNames: string[] = [];
  const allyNames: string[] = [];
  for (const charId of company.characters) {
    const char = player.characters[charId];
    if (!char) continue;
    const cn = defById(state, char.definitionId)?.name;
    if (cn != null) characterNames.push(cn);
    itemNames.push(...defNamesOf(state, char.items));
    allyNames.push(...defNamesOf(state, char.allies));
  }

  const context: Record<string, unknown> = {
    site: { name: siteName, type: siteType, isOwnWizardhaven },
    company: { characterNames, itemNames, allyNames, playedUniqueHeroFactionAtFreeHold, playedFactionHere },
  };
  return matchesCondition(condition, context);
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
 * Game-wide environment override contributed by in-play cards carrying an
 * `environment-override` effect (Peril Returned td-54). Returns the union of
 * every such card's `considerInPlay` names (treated as in play regardless of any
 * actual card) and `considerNotInPlay` names (treated as out of play even while
 * their card sits in `cardsInPlay`). Both sets are empty in the common case.
 *
 * The override is global — an environment card reshapes the interpretation for
 * every player — so both players' `cardsInPlay` are scanned and the result is
 * consulted by both the `inPlay`-context builder (`buildInPlayNames`) and the
 * name-in-play predicates below, keeping every "is X in play?" query consistent.
 */
export function collectEnvironmentOverride(state: GameState): { add: Set<string>; remove: Set<string> } {
  const add = new Set<string>();
  const remove = new Set<string>();
  for (const p of state.players) {
    for (const card of p.cardsInPlay) {
      const def = defById(state, card.definitionId);
      if (!def) continue;
      for (const eff of getCardEffects(def)) {
        if (eff.type !== 'environment-override') continue;
        for (const n of eff.considerInPlay ?? []) add.add(n);
        for (const n of eff.considerNotInPlay ?? []) remove.add(n);
      }
    }
  }
  return { add, remove };
}

/**
 * Applies the game-wide {@link collectEnvironmentOverride} to a single name
 * query, returning `true`/`false` when the name is forced in/out of play, or
 * `undefined` when no override touches it (caller falls back to a physical
 * scan). Additions win over removals for a name in both lists.
 */
function overriddenInPlay(state: GameState, name: string): boolean | undefined {
  const { add, remove } = collectEnvironmentOverride(state);
  if (add.has(name)) return true;
  if (remove.has(name)) return false;
  return undefined;
}

/**
 * True if any player has a card with the given name among their characters or
 * cards in play. Used for "card-not-in-play" play conditions, where the named
 * blocker may be either a character or a permanent in play.
 *
 * Honors the game-wide environment override (Peril Returned td-54) so a name
 * "considered in play" (Doors of Night) reads as in play with no actual card,
 * and a name "considered out of play" (Gates of Morning) reads as absent even
 * while its card remains in `cardsInPlay`.
 */
export function isCardNameInPlayOrCharacters(state: GameState, name: string): boolean {
  const override = overriddenInPlay(state, name);
  if (override !== undefined) return override;
  return state.players.some(p =>
    Object.values(p.characters).some(ch => defById(state, ch.definitionId)?.name === name) ||
    p.cardsInPlay.some(c => defById(state, c.definitionId)?.name === name),
  );
}

/**
 * The `move` effect by which a card relocates *itself* from the sideboard into
 * the play deck — the Balrog sideboard family's "You may bring this card from
 * your sideboard into your play deck and reshuffle during your organization
 * phase" (Terror Heralds Doom ba-78 et al.). Returns undefined when the card
 * declares no such effect. Shared by the organization-phase legal-action
 * generator and its reducer.
 */
export function selfSideboardToDeckMove(
  def: CardDefinition | undefined,
): import('../types/effects.js').MoveEffect | undefined {
  if (!def) return undefined;
  return getCardEffects(def).find((e): e is import('../types/effects.js').MoveEffect => {
    if (e.type !== 'move' || e.select !== 'self' || e.to !== 'deck') return false;
    const from = Array.isArray(e.from) ? e.from : [e.from];
    return from.includes('sideboard');
  });
}

/**
 * True if a named card is in play for the given player, checking every in-play
 * zone the player controls: `cardsInPlay` (permanent/long events, factions,
 * stage cards), the player's characters, and cards attached to those characters
 * (items and hazards). Attachment-aware because some "in play" cards live only
 * as character-attached permanent events — e.g. Flame of Udûn (ba-58), a Demon
 * fána played on The Balrog and held in his `items`. Backs the resource
 * short-event `card-in-play` play-condition (Terror Heralds Doom ba-78:
 * "Playable ... if Flame of Udûn is in play").
 */
export function isCardNameInPlayForPlayer(
  state: GameState,
  player: PlayerState,
  name: string,
): boolean {
  // Environment overrides (Peril Returned td-54) are game-wide, so they resolve
  // the query before the per-player scan (Doors of Night considered in play,
  // Gates of Morning considered out, for every player).
  const override = overriddenInPlay(state, name);
  if (override !== undefined) return override;
  if (player.cardsInPlay.some(c => defById(state, c.definitionId)?.name === name)) return true;
  for (const ch of Object.values(player.characters)) {
    if (defById(state, ch.definitionId)?.name === name) return true;
    if (ch.items.some(i => defById(state, i.definitionId)?.name === name)) return true;
    if (ch.hazards.some(h => defById(state, h.definitionId)?.name === name)) return true;
  }
  return false;
}

/**
 * All card names in play for the given player, attachment-aware: `cardsInPlay`
 * plus every character, the items and hazards attached to them. The list form
 * of {@link isCardNameInPlayForPlayer}; used to populate a `defender.inPlay`
 * combat context so a `when` gate can test `{ $includes: "<name>" }` for a card
 * that lives only as a character-attached permanent event (e.g. Great Shadow
 * ba-62, a Demon fána on The Balrog). Backs Darkness Wielded (ba-55):
 * "Playable on an attack against The Balrog's company if Great Shadow is in play."
 */
export function inPlayNamesForPlayerDeep(
  state: GameState,
  player: PlayerState,
): readonly string[] {
  const names: string[] = [];
  const push = (id: import('../types/common.js').CardDefinitionId): void => {
    const n = defById(state, id)?.name;
    if (n) names.push(n);
  };
  for (const c of player.cardsInPlay) push(c.definitionId);
  for (const ch of Object.values(player.characters)) {
    push(ch.definitionId);
    for (const i of ch.items) push(i.definitionId);
    for (const h of ch.hazards) push(h.definitionId);
  }
  // Apply the game-wide environment override (Peril Returned td-54) so a
  // `defender.inPlay` `$includes` gate sees the same considered-in/out set.
  const { add, remove } = collectEnvironmentOverride(state);
  if (add.size === 0 && remove.size === 0) return names;
  const adjusted = names.filter(n => !remove.has(n) || add.has(n));
  for (const n of add) {
    if (!adjusted.includes(n)) adjusted.push(n);
  }
  return adjusted;
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
 * True if a character definition is an agent whose *printed* home site is a
 * site of one of the given {@link SiteType}s.
 *
 * The `homesite` field is a comma-separated list of site *names*; this resolves
 * each name against the card pool and checks whether any matching site's type
 * is in `types`. A single site name can exist in more than one alignment's map
 * with *different* types (e.g. Dol Guldur is a minion haven but a hero
 * dark-hold), so when the character definition carries an alignment the lookup
 * is restricted to sites of that same alignment (falling back to any-alignment
 * site of that name only when no alignment-matched site exists). This keys the
 * classification off the map the agent actually uses. Used by Inner Cunning
 * (dm-68) — both mode 1's reveal broadening ("if his home site is a Shadow-hold
 * or Dark-hold") and mode 2's fetch filter ("any agent whose home site is a
 * Shadow-hold or Dark-hold").
 */
export function agentHomeSiteMatchesTypes(
  state: GameState,
  def: { homesite?: string; alignment?: Alignment } | undefined,
  types: readonly SiteType[],
): boolean {
  if (!def?.homesite) return false;
  const names = new Set(parseHomesiteNames(def.homesite));
  if (names.size === 0) return false;
  const align = def.alignment;
  // Collect same-named sites, preferring those matching the agent's alignment.
  const named = Object.values(state.cardPool).filter(
    (d): d is SiteCard => isSiteCard(d) && names.has(d.name),
  );
  const aligned = align !== undefined ? named.filter(s => s.alignment === align) : [];
  const candidates = aligned.length > 0 ? aligned : named;
  return candidates.some(s => types.includes(s.siteType));
}

/**
 * The distinct printed {@link SiteType}s of a character's home sites.
 *
 * Companion to {@link agentHomeSiteMatchesTypes} that returns the *set* of types
 * rather than a boolean, so a play-target filter context can expose
 * `target.homeSiteTypes` and gate on "who has a Border-hold or Free-hold as a
 * home site" (Faithless Steward as-83). Resolution mirrors
 * `agentHomeSiteMatchesTypes`: each comma-separated home-site name is resolved
 * against the pool, preferring sites of the character's own alignment.
 */
export function characterHomeSiteTypes(
  state: GameState,
  def: { homesite?: string; alignment?: Alignment } | undefined,
): SiteType[] {
  if (!def?.homesite) return [];
  const names = new Set(parseHomesiteNames(def.homesite));
  if (names.size === 0) return [];
  const align = def.alignment;
  const named = Object.values(state.cardPool).filter(
    (d): d is SiteCard => isSiteCard(d) && names.has(d.name),
  );
  const aligned = align !== undefined ? named.filter(s => s.alignment === align) : [];
  const candidates = aligned.length > 0 ? aligned : named;
  const types = new Set<SiteType>();
  for (const s of candidates) types.add(s.siteType);
  return [...types];
}

/**
 * Evaluates whether an {@link AgentHomeSiteFactionLockEffect} (Faithless Steward
 * as-83) is currently *active* for its bearer character. Active means the bearer
 * is **unwounded** and its company is standing at one of the character's home
 * sites whose printed type is in `homeSiteTypes`. Returns the locked site's
 * printed `name` when active so callers can match "any version of that site".
 */
export function agentHomeSiteFactionLockState(
  state: GameState,
  char: CharacterInPlay,
  charDef: { homesite?: string },
  company: Company | undefined,
  homeSiteTypes: readonly SiteType[],
): { active: boolean; siteName?: string } {
  // Only while the bearer is unwounded (wounded == inverted).
  if (char.status === CardStatus.Inverted) return { active: false };
  const currentSite = company?.currentSite;
  if (!currentSite) return { active: false };
  const siteDef = state.cardPool[currentSite.definitionId];
  if (!siteDef || !isSiteCard(siteDef)) return { active: false };
  // The current site must be one of the bearer's home sites AND of a
  // qualifying type (Border-hold / Free-hold).
  if (!homeSiteTypes.includes(siteDef.siteType)) return { active: false };
  const homeNames = parseHomesiteNames(charDef.homesite ?? '');
  if (!homeNames.includes(siteDef.name)) return { active: false };
  return { active: true, siteName: siteDef.name };
}

/**
 * True if any in-play {@link AgentHomeSiteFactionLockEffect} (Faithless Steward
 * as-83) currently bars faction plays at the named site — i.e. some player's
 * character bears an active lock whose current home site prints that name. Used
 * by the site-phase faction legal-action gate to forbid factions at "any
 * version of that site". Scans both players since the lock applies to everyone.
 */
export function siteFactionLockedByAgentHomeSite(
  state: GameState,
  siteName: string,
): boolean {
  for (const player of state.players) {
    for (const char of Object.values(player.characters)) {
      for (const item of char.items) {
        const def = resolveDef(state, item.instanceId);
        if (!def) continue;
        const lock = getCardEffects(def).find(
          (e): e is AgentHomeSiteFactionLockEffect => e.type === 'agent-home-site-faction-lock',
        );
        if (!lock) continue;
        const charDef = resolveDef(state, char.instanceId);
        if (!charDef || !isCharacterCard(charDef)) continue;
        const company = findCharacterCompany(player.companies, char.instanceId);
        const st = agentHomeSiteFactionLockState(state, char, charDef, company, lock.homeSiteTypes);
        if (st.active && st.siteName === siteName) return true;
      }
    }
  }
  return false;
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

// ─── Opponent-influence override (Prophet of Doom wh-106) ────────────────────

/** Sentinel penalty when the target region is unreachable in the region graph. */
const UNREACHABLE_REGION_PENALTY = 99;

/**
 * The active player's in-play `opponent-influence-override` effect (Prophet of
 * Doom wh-106), or `undefined` if none is in play. The effect is carried by a
 * stage permanent-event in the player's `cardsInPlay`.
 */
export function getOpponentInfluenceOverride(
  state: GameState,
  player: PlayerState,
): OpponentInfluenceOverrideEffect | undefined {
  for (const card of player.cardsInPlay) {
    const def = defById(state, card.definitionId);
    const eff = getCardEffects(def).find(e => e.type === 'opponent-influence-override');
    if (eff) return eff;
  }
  return undefined;
}

/**
 * The value an `opponent-influence-override` contributes to the influence check
 * in place of the influencer's unused direct influence: the player's unused
 * general influence divided by `divisor` (rounded per `roundUp`), clamped to
 * `[0, max]`. Prophet of Doom: half of unused GI, rounded up, capped at 10.
 */
export function generalInfluenceSubstitutionValue(
  unusedGeneralInfluence: number,
  sub: NonNullable<OpponentInfluenceOverrideEffect['generalInfluenceSubstitution']>,
): number {
  const quotient = unusedGeneralInfluence / sub.divisor;
  const rounded = sub.roundUp ? Math.ceil(quotient) : Math.floor(quotient);
  return Math.max(0, Math.min(sub.max, rounded));
}

/**
 * Name of the site a company currently occupies, or undefined when it has no
 * site card in play. The site *name* — not its definition id — is the identity
 * of the physical location: each location exists as several alignment-specific
 * cards (e.g. Rivendell is `tw-421` for hero players and `as-160` for minion
 * players) and both players may have a copy in play at once (rule g.site.1).
 * Any "at the same site" check that compares companies across players must
 * therefore compare names, not definition ids.
 */
export function companySiteName(state: GameState, company: Company | undefined): string | undefined {
  const siteId = company?.currentSite?.instanceId;
  if (!siteId) return undefined;
  const def = resolveDef(state, siteId);
  return def && isSiteCard(def) ? def.name : undefined;
}

/** Region name of the site a company currently occupies, or undefined. */
export function companySiteRegion(state: GameState, company: Company | undefined): string | undefined {
  const siteId = company?.currentSite?.instanceId;
  if (!siteId) return undefined;
  const def = resolveDef(state, siteId);
  return def && isSiteCard(def) ? def.region : undefined;
}

/**
 * The set of region names where a faction may be played, resolved from its
 * `playableAt` entries: named-site entries map to that site's region and
 * named-region entries contribute directly. Site-type / any entries have no
 * single region and are skipped. Used to approximate "the region the faction is
 * played in" for Prophet of Doom's region-distance penalty when re-influencing
 * an opponent's in-play faction (the game does not record the exact site a
 * faction was played at).
 */
export function factionPlayableSiteRegions(state: GameState, factionDef: CardDefinition): readonly string[] {
  if (!isFactionCard(factionDef)) return [];
  const regions = new Set<string>();
  for (const entry of factionDef.playableAt) {
    if ('region' in entry) {
      regions.add(entry.region);
    } else if ('site' in entry) {
      for (const d of Object.values(state.cardPool)) {
        if (isSiteCard(d) && d.name === entry.site && d.region) regions.add(d.region);
      }
    }
  }
  return [...regions];
}

/**
 * The inclusive region-distance penalty (CRF 22: both endpoint regions count)
 * for a Prophet-of-Doom influence attempt: the minimum distance from the
 * influencer's region to any of the candidate target regions. Returns 0 when
 * either side is undeterminable (no penalty) and a large sentinel when a
 * determinable target is unreachable in the region graph.
 */
export function influenceRegionPenalty(
  state: GameState,
  influencerRegion: string | undefined,
  targetRegions: readonly string[],
): number {
  if (!influencerRegion || targetRegions.length === 0) return 0;
  const map = buildMovementMap(state.cardPool);
  let best: number | null = null;
  for (const target of targetRegions) {
    const d = regionDistanceInclusive(map, influencerRegion, target);
    if (d === null) continue;
    if (best === null || d < best) best = d;
  }
  return best ?? UNREACHABLE_REGION_PENALTY;
}

/**
 * One `playableAt` entry of an ally/faction card matched against a site
 * definition: a named site, a site type, or a region (non-haven sites only),
 * with the entry's optional `when` condition evaluated against the site
 * (mirrors `siteMatchesEntry` in `legal-actions/site.ts`, on printed types).
 */
function playableAtEntryMatchesSite(
  entry: import('../types/cards-resources.js').PlayableAtEntry,
  siteDef: SiteCard,
): boolean {
  if ('region' in entry) {
    if (siteDef.siteType === 'haven') return false;
    return siteDef.region === entry.region;
  }
  // `any` entries match every site subject to the optional `when` condition.
  // NOTE: this path (backing `isCardPlayableAtSiteDef`, e.g. Strider's
  // discard-pile fetch) has no `state`, so `site.regionType` is not populated
  // here — a `when` gating on region type under-approximates (safe: never a
  // false positive). The primary faction-play path (`siteMatchesEntry` in
  // `legal-actions/site.ts`) supplies `regionType` and evaluates it fully.
  const baseMatches = 'any' in entry
    ? true
    : 'site' in entry
      ? siteDef.name === entry.site
      : siteDef.siteType === entry.siteType;
  if (!baseMatches) return false;
  if (!entry.when) return true;
  const autoAttackRaces = siteDef.automaticAttacks.map(a => normalizeCreatureRace(a.creatureType));
  return matchesCondition(entry.when, {
    site: {
      name: siteDef.name,
      siteType: siteDef.siteType,
      region: siteDef.region,
      autoAttack: { race: autoAttackRaces },
    },
  });
}

/**
 * True when `def` — an item, ally, or faction — is playable at the site
 * described by `siteDef`, per each card type's own playability rule:
 *
 * - **Items**: the item's subtype must appear in the site's printed
 *   `playableResources` list, or an `item-play-site` effect on the item
 *   must name the site (`sites`) / match it (`filter`).
 * - **Allies / factions**: some `playableAt` entry must match the site.
 *
 * Other card types return false. Backs the `playableAtSite` restriction of
 * `fetch-to-deck` pending effects (Strider ba-1: "search your discard pile
 * for any one item, ally, or faction playable at his current site").
 */
export function isCardPlayableAtSiteDef(def: CardDefinition, siteDef: SiteCard): boolean {
  if (isItemCard(def)) {
    if ((siteDef.playableResources as readonly string[]).includes(def.subtype as string)) return true;
    const playSite = getCardEffects(def).find(
      (e): e is import('../types/effects.js').ItemPlaySiteEffect => e.type === 'item-play-site',
    );
    if (playSite?.sites?.includes(siteDef.name)) return true;
    if (playSite?.filter) {
      const autoAttackRaces = siteDef.automaticAttacks.map(a => normalizeCreatureRace(a.creatureType));
      return matchesContext(playSite.filter, { site: { ...siteDef, autoAttackRaces } });
    }
    return false;
  }
  if (isAllyCard(def)) {
    return def.playableAt.some(entry => playableAtEntryMatchesSite(entry, siteDef));
  }
  if (isFactionCard(def)) {
    return def.playableAt.some(entry => playableAtEntryMatchesSite(entry, siteDef));
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
 * Fires `play-deck-exhausted` — discards any permanent event that declares
 * `on-event: play-deck-exhausted` with a self-discard `move` apply, whether it
 * sits in either player's `cardsInPlay` (Safe from the Shadow, Tokens to Show)
 * or is attached to a character as an item / hazard (Fool's Bane wh-19 and
 * Cruel Claw Perceived wh-16, both hazard permanent-events played on the
 * opponent's avatar). An attached card returns to *its owner's* discard pile,
 * so an opponent-owned hazard goes back to the opponent's pile.
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

  // Same trigger for cards attached to a character (items and hazards). The
  // card leaves its host and lands in its owner's discard pile.
  for (let pi = 0; pi < 2; pi++) {
    for (const [charId, char] of Object.entries(result.players[pi].characters)) {
      for (const slot of ['items', 'hazards'] as const) {
        for (const card of char[slot]) {
          const def = defById(result, card.definitionId);
          if (!getOnEventEffects(def, 'play-deck-exhausted').some(e => isSelfDiscardMove(e.apply))) continue;
          const ownerIndex = getPlayerIndex(result, ownerOf(card.instanceId));
          logDetail(`play-deck-exhausted: discarding ${cardName(result, card.definitionId)} from ${charId} to ${result.players[ownerIndex].name}'s discard pile`);
          result = updatePlayer(result, pi, p => {
            const host = p.characters[charId as CardInstanceId];
            if (!host) return p;
            return {
              ...p,
              characters: {
                ...p.characters,
                [charId]: { ...host, [slot]: host[slot].filter(c => c.instanceId !== card.instanceId) },
              },
            };
          });
          result = updatePlayer(result, ownerIndex, p => ({
            ...p,
            discardPile: [...p.discardPile, toCardInstance(card)],
          }));
        }
      }
    }
  }

  return result;
}

/**
 * Returns the name of an in-play card (either player's `cardsInPlay`) whose
 * `cancel-deck-search` effect cancels own-deck/discard searches for the given
 * acting player, or `null` when none applies.
 *
 * Each `cancel-deck-search` effect declares which players it hits via
 * `affects`: the default `"minion"` covers Ringwraith/Balrog players (MEBA: the
 * Balrog player is a minion player) — "all effects are automatically canceled
 * which allow a minion player to search through or look at any portion of his
 * play deck or discard pile outside of the normal sequence of play" (Lady of
 * the Golden Wood as-13) — while `"non-minion"` covers Wizard and
 * Fallen-wizard players (Bane of the Ithil-stone tw-13, which "has no effect on
 * a minion player").
 */
export function deckSearchCancellerFor(state: GameState, actorId: PlayerId): string | null {
  const actor = state.players.find(p => p.id === actorId);
  if (!actor) return null;
  const actorIsMinion = isMinionOrBalrog(actor);
  for (const p of state.players) {
    for (const card of p.cardsInPlay) {
      const def = defById(state, card.definitionId);
      if (!def) continue;
      for (const effect of getCardEffects(def)) {
        if (effect.type !== 'cancel-deck-search') continue;
        const hitsMinion = (effect.affects ?? 'minion') === 'minion';
        if (hitsMinion === actorIsMinion) return def.name;
      }
    }
  }
  return null;
}

/**
 * Applies any in-play `cancel-deck-search` effect to a `fetch-to-deck` payload
 * about to be enqueued for `actorId`: the canceled `deck` / `discard-pile`
 * sources are stripped from the fetch. Returns the (possibly reduced) effect,
 * or `null` when every source was canceled — the caller must then skip
 * enqueueing the fetch entirely (the search fizzles). Sideboard sources are
 * never affected (the card only cancels play-deck / discard-pile access).
 */
export function gateDeckSearchFetch(
  state: GameState,
  actorId: PlayerId,
  effect: FetchToDeckEffect,
): FetchToDeckEffect | null {
  if (!effect.source.some(s => s === 'deck' || s === 'discard-pile')) return effect;
  const canceller = deckSearchCancellerFor(state, actorId);
  if (!canceller) return effect;
  const remaining = effect.source.filter(s => s !== 'deck' && s !== 'discard-pile');
  if (remaining.length === 0) {
    logDetail(`cancel-deck-search: "${canceller}" cancels the play-deck/discard search for player ${actorId as string} — fetch fizzles`);
    return null;
  }
  logDetail(`cancel-deck-search: "${canceller}" strips play-deck/discard sources from ${actorId as string}'s fetch (remaining: ${remaining.join(', ')})`);
  return { ...effect, source: remaining };
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
    // Left Behind (td-41): a "left behind" company only rejoins its original
    // company by explicit choice ("may rejoin"), so it is exempt from the
    // automatic same-site merge (rule 2.IV.6). The optional rejoin is offered
    // as a `left-behind-rejoin` resolution at the M/H→Site transition.
    if (c.leftBehind) continue;
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
 * Whether `company` (owned by `player`) contains a character whose printed
 * `race` equals `race`. Shared by the {@link ProhibitCompanyEventsEffect}
 * machinery (Stormcrow td-73) to detect "a company with a Wizard".
 */
export function companyContainsRace(
  state: GameState,
  player: PlayerState,
  company: Company,
  race: string,
): boolean {
  return company.characters.some(cId => {
    const ch = player.characters[cId];
    if (!ch) return false;
    const def = defById(state, ch.definitionId);
    return !!def && isCharacterCard(def) && def.race === race;
  });
}

/**
 * Collects the races prohibited by every in-play
 * {@link ProhibitCompanyEventsEffect} (Stormcrow td-73), across both players'
 * `cardsInPlay`. A card still resolving a `trigger-attack-on-play` keep is
 * skipped (its ongoing effects are suppressed until the keep is confirmed).
 */
function collectProhibitedCompanyEventRaces(state: GameState): string[] {
  const races: string[] = [];
  for (const p of state.players) {
    for (const c of p.cardsInPlay) {
      if (c.pendingTriggerAttack) continue;
      for (const e of getCardEffects(defById(state, c.definitionId))) {
        if (e.type === 'prohibit-company-events') {
          races.push(e.companyHasRace);
        }
      }
    }
  }
  return races;
}

/**
 * Whether a resource permanent-event played on the company as a whole (e.g.
 * Fellowship tw-240) may **not** be played on `company` (owned by `player`)
 * because an in-play {@link ProhibitCompanyEventsEffect} (Stormcrow td-73)
 * targets a race present in the company. Consulted by the organization-phase
 * `play-target: company` emitter.
 */
export function isCompanyEventPlayProhibited(
  state: GameState,
  player: PlayerState,
  company: Company,
): boolean {
  const races = collectProhibitedCompanyEventRaces(state);
  return races.some(race => companyContainsRace(state, player, company, race));
}

/**
 * `postReduce` sweep: while a {@link ProhibitCompanyEventsEffect} (Stormcrow
 * td-73) is in play, discard every resource permanent-event bound to a
 * matching company (a company containing a prohibited race) to its owner's
 * discard pile. Runs continuously so it also catches a matching character
 * joining a company that already carries such an event. Company-bound
 * resource permanent-events are exactly the "played on the company as a whole"
 * cards (Fellowship); character-attached permanent-events (which set
 * `attachedTo`, not `companyId`) are untouched.
 */
export function sweepProhibitedCompanyEvents(state: GameState): GameState {
  const races = collectProhibitedCompanyEventRaces(state);
  if (races.length === 0) return state;
  const { state: next, removedInstanceIds } = discardCardsInPlayWhere(
    state,
    (card, player) => {
      if (card.companyId === undefined) return false;
      const def = defById(state, card.definitionId);
      if (!def) return false;
      if (def.cardType !== 'hero-resource-event' && def.cardType !== 'minion-resource-event') return false;
      if ((def as { eventType?: string }).eventType !== 'permanent') return false;
      const company = player.companies.find(c => c.id === card.companyId);
      if (!company) return false;
      return races.some(race => companyContainsRace(state, player, company, race));
    },
    card => {
      const def = state.cardPool[card.definitionId] as { name?: string } | undefined;
      logDetail(`Stormcrow: discarding company-bound resource event "${def?.name ?? card.definitionId}" — company has a prohibited race`);
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
 * True when a site-bound permanent event's card text keeps its bound site
 * permanent — "This site is never discarded or returned to its location deck."
 * Such a card is exempt from the site-attached orphan sweep (it persists while
 * its site is unoccupied) and its bound origin site is always returned to the
 * owner's location deck rather than discarded when a company leaves it. Shared
 * by Caverns Unchoked (ba-51, `surface-region-adjacency`), Breach the Hold
 * (ba-50, `surface-site-roll-zero`), Roots of the Earth (ba-74,
 * `site-instance-transform`), and Eddy in Fate's Tide (ba-57, `eddy-lock`,
 * "This site is never discarded").
 *
 * Also true for Girdle of Radagast (wh-110, `region-type-conversion`): a
 * permanent Fallen-wizard **stage** resource bound to a Wizardhaven purely to
 * anchor its region-conversion effect. It contributes stage points for the rest
 * of the game and must persist when the company leaves the haven, so it is
 * exempt from the orphan sweep (the haven itself is never discarded regardless).
 */
export function cardKeepsBoundSitePermanent(def: CardDefinition | null | undefined): boolean {
  return getCardEffects(def).some(
    e => e.type === 'surface-region-adjacency'
      || e.type === 'surface-site-roll-zero'
      || e.type === 'site-instance-transform'
      || e.type === 'eddy-lock'
      || e.type === 'site-lock'
      || e.type === 'region-type-conversion'
      // Long Grievous Siege (ba-40): the besieged Border-hold is off to the
      // side and never any company's current site, so the host must not be
      // swept as a site-attached orphan.
      || e.type === 'faction-siege',
  );
}

/**
 * Whether the given site *definition* never untaps for `forPlayer` — i.e. that
 * player's `cardsInPlay` holds a bound (`attachedToSite === siteDefId`),
 * non-`pendingTriggerAttack` card carrying an `eddy-lock` (ba-57) or `site-lock`
 * (ba-72) effect. Used at re-placement (mh-hazard-play step 8) so the owner's
 * company arrives at a version of the locked site **tapped** ("never untaps for
 * you"). The engine never untaps a stationary site, so re-placement is the only
 * refresh point.
 */
export function siteNeverUntapsForOwner(
  state: GameState,
  siteDefId: CardDefinitionId | undefined,
  forPlayer: PlayerId,
): boolean {
  if (!siteDefId) return false;
  const owner = state.players.find(p => p.id === forPlayer);
  if (!owner) return false;
  return owner.cardsInPlay.some(c => {
    if (c.attachedToSite !== siteDefId || c.pendingTriggerAttack) return false;
    return getCardEffects(defById(state, c.definitionId)).some(
      e => e.type === 'eddy-lock' || e.type === 'site-lock',
    );
  });
}

/**
 * Sum of the `factionInfluenceModifier` of every in-play `site-lock` (People
 * Diminished ba-72) or `faction-siege` (Long Grievous Siege ba-40) card of
 * either player bound to the given site and not still `pendingTriggerAttack`.
 * Both cards read "-5 … at any version of this site", and hero/minion twins of
 * a site use distinct definition ids, so the binding is matched by the bound
 * site's printed *name* (definition-id equality is a fast path of that).
 * Applied to the faction-influence need in the site-phase legal-action path
 * and to the roll in `resolveInfluenceAttemptRoll`.
 */
export function siteFactionInfluenceModifier(
  state: GameState,
  siteDefId: CardDefinitionId | undefined,
): number {
  if (!siteDefId) return 0;
  const siteName = defById(state, siteDefId)?.name;
  let total = 0;
  for (const p of state.players) {
    for (const c of p.cardsInPlay) {
      if (c.attachedToSite === undefined || c.pendingTriggerAttack) continue;
      const boundMatches = c.attachedToSite === siteDefId
        || (siteName !== undefined && defById(state, c.attachedToSite)?.name === siteName);
      if (!boundMatches) continue;
      for (const e of getCardEffects(defById(state, c.definitionId))) {
        if (e.type === 'site-lock' && typeof e.factionInfluenceModifier === 'number') {
          total += e.factionInfluenceModifier;
        } else if (e.type === 'faction-siege') {
          total += e.factionInfluenceModifier;
        }
      }
    }
  }
  return total;
}

/**
 * Every in-play card of either player besieging `siteDefId` (bound via
 * `CardInPlay.attachedToSite`, not still `pendingTriggerAttack`) that carries a
 * `site-phase-start-attack` effect — the attacks a company at that site must
 * face at the beginning of its site phase, before deciding whether to enter
 * (Siege tw-87). Returned in `cardsInPlay` order so the sequence a company
 * faces is stable across recomputations.
 */
export function siteStartOfPhaseAttacks(
  state: GameState,
  siteDefId: CardDefinitionId | undefined,
): readonly { readonly cardInstanceId: CardInstanceId; readonly effect: import('../types/effects.js').SitePhaseStartAttackEffect }[] {
  if (!siteDefId) return [];
  const out: { cardInstanceId: CardInstanceId; effect: import('../types/effects.js').SitePhaseStartAttackEffect }[] = [];
  for (const p of state.players) {
    for (const c of p.cardsInPlay) {
      if (c.attachedToSite !== siteDefId || c.pendingTriggerAttack) continue;
      for (const e of getCardEffects(defById(state, c.definitionId))) {
        if (e.type === 'site-phase-start-attack') out.push({ cardInstanceId: c.instanceId, effect: e });
      }
    }
  }
  return out;
}

/**
 * Every in-play card of either player besieging `siteDefId` that carries a
 * `company-movement-roll` effect — the end-of-organization-phase rolls a
 * company at that site must make to keep its movement (Siege tw-87).
 */
export function siteMovementRolls(
  state: GameState,
  siteDefId: CardDefinitionId | undefined,
): readonly {
  readonly cardInstanceId: CardInstanceId;
  readonly sourceDefinitionId: CardDefinitionId;
  readonly effect: import('../types/effects.js').CompanyMovementRollEffect;
}[] {
  if (!siteDefId) return [];
  const out: {
    cardInstanceId: CardInstanceId;
    sourceDefinitionId: CardDefinitionId;
    effect: import('../types/effects.js').CompanyMovementRollEffect;
  }[] = [];
  for (const p of state.players) {
    for (const c of p.cardsInPlay) {
      if (c.attachedToSite !== siteDefId || c.pendingTriggerAttack) continue;
      for (const e of getCardEffects(defById(state, c.definitionId))) {
        if (e.type === 'company-movement-roll') {
          out.push({ cardInstanceId: c.instanceId, sourceDefinitionId: c.definitionId, effect: e });
        }
      }
    }
  }
  return out;
}

/**
 * Aggregated anti-minion flags of every in-play `site-lock` card (of either
 * player) bound to the given site *definition* (and not still
 * `pendingTriggerAttack`). No Strangers at this Time (as-51) sets both flags:
 * against a minion (Ringwraith) company at any version of the bound site,
 * `convertDetainment` makes the site's detainment automatic-attacks resolve as
 * normal attacks, and `duplicateFirstAutoAttack` adds one exact copy of the
 * site's first automatic-attack. Both are gated on the defending company's
 * alignment by the caller (`reducer-site.ts`).
 */
export function siteLockAntiMinion(
  state: GameState,
  siteDefId: CardDefinitionId | undefined,
): { convertDetainment: boolean; duplicateFirstAutoAttack: boolean } {
  const result = { convertDetainment: false, duplicateFirstAutoAttack: false };
  if (!siteDefId) return result;
  for (const p of state.players) {
    for (const c of p.cardsInPlay) {
      if (c.attachedToSite !== siteDefId || c.pendingTriggerAttack) continue;
      for (const e of getCardEffects(defById(state, c.definitionId))) {
        if (e.type !== 'site-lock') continue;
        if (e.convertDetainmentVsMinion) result.convertDetainment = true;
        if (e.duplicateFirstAutoAttackVsMinion) result.duplicateFirstAutoAttack = true;
      }
    }
  }
  return result;
}

/**
 * The `eddy-lock` effect of an Eddy in Fate's Tide (ba-57) permanent-event that
 * is in play and bound to the given site *definition* — i.e. some player's
 * `cardsInPlay` holds a card whose `attachedToSite` equals `siteDefId` and which
 * carries an `eddy-lock` effect (and is not still `pendingTriggerAttack`).
 * Returns the effect (for its `taxTapCharacters`) or `undefined`.
 *
 * Scans **both** players so the tax applies to any company at any version of the
 * bound site definition, regardless of which player owns the Eddy. When
 * `forPlayer` is given, only that player's copies are considered — used for the
 * owner-only "never untaps for you" placement check.
 */
export function siteEddyLock(
  state: GameState,
  siteDefId: CardDefinitionId | undefined,
  forPlayer?: PlayerId,
): import('../types/effects.js').EddyLockEffect | undefined {
  if (!siteDefId) return undefined;
  for (const p of state.players) {
    if (forPlayer !== undefined && p.id !== forPlayer) continue;
    for (const c of p.cardsInPlay) {
      if (c.attachedToSite !== siteDefId || c.pendingTriggerAttack) continue;
      const eff = getCardEffects(defById(state, c.definitionId)).find(
        (e): e is import('../types/effects.js').EddyLockEffect => e.type === 'eddy-lock',
      );
      if (eff) return eff;
    }
  }
  return undefined;
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
      // A site-targeting hazard permanent-event (Troll-purse dm-95, Siege
      // tw-87) is played during the M/H phase on the company's *destination*
      // site, which only becomes its `currentSite` when the company arrives at
      // M/H step 8. Without counting declared destinations the card would be
      // swept as an orphan on the very action that played it. If the company is
      // later returned to its site of origin the destination is cleared and the
      // attached card is swept then, as its text requires ("Discard … when the
      // site card is returned to the location deck").
      if (co.destinationSite) occupied.add(co.destinationSite.definitionId as string);
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
      && !activeHosts.has(card.instanceId as string)
      // Caverns Unchoked (ba-51) / Breach the Hold (ba-50) / Roots of the Earth
      // (ba-74): "This site is never discarded or returned to its location
      // deck." The card is permanent and keeps its bound Under-deeps site in
      // play even while unoccupied — exempt it from the orphan sweep.
      && !cardKeepsBoundSitePermanent(defById(state, card.definitionId)),
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
 * Inner Cunning (dm-68) mode 1: discard any permanent event bound to a
 * face-down agent ({@link CardInPlay.attachedToAgentId}) once that agent is no
 * longer a face-down agent in the same player's `agents` list — i.e. it was
 * revealed ("Discard when the agent is revealed.") or otherwise left play.
 * Runs as part of the post-reduce sweep, mirroring
 * {@link discardOrphanedSiteAttachedEvents}.
 */
export function discardOrphanedAgentAttachedEvents(state: GameState): GameState {
  const { state: next, removedInstanceIds } = discardCardsInPlayWhere(
    state,
    (card, player) => {
      if (card.attachedToAgentId === undefined) return false;
      const agent = player.agents.find(a => a.id === card.attachedToAgentId);
      return !agent || agent.revealed;
    },
    (card, player) => {
      const def = state.cardPool[card.definitionId] as { name?: string } | undefined;
      const agent = player.agents.find(a => a.id === card.attachedToAgentId);
      logDetail(`agent-attached event: discarding "${def?.name ?? card.definitionId}" — bound agent ${card.attachedToAgentId as string} ${agent ? 'was revealed' : 'left play'}`);
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
 * Discard item-attached permanent events whose host item has left play. A card
 * with `attachedToItem` set (Barrow-blade dm-119, "play this with the Dagger")
 * is kept in cards-in-play bound to a specific item instance. When that item is
 * no longer borne by any character on either side (discarded, stored, returned
 * to hand, …) the event is orphaned and must be discarded. Mirrors
 * {@link discardOrphanedSiteAttachedEvents}.
 */
export function discardOrphanedItemAttachedEvents(state: GameState): GameState {
  // Collect every item instance currently borne by a character in play.
  const itemIds = new Set<string>();
  for (const p of state.players) {
    for (const ch of Object.values(p.characters)) {
      for (const it of ch.items) itemIds.add(it.instanceId as string);
    }
  }

  const { state: next, removedInstanceIds } = discardCardsInPlayWhere(
    state,
    card => card.attachedToItem !== undefined && !itemIds.has(card.attachedToItem as string),
    card => {
      const def = state.cardPool[card.definitionId] as { name?: string } | undefined;
      logDetail(`item-attached event: discarding "${def?.name ?? card.definitionId}" — host item ${card.attachedToItem as string} left play`);
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
 * Discard faction-attached permanent events whose target faction has left
 * play. A `faction-siege` card (Long Grievous Siege ba-40) is kept in
 * cards-in-play with `attachedTo` pointing at the target faction's in-play
 * instance. When that faction is no longer in any player's `cardsInPlay`
 * (returned to hand, discarded, re-influenced away, …) the event is orphaned
 * and discarded; its set-aside site card is then routed back to its owner's
 * location deck by the site-card branch of `sweepSetAside`. Mirrors
 * {@link discardOrphanedSiteAttachedEvents}.
 */
export function discardOrphanedFactionAttachedEvents(state: GameState): GameState {
  // Every faction instance currently in play (either player's cardsInPlay).
  const factionIds = new Set<string>();
  for (const p of state.players) {
    for (const c of p.cardsInPlay) {
      const def = defById(state, c.definitionId);
      if (def && isFactionCard(def)) factionIds.add(c.instanceId as string);
    }
  }

  const { state: next, removedInstanceIds } = discardCardsInPlayWhere(
    state,
    card => card.attachedTo !== undefined
      && !factionIds.has(card.attachedTo as string)
      && getCardEffects(defById(state, card.definitionId)).some(e => e.type === 'faction-siege'),
    card => {
      const def = state.cardPool[card.definitionId] as { name?: string } | undefined;
      logDetail(`faction-attached event: discarding "${def?.name ?? card.definitionId}" — target faction ${card.attachedTo as string} left play`);
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
 * Discard permanent events placed "with" a stored card
 * ({@link CardInPlay.attachedToStored} — Wizard's Trove wh-85
 * `storage-site-transfer` mode) once the stored card is no longer in the
 * controller's marshalling-point pile (e.g. displaced back to hand by Neither
 * so Ancient Nor so Potent dm-73). Runs as part of the post-reduce sweep,
 * mirroring {@link discardOrphanedItemAttachedEvents}.
 */
export function discardOrphanedStoredAttachedEvents(state: GameState): GameState {
  const { state: next, removedInstanceIds } = discardCardsInPlayWhere(
    state,
    (card, player) => card.attachedToStored !== undefined
      && !player.killPile.some(c => c.instanceId === card.attachedToStored),
    card => {
      const def = state.cardPool[card.definitionId] as { name?: string } | undefined;
      logDetail(`stored-attached event: discarding "${def?.name ?? card.definitionId}" — stored card ${card.attachedToStored as string} left the marshalling-point pile`);
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
 * Number of in-play copies of the named card attached (via `attachedTo`) to
 * the given faction instance, across both players. Backs `duplication-limit`
 * scope `'faction'` ("Cannot be duplicated on your faction", Long Grievous
 * Siege ba-40) — the analogue of `countItemAttachedCopies` for faction hosts.
 */
export function countFactionAttachedCopies(
  state: GameState,
  cardName: string,
  factionInstanceId: CardInstanceId,
): number {
  let count = 0;
  for (const p of state.players) {
    for (const c of p.cardsInPlay) {
      if (c.attachedTo !== factionInstanceId) continue;
      if (defById(state, c.definitionId)?.name === cardName) count++;
    }
  }
  return count;
}

/**
 * The site card instances in `player`'s location deck that a `faction-siege`
 * event may besiege for the given target faction: sites of the effect's
 * printed `siteType` whose region is the region of some site where the faction
 * is playable, or a region adjacent thereto ("The Border-hold must be in the
 * same region or adjacent thereto as a site where the target faction is
 * playable", Long Grievous Siege ba-40). Faction playability is evaluated with
 * {@link isCardPlayableAtSiteDef} against every site definition in the pool,
 * so named-site, site-type, and region `playableAt` entries all contribute.
 * CRF: "There must be an eligible borderhold for this card to be played" — an
 * empty result makes the play illegal.
 */
export function factionSiegeEligibleSites(
  state: GameState,
  player: PlayerState,
  factionDef: CardDefinition,
  siege: FactionSiegeEffect,
): CardInstance[] {
  // Regions containing a site where the target faction is playable.
  const regionSet = new Set<string>();
  for (const def of Object.values(state.cardPool)) {
    if (!isSiteCard(def) || !def.region) continue;
    if (isCardPlayableAtSiteDef(factionDef, def)) regionSet.add(def.region);
  }
  // Expand with adjacent regions (region cards carry the adjacency graph).
  const adjacent = new Set<string>();
  for (const def of Object.values(state.cardPool)) {
    const rc = def as { cardType?: string; name?: string; adjacentRegions?: readonly string[] };
    if (rc.cardType !== 'region' || !rc.name || !regionSet.has(rc.name)) continue;
    for (const adj of rc.adjacentRegions ?? []) adjacent.add(adj);
  }
  for (const r of adjacent) regionSet.add(r);

  return player.siteDeck.filter(inst => {
    const def = defById(state, inst.definitionId);
    return !!def && isSiteCard(def)
      && def.siteType === siege.siteType
      && !!def.region && regionSet.has(def.region);
  });
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
 * True when any character in the given company bears an item / attached
 * permanent-event carrying the `no-allies-in-company` play-flag — while such a
 * card is on a company member, no ally may be played to the company. Allies are
 * only ever played during the site phase, so this realizes "no allies in his
 * company outside the organization phase" without a phase gate. Used by Flame of
 * Udûn (ba-58).
 */
export function companyHasNoAllyRestriction(
  state: GameState,
  player: PlayerState,
  company: Company,
): boolean {
  for (const charId of company.characters) {
    const char = player.characters[charId];
    if (!char) continue;
    for (const item of char.items) {
      const def = defById(state, item.definitionId);
      if (def && hasPlayFlag(def as { effects?: readonly CardEffect[] }, 'no-allies-in-company')) return true;
    }
  }
  return false;
}

/**
 * True when any character in the given company bears a card carrying the
 * `bearer-cannot-move` play-flag — "Radagast may not move" (Shifter of Hues
 * wh-115).
 *
 * A company moves as a unit, so a character who may not move keeps their whole
 * company stationary for as long as they are in it; the player's escape hatch
 * is the ordinary organization-phase split, which re-forms the rest of the
 * characters into a company the immobile one is not part of. That makes this a
 * company-level movement gate derived from a character-level flag, checked
 * alongside the `company-cannot-move` constraint (Hide in Dark Places le-192)
 * at both movement-planning sites.
 */
export function companyHasImmobileCharacter(
  state: GameState,
  player: PlayerState,
  company: Company,
): boolean {
  for (const charId of company.characters) {
    const char = player.characters[charId];
    if (!char) continue;
    const charDef = defById(state, char.definitionId);
    if (charDef && hasPlayFlag(charDef as { effects?: readonly CardEffect[] }, 'bearer-cannot-move')) return true;
    for (const attached of char.items) {
      const def = defById(state, attached.definitionId);
      if (def && hasPlayFlag(def as { effects?: readonly CardEffect[] }, 'bearer-cannot-move')) return true;
    }
  }
  return false;
}

/**
 * An in-play `grant-ally-play` permission (Glove of Radagast wh-111) plus the
 * instance id of the character bearing it. Returned by
 * {@link findAllyPlayGrant}.
 */
export interface AllyPlayGrant {
  readonly effect: import('../types/effects.js').GrantAllyPlayEffect;
  /** The character bearing the granting permanent-event (Radagast). */
  readonly bearerId: CardInstanceId;
}

/**
 * Finds a `grant-ally-play` permission active for the given company: an attached
 * permanent-event (stored among a company member's `items`) whose definition
 * carries a `grant-ally-play` effect. Returns the effect and the bearer's
 * instance id, or `undefined` when the company has no such grant. Backs Glove of
 * Radagast (wh-111): "Any non-unique ally with 1 mind … is considered playable
 * with Radagast at his site."
 */
export function findAllyPlayGrant(
  state: GameState,
  player: PlayerState,
  company: Company,
): AllyPlayGrant | undefined {
  for (const charId of company.characters) {
    const char = player.characters[charId];
    if (!char) continue;
    for (const item of char.items) {
      const def = defById(state, item.definitionId);
      if (!def) continue;
      const eff = getCardEffects(def).find(
        (e): e is import('../types/effects.js').GrantAllyPlayEffect => e.type === 'grant-ally-play',
      );
      if (eff) return { effect: eff, bearerId: charId };
    }
  }
  return undefined;
}

/**
 * True when a `grant-ally-play` permission active for `company` extends
 * playability to the given ally definition: the ally matches the grant's
 * `filter` and — when `excludeBearerControlsCopy` is set — the bearer does not
 * already control a copy of it (same card name in the bearer's `allies`). Used
 * both to relax the site-match check for a hand ally and to source granted
 * allies from the discard pile (Glove of Radagast wh-111).
 */
export function allyPlayGrantAllowsAlly(
  state: GameState,
  player: PlayerState,
  company: Company,
  allyDef: CardDefinition,
): boolean {
  const grant = findAllyPlayGrant(state, player, company);
  if (!grant) return false;
  if (grant.effect.filter && !matchesCondition(grant.effect.filter, { target: allyDef as unknown as Record<string, unknown> })) {
    return false;
  }
  if (grant.effect.excludeBearerControlsCopy) {
    const bearer = player.characters[grant.bearerId];
    const allyName = (allyDef as { name?: string }).name;
    if (bearer && bearer.allies.some(a => defById(state, a.definitionId)?.name === allyName)) {
      return false;
    }
  }
  return true;
}

/**
 * A player-scoped, Wizardhaven-keyed `grant-ally-play` permission (An Untimely
 * Brood wh-62) plus the instance id of the granting permanent-event. Unlike the
 * bearer-scoped grant located by {@link findAllyPlayGrant}, this permission is a
 * free-standing permanent-event in the player's `cardsInPlay`.
 */
export interface WizardhavenAllyPlayGrant {
  readonly effect: import('../types/effects.js').GrantAllyPlayEffect;
  /** The permanent-event card instance carrying the grant (wh-62). */
  readonly sourceId: CardInstanceId;
}

/**
 * Finds a `grant-ally-play` permission with `atProtectedWizardhavens` among the
 * player's in-play permanent-events. Returns the effect and the granting card's
 * instance id, or `undefined` when the player has no such grant. Backs An
 * Untimely Brood (wh-62): "One non-unique ally with a mind of 1 is playable at
 * one of your … protected Wizardhavens each of your site phases."
 */
export function findWizardhavenAllyPlayGrant(
  state: GameState,
  player: PlayerState,
): WizardhavenAllyPlayGrant | undefined {
  for (const card of player.cardsInPlay) {
    const def = defById(state, card.definitionId);
    if (!def) continue;
    const eff = getCardEffects(def).find(
      (e): e is import('../types/effects.js').GrantAllyPlayEffect =>
        e.type === 'grant-ally-play' && e.atProtectedWizardhavens === true,
    );
    if (eff) return { effect: eff, sourceId: card.instanceId };
  }
  return undefined;
}

/**
 * True when a turn-scoped `granted-action-used` lock is active for the given
 * source card instance and action id — i.e. a once-per-turn / once-per-phase
 * ability has already been used this turn. The lock is added by the reducer on
 * first use and cleared at turn-end. Shared by the grant-action scanner
 * (Strangling Coils ba-76) and the Wizardhaven ally grant (An Untimely Brood
 * wh-62, action id `grant-ally-play`).
 */
export function grantedActionUsedThisTurn(
  state: GameState,
  sourceInstanceId: CardInstanceId,
  actionId: string,
): boolean {
  return state.activeConstraints.some(c =>
    c.kind.type === 'granted-action-used'
    && c.kind.sourceInstanceId === sourceInstanceId
    && c.kind.actionId === actionId,
  );
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

/**
 * Discards every follower character in a company, leaving the general-influence
 * members (and their allies) in place. A follower's own attached allies and
 * items go to the owner's discard; its hazards go to the opponent's discard.
 *
 * Backs Black Rider (le-170): "Discard this card and any other Ringwraith
 * followers in the company …" — evaluated at a following organization phase
 * when the mode card self-discards. Unlike {@link purgeCompanyAlliesAndFollowers}
 * (Fell Rider's on-play purge) this does NOT discard the non-follower members'
 * own allies, since Black Rider's text targets followers only.
 */
export function purgeCompanyFollowers(
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
  if (followerSet.size === 0) return state;

  // Discard each follower character entirely, together with its own attached
  // allies (→ owner), items (→ owner) and hazards (→ opponent).
  for (const id of followerSet) {
    const f = newChars[id];
    if (!f) continue;
    for (const ally of f.allies) discard.push(toCardInstance(ally));
    for (const item of f.items) discard.push(toCardInstance(item));
    for (const hz of f.hazards) oppDiscard.push(toCardInstance(hz));
    discard.push(toCardInstance(f));
    delete newChars[id];
  }

  // Remaining (non-follower) members drop any discarded follower from their
  // `followers` list but keep their own allies.
  for (const id of company.characters) {
    if (followerSet.has(id as string)) continue;
    const c = newChars[id as string];
    if (!c) continue;
    newChars[id as string] = {
      ...c,
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
 * Removes a played event card from the game entirely, routing it from
 * `cardsInPlay` to the owner's out-of-play pile instead of the discard pile.
 * Backs "Remove this card from the game." on fetch short-events such as
 * Longbottom Leaf (ba-30) — the no-card-disappears invariant is preserved
 * (the instance lands in `outOfPlayPile`, never dropped).
 */
export function removeEventCardFromGame(state: GameState, cardInstanceId: CardInstanceId, playerIndex: number): GameState {
  const player = state.players[playerIndex];
  const eventCard = findById(player.cardsInPlay, cardInstanceId);
  if (!eventCard) return state;
  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...newPlayers[playerIndex],
    cardsInPlay: removeById(player.cardsInPlay, cardInstanceId),
    outOfPlayPile: [...player.outOfPlayPile, toCardInstance(eventCard)],
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
      // Fetch short-events flagged `removeFromGame` (Longbottom Leaf ba-30) are
      // removed from the game even when the player passes / takes fewer than the
      // maximum number of cards.
      newState = current.effect.type === 'fetch-to-deck' && current.effect.removeFromGame
        ? removeEventCardFromGame(newState, current.cardInstanceId, ownerIndex)
        : discardEventCard(newState, current.cardInstanceId, ownerIndex);
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

  // Home-site-type restriction (Inner Cunning dm-68 mode 2): the fetched agent's
  // printed home site must be a site of one of the listed types.
  if (current.effect.homeSiteTypes && current.effect.homeSiteTypes.length > 0) {
    if (!agentHomeSiteMatchesTypes(state, def as { homesite?: string }, current.effect.homeSiteTypes)) {
      return { state, error: 'Card does not match fetch home-site-type restriction' };
    }
  }

  // Site-playability restriction (Strider ba-1: "playable at his current
  // site") — the qualifying site was captured when the fetch was enqueued.
  if (current.effect.playableAtSite !== undefined) {
    const requiredSite = defById(state, current.effect.playableAtSite);
    if (!isSiteCard(requiredSite) || !isCardPlayableAtSiteDef(def, requiredSite)) {
      return { state, error: `Card is not playable at ${requiredSite && 'name' in requiredSite ? requiredSite.name : 'the required site'}` };
    }
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
  // Reveal-to-opponent (Inner Cunning dm-68 mode 2): the fetched card's identity
  // becomes public as it is taken to hand.
  if (current.effect.type === 'fetch-to-deck' && current.effect.revealToOpponent) {
    logDetail(`Fetch: revealing ${def?.name ?? '?'} (${fetchedCard.instanceId as string}) to opponent`);
    newState = revealInstances(newState, [fetchedCard]);
  }
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
      // Longbottom Leaf (ba-30) and any fetch short-event flagged
      // `removeFromGame` route the spent card to the out-of-play pile instead
      // of the discard pile once the last pick resolves.
      newState = current.effect.type === 'fetch-to-deck' && current.effect.removeFromGame
        ? removeEventCardFromGame(newState, current.cardInstanceId, playerIndex)
        : discardEventCard(newState, current.cardInstanceId, playerIndex);
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
