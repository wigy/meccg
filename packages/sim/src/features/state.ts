/**
 * @module features/state
 *
 * State featurizer: turns a projected {@link PlayerView} into numeric
 * feature data for learning — never the raw `GameState`, so the hidden-
 * information boundary is preserved by construction. Output has two parts:
 *
 * - a fixed-width **global vector** (turn, phase one-hot, pile sizes,
 *   influence, marshalling points by category, tournament scores, …),
 *   self-documented by {@link GLOBAL_FEATURE_NAMES}; and
 * - a variable-length list of **entity vectors** (one per card the player
 *   can see in a structured zone: hand, characters, items, allies, company
 *   sites, permanents, on-guard cards, agents, own site deck), each a
 *   fixed-width row documented by {@link ENTITY_FEATURE_NAMES}, carrying a
 *   zone id, an owner flag, and a card-vocabulary index for embedding.
 *
 * Counts are scaled to keep values roughly in [0, 1]; identity columns
 * (zone, status, vocab index) stay integers for embedding lookup on the
 * Python side. The layout is versioned by `FEATURE_SPEC_VERSION` in the
 * features index module — any change here must bump it.
 */

import { CardStatus, Phase, computeTournamentScore } from '@meccg/shared';
import type { CardDefinition, CharacterInPlay, PlayerView } from '@meccg/shared';
import type { CardVocab } from './vocab.js';

/** Names of the global feature vector's columns, in order. */
export const GLOBAL_FEATURE_NAMES: readonly string[] = [
  'turn',
  ...Object.values(Phase).map(phase => `phase:${phase}`),
  'is-active-player',
  'self-index',
  'self-hand-size',
  'opp-hand-size',
  'self-play-deck-size',
  'opp-play-deck-size',
  'self-discard-size',
  'opp-discard-size',
  'self-sideboard-size',
  'opp-sideboard-size',
  'self-gi-used',
  'self-gi-total',
  'opp-gi-used',
  'opp-gi-total',
  'self-stage-points',
  'opp-stage-points',
  'self-deck-exhaustions',
  'opp-deck-exhaustions',
  'self-mp-character',
  'self-mp-item',
  'self-mp-faction',
  'self-mp-ally',
  'self-mp-kill',
  'self-mp-misc',
  'opp-mp-character',
  'opp-mp-item',
  'opp-mp-faction',
  'opp-mp-ally',
  'opp-mp-kill',
  'opp-mp-misc',
  'self-score',
  'opp-score',
  'combat-active',
  'chain-active',
  'pending-effects',
  'active-constraints',
  'self-companies',
  'opp-companies',
  'self-characters',
  'opp-characters',
  'self-kill-pile',
  'opp-kill-pile',
  'self-agents',
  'opp-agents',
];

/** Width of the global feature vector. */
export const GLOBAL_FEATURE_WIDTH = GLOBAL_FEATURE_NAMES.length;

/**
 * Entity zones. Integer ids embedded on the learning side; listed here so
 * both runtimes agree on the numbering.
 */
export const ENTITY_ZONES = {
  selfHand: 1,
  selfCharacter: 2,
  oppCharacter: 3,
  item: 4,
  ally: 5,
  attachedHazard: 6,
  companySite: 7,
  destinationSite: 8,
  cardInPlay: 9,
  onGuard: 10,
  agent: 11,
  selfSiteDeck: 12,
} as const;

/** Names of each entity row's columns, in order. */
export const ENTITY_FEATURE_NAMES: readonly string[] = [
  'zone',        // ENTITY_ZONES id (integer)
  'owner',       // 0 = self, 1 = opponent
  'card',        // card-vocabulary index (integer, 0 = unknown)
  'status',      // 0 untapped, 1 tapped, 2 inverted
  'company',     // 1-based company index the entity belongs to (0 = none); self and opponent companies numbered independently
  'bearer-card', // vocab index of the bearing character (0 = none)
  'prowess',
  'body',
  'mind',
  'influence',
  'mp',
  'corruption',
  'flag',        // zone-specific: company moved / on-guard revealed / agent face-down
];

/** Width of one entity feature row. */
export const ENTITY_FEATURE_WIDTH = ENTITY_FEATURE_NAMES.length;

