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
  PlanMovementAction,
  CancelMovementAction,
  MoveToInfluenceAction,
  PlayPermanentEventAction,
  ActivateGrantedAction,
} from './actions-organization.js';

// ---- Short-event actions ----
export type {
  PlayShortEventAction,
  FetchFromPileAction,
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
  SalvageItemAction,
  PlayDodgeAction,
} from './actions-movement-hazard.js';

// ---- Site phase actions ----
export type {
  EnterSiteAction,
  PlaceOnGuardAction,
  RevealOnGuardAction,
  DeclareAgentAttackAction,
  PlayHeroResourceAction,
  InfluenceAttemptAction,
  OpponentInfluenceAttemptAction,
  OpponentInfluenceDefendAction,
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
import type { UntapAction, PlayCharacterAction, SplitCompanyAction, MoveToCompanyAction, MergeCompaniesAction, TransferItemAction, StoreItemAction, PlanMovementAction, CancelMovementAction, MoveToInfluenceAction, PlayPermanentEventAction, ActivateGrantedAction } from './actions-organization.js';
import type { PlayShortEventAction, FetchFromPileAction } from './actions-short-event.js';
import type { PlayLongEventAction } from './actions-long-event.js';
import type { SelectCompanyAction, DeclarePathAction, OrderEffectsAction, PlayHazardAction, AssignStrikeAction, ResolveStrikeAction, SupportStrikeAction, ChooseStrikeOrderAction, BodyCheckRollAction, CancelAttackAction, CancelByTapAction, CancelStrikeAction, HalveStrikesAction, SalvageItemAction, PlayDodgeAction } from './actions-movement-hazard.js';
import type { EnterSiteAction, PlaceOnGuardAction, RevealOnGuardAction, DeclareAgentAttackAction, PlayHeroResourceAction, InfluenceAttemptAction, OpponentInfluenceAttemptAction, OpponentInfluenceDefendAction, FactionInfluenceRollAction, PlayMinorItemAction } from './actions-site.js';
import type { SupportCorruptionCheckAction, CorruptionCheckAction, DrawCardsAction, DiscardCardAction, PassAction, CallFreeCouncilAction, DeckExhaustAction, ExchangeSideboardAction, StartSideboardToDeckAction, StartSideboardToDiscardAction, FetchFromSideboardAction, StartHazardSideboardToDeckAction, StartHazardSideboardToDiscardAction, FetchHazardFromSideboardAction, NotPlayableAction, PassChainPriorityAction, OrderPassivesAction, FinishedAction } from './actions-universal.js';

// ---- Discriminated union ----

/**
 * The top-level union of all possible game actions.
 *
 * Discriminated by the `type` field. The game engine's reducer accepts
 * a `GameAction` and produces a new `GameState`. Actions are validated
 * against `LEGAL_ACTIONS_BY_PHASE` before being applied.
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
  | MoveToInfluenceAction
  | PlanMovementAction
  | CancelMovementAction
  | PlayPermanentEventAction
  | ActivateGrantedAction
  | PlayShortEventAction
  | FetchFromPileAction
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
  | SalvageItemAction
  | PlayDodgeAction
  | EnterSiteAction
  | PlaceOnGuardAction
  | RevealOnGuardAction
  | DeclareAgentAttackAction
  | PlayHeroResourceAction
  | InfluenceAttemptAction
  | OpponentInfluenceAttemptAction
  | OpponentInfluenceDefendAction
  | FactionInfluenceRollAction
  | PlayMinorItemAction
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
