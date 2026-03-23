/**
 * @module 04-long-event-phase.test
 *
 * Tests for CoE Rules Section 2.III: Long-event Phase.
 *
 * Rule references from docs/coe-rules.txt lines 272-274.
 *
 * Tests construct explicit game states in the Organization or Long-event
 * phase and verify the engine correctly handles long-event discard and play.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  reduce,
  Phase,
  ARAGORN, LEGOLAS,
  SUN, EYE_OF_SAURON,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import type {
  CardInstanceId, GameState, PlayerId, CardDefinitionId, CompanyId,
  CardInPlay,
} from '../../index.js';
import { CardStatus, ZERO_EFFECTIVE_STATS, ZERO_MARSHALLING_POINTS, Alignment } from '../../index.js';

// ─── State builder ───────────────────────────────────────────────────────────

let nextInstanceCounter = 1;

function mint(): CardInstanceId {
  return `inst-${nextInstanceCounter++}` as CardInstanceId;
}

function resetMint(): void {
  nextInstanceCounter = 1;
}

interface CharSetup {
  defId: CardDefinitionId;
  status?: typeof CardStatus[keyof typeof CardStatus];
}

interface CompanySetup {
  site: CardDefinitionId;
  characters: CharSetup[];
}

interface PlayerSetup {
  id: PlayerId;
  companies: CompanySetup[];
  hand: CardDefinitionId[];
  siteDeck: CardDefinitionId[];
  playDeck?: CardDefinitionId[];
  discardPile?: CardDefinitionId[];
  cardsInPlay?: CardInPlay[];
}

/**
 * Build a minimal valid GameState in the Organization phase, with optional
 * events already in play. Pass through to Long-event phase by dispatching
 * a 'pass' action.
 */
