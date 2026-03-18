import { PlayerId, CardInstanceId, CompanyId } from './common.js';

// ---- Organization phase ----

export interface PlayCharacterAction {
  readonly type: 'play-character';
  readonly player: PlayerId;
  readonly characterInstanceId: CardInstanceId;
  readonly atSite: CardInstanceId;
  readonly controlledBy: 'general' | CardInstanceId;
}

export interface SplitCompanyAction {
  readonly type: 'split-company';
  readonly player: PlayerId;
  readonly sourceCompanyId: CompanyId;
  readonly characterIds: readonly CardInstanceId[];
}

export interface MergeCompaniesAction {
  readonly type: 'merge-companies';
  readonly player: PlayerId;
  readonly sourceCompanyId: CompanyId;
  readonly targetCompanyId: CompanyId;
}

export interface TransferItemAction {
  readonly type: 'transfer-item';
  readonly player: PlayerId;
  readonly itemInstanceId: CardInstanceId;
  readonly fromCharacterId: CardInstanceId;
  readonly toCharacterId: CardInstanceId;
}

export interface PlanMovementAction {
  readonly type: 'plan-movement';
  readonly player: PlayerId;
  readonly companyId: CompanyId;
  readonly destinationSite: CardInstanceId;
  readonly regionPath: readonly CardInstanceId[];
}

export interface CancelMovementAction {
  readonly type: 'cancel-movement';
  readonly player: PlayerId;
  readonly companyId: CompanyId;
}

// ---- Movement/Hazard phase ----

export interface PlayHazardAction {
  readonly type: 'play-hazard';
  readonly player: PlayerId;
  readonly cardInstanceId: CardInstanceId;
  readonly targetCompanyId: CompanyId;
  readonly targetCharacterId?: CardInstanceId;
}

export interface AssignStrikeAction {
  readonly type: 'assign-strike';
  readonly player: PlayerId;
  readonly characterId: CardInstanceId;
}

export interface ResolveStrikeAction {
  readonly type: 'resolve-strike';
  readonly player: PlayerId;
  readonly tapToFight: boolean;
}

export interface SupportStrikeAction {
  readonly type: 'support-strike';
  readonly player: PlayerId;
  readonly supportingCharacterId: CardInstanceId;
  readonly targetCharacterId: CardInstanceId;
}

// ---- Site phase ----

export interface PlayHeroResourceAction {
  readonly type: 'play-hero-resource';
  readonly player: PlayerId;
  readonly cardInstanceId: CardInstanceId;
  readonly companyId: CompanyId;
  readonly attachToCharacterId?: CardInstanceId;
}

export interface InfluenceAttemptAction {
  readonly type: 'influence-attempt';
  readonly player: PlayerId;
  readonly factionInstanceId: CardInstanceId;
  readonly influencingCharacterId: CardInstanceId;
}

export interface PlayMinorItemAction {
  readonly type: 'play-minor-item';
  readonly player: PlayerId;
  readonly cardInstanceId: CardInstanceId;
  readonly characterId: CardInstanceId;
  readonly attachToCharacterId: CardInstanceId;
}

// ---- Universal ----

export interface CorruptionCheckAction {
  readonly type: 'corruption-check';
  readonly player: PlayerId;
  readonly characterId: CardInstanceId;
}

export interface DrawCardsAction {
  readonly type: 'draw-cards';
  readonly player: PlayerId;
  readonly count: number;
}

export interface DiscardCardAction {
  readonly type: 'discard-card';
  readonly player: PlayerId;
  readonly cardInstanceId: CardInstanceId;
}

export interface PassAction {
  readonly type: 'pass';
  readonly player: PlayerId;
}

export interface CallFreeCouncilAction {
  readonly type: 'call-free-council';
  readonly player: PlayerId;
}

export interface FetchFromSideboardAction {
  readonly type: 'fetch-from-sideboard';
  readonly player: PlayerId;
  readonly cardInstanceId: CardInstanceId;
}

// ---- Discriminated union ----

export type GameAction =
  | PlayCharacterAction
  | SplitCompanyAction
  | MergeCompaniesAction
  | TransferItemAction
  | PlanMovementAction
  | CancelMovementAction
  | PlayHazardAction
  | AssignStrikeAction
  | ResolveStrikeAction
  | SupportStrikeAction
  | PlayHeroResourceAction
  | InfluenceAttemptAction
  | PlayMinorItemAction
  | CorruptionCheckAction
  | DrawCardsAction
  | DiscardCardAction
  | PassAction
  | CallFreeCouncilAction
  | FetchFromSideboardAction;