/** Featurized state: the global vector plus one row per visible entity. */
export interface StateFeatures {
  readonly global: readonly number[];
  readonly entities: readonly (readonly number[])[];
}

/** Reads a numeric field off a card definition, 0 when absent or non-numeric. */
function defNumber(def: CardDefinition | undefined, field: string): number {
  if (def === undefined) return 0;
  const value = (def as unknown as Record<string, unknown>)[field];
  return typeof value === 'number' ? value : 0;
}

/** Integer code of a card status. */
function statusCode(status: CardStatus | string | undefined): number {
  if (status === CardStatus.Tapped) return 1;
  if (status === CardStatus.Inverted) return 2;
  return 0;
}

/**
 * Featurizes one {@link PlayerView}. Deterministic: the same view and
 * vocabulary always produce identical vectors, and entity rows follow the
 * view's own iteration order (hand, then characters company by company,
 * then attachments, sites, permanents, on-guard, agents, site deck).
 */
export function featurizeState(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  vocab: CardVocab,
): StateFeatures {
  const s = view.self;
  const o = view.opponent;

  const global: number[] = [
    view.turnNumber / 100,
    ...Object.values(Phase).map(phase => (view.phaseState.phase === phase ? 1 : 0)),
    view.activePlayer === s.id ? 1 : 0,
    view.selfIndex,
    s.hand.length / 10,
    o.hand.length / 10,
    s.playDeck.length / 100,
    o.playDeck.length / 100,
    s.discardPile.length / 100,
    o.discardPile.length / 100,
    s.sideboard.length / 100,
    o.sideboard.length / 100,
    s.generalInfluenceUsed / 20,
    s.generalInfluence / 20,
    o.generalInfluenceUsed / 20,
    o.generalInfluence / 20,
    s.stagePoints / 10,
    o.stagePoints / 10,
    s.deckExhaustionCount,
    o.deckExhaustionCount,
    s.marshallingPoints.character / 10,
    s.marshallingPoints.item / 10,
    s.marshallingPoints.faction / 10,
    s.marshallingPoints.ally / 10,
    s.marshallingPoints.kill / 10,
    s.marshallingPoints.misc / 10,
    o.marshallingPoints.character / 10,
    o.marshallingPoints.item / 10,
    o.marshallingPoints.faction / 10,
    o.marshallingPoints.ally / 10,
    o.marshallingPoints.kill / 10,
    o.marshallingPoints.misc / 10,
    computeTournamentScore(s.marshallingPoints, o.marshallingPoints) / 10,
    computeTournamentScore(o.marshallingPoints, s.marshallingPoints) / 10,
    view.combat !== null ? 1 : 0,
    view.chain !== null ? 1 : 0,
    view.pendingEffects.length / 5,
    view.activeConstraints.length / 5,
    s.companies.length / 5,
    o.companies.length / 5,
    Object.keys(s.characters).length / 10,
    Object.keys(o.characters).length / 10,
    s.killPile.length / 10,
    o.killPile.length / 10,
    s.agents.length / 5,
    o.agents.length / 5,
  ];

  const entities: number[][] = [];
  const row = (
    zone: number,
    owner: number,
    definitionId: string | null | undefined,
    status: number,
    company: number,
    bearerCard: number,
    flag: number,
  ): number[] => {
    const def = definitionId ? cardPool[definitionId] : undefined;
    return [
      zone,
      owner,
      vocab.indexOf(definitionId),
      status,
      company,
      bearerCard,
      defNumber(def, 'prowess') / 10,
      defNumber(def, 'body') / 10,
      defNumber(def, 'mind') / 10,
      defNumber(def, 'directInfluence') / 10,
      defNumber(def, 'mp') / 5,
      defNumber(def, 'corruption') / 10,
      flag,
    ];
  };

  /** Character row overriding definition stats with live effective stats. */
  const characterRow = (
    zone: number,
    owner: number,
    character: CharacterInPlay,
    company: number,
    flag: number,
  ): number[] => {
    const vector = row(zone, owner, character.definitionId, statusCode(character.status), company, 0, flag);
    vector[6] = character.effectiveStats.prowess / 10;
    vector[7] = character.effectiveStats.body / 10;
    vector[9] = character.effectiveStats.directInfluence / 10;
    vector[11] = character.effectiveStats.corruptionPoints / 10;
    return vector;
  };

  /** A character with its items, allies, and attached hazards. */
  const addCharacterGroup = (
    owner: number,
    characterZone: number,
    character: CharacterInPlay,
    company: number,
  ): void => {
    entities.push(characterRow(characterZone, owner, character, company, 0));
    const bearer = vocab.indexOf(character.definitionId);
    for (const item of character.items) {
      entities.push(row(ENTITY_ZONES.item, owner, item.definitionId, statusCode(item.status), company, bearer, 0));
    }
    for (const ally of character.allies) {
      entities.push(row(ENTITY_ZONES.ally, owner, ally.definitionId, statusCode(ally.status), company, bearer, 0));
    }
    for (const hazard of character.hazards) {
      entities.push(row(ENTITY_ZONES.attachedHazard, owner, hazard.definitionId, statusCode(hazard.status), company, bearer, 0));
    }
  };

  // Own hand.
  for (const card of s.hand) {
    entities.push(row(ENTITY_ZONES.selfHand, 0, card.definitionId, 0, 0, 0, 0));
  }

  // Own companies: characters (in company order), current site, destination.
  s.companies.forEach((company, companyIndex) => {
    const companyNumber = companyIndex + 1;
    for (const characterId of company.characters) {
      const character = s.characters[characterId];
      if (character) addCharacterGroup(0, ENTITY_ZONES.selfCharacter, character, companyNumber);
    }
    if (company.currentSite) {
      entities.push(row(ENTITY_ZONES.companySite, 0, company.currentSite.definitionId, statusCode(company.currentSite.status), companyNumber, 0, company.moved ? 1 : 0));
    }
    if (company.destinationSite) {
      entities.push(row(ENTITY_ZONES.destinationSite, 0, company.destinationSite.definitionId, statusCode(company.destinationSite.status), companyNumber, 0, 0));
    }
    for (const onGuard of company.onGuardCards) {
      entities.push(row(ENTITY_ZONES.onGuard, 0, onGuard.definitionId, 0, companyNumber, 0, onGuard.revealed ? 1 : 0));
    }
  });

  // Opponent companies: characters, sites, revealed destinations.
  o.companies.forEach((company, companyIndex) => {
    const companyNumber = companyIndex + 1;
    for (const characterId of company.characters) {
      const character = o.characters[characterId];
      if (character) addCharacterGroup(1, ENTITY_ZONES.oppCharacter, character, companyNumber);
    }
    if (company.currentSite) {
      entities.push(row(ENTITY_ZONES.companySite, 1, company.currentSite.definitionId, statusCode(company.currentSite.status), companyNumber, 0, company.moved ? 1 : 0));
    }
    if (company.revealedDestinationSite) {
      entities.push(row(ENTITY_ZONES.destinationSite, 1, company.revealedDestinationSite.definitionId, statusCode(company.revealedDestinationSite.status), companyNumber, 0, 0));
    }
    for (const onGuard of company.onGuardCards) {
      entities.push(row(ENTITY_ZONES.onGuard, 1, onGuard.definitionId, 0, companyNumber, 0, 0));
    }
  });

  // Permanents in play on both sides.
  for (const card of s.cardsInPlay) {
    entities.push(row(ENTITY_ZONES.cardInPlay, 0, card.definitionId, statusCode(card.status), 0, 0, 0));
  }
  for (const card of o.cardsInPlay) {
    entities.push(row(ENTITY_ZONES.cardInPlay, 1, card.definitionId, statusCode(card.status), 0, 0, 0));
  }

  // Agents: own in full; opponent's as much as is revealed.
  for (const agent of s.agents) {
    entities.push(characterRow(ENTITY_ZONES.agent, 0, agent.character, 0, 0));
  }
  for (const agent of o.agents) {
    entities.push(row(ENTITY_ZONES.agent, 1, agent.characterDefinitionId, 0, 0, 0, agent.revealed ? 0 : 1));
  }

  // Own site deck (visible to the owner; movement planning signal).
  for (const site of s.siteDeck) {
    entities.push(row(ENTITY_ZONES.selfSiteDeck, 0, site.definitionId, 0, 0, 0, 0));
  }

  return { global, entities };
}
