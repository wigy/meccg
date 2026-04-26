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
  AddCharacterToDeckAction,
  ShufflePlayDeckAction,
  SelectStartingSiteAction,
  PlaceCharacterAction,
  RollInitiativeAction,
} from './actions-setup.js';

// ---- Organization phase actions (includes Untap) ----
export type {
  UntapAction,
  PlayCharacterAction,
  SplitCompanyAction,
  MoveToCompanyAction,
  MergeCompaniesAction,
  TransferItemAction,
  StoreItemAction,
  GoldRingTestRollAction,
  PlanMovementAction,
  CancelMovementAction,
  MoveToInfluenceAction,
  PlayPermanentEventAction,
  PairResourceWithCofAction,
  ActivateGrantedAction,
  PlayWizardFromSearchAction,
  SkipWizardSearchAction,
  SelectCardBearerAction,
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
  AssignStrikeAction,
  ResolveStrikeAction,
  SupportStrikeAction,
  ChooseStrikeOrderAction,
  BodyCheckRollAction,
  CancelAttackAction,
  CancelByTapAction,
  CancelStrikeAction,
  HalveStrikesAction,
  ModifyAttackAction,
  TapItemForStrikeAction,
  ModifyAttackFromHandAction,
  SalvageItemAction,
  PlayDodgeAction,
  PlayStrikeEventAction,
  PlayRerollStrikeAction,
  MusterRollAction,
  CallOfHomeRollAction,
  BodyCheckCompanyRollAction,
  SeizedByTerrorRollAction,
  HavenJoinAttackAction,
  CancelReturnToOriginAction,
} from './actions-movement-hazard.js';

// ---- Site phase actions ----
export type {
  EnterSiteAction,
  PlaceOnGuardAction,
  RevealOnGuardAction,
  PlaySiteAutoAttackAction,
  DeclareAgentAttackAction,
  PlayHeroResourceAction,
  InfluenceAttemptAction,
  OpponentInfluenceAttemptAction,
  OpponentInfluenceDefendAction,
  CancelInfluenceAction,
  FactionInfluenceRollAction,
  PlayMinorItemAction,
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
  StartHazardSideboardToDeckAction,
  StartHazardSideboardToDiscardAction,
  FetchHazardFromSideboardAction,
  NotPlayableAction,
  PassChainPriorityAction,
  OrderPassivesAction,
  FinishedAction,
} from './actions-universal.js';

// ---- Import concrete types for the union ----
import type { DraftPickAction, DraftStopAction, AssignStartingItemAction, AddCharacterToDeckAction, ShufflePlayDeckAction, SelectStartingSiteAction, PlaceCharacterAction, RollInitiativeAction } from './actions-setup.js';
import type { UntapAction, PlayCharacterAction, SplitCompanyAction, MoveToCompanyAction, MergeCompaniesAction, TransferItemAction, StoreItemAction, GoldRingTestRollAction, PlanMovementAction, CancelMovementAction, MoveToInfluenceAction, PlayPermanentEventAction, PairResourceWithCofAction, ActivateGrantedAction, PlayWizardFromSearchAction, SkipWizardSearchAction, SelectCardBearerAction } from './actions-organization.js';
import type { PlayShortEventAction, FetchFromPileAction, ReshuffleCardFromHandAction } from './actions-short-event.js';
import type { PlayLongEventAction } from './actions-long-event.js';
import type { SelectCompanyAction, DeclarePathAction, OrderEffectsAction, PlayHazardAction, AssignStrikeAction, ResolveStrikeAction, SupportStrikeAction, ChooseStrikeOrderAction, BodyCheckRollAction, CancelAttackAction, CancelByTapAction, CancelStrikeAction, HalveStrikesAction, ModifyAttackAction, TapItemForStrikeAction, ModifyAttackFromHandAction, SalvageItemAction, PlayDodgeAction, PlayStrikeEventAction, PlayRerollStrikeAction, MusterRollAction, CallOfHomeRollAction, BodyCheckCompanyRollAction, SeizedByTerrorRollAction, HavenJoinAttackAction, CancelReturnToOriginAction } from './actions-movement-hazard.js';
import type { EnterSiteAction, PlaceOnGuardAction, RevealOnGuardAction, PlaySiteAutoAttackAction, DeclareAgentAttackAction, PlayHeroResourceAction, InfluenceAttemptAction, OpponentInfluenceAttemptAction, OpponentInfluenceDefendAction, CancelInfluenceAction, FactionInfluenceRollAction, PlayMinorItemAction, SelectForewarnedAttackAction } from './actions-site.js';
import type { SupportCorruptionCheckAction, CorruptionCheckAction, DrawCardsAction, DiscardCardAction, PassAction, CallFreeCouncilAction, DeckExhaustAction, ExchangeSideboardAction, StartSideboardToDeckAction, StartSideboardToDiscardAction, FetchFromSideboardAction, StartHazardSideboardToDeckAction, StartHazardSideboardToDiscardAction, FetchHazardFromSideboardAction, NotPlayableAction, PassChainPriorityAction, OrderPassivesAction, FinishedAction } from './actions-universal.js';

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
  | AddCharacterToDeckAction
  | ShufflePlayDeckAction
  | SelectStartingSiteAction
  | PlaceCharacterAction
  | RollInitiativeAction
  | UntapAction
  | PlayCharacterAction
  | SplitCompanyAction
  | MoveToCompanyAction
  | MergeCompaniesAction
  | TransferItemAction
  | StoreItemAction
  | GoldRingTestRollAction
  | MoveToInfluenceAction
  | PlanMovementAction
  | CancelMovementAction
  | PlayPermanentEventAction
  | PairResourceWithCofAction
  | ActivateGrantedAction
  | PlayWizardFromSearchAction
  | SkipWizardSearchAction
  | SelectCardBearerAction
  | PlayShortEventAction
  | FetchFromPileAction
  | ReshuffleCardFromHandAction
  | PlayLongEventAction
  | SelectCompanyAction
  | DeclarePathAction
  | OrderEffectsAction
  | PlayHazardAction
  | AssignStrikeAction
  | ResolveStrikeAction
  | SupportStrikeAction
  | ChooseStrikeOrderAction
  | BodyCheckRollAction
  | CancelAttackAction
  | CancelByTapAction
  | CancelStrikeAction
  | HalveStrikesAction
  | ModifyAttackAction
  | TapItemForStrikeAction
  | ModifyAttackFromHandAction
  | SalvageItemAction
  | PlayDodgeAction
  | PlayStrikeEventAction
  | PlayRerollStrikeAction
  | MusterRollAction
  | CallOfHomeRollAction
  | BodyCheckCompanyRollAction
  | SeizedByTerrorRollAction
  | HavenJoinAttackAction
  | CancelReturnToOriginAction
  | EnterSiteAction
  | PlaceOnGuardAction
  | RevealOnGuardAction
  | PlaySiteAutoAttackAction
  | DeclareAgentAttackAction
  | PlayHeroResourceAction
  | InfluenceAttemptAction
  | OpponentInfluenceAttemptAction
  | OpponentInfluenceDefendAction
  | CancelInfluenceAction
  | FactionInfluenceRollAction
  | PlayMinorItemAction
  | SelectForewarnedAttackAction
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
  | StartHazardSideboardToDeckAction
  | StartHazardSideboardToDiscardAction
  | FetchHazardFromSideboardAction
  | PassChainPriorityAction
  | OrderPassivesAction
  | FinishedAction
  | NotPlayableAction;
