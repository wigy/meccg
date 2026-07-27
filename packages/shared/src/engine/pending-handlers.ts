/**
 * @module pending-handlers
 *
 * Single source of truth pairing each {@link PendingResolution} kind with its
 * two halves: the legal-action computer (what the actor may do while this
 * resolution is at the head of their queue) and the reducer (how an action
 * resolves it). Previously these halves lived ~700 lines apart in two files —
 * the `switch (top.kind.type)` in `legal-actions/pending.ts` and the matching
 * `switch` in `pending-reducers.ts` — and had to be kept in lock-step by hand,
 * so adding or removing a kind in one without the other silently drifted.
 *
 * {@link PENDING_HANDLERS} is a mapped type over the closed
 * `PendingResolution['kind']['type']` union, so the compiler now *requires*
 * every kind to declare both halves in one place: omit a kind and the registry
 * literal fails to type-check. The two dispatchers below are reduced to a
 * single registry lookup each.
 *
 * The per-kind functions themselves still live in their original modules
 * (`legal-actions/pending.ts` for the action side, `pending-reducers.ts` for
 * the apply side); this module only imports and pairs them, which keeps the
 * dependency edges one-directional (this module depends on both; neither
 * depends back on it) and avoids reintroducing an import cycle.
 */

import type { GameState, GameAction, PlayerId, EvaluatedAction, PendingResolution } from '../index.js';
import type { ReducerResult } from './reducer-utils.js';
import {
  applyCorruptionCheckResolution,
  applyOrderEffectsResolution,
  applyOnGuardWindowResolution,
  applyOpponentInfluenceDefendResolution,
  applyFactionInfluenceRollResolution,
  applyDiceCheckResolution,
  applyFlateryAttemptResolution,
  applySeizedByTerrorRollResolution,
  applyCompanyTapRollResolution,
  applyOpposedRollResolution,
  applyGoldRingTestResolution,
  applyRingPlayOfferResolution,
  applyWizardSearchOnStoreResolution,
  applySelectCardBearerResolution,
  applyDiscardOneCompanyItemResolution,
  applyDiscardSubstituteOfferResolution,
  applyForceDiscardCardResolution,
  applyHazardEventMaintenanceResolution,
  applyTapOneCharacterResolution,
  applyHavenRestoreCharacterResolution,
  applyLeftBehindRejoinResolution,
  applyArrangeDeckTopResolution,
  applyRevealChooseToHandResolution,
  applyRevealRemoveFromDiscardResolution,
  applyDesireBellyChooseCardResolution,
  applyDesireBellyChoosePenaltyResolution,
  applyAgentPlayManifestationResolution,
  applyStayHerAppetiteRollResolution,
  applyTransferReturnedItemResolution,
  applyGreatHuntSourceResolution,
  applyGreatHuntDiscardAttackResolution,
  applyPostAttackPlayOfferResolution,
} from './pending-reducers.js';
import {
  corruptionCheckActions,
  onGuardWindowActions,
  opponentInfluenceDefendActions,
  factionInfluenceRollActions,
  diceCheckActions,
  flateryAttemptRollActions,
  seizedByTerrorRollActions,
  companyTapRollActions,
  opposedRollActions,
  goldRingTestActions,
  ringPlayOfferActions,
  wizardSearchOnStoreActions,
  selectCardBearerActions,
  discardOneCompanyItemActions,
  discardSubstituteOfferActions,
  forceDiscardCardActions,
  hazardEventMaintenanceActions,
  tapOneCharacterActions,
  havenRestoreCharacterActions,
  leftBehindRejoinActions,
  arrangeDeckTopActions,
  revealChooseToHandActions,
  revealRemoveFromDiscardActions,
  desireBellyChooseCardActions,
  desireBellyChoosePenaltyActions,
  agentPlayManifestationActions,
  stayHerAppetiteRollActions,
  transferReturnedItemActions,
  greatHuntSourceActions,
  greatHuntDiscardAttackActions,
  postAttackPlayOfferActions,
} from './legal-actions/pending.js';

/** The discriminant of every {@link PendingResolution} kind. */
type PendingKindType = PendingResolution['kind']['type'];

/**
 * The two halves of one pending-resolution kind.
 *
 * - `legalActions` — invoked when a resolution of this kind sits at the head
 *   of `actor`'s queue, to compute what they may do. Returns `[]` for kinds
 *   resolved purely by the engine with no player choice.
 * - `apply` — invoked from the reducer *before* the per-phase reducer to
 *   resolve `action` against `top`; returns `null` to defer to normal phase
 *   handling.
 */
export interface PendingHandler {
  readonly legalActions: (state: GameState, actor: PlayerId, top: PendingResolution) => EvaluatedAction[];
  readonly apply: (state: GameState, action: GameAction, top: PendingResolution) => ReducerResult | null;
}

