/**
 * @module actions
 *
 * Game action types representing every possible player input in MECCG.
 *
 * The game engine is a pure reducer: `(GameState, GameAction) -> GameState`.
 * Each action type corresponds to a specific player decision at a specific
 * point in the game. The server validates that incoming actions are legal
 * for the current phase and game state before applying them.
 *
 * Actions are grouped by the phase in which they are primarily used,
 * plus a set of universal actions available across multiple phases.
 * Each group lives in its own module; this file re-exports everything
 * and defines the top-level {@link GameAction} discriminated union.
 */

// ---- Setup phase actions ----
export type {
  DraftPickAction,
  DraftStopAction,
  AssignStartingItemAction,
  PlaceStartingCompanyEventAction,
  AddCharacterToDeckAction,
  ShufflePlayDeckAction,
  SelectStartingSiteAction,
  SelectStageResourceSiteAction,
  PlaceCharacterAction,
  RollInitiativeAction,
} from './actions-setup.js';

// ---- Organization phase actions (includes Untap) ----
export type {
  UntapAction,
  PlayCharacterAction,
  ReanimateFromDiscardAction,
  SplitCompanyAction,
  MoveToCompanyAction,
  MergeCompaniesAction,
  TransferItemAction,
  StoreItemAction,
  GoldRingTestRollAction,
  PlayRingAfterTestAction,
  PlanMovementAction,
  CancelMovementAction,
  MoveToInfluenceAction,
  PlayPermanentEventAction,
  PairResourceWithCofAction,
  ActivateGrantedAction,
  ManifestationSwapAction,
  DiscardToRecruitAction,
  TestRingAtSiteAction,
  PlayWizardFromSearchAction,
  SkipWizardSearchAction,
  SelectCardBearerAction,
  DiscardCharacterOrgAction,
} from './actions-organization.js';

// ---- Short-event actions ----
export type {
  PlayShortEventAction,
  FetchFromPileAction,
  ReshuffleCardFromHandAction,
} from './actions-short-event.js';

// ---- Long-event actions ----
export type {
  PlayLongEventAction,
} from './actions-long-event.js';

// ---- Movement/Hazard and combat actions ----
export type {
  CreatureKeyingMatch,
  SelectCompanyAction,
  DeclarePathAction,
  OrderEffectsAction,
  PlayHazardAction,
  SideboardWithNazgulAction,
  TapAltPermanentEventAction,
  PlayAgentManifestationAction,
  AssignStrikeAction,
  AllocateCvccExcessAction,
  ResolveStrikeAction,
  SupportStrikeAction,
  ChooseStrikeOrderAction,
  BodyCheckRollAction,
  CancelAttackAction,
  ConvertCreatureToAllyAction,
  CancelByTapAction,
  CancelStrikeAction,
  FleeFromStrikeAction,
  ProtectFromStrikeAssignmentAction,
  HalveStrikesAction,
  TapAllyCombatBoostAction,
  TapAllyBodyCheckBoostAction,
  ModifyAttackAction,
  TapItemForStrikeAction,
  SalvageItemAction,
  ShieldDiscardRollAction,
  DiscardItemFromCompanyAction,
  ForceDiscardCardAction,
  PlayStrikeEventAction,
  ResolveDiceCheckAction,
  SeizedByTerrorRollAction,
  CompanyTapRollAction,
  HavenJoinAttackAction,
  CancelReturnToOriginAction,
  CancelHazardEventAction,
  PlayCounterCancelRollAction,
  CounterCancelAttackAction,
  TapAllyDiscardHazardAction,
  PlayAgentHazardAction,
  RevealAgentAction,
  AgentMoveAction,
  AgentMoveBackAction,
  AgentReturnHomeAction,
  AgentHealAction,
  AgentUntapAction,
  AgentTurnFaceDownAction,
  AgentKeyCreaturesAction,
  AgentInfluenceAttemptAction,
  AgentTapAttackAction,
  AgentDiscardReturnToOriginAction,
  UnderDeepsRollAction,
} from './actions-movement-hazard.js';

