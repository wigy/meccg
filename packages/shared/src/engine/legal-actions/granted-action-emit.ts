/**
 * @module granted-action-emit
 *
 * Constructing the `activate-granted-action` evaluated actions that the
 * grant-action emitters offer.
 *
 * Every card that grants an activated ability — an item the bearer taps, a
 * corruption card the bearer rolls to shed, a site's sage-and-scout action, a
 * bare permanent-event in play — ends up pushing the same seven-field action
 * object, differing only in which optional target field it carries. Written
 * out inline that is a twelve-line literal per emission, and there are around
 * thirty of them spread over six modules; this collapses each to a call.
 *
 * Field order does not matter: {@link canonicalActionKey} sorts keys and drops
 * `undefined` before hashing, so an action built here is indistinguishable from
 * the literal it replaces.
 */

import type { CardDefinitionId, CardInstanceId, PlayerId } from '../../types/common.js';
import type { ActivateGrantedAction } from '../../types/actions-organization.js';
import type { GrantActionEffect } from '../../types/effects.js';
import type { EvaluatedAction } from '../../rules/types.js';

/**
 * The card providing the ability. Both `CardInstance` and the in-play
 * item/ally/hazard records structurally satisfy this, so attachments can be
 * passed straight through.
 */
export interface GrantActionSource {
  readonly instanceId: CardInstanceId;
  readonly definitionId: CardDefinitionId;
}

/**
 * The optional fields an individual emitter adds on top of the common shape —
 * which target was chosen, which second character pays the cost, and so on.
 * Omitted keys are simply absent from the action.
 */
export type GrantedActionExtras = Partial<Pick<
  ActivateGrantedAction,
  'targetCardId' | 'targetCompanyId' | 'secondCharacterId'
  | 'secondTargetCardId' | 'recipientCharacterId' | 'noTap'
>>;

/**
 * Builds one viable `activate-granted-action`.
 *
 * `characterId` is the character who performs the action and pays the tap
 * cost. For a bearer-less source (a faction or permanent-event in play) it
 * self-references the source instance — the reducer routes those to
 * `handleInPlayCardGrantAction`.
 */
export function grantedAction(
  playerId: PlayerId,
  characterId: CardInstanceId,
  source: GrantActionSource,
  actionId: string,
  rollThreshold: number,
  extras?: GrantedActionExtras,
): EvaluatedAction {
  return {
    action: {
      type: 'activate-granted-action',
      player: playerId,
      characterId,
      sourceCardId: source.instanceId,
      sourceCardDefinitionId: source.definitionId,
      actionId,
      rollThreshold,
      ...extras,
    },
    viable: true,
  };
}

/**
 * The effective 2d6 threshold for a roll-based granted action: the effect's
 * own `rollThreshold` when it declares one, else the threshold of a
 * `roll-then-apply` apply, else 0 (no roll — the ability just happens).
 */
export function rollThresholdFor(effect: GrantActionEffect): number {
  if (effect.rollThreshold !== undefined) return effect.rollThreshold;
  if (effect.apply?.type === 'roll-then-apply' && typeof effect.apply.threshold === 'number') {
    return effect.apply.threshold;
  }
  return 0;
}

/**
 * {@link grantedAction} for the common case where both the action id and the
 * roll threshold come from the granting effect itself.
 */
export function grantedActionFor(
  playerId: PlayerId,
  characterId: CardInstanceId,
  source: GrantActionSource,
  effect: GrantActionEffect,
  extras?: GrantedActionExtras,
): EvaluatedAction {
  return grantedAction(playerId, characterId, source, effect.action, rollThresholdFor(effect), extras);
}