/** Legal-action computer for kinds the engine resolves with no player choice. */
const noActions = (): EvaluatedAction[] => [];

/**
 * The registry pairing each pending-resolution kind with its legal-action and
 * apply halves. The mapped type over {@link PendingKindType} makes the literal
 * exhaustive: every kind must appear exactly once, with both halves.
 */
export const PENDING_HANDLERS: { readonly [K in PendingKindType]: PendingHandler } = {
  'corruption-check': { legalActions: corruptionCheckActions, apply: applyCorruptionCheckResolution },
  'order-effects': { legalActions: noActions, apply: applyOrderEffectsResolution },
  'on-guard-window': { legalActions: onGuardWindowActions, apply: applyOnGuardWindowResolution },
  'opponent-influence-defend': { legalActions: opponentInfluenceDefendActions, apply: applyOpponentInfluenceDefendResolution },
  'faction-influence-roll': { legalActions: factionInfluenceRollActions, apply: applyFactionInfluenceRollResolution },
  'dice-check': { legalActions: diceCheckActions, apply: applyDiceCheckResolution },
  'flattery-attempt': { legalActions: flateryAttemptRollActions, apply: applyFlateryAttemptResolution },
  'seized-by-terror-roll': { legalActions: seizedByTerrorRollActions, apply: applySeizedByTerrorRollResolution },
  'company-tap-roll': { legalActions: companyTapRollActions, apply: applyCompanyTapRollResolution },
  'opposed-roll': { legalActions: opposedRollActions, apply: applyOpposedRollResolution },
  'gold-ring-test': { legalActions: goldRingTestActions, apply: applyGoldRingTestResolution },
  'ring-play-offer': { legalActions: ringPlayOfferActions, apply: applyRingPlayOfferResolution },
  'wizard-search-on-store': { legalActions: wizardSearchOnStoreActions, apply: applyWizardSearchOnStoreResolution },
  'select-card-bearer': { legalActions: selectCardBearerActions, apply: applySelectCardBearerResolution },
  'discard-one-company-item': { legalActions: discardOneCompanyItemActions, apply: applyDiscardOneCompanyItemResolution },
  'discard-substitute-offer': { legalActions: discardSubstituteOfferActions, apply: applyDiscardSubstituteOfferResolution },
  'force-discard-card': { legalActions: forceDiscardCardActions, apply: applyForceDiscardCardResolution },
  'hazard-event-maintenance': { legalActions: hazardEventMaintenanceActions, apply: applyHazardEventMaintenanceResolution },
  'tap-one-character': { legalActions: tapOneCharacterActions, apply: applyTapOneCharacterResolution },
  'haven-restore-character': { legalActions: havenRestoreCharacterActions, apply: applyHavenRestoreCharacterResolution },
  'left-behind-rejoin': { legalActions: leftBehindRejoinActions, apply: applyLeftBehindRejoinResolution },
  'arrange-deck-top': { legalActions: arrangeDeckTopActions, apply: applyArrangeDeckTopResolution },
  'reveal-choose-to-hand': { legalActions: revealChooseToHandActions, apply: applyRevealChooseToHandResolution },
  'reveal-remove-from-discard': { legalActions: revealRemoveFromDiscardActions, apply: applyRevealRemoveFromDiscardResolution },
  'desire-belly-choose-card': { legalActions: desireBellyChooseCardActions, apply: applyDesireBellyChooseCardResolution },
  'desire-belly-choose-penalty': { legalActions: desireBellyChoosePenaltyActions, apply: applyDesireBellyChoosePenaltyResolution },
  'agent-play-manifestation-offer': { legalActions: agentPlayManifestationActions, apply: applyAgentPlayManifestationResolution },
  'stay-her-appetite-roll': { legalActions: stayHerAppetiteRollActions, apply: applyStayHerAppetiteRollResolution },
  'transfer-returned-item': { legalActions: transferReturnedItemActions, apply: applyTransferReturnedItemResolution },
  'great-hunt-source': { legalActions: greatHuntSourceActions, apply: applyGreatHuntSourceResolution },
  'great-hunt-discard-attack': { legalActions: greatHuntDiscardAttackActions, apply: applyGreatHuntDiscardAttackResolution },
  'post-attack-play-offer': { legalActions: postAttackPlayOfferActions, apply: applyPostAttackPlayOfferResolution },
};

/**
 * Resolve `action` against the head-of-queue resolution `top` by dispatching
 * to its kind's apply half. Runs *before* the per-phase reducer; returns
 * `null` to defer to normal phase handling.
 */
export function applyResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  return PENDING_HANDLERS[top.kind.type].apply(state, action, top);
}

/**
 * Compute the legal actions available to `actor` while the resolution `top`
 * sits at the head of their queue, by dispatching to its kind's legal half.
 */
export function resolutionLegalActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  return PENDING_HANDLERS[top.kind.type].legalActions(state, actor, top);
}
