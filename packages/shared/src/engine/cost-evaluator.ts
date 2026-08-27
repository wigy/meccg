/**
 * @module cost-evaluator
 *
 * Pure helpers for checking and applying {@link ActionCost} payments.
 * Centralizes cost-legality and cost-payment logic that was previously
 * duplicated across grant-action, play-target, cancel-attack, and
 * cancel-influence handlers.
 *
 * Two entry points:
 *  - {@link canPayCost} — predicate for legal-action computers; takes
 *    the resolved entity objects directly (no state lookup needed).
 *  - {@link applyCost} — state reducer; applies the cost payment and
 *    returns the updated {@link GameState}.
 */

import type { GameState, CardInstanceId, CharacterInPlay } from '../index.js';
import { CardStatus } from '../types/common.js';
import type { ActionCost } from '../types/effects.js';
import type { CardDefinitionId, CompanyId } from '../types/common.js';
import { logDetail } from './legal-actions/log.js';
import { updatePlayer, removeById, updateAttachment, cardName } from './reducer-utils.js';
import { enqueueCorruptionCheck } from './pending.js';

// ---- Public API ----

/**
 * Context for {@link applyCost}. Carries the varying fields that differ
 * across call sites (player index, source card, company scope, etc.).
 */
export interface CostContext {
  /** Player index of the character paying the cost. */
  readonly playerIndex: number;
  /**
   * The source card instance ID. Required for `tap: "self"` on an
   * attachment (where source ≠ actor) and for `discard: "self"`.
   * When the source IS the actor character (grant-action on a character
   * card), this equals `actorId`.
   */
  readonly sourceCardId?: CardInstanceId;
  /**
   * Source card definition ID. Required alongside `sourceCardId` for
   * `discard: "self"` so the discarded {@link CardInstance} can be built.
   */
  readonly sourceCardDefId?: CardDefinitionId;
  /** Company ID required for `check: "corruption"` enqueue. */
  readonly companyId?: CompanyId;
  /**
   * Scope kind for the corruption check. Defaults to
   * `"company-site-subphase"` when omitted.
   */
  readonly checkScopeKind?: 'company-mh-subphase' | 'company-site-subphase';
  /**
   * When true, a tap cost is skipped (METD §7 / rule 10.08 no-tap variant
   * for corruption-removal grant actions). The cost is otherwise paid
   * normally; the -3 roll penalty is handled by the apply branch.
   */
  readonly noTap?: boolean;
  /** Human-readable label for log messages (e.g. card name or action ID). */
  readonly label?: string;
  /**
   * For `discard: "named-stored-card"` on an ordinary (non-`fromStored`)
   * grant-action — the chosen stored card's instance ID, carried by the
   * activation's `targetCardId`. Required whenever the cost declares this
   * discard kind; the `fromStored` variant (Andúril tw-192) instead resolves
   * its discard candidate through `handleStoredCardGrantAction`, bypassing
   * `applyCost` entirely, so this field is unused there.
   */
  readonly discardTargetId?: CardInstanceId;
}

/** Result of {@link applyCost}: updated state or an error message. */
export type CostResult = { readonly state: GameState } | { readonly error: string };

/**
 * Returns true if the cost can currently be paid.
 *
 * - tap "bearer" | "character" | "sage-in-company" | "self" (as character):
 *   `actor` must be untapped.
 * - tap "self" on attachment: pass the item/ally/hazard as `source`;
 *   `source` must be untapped.
 * - discard | check | wound: always payable (payment happens at apply time).
 */
export function canPayCost(
  cost: ActionCost,
  actor: { readonly status: CardStatus },
  source?: { readonly status: CardStatus },
): boolean {
  if (!cost.tap) return true;
  if (cost.tap === 'self' && source) return source.status === CardStatus.Untapped;
  return actor.status === CardStatus.Untapped;
}

/**
 * Apply cost to state and return the updated state.
 *
 * Cost components are independent and, when a card declares more than one
 * (e.g. Healing Herbs tw-255's "tap and discard this item"), all of them are
 * paid in sequence rather than the first one short-circuiting the rest:
 *
 * - tap: taps the actor character, or the attached source card if
 *   `tap === "self"` and `context.sourceCardId !== actorId`.
 * - discard: detaches the source from the bearer and moves it to the
 *   correct discard pile (own pile for items/allies, opponent's for hazards).
 * - check: enqueues a corruption check pending resolution (requires
 *   `context.companyId`).
 * - wound: sets the actor's status to `CardStatus.Inverted`.
 */
