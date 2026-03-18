import {
  PlayerId,
  CardInstanceId,
  CompanyId,
  CardDefinitionId,
  WizardName,
} from './common.js';
import type {
  PhaseState,
  EventInPlay,
  Company,
  CharacterInPlay,
} from './state.js';
import type { GameAction } from './actions.js';

// ---- Card visibility ----

export interface HiddenCard {
  readonly instanceId: CardInstanceId;
  readonly known: false;
}

export interface RevealedCard {
  readonly instanceId: CardInstanceId;
  readonly definitionId: CardDefinitionId;
  readonly known: true;
}

export type ViewCard = HiddenCard | RevealedCard;

// ---- Opponent's company (destination hidden until movement phase) ----

export interface OpponentCompanyView {
  readonly id: CompanyId;
  readonly characters: readonly CardInstanceId[];
  readonly currentSite: CardInstanceId;
  readonly hasPlannedMovement: boolean;
  readonly moved: boolean;
}

// ---- Opponent view (hidden info redacted) ----

export interface OpponentView {
  readonly id: PlayerId;
  readonly wizard: WizardName;
  readonly handSize: number;
  readonly playDeckSize: number;
  readonly discardPile: readonly RevealedCard[];
  readonly siteDiscardPile: readonly RevealedCard[];
  readonly companies: readonly OpponentCompanyView[];
  readonly characters: Readonly<Record<string, CharacterInPlay>>;
  readonly generalInfluenceUsed: number;
  readonly deckExhaustionCount: number;
}

// ---- Self view (full access to own info) ----

export interface SelfView {
  readonly id: PlayerId;
  readonly wizard: WizardName;
  readonly hand: readonly RevealedCard[];
  readonly playDeckSize: number;
  readonly discardPile: readonly RevealedCard[];
  readonly siteDeck: readonly RevealedCard[];
  readonly siteDiscardPile: readonly RevealedCard[];
  readonly sideboard: readonly RevealedCard[];
  readonly companies: readonly Company[];
  readonly characters: Readonly<Record<string, CharacterInPlay>>;
  readonly generalInfluenceUsed: number;
  readonly deckExhaustionCount: number;
}

// ---- Combined player view ----

export interface PlayerView {
  readonly self: SelfView;
  readonly opponent: OpponentView;
  readonly activePlayer: PlayerId;
  readonly phaseState: PhaseState;
  readonly eventsInPlay: readonly EventInPlay[];
  readonly turnNumber: number;
  readonly legalActions: readonly GameAction['type'][];
}
