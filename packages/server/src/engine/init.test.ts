import { describe, it, expect } from 'vitest';
import { createGame } from './init.js';
import type { GameConfig } from './init.js';
import {
  loadCardPool,
  formatGameState,
  Phase,
  CharacterStatus,
  WizardName,
  HAND_SIZE,
} from '@meccg/shared';
import type { PlayerId, CardDefinitionId } from '@meccg/shared';

const pid = (s: string) => s as PlayerId;
const did = (s: string) => s as CardDefinitionId;

function makeTestConfig(seed = 42): GameConfig {
  // Build a minimal play deck (just repeat the few cards we have)
  const resourceIds = [did('tw-244'), did('tw-333'), did('tw-345'), did('tw-347')];
  const hazardIds = [did('tw-020'), did('tw-074'), did('tw-015')];

  // Pad to at least 10 cards per player to have enough for a hand
  const playDeck: CardDefinitionId[] = [];
  for (let i = 0; i < 5; i++) {
    playDeck.push(...resourceIds, ...hazardIds);
  }

  return {
    players: [
      {
        id: pid('p1'),
        wizard: WizardName.Gandalf,
        startingCharacters: [did('tw-120'), did('tw-131')], // Aragorn II, Bilbo
        playDeck,
        siteDeck: [did('tw-413'), did('tw-412'), did('tw-414')], // Moria, Minas Tirith, Mount Doom
        startingHaven: did('tw-421'), // Rivendell
      },
      {
        id: pid('p2'),
        wizard: WizardName.Saruman,
        startingCharacters: [did('tw-168'), did('tw-159')], // Legolas, Gimli
        playDeck,
        siteDeck: [did('tw-413'), did('tw-412')],
        startingHaven: did('tw-408'), // Lórien
      },
    ],
    seed,
  };
}

describe('createGame', () => {
  const pool = loadCardPool();

  it('creates valid initial state with correct wizards', () => {
    const state = createGame(makeTestConfig(), pool);

    expect(state.players[0].wizard).toBe(WizardName.Gandalf);
    expect(state.players[1].wizard).toBe(WizardName.Saruman);
    expect(state.players[0].id).toBe('p1');
    expect(state.players[1].id).toBe('p2');
  });

  it('starts at turn 1 in untap phase with player 1 active', () => {
    const state = createGame(makeTestConfig(), pool);

    expect(state.turnNumber).toBe(1);
    expect(state.phaseState.phase).toBe(Phase.Untap);
    expect(state.activePlayer).toBe('p1');
  });

  it('deals HAND_SIZE cards to each player', () => {
    const state = createGame(makeTestConfig(), pool);

    expect(state.players[0].hand).toHaveLength(HAND_SIZE);
    expect(state.players[1].hand).toHaveLength(HAND_SIZE);
    // Remaining deck should be total - HAND_SIZE
    expect(state.players[0].playDeck.length + HAND_SIZE).toBe(35);
    expect(state.players[1].playDeck.length + HAND_SIZE).toBe(35);
  });

  it('places starting characters untapped in a company at the haven', () => {
    const state = createGame(makeTestConfig(), pool);

    const p1 = state.players[0];
    expect(p1.companies).toHaveLength(1);

    const company = p1.companies[0];
    expect(company.characters).toHaveLength(2); // Aragorn + Bilbo

    // All characters untapped
    for (const charId of company.characters) {
      const char = p1.characters[charId as string];
      expect(char).toBeDefined();
      expect(char.status).toBe(CharacterStatus.Untapped);
      expect(char.items).toHaveLength(0);
      expect(char.controlledBy).toBe('general');
    }

    // Haven site resolves to Rivendell
    const havenInstance = state.instanceMap[company.currentSite as string];
    expect(havenInstance).toBeDefined();
    expect(havenInstance.definitionId).toBe('tw-421');
  });

  it('calculates general influence used from starting characters', () => {
    const state = createGame(makeTestConfig(), pool);

    // Aragorn (mind 9) + Bilbo (mind 5) = 14
    expect(state.players[0].generalInfluenceUsed).toBe(14);
    // Legolas (mind 6) + Gimli (mind 6) = 12
    expect(state.players[1].generalInfluenceUsed).toBe(12);
  });

  it('registers all card instances in the instance map', () => {
    const state = createGame(makeTestConfig(), pool);

    // Every card in hands, decks, site decks, and companies should be in instanceMap
    for (const player of state.players) {
      for (const id of player.hand) {
        expect(state.instanceMap[id as string]).toBeDefined();
      }
      for (const id of player.playDeck) {
        expect(state.instanceMap[id as string]).toBeDefined();
      }
      for (const id of player.siteDeck) {
        expect(state.instanceMap[id as string]).toBeDefined();
      }
      for (const company of player.companies) {
        expect(state.instanceMap[company.currentSite as string]).toBeDefined();
      }
    }
  });

  it('shuffles play deck deterministically based on seed', () => {
    const state1 = createGame(makeTestConfig(42), pool);
    const state2 = createGame(makeTestConfig(42), pool);
    const state3 = createGame(makeTestConfig(99), pool);

    // Same seed → same hand (by definition IDs)
    const hand1Defs = state1.players[0].hand.map(id => state1.instanceMap[id as string].definitionId);
    const hand2Defs = state2.players[0].hand.map(id => state2.instanceMap[id as string].definitionId);
    expect(hand1Defs).toEqual(hand2Defs);

    // Different seed → different hand (very likely with 35 cards)
    const hand3Defs = state3.players[0].hand.map(id => state3.instanceMap[id as string].definitionId);
    expect(hand3Defs).not.toEqual(hand1Defs);
  });

  it('renders initial state with formatGameState', () => {
    const state = createGame(makeTestConfig(), pool);
    const output = formatGameState(state);

    console.log(output);

    expect(output).toContain('Turn 1');
    expect(output).toContain('Aragorn II');
    expect(output).toContain('Bilbo');
    expect(output).toContain('Rivendell');
    expect(output).toContain('Legolas');
    expect(output).toContain('Gimli');
  });
});