export function applyCost(
  state: GameState,
  cost: ActionCost,
  actorId: CardInstanceId,
  context: CostContext,
): CostResult {
  const { sourceCardId, sourceCardDefId, noTap, label = '?' } = context;
  let currentState = state;

  if (cost.tap) {
    const tapResult = applyTapCost(currentState, cost, actorId, context, noTap, label);
    if ('error' in tapResult) return tapResult;
    currentState = tapResult.state;
  }

  if (cost.discard === 'self') {
    if (!sourceCardId || !sourceCardDefId) {
      return { error: `applyCost: discard-self requires sourceCardId and sourceCardDefId in context` };
    }
    const player = currentState.players[context.playerIndex];
    if (!player) return { error: `applyCost: no player at index ${context.playerIndex}` };
    const actor = player.characters[actorId];
    if (!actor) return { error: `applyCost: actor ${actorId as string} not found` };
    const discardResult = applyDiscardSelf(currentState, actor, actorId, sourceCardId, sourceCardDefId, context.playerIndex, label);
    if ('error' in discardResult) return discardResult;
    currentState = discardResult.state;
  } else if (cost.discard === 'named-card') {
    if (!cost.discardCardName) {
      return { error: `applyCost: discard named-card requires discardCardName` };
    }
    const player = currentState.players[context.playerIndex];
    if (!player) return { error: `applyCost: no player at index ${context.playerIndex}` };
    const handIdx = player.hand.findIndex(c => cardName(currentState, c.definitionId, '') === cost.discardCardName);
    if (handIdx < 0) {
      return { error: `applyCost: no "${cost.discardCardName}" in hand to discard` };
    }
    const discarded = player.hand[handIdx];
    currentState = updatePlayer(currentState, context.playerIndex, p => ({
      ...p,
      hand: p.hand.filter((_, i) => i !== handIdx),
      discardPile: [...p.discardPile, discarded],
    }));
    logDetail(`Cost (${label}): discarded "${cost.discardCardName}" from hand`);
  } else if (cost.discard === 'named-stored-card') {
    if (!cost.discardCardName) {
      return { error: `applyCost: discard named-stored-card requires discardCardName` };
    }
    const targetId = context.discardTargetId;
    if (!targetId) {
      return { error: `applyCost: discard named-stored-card requires a chosen stored card` };
    }
    const player = currentState.players[context.playerIndex];
    if (!player) return { error: `applyCost: no player at index ${context.playerIndex}` };
    const stored = player.killPile.find(c => c.instanceId === targetId && c.storedAtSite);
    if (!stored) {
      return { error: `applyCost: no stored "${cost.discardCardName}" (${targetId as string}) found in the marshalling-point pile` };
    }
    currentState = updatePlayer(currentState, context.playerIndex, p => ({
      ...p,
      killPile: removeById(p.killPile, targetId),
      discardPile: [...p.discardPile, { instanceId: stored.instanceId, definitionId: stored.definitionId }],
    }));
    logDetail(`Cost (${label}): discarded stored "${cost.discardCardName}" from the marshalling-point pile`);
  }

  if (cost.check === 'corruption') {
    const { companyId, checkScopeKind = 'company-site-subphase', playerIndex } = context;
    const player = currentState.players[playerIndex];
    if (!player) return { error: `applyCost: no player at index ${playerIndex}` };
    if (!companyId) return { error: `applyCost: check-corruption requires companyId in context` };
    const modifier = cost.modifier ?? 0;
    const scope = { kind: checkScopeKind, companyId };
    logDetail(`Cost (${label}): enqueuing corruption check (modifier ${modifier})`);
    currentState = enqueueCorruptionCheck(currentState, {
      source: sourceCardId ?? actorId,
      actor: player.id,
      scope,
      characterId: actorId,
      modifier,
      reason: label,
    });
  }

  if (cost.wound) {
    const player = currentState.players[context.playerIndex];
    if (!player) return { error: `applyCost: no player at index ${context.playerIndex}` };
    const actor = player.characters[actorId];
    if (!actor) return { error: `applyCost: actor ${actorId as string} not found` };
    currentState = updatePlayer(currentState, context.playerIndex, p => ({
      ...p,
      characters: { ...p.characters, [actorId as string]: { ...actor, status: CardStatus.Inverted } },
    }));
    logDetail(`Cost (${label}): wounded ${actorId as string}`);
  }

  return { state: currentState };
}

/**
 * Pay the `tap` component of an {@link ActionCost} in isolation. Split out
 * of {@link applyCost} so tap-and-discard combinations (e.g. Healing Herbs
 * tw-255: "tap and discard this item") can pay the tap first and then fall
 * through to the discard branch instead of the tap branch short-circuiting.
 */