function buildState(opts: {
  activePlayer: PlayerId;
  players: [PlayerSetup, PlayerSetup];
  phase?: Phase;
}): GameState {
  resetMint();

  const instanceMap: Record<string, { instanceId: CardInstanceId; definitionId: CardDefinitionId }> = {};

  function mintFor(defId: CardDefinitionId): CardInstanceId {
    const id = mint();
    instanceMap[id as string] = { instanceId: id, definitionId: defId };
    return id;
  }

  const playerStates = opts.players.map((setup) => {
    const hand = setup.hand.map(defId => mintFor(defId));
    const siteDeck = setup.siteDeck.map(defId => mintFor(defId));

    // Register cardsInPlay instances in the instanceMap
    if (setup.cardsInPlay) {
      for (const card of setup.cardsInPlay) {
        instanceMap[card.instanceId as string] = { instanceId: card.instanceId, definitionId: card.definitionId };
      }
    }

    const characters: Record<string, import('../../index.js').CharacterInPlay> = {};
    const companies: import('../../index.js').Company[] = [];

    for (const companySetup of setup.companies) {
      const siteInstId = mintFor(companySetup.site);
      const charInstIds: CardInstanceId[] = [];

      for (const charSetup of companySetup.characters) {
        const charInstId = mintFor(charSetup.defId);
        charInstIds.push(charInstId);

        characters[charInstId as string] = {
          instanceId: charInstId,
          definitionId: charSetup.defId,
          status: charSetup.status ?? CardStatus.Untapped,
          items: [],
          allies: [],
          corruptionCards: [],
          followers: [],
          controlledBy: 'general' as const,
          effectiveStats: ZERO_EFFECTIVE_STATS,
        };
      }

      companies.push({
        id: `company-${setup.id as string}-${companies.length}` as CompanyId,
        characters: charInstIds,
        currentSite: siteInstId,
        siteCardOwned: true,
        destinationSite: null,
        movementPath: [],
        moved: false,
      });
    }

    const playDeck = (setup.playDeck ?? []).map(defId => mintFor(defId));
    const discardPile = (setup.discardPile ?? []).map(defId => mintFor(defId));

    return {
      id: setup.id,
      name: setup.id === PLAYER_1 ? 'Alice' : 'Bob',
      alignment: Alignment.Wizard,
      wizard: null,
      hand,
      playDeck,
      discardPile,
      siteDeck,
      siteDiscardPile: [] as CardInstanceId[],
      sideboard: [] as CardInstanceId[],
      eliminatedPile: [] as CardInstanceId[],
      companies,
      characters,
      cardsInPlay: setup.cardsInPlay ?? [],
      marshallingPoints: ZERO_MARSHALLING_POINTS,
      generalInfluenceUsed: 0,
      deckExhaustionCount: 0,
      freeCouncilCalled: false,
      lastDiceRoll: null,
    };
  });

  const phase = opts.phase ?? Phase.Organization;
  let phaseState: GameState['phaseState'];
  if (phase === Phase.Organization) {
    phaseState = { phase: Phase.Organization, characterPlayedThisTurn: false, pendingCorruptionCheck: null };
  } else {
    phaseState = { phase: Phase.LongEvent };
  }

  return {
    gameId: 'test-game',
    players: playerStates as unknown as readonly [import('../../index.js').PlayerState, import('../../index.js').PlayerState],
    activePlayer: opts.activePlayer,
    phaseState,
    eventsInPlay: [],
    cardPool: pool,
    instanceMap,
    turnNumber: 1,
    pendingEffects: [],
    rng: { seed: 42, counter: 0 },
    stateSeq: 0,
    touchedCards: [],
    cheatRollTotal: null,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('2.III Long-event phase', () => {
  beforeEach(() => resetMint());

  test('[2.III.1] at beginning: resource player immediately discards own resource long-events', () => {
    // Place a resource long-event (Sun) in PLAYER_1's cardsInPlay.
    // Start in Organization phase, pass to Long-event phase, verify the
    // event is removed from cardsInPlay and placed in P1's discard pile.
    const sunCardInPlay: CardInPlay = {
      instanceId: 'evt-sun-1' as CardInstanceId,
      definitionId: SUN,
      status: CardStatus.Untapped,
    };

    const state = buildState({
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }], hand: [], siteDeck: [MORIA], cardsInPlay: [sunCardInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Pass from Organization → Long-event phase
    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.phaseState.phase).toBe(Phase.LongEvent);

    // Resource long-event should be gone from cardsInPlay
    expect(result.state.players[0].cardsInPlay).toHaveLength(0);

    // It should be in P1's discard pile
    expect(result.state.players[0].discardPile).toContain(sunCardInPlay.instanceId);
  });

  test('[2.III.2] resource player may play resource long-events during this phase only', () => {
    // Place a Sun card in P1's hand, start in Long-event phase.
    // Verify play-long-event is a legal action; play it and check cardsInPlay.
    const state = buildState({
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }], hand: [SUN], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
      phase: Phase.LongEvent,
    });

    // Compute legal actions: should include play-long-event for the Sun card
    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = actions.filter(a => a.action.type === 'play-long-event');
    expect(playActions).toHaveLength(1);
    expect(playActions[0].viable).toBe(true);

    // Play the long-event
    const sunInstanceId = state.players[0].hand[0];
    const result = reduce(state, { type: 'play-long-event', player: PLAYER_1, cardInstanceId: sunInstanceId });
    expect(result.error).toBeUndefined();

    // Sun should be in P1's cardsInPlay
    const sunCard = result.state.players[0].cardsInPlay.find(c => c.definitionId === SUN);
    expect(sunCard).toBeDefined();

    // Sun should be removed from hand
    expect(result.state.players[0].hand).not.toContain(sunInstanceId);
  });

  test('[2.III.3] at end: hazard player immediately discards own hazard long-events', () => {
    // Place a hazard long-event (Eye of Sauron) in PLAYER_2's cardsInPlay.
    // PLAYER_1 is active (resource player), so PLAYER_2 is the hazard player.
    // Pass through Long-event → Movement/Hazard, verify hazard event is discarded.
    const eyeCardInPlay: CardInPlay = {
      instanceId: 'evt-eye-1' as CardInstanceId,
      definitionId: EYE_OF_SAURON,
      status: CardStatus.Untapped,
    };

    const state = buildState({
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [eyeCardInPlay] },
      ],
      phase: Phase.LongEvent,
    });

    // Pass from Long-event → Movement/Hazard
    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.phaseState.phase).toBe(Phase.MovementHazard);

    // Hazard long-event should be gone from P2's cardsInPlay
    expect(result.state.players[1].cardsInPlay).toHaveLength(0);

    // It should be in P2's discard pile
    expect(result.state.players[1].discardPile).toContain(eyeCardInPlay.instanceId);
  });
});
