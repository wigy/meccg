import {
  PlayerId,
  CardInstanceId,
  CompanyId,
  CardDefinitionId,
  CharacterStatus,
  WizardName,
} from './common.js';
import { CardDefinition } from './cards.js';

// ---- Card Instances (runtime, in-game) ----

export interface CardInstance {
  readonly instanceId: CardInstanceId;
  readonly definitionId: CardDefinitionId;
}

// ---- Characters in play ----

export interface CharacterInPlay {
  readonly instanceId: CardInstanceId;
  readonly definitionId: CardDefinitionId;
  readonly status: CharacterStatus;
  readonly items: readonly CardInstanceId[];
  readonly allies: readonly CardInstanceId[];
  readonly corruptionCards: readonly CardInstanceId[];
  readonly followers: readonly CardInstanceId[];
  readonly controlledBy: 'general' | CardInstanceId;
}

// ---- Company ----

export interface Company {
  readonly id: CompanyId;
  readonly characters: readonly CardInstanceId[];
  readonly currentSite: CardInstanceId;
  readonly destinationSite: CardInstanceId | null;
  readonly movementPath: readonly CardInstanceId[];
  readonly moved: boolean;
}

// ---- Events in play (long/permanent) ----

export interface EventInPlay {
  readonly instanceId: CardInstanceId;
  readonly definitionId: CardDefinitionId;
  readonly owner: PlayerId;
  readonly attachedTo?: CardInstanceId;
}

// ---- Per-player state ----

export interface PlayerState {
  readonly id: PlayerId;
  readonly name: string;
  readonly wizard: WizardName | null;
  readonly hand: readonly CardInstanceId[];
  readonly playDeck: readonly CardInstanceId[];
  readonly discardPile: readonly CardInstanceId[];
  readonly siteDeck: readonly CardInstanceId[];
  readonly siteDiscardPile: readonly CardInstanceId[];
  readonly sideboard: readonly CardInstanceId[];
  readonly companies: readonly Company[];
  readonly characters: Readonly<Record<string, CharacterInPlay>>;
  readonly generalInfluenceUsed: number;
  readonly deckExhaustionCount: number;
  readonly freeCouncilCalled: boolean;
}

// ---- Phases ----

export enum Phase {
  // Pre-game draft phases
  CharacterDraft = 'character-draft',
  // Game phases
  Untap = 'untap',
  Organization = 'organization',
  LongEvent = 'long-event',
  MovementHazard = 'movement-hazard',
  Site = 'site',
  EndOfTurn = 'end-of-turn',
  FreeCouncil = 'free-council',
  GameOver = 'game-over',
}

// ---- Draft state ----

export interface DraftPlayerState {
  readonly pool: readonly CardDefinitionId[];              // up to 10 characters available to draft
  readonly drafted: readonly CardDefinitionId[];           // characters successfully drafted
  readonly startingMinorItems: readonly CardDefinitionId[]; // up to 2 non-unique minor items
  readonly currentPick: CardDefinitionId | null;           // face-down pick for current round
  readonly stopped: boolean;                               // player has stopped drafting
}

// ---- Phase-specific state ----

export interface CharacterDraftPhaseState {
  readonly phase: Phase.CharacterDraft;
  readonly round: number;
  readonly draftState: readonly [DraftPlayerState, DraftPlayerState];
  readonly setAside: readonly CardDefinitionId[];       // duplicates neither player gets
}

export interface UntapPhaseState {
  readonly phase: Phase.Untap;
}

export interface OrganizationPhaseState {
  readonly phase: Phase.Organization;
}

export interface LongEventPhaseState {
  readonly phase: Phase.LongEvent;
}

export interface MovementHazardPhaseState {
  readonly phase: Phase.MovementHazard;
  readonly activeCompanyIndex: number;
  readonly hazardsPlayedThisCompany: number;
  readonly hazardLimit: number;
  readonly combat: CombatState | null;
}

export interface SitePhaseState {
  readonly phase: Phase.Site;
  readonly activeCompanyIndex: number;
  readonly automaticAttacksResolved: number;
  readonly resourcePlayed: boolean;
  readonly combat: CombatState | null;
}

export interface EndOfTurnPhaseState {
  readonly phase: Phase.EndOfTurn;
}

export interface FreeCouncilPhaseState {
  readonly phase: Phase.FreeCouncil;
  readonly tiebreaker: boolean;
}

export interface GameOverPhaseState {
  readonly phase: Phase.GameOver;
  readonly winner: PlayerId | null;
  readonly finalScores: Readonly<Record<string, number>>;
}

export type PhaseState =
  | CharacterDraftPhaseState
  | UntapPhaseState
  | OrganizationPhaseState
  | LongEventPhaseState
  | MovementHazardPhaseState
  | SitePhaseState
  | EndOfTurnPhaseState
  | FreeCouncilPhaseState
  | GameOverPhaseState;

// ---- Combat sub-state ----

export type AttackSource =
  | { readonly type: 'creature'; readonly instanceId: CardInstanceId }
  | { readonly type: 'automatic-attack'; readonly siteInstanceId: CardInstanceId; readonly attackIndex: number };

export interface StrikeAssignment {
  readonly characterId: CardInstanceId;
  readonly resolved: boolean;
  readonly result?: 'success' | 'wounded' | 'eliminated';
}

export interface CombatState {
  readonly attackSource: AttackSource;
  readonly strikesTotal: number;
  readonly strikeProwess: number;
  readonly strikeAssignments: readonly StrikeAssignment[];
  readonly currentStrikeIndex: number;
  readonly phase: 'assign-strikes' | 'resolve-strike' | 'body-check';
}

// ---- Pending effects ----

export interface PendingEffect {
  readonly type: string;
  readonly data: unknown;
}

// ---- RNG ----

export interface RngState {
  readonly seed: number;
  readonly counter: number;
}

// ---- Full Game State ----

export interface GameState {
  readonly players: readonly [PlayerState, PlayerState];
  readonly activePlayer: PlayerId;
  readonly phaseState: PhaseState;
  readonly eventsInPlay: readonly EventInPlay[];
  readonly cardPool: Readonly<Record<string, CardDefinition>>;
  readonly instanceMap: Readonly<Record<string, CardInstance>>;
  readonly turnNumber: number;
  readonly pendingEffects: readonly PendingEffect[];
  readonly rng: RngState;
}