function applyTapCost(
  state: GameState,
  cost: ActionCost,
  actorId: CardInstanceId,
  context: CostContext,
  noTap: boolean | undefined,
  label: string,
): CostResult {
  const { playerIndex, sourceCardId } = context;
  const player = state.players[playerIndex];
  if (!player) return { error: `applyCost: no player at index ${playerIndex}` };

  if (noTap) {
    logDetail(`Cost (${label}): tap skipped (no-tap variant)`);
    return { state };
  }
  const actor = player.characters[actorId];

  if (cost.tap === 'self' && sourceCardId && sourceCardId !== actorId) {
    if (!actor) return { error: `applyCost: actor ${actorId as string} not found` };
    // Tap the attachment in place (item / ally / hazard).
    const updated = tapAttachment(actor, sourceCardId);
    if (!updated) {
      return { error: `applyCost: source ${sourceCardId as string} not found on actor ${actorId as string}` };
    }
    const newState = updatePlayer(state, playerIndex, p => ({
      ...p,
      characters: { ...p.characters, [actorId as string]: updated },
    }));
    logDetail(`Cost (${label}): tapped attachment ${sourceCardId as string}`);
    return { state: newState };
  }

  if (actor) {
    // Tap the actor character itself.
    const newState = updatePlayer(state, playerIndex, p => ({
      ...p,
      characters: { ...p.characters, [actorId as string]: { ...actor, status: CardStatus.Tapped } },
    }));
    logDetail(`Cost (${label}): tapped ${actorId as string}`);
    return { state: newState };
  }

  // The actor id is not a top-level character: a "skill only" card (e.g.
  // Marvels Told) may tap a sage ally borne by one of the player's
  // characters. Per CoE rule 2.V.2.2 the ally counts as a character for
  // fulfilling that skill condition, so tap the ally in place.
  const allyUpdate = updateAttachment(player, 'allies', actorId, a => ({ ...a, status: CardStatus.Tapped }));
  if (allyUpdate) {
    const newState = updatePlayer(state, playerIndex, () => allyUpdate.player);
    logDetail(`Cost (${label}): tapped ally ${actorId as string}`);
    return { state: newState };
  }
  return { error: `applyCost: actor ${actorId as string} not found` };
}

// ---- Private helpers ----

/**
 * Return a copy of `char` with the attachment identified by `sourceId`
 * set to {@link CardStatus.Tapped}. Returns null if not found.
 */
function tapAttachment(
  char: CharacterInPlay,
  sourceId: CardInstanceId,
): CharacterInPlay | null {
  const tapOne = <T extends { readonly instanceId: CardInstanceId; readonly status: CardStatus }>(
    arr: readonly T[],
  ): readonly T[] | null => {
    const idx = arr.findIndex(a => a.instanceId === sourceId);
    if (idx < 0) return null;
    return arr.map((a, i) => i === idx ? { ...a, status: CardStatus.Tapped } : a);
  };

  const items = tapOne(char.items);
  if (items) return { ...char, items };
  const allies = tapOne(char.allies);
  if (allies) return { ...char, allies };
  const hazards = tapOne(char.hazards);
  if (hazards) return { ...char, hazards };
  return null;
}

/**
 * Detach `sourceCardId` from `actor`'s attachment lists and push it
 * into the appropriate discard pile (own pile for items/allies,
 * opponent's pile for hazards). Returns updated state or an error.
 */
function applyDiscardSelf(
  state: GameState,
  actor: CharacterInPlay,
  actorId: CardInstanceId,
  sourceCardId: CardInstanceId,
  sourceCardDefId: CardDefinitionId,
  playerIndex: number,
  label: string,
): CostResult {
  const discardedCard = { instanceId: sourceCardId, definitionId: sourceCardDefId };

  let updatedActor: CharacterInPlay | null = null;
  let discardOwnerIndex = playerIndex;

  if (actor.items.some(i => i.instanceId === sourceCardId)) {
    updatedActor = { ...actor, items: removeById(actor.items, sourceCardId) };
  } else if (actor.allies.some(a => a.instanceId === sourceCardId)) {
    updatedActor = { ...actor, allies: removeById(actor.allies, sourceCardId) };
  } else if (actor.hazards.some(h => h.instanceId === sourceCardId)) {
    updatedActor = { ...actor, hazards: removeById(actor.hazards, sourceCardId) };
    discardOwnerIndex = 1 - playerIndex; // hazards return to the hazard player's discard
  }

  if (!updatedActor) {
    // A stored card (marshalling-point pile, `killPile`) has no bearer to
    // detach it from — a `fromStored` grant-action (Reforging tw-314) taps a
    // separately-chosen actor (e.g. a sage at a Haven) while discarding the
    // stored source itself. Fall back to removing it from `killPile`.
    const player = state.players[playerIndex];
    if (player?.killPile.some(c => c.instanceId === sourceCardId && c.storedAtSite)) {
      const newState = updatePlayer(state, playerIndex, p => ({
        ...p,
        killPile: removeById(p.killPile, sourceCardId),
        discardPile: [...p.discardPile, discardedCard],
      }));
      logDetail(`Cost (${label}): discarded stored card ${sourceCardId as string} from the marshalling-point pile`);
      return { state: newState };
    }
    return { error: `applyCost: source ${sourceCardId as string} not found on actor ${actorId as string}` };
  }

  let newState = updatePlayer(state, playerIndex, p => ({
    ...p,
    characters: { ...p.characters, [actorId as string]: updatedActor },
  }));
  newState = updatePlayer(newState, discardOwnerIndex, p => ({
    ...p,
    discardPile: [...p.discardPile, discardedCard],
  }));

  logDetail(`Cost (${label}): discarded ${sourceCardId as string} from ${actorId as string}`);
  return { state: newState };
}