// ---- Site phase actions ----
export type {
  EnterSiteAction,
  PlaceOnGuardAction,
  RevealOnGuardAction,
  CancelAutoAttackAction,
  PlaySiteAutoAttackAction,
  RescuePrisonerAction,
  DeclareAgentAttackAction,
  PlayHeroResourceAction,
  InfluenceAttemptAction,
  OpponentInfluenceAttemptAction,
  OpponentInfluenceDefendAction,
  CancelInfluenceAction,
  FactionInfluenceRollAction,
  PlayMinorItemAction,
  DeclareCompanyAttackAction,
  PaySiteTaxAction,
} from './actions-site.js';

// ---- Universal / cross-phase actions ----
export type {
  SupportCorruptionCheckAction,
  CorruptionCheckAction,
  DrawCardsAction,
  DiscardCardAction,
  PassAction,
  CallFreeCouncilAction,
  DeckExhaustAction,
  ExchangeSideboardAction,
  StartSideboardToDeckAction,
  StartSideboardToDiscardAction,
  FetchFromSideboardAction,
  CardSideboardToDeckAction,
  StartHazardSideboardToDeckAction,
  StartHazardSideboardToDiscardAction,
  FetchHazardFromSideboardAction,
  NotPlayableAction,
  PassChainPriorityAction,
  OrderPassivesAction,
  FinishedAction,
  HavenReturnAction,
  RunHomeAction,
  PayHazardEventMaintenanceAction,
  TapCharacterByEffectAction,
  RestoreCharacterByEffectAction,
  ArrangeDeckTopCardAction,
  ChooseRevealedCardAction,
  RemoveRevealedCardAction,
  DesireChooseShownCardAction,
  DesireChoosePenaltyAction,
  ChooseGreatHuntSourceAction,
  GreatHuntAttackWithCreatureAction,
} from './actions-universal.js';

// ---- Import concrete types for the union ----
import type { DraftPickAction, DraftStopAction, AssignStartingItemAction, PlaceStartingCompanyEventAction, AddCharacterToDeckAction, ShufflePlayDeckAction, SelectStartingSiteAction, SelectStageResourceSiteAction, PlaceCharacterAction, RollInitiativeAction } from './actions-setup.js';
import type { UntapAction, PlayCharacterAction, ReanimateFromDiscardAction, SplitCompanyAction, MoveToCompanyAction, MergeCompaniesAction, TransferItemAction, StoreItemAction, GoldRingTestRollAction, PlayRingAfterTestAction, PlanMovementAction, CancelMovementAction, MoveToInfluenceAction, PlayPermanentEventAction, PairResourceWithCofAction, ActivateGrantedAction, ManifestationSwapAction, DiscardToRecruitAction, TestRingAtSiteAction, PlayWizardFromSearchAction, SkipWizardSearchAction, SelectCardBearerAction, DiscardCharacterOrgAction, DiscardStageResourceAction, VoluntaryDiscardInPlayAction, ReturnAttachedToHandAction, ActivateOrgFetchAction, DiscardForEvilHourMovementAction, PayMovementTaxAction } from './actions-organization.js';
import type { PlayShortEventAction, FetchFromPileAction, ReshuffleCardFromHandAction } from './actions-short-event.js';
import type { PlayLongEventAction } from './actions-long-event.js';
import type { SelectCompanyAction, DeclarePathAction, OrderEffectsAction, PlayHazardAction, SideboardWithNazgulAction, TapAltPermanentEventAction, PlayAgentManifestationAction, AssignStrikeAction, AllocateCvccExcessAction, ResolveStrikeAction, AgentStrikeRollAction, SupportStrikeAction, ChooseStrikeOrderAction, BodyCheckRollAction, CancelAttackAction, ConvertCreatureToAllyAction, CancelByTapAction, CancelStrikeAction, FleeFromStrikeAction, ProtectFromStrikeAssignmentAction, HalveStrikesAction, TapAllyCombatBoostAction, TapAllyBodyCheckBoostAction, ModifyAttackAction, ApplyAttackerAttackOptionAction, TapItemForStrikeAction, FaceStrikeOnTapAction, CancelWeaponEffectsAction, SalvageItemAction, ShieldDiscardRollAction, DiscardItemFromCompanyAction, PlayStrikeEventAction, ResolveDiceCheckAction, SeizedByTerrorRollAction, CompanyTapRollAction, HavenJoinAttackAction, CancelReturnToOriginAction, CancelHazardEventAction, PlayCounterCancelRollAction, CounterCancelAttackAction, TapAllyDiscardHazardAction, PlayAgentHazardAction, RevealAgentAction, AgentMoveAction, AgentMoveBackAction, AgentReturnHomeAction, AgentHealAction, AgentUntapAction, AgentTurnFaceDownAction, AgentKeyCreaturesAction, AgentInfluenceAttemptAction, AgentTapAttackAction, AgentDiscardReturnToOriginAction, UnderDeepsRollAction, GangwaysExtraMoveAction, ExtraMHMoveAction, FlateryAttemptRollAction, TapHazardCardForLimitAction, PayHazardLimitToUntapCardAction, DiscardCardForHazardLimitAction, TakeTrophyAction, ReserveCreatureAction, PlayReservedCreatureAction, PlayCreatureFromDiscardAction, SpawnReplayCreatureAction, StayHerAppetiteRollAction, ForceDiscardCardAction, TransferReturnedItemAction } from './actions-movement-hazard.js';
import type { EnterSiteAction, PlaceOnGuardAction, RevealOnGuardAction, CancelAutoAttackAction, PlaySiteAutoAttackAction, RescuePrisonerAction, DeclareAgentAttackAction, PlayHeroResourceAction, InfluenceAttemptAction, OpponentInfluenceAttemptAction, OpponentInfluenceDefendAction, CancelInfluenceAction, FactionInfluenceRollAction, PlayMinorItemAction, SelectForewarnedAttackAction, DeclareCompanyAttackAction, PaySiteTaxAction } from './actions-site.js';
import type { SupportCorruptionCheckAction, CorruptionCheckAction, DrawCardsAction, DiscardCardAction, PassAction, CallFreeCouncilAction, DeckExhaustAction, ExchangeSideboardAction, StartSideboardToDeckAction, StartSideboardToDiscardAction, FetchFromSideboardAction, CardSideboardToDeckAction, StartHazardSideboardToDeckAction, StartHazardSideboardToDiscardAction, FetchHazardFromSideboardAction, NotPlayableAction, PassChainPriorityAction, OrderPassivesAction, FinishedAction, HavenReturnAction, RunHomeAction, PayHazardEventMaintenanceAction, TapCharacterByEffectAction, RestoreCharacterByEffectAction, LeftBehindRejoinAction, ArrangeDeckTopCardAction, ChooseRevealedCardAction, RemoveRevealedCardAction, DesireChooseShownCardAction, DesireChoosePenaltyAction, ChooseGreatHuntSourceAction, GreatHuntAttackWithCreatureAction } from './actions-universal.js';

// ---- Discriminated union ----

/**
 * The top-level union of all possible game actions.
 *
 * Discriminated by the `type` field. The game engine's reducer accepts
 * a `GameAction` and produces a new `GameState`. Actions are validated
 * upstream by membership lookup against the legal-action set the server
 * last sent to the player; the reducer trusts its input.
 */
export type GameAction =
  | DraftPickAction
  | DraftStopAction
  | AssignStartingItemAction
  | PlaceStartingCompanyEventAction
  | AddCharacterToDeckAction
  | ShufflePlayDeckAction
  | SelectStartingSiteAction
  | SelectStageResourceSiteAction
  | PlaceCharacterAction
  | RollInitiativeAction
  | UntapAction
  | PlayCharacterAction
  | ReanimateFromDiscardAction
  | SplitCompanyAction
  | MoveToCompanyAction
  | MergeCompaniesAction
  | TransferItemAction
  | StoreItemAction
  | GoldRingTestRollAction
  | PlayRingAfterTestAction
  | MoveToInfluenceAction
  | PlanMovementAction
  | CancelMovementAction
  | PlayPermanentEventAction
  | PairResourceWithCofAction
  | ActivateGrantedAction
  | ManifestationSwapAction
  | DiscardToRecruitAction
  | TestRingAtSiteAction
  | PlayWizardFromSearchAction
  | SkipWizardSearchAction
  | SelectCardBearerAction
  | DiscardCharacterOrgAction
  | DiscardStageResourceAction
  | VoluntaryDiscardInPlayAction
  | ReturnAttachedToHandAction
  | ActivateOrgFetchAction
  | DiscardForEvilHourMovementAction
  | PayMovementTaxAction
  | PlayShortEventAction
  | FetchFromPileAction
  | ReshuffleCardFromHandAction
  | PlayLongEventAction
  | SelectCompanyAction
  | DeclarePathAction
  | OrderEffectsAction
  | PlayHazardAction
  | SideboardWithNazgulAction
  | TapAltPermanentEventAction
  | PlayAgentManifestationAction
  | AssignStrikeAction
  | AllocateCvccExcessAction
  | ResolveStrikeAction
  | AgentStrikeRollAction
  | SupportStrikeAction
  | ChooseStrikeOrderAction
  | BodyCheckRollAction
  | CancelAttackAction
  | ConvertCreatureToAllyAction
  | CancelByTapAction
  | CancelStrikeAction
  | FleeFromStrikeAction
  | ProtectFromStrikeAssignmentAction
  | HalveStrikesAction
  | TapAllyCombatBoostAction
  | TapAllyBodyCheckBoostAction
  | ModifyAttackAction
  | ApplyAttackerAttackOptionAction
  | TapItemForStrikeAction
  | FaceStrikeOnTapAction
  | CancelWeaponEffectsAction
  | SalvageItemAction
  | ShieldDiscardRollAction
  | DiscardItemFromCompanyAction
  | ForceDiscardCardAction
  | PlayStrikeEventAction
  | ResolveDiceCheckAction
  | FlateryAttemptRollAction
  | SeizedByTerrorRollAction
  | CompanyTapRollAction
  | HavenJoinAttackAction
  | CancelReturnToOriginAction
  | CancelHazardEventAction
  | PlayCounterCancelRollAction
  | CounterCancelAttackAction
  | TapAllyDiscardHazardAction
  | PlayAgentHazardAction
  | RevealAgentAction
  | AgentMoveAction
  | AgentMoveBackAction
  | AgentReturnHomeAction
  | AgentHealAction
  | AgentUntapAction
  | AgentTurnFaceDownAction
  | AgentKeyCreaturesAction
  | AgentInfluenceAttemptAction
  | AgentTapAttackAction
  | AgentDiscardReturnToOriginAction
  | UnderDeepsRollAction
  | GangwaysExtraMoveAction
  | ExtraMHMoveAction
  | EnterSiteAction
  | PlaceOnGuardAction
  | RevealOnGuardAction
  | CancelAutoAttackAction
  | PlaySiteAutoAttackAction
  | RescuePrisonerAction
  | DeclareAgentAttackAction
  | PlayHeroResourceAction
  | InfluenceAttemptAction
  | OpponentInfluenceAttemptAction
  | OpponentInfluenceDefendAction
  | CancelInfluenceAction
  | FactionInfluenceRollAction
  | PlayMinorItemAction
  | SelectForewarnedAttackAction
  | DeclareCompanyAttackAction
  | PaySiteTaxAction
  | SupportCorruptionCheckAction
  | CorruptionCheckAction
  | DrawCardsAction
  | DiscardCardAction
  | PassAction
  | CallFreeCouncilAction
  | DeckExhaustAction
  | ExchangeSideboardAction
  | StartSideboardToDeckAction
  | StartSideboardToDiscardAction
  | FetchFromSideboardAction
  | CardSideboardToDeckAction
  | StartHazardSideboardToDeckAction
  | StartHazardSideboardToDiscardAction
  | FetchHazardFromSideboardAction
  | PassChainPriorityAction
  | OrderPassivesAction
  | FinishedAction
  | HavenReturnAction
  | RunHomeAction
  | PayHazardEventMaintenanceAction
  | TapHazardCardForLimitAction
  | PayHazardLimitToUntapCardAction
  | DiscardCardForHazardLimitAction
  | TakeTrophyAction
  | TapCharacterByEffectAction
  | RestoreCharacterByEffectAction
  | LeftBehindRejoinAction
  | ArrangeDeckTopCardAction
  | ChooseRevealedCardAction
  | RemoveRevealedCardAction
  | DesireChooseShownCardAction
  | DesireChoosePenaltyAction
  | ChooseGreatHuntSourceAction
  | GreatHuntAttackWithCreatureAction
  | ReserveCreatureAction
  | PlayReservedCreatureAction
  | PlayCreatureFromDiscardAction
  | SpawnReplayCreatureAction
  | StayHerAppetiteRollAction
  | TransferReturnedItemAction
  | NotPlayableAction;
