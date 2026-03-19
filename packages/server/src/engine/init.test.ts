import { describe, it, expect } from 'vitest';
import { createGame, createGameQuickStart } from './init.js';
import type { GameConfig, QuickStartGameConfig } from './init.js';
import { reduce } from './reducer.js';
import {
  loadCardPool,
  formatGameState,
  Phase,
  CharacterStatus,
  HAND_SIZE,
} from '@meccg/shared';
import type { PlayerId, CardDefinitionId, DraftPickAction, DraftStopAction } from '@meccg/shared';

const pid = (s: string) => s as PlayerId;
const did = (s: string) => s as CardDefinitionId;

const pool = loadCardPool();

function makePlayDeck(): CardDefinitionId[] {
  const resourceIds = [did('tw-244'), did('tw-333'), did('tw-345'), did('tw-347')];
  const hazardIds = [did('tw-020'), did('tw-074'), did('tw-015')];
  const playDeck: CardDefinitionId[] = [];
  for (let i = 0; i < 5; i++) {
    playDeck.push(...resourceIds, ...hazardIds);
  }
  return playDeck;
}

function makeQuickStartConfig(seed = 42): QuickStartGameConfig {
  return {
    players: [
      {
        id: pid('p1'),
        name: 'Alice',
        startingCharacters: [did('tw-120'), did('tw-131')], // Aragorn II, Bilbo
        playDeck: makePlayDeck(),
        siteDeck: [did('tw-413'), did('tw-412'), did('tw-414')],
        startingHaven: did('tw-421'), // Rivendell
      },
      {
        id: pid('p2'),
        name: 'Bob',
        startingCharacters: [did('tw-168'), did('tw-159')], // Legolas, Gimli
        playDeck: makePlayDeck(),
        siteDeck: [did('tw-413'), did('tw-412')],
        startingHaven: did('tw-408'), // Lórien
      },
    ],
    seed,
  };
}

function makeDraftConfig(seed = 42): GameConfig {
  return {
    players: [
      {
        id: pid('p1'),
        name: 'Alice',
        draftPool: [did('tw-120'), did('tw-131'), did('tw-152')], // Aragorn, Bilbo, Frodo
        playDeck: makePlayDeck(),
        siteDeck: [did('tw-413'), did('tw-412'), did('tw-414')],
        startingHaven: did('tw-421'),
      },
      {
        id: pid('p2'),
        name: 'Bob',
        draftPool: [did('tw-168'), did('tw-159'), did('tw-149')], // Legolas, Gimli, Faramir
        playDeck: makePlayDeck(),
        siteDeck: [did('tw-413'), did('tw-412')],
        startingHaven: did('tw-408'),
      },
    ],
    seed,
  };
}

// ---- Quick Start tests (skip draft) ----

describe('createGameQuickStart', () => {
  it('creates valid initial state with player names and no wizard', () => {
    const state = createGameQuickStart(makeQuickStartConfig(), pool);

    expect(state.players[0].name).toBe('Alice');
    expect(state.players[1].name).toBe('Bob');
    expect(state.players[0].wizard).toBeNull();
    expect(state.players[1].wizard).toBeNull();
  });

  it('starts at turn 1 in untap phase with player 1 active', () => {
    const state = createGameQuickStart(makeQuickStartConfig(), pool);

    expect(state.turnNumber).toBe(1);
    expect(state.phaseState.phase).toBe(Phase.Untap);
    expect(state.activePlayer).toBe('p1');
  });

  it('deals HAND_SIZE cards to each player', () => {
    const state = createGameQuickStart(makeQuickStartConfig(), pool);

    expect(state.players[0].hand).toHaveLength(HAND_SIZE);
    expect(state.players[1].hand).toHaveLength(HAND_SIZE);
    expect(state.players[0].playDeck.length + HAND_SIZE).toBe(35);
  });

  it('places starting characters untapped in a company at the haven', () => {
    const state = createGameQuickStart(makeQuickStartConfig(), pool);
    const p1 = state.players[0];

    expect(p1.companies).toHaveLength(1);
    const company = p1.companies[0];
    expect(company.characters).toHaveLength(2);

    for (const charId of company.characters) {
      const char = p1.characters[charId as string];
      expect(char).toBeDefined();
      expect(char.status).toBe(CharacterStatus.Untapped);
      expect(char.controlledBy).toBe('general');
    }

    const havenInstance = state.instanceMap[company.currentSite as string];
    expect(havenInstance.definitionId).toBe('tw-421');
  });

  it('calculates general influence used from starting characters', () => {
    const state = createGameQuickStart(makeQuickStartConfig(), pool);

    expect(state.players[0].generalInfluenceUsed).toBe(14); // Aragorn 9 + Bilbo 5
    expect(state.players[1].generalInfluenceUsed).toBe(12); // Legolas 6 + Gimli 6
  });

  it('shuffles play deck deterministically based on seed', () => {
    const state1 = createGameQuickStart(makeQuickStartConfig(42), pool);
    const state2 = createGameQuickStart(makeQuickStartConfig(42), pool);
    const state3 = createGameQuickStart(makeQuickStartConfig(99), pool);

    const hand1Defs = state1.players[0].hand.map(id => state1.instanceMap[id as string].definitionId);
    const hand2Defs = state2.players[0].hand.map(id => state2.instanceMap[id as string].definitionId);
    expect(hand1Defs).toEqual(hand2Defs);

    const hand3Defs = state3.players[0].hand.map(id => state3.instanceMap[id as string].definitionId);
    expect(hand3Defs).not.toEqual(hand1Defs);
  });

  it('renders initial state with formatGameState', () => {
    const state = createGameQuickStart(makeQuickStartConfig(), pool);
    const output = formatGameState(state);

    console.log(output);

    expect(output).toContain('Turn 1');
    expect(output).toContain('Alice');
    expect(output).toContain('Aragorn II');
    expect(output).toContain('Rivendell');
  });
});

// ---- Character Draft tests ----

describe('character draft', () => {
  it('starts in character-draft phase at round 1', () => {
    const state = createGame(makeDraftConfig(), pool);

    expect(state.phaseState.phase).toBe(Phase.CharacterDraft);
    expect(state.turnNumber).toBe(0);
    expect(state.players[0].companies).toHaveLength(0);
    expect(state.players[1].companies).toHaveLength(0);
  });

  it('accepts picks from both players and resolves round', () => {
    let state = createGame(makeDraftConfig(), pool);

    // Player 1 picks Aragorn
    const pick1: DraftPickAction = { type: 'draft-pick', player: pid('p1'), characterDefId: did('tw-120') };
    let result = reduce(state, pick1);
    expect(result.error).toBeUndefined();
    state = result.state;

    // Still in draft, waiting for player 2
    expect(state.phaseState.phase).toBe(Phase.CharacterDraft);

    // Player 2 picks Legolas
    const pick2: DraftPickAction = { type: 'draft-pick', player: pid('p2'), characterDefId: did('tw-168') };
    result = reduce(state, pick2);
    expect(result.error).toBeUndefined();
    state = result.state;

    // Round resolved, different picks so both get their character
    if (state.phaseState.phase === Phase.CharacterDraft) {
      expect(state.phaseState.draftState[0].drafted).toContain(did('tw-120'));
      expect(state.phaseState.draftState[1].drafted).toContain(did('tw-168'));
      expect(state.phaseState.round).toBe(2);
    }
  });

  it('sets aside duplicate picks', () => {
    // Both players have Aragorn in their pool
    const config: GameConfig = {
      players: [
        {
          id: pid('p1'), name: 'Alice',
          draftPool: [did('tw-120'), did('tw-131')],
          playDeck: makePlayDeck(),
          siteDeck: [did('tw-413')],
          startingHaven: did('tw-421'),
        },
        {
          id: pid('p2'), name: 'Bob',
          draftPool: [did('tw-120'), did('tw-168')],
          playDeck: makePlayDeck(),
          siteDeck: [did('tw-413')],
          startingHaven: did('tw-408'),
        },
      ],
      seed: 42,
    };

    let state = createGame(config, pool);

    // Both pick Aragorn
    let result = reduce(state, { type: 'draft-pick', player: pid('p1'), characterDefId: did('tw-120') });
    state = result.state;
    result = reduce(state, { type: 'draft-pick', player: pid('p2'), characterDefId: did('tw-120') });
    state = result.state;

    if (state.phaseState.phase === Phase.CharacterDraft) {
      expect(state.phaseState.draftState[0].drafted).not.toContain(did('tw-120'));
      expect(state.phaseState.draftState[1].drafted).not.toContain(did('tw-120'));
      expect(state.phaseState.setAside).toContain(did('tw-120'));
    }
  });

  it('transitions to untap phase when both players stop', () => {
    let state = createGame(makeDraftConfig(), pool);

    // Both pick one character each
    let result = reduce(state, { type: 'draft-pick', player: pid('p1'), characterDefId: did('tw-120') });
    state = result.state;
    result = reduce(state, { type: 'draft-pick', player: pid('p2'), characterDefId: did('tw-168') });
    state = result.state;

    // Both stop
    result = reduce(state, { type: 'draft-stop', player: pid('p1') });
    state = result.state;
    result = reduce(state, { type: 'draft-stop', player: pid('p2') });
    state = result.state;

    expect(state.phaseState.phase).toBe(Phase.Untap);
    expect(state.turnNumber).toBe(1);

    // Characters should be placed at havens
    expect(state.players[0].companies).toHaveLength(1);
    expect(state.players[1].companies).toHaveLength(1);

    console.log(formatGameState(state));
  });

  it('rejects picks that would exceed mind limit of 20', () => {
    // Aragorn has mind 9 — two of those would be 18, third would depend
    const config: GameConfig = {
      players: [
        {
          id: pid('p1'), name: 'Alice',
          draftPool: [did('tw-120'), did('tw-168'), did('tw-159')], // Aragorn(9) + Legolas(6) + Gimli(6) = 21
          playDeck: makePlayDeck(),
          siteDeck: [did('tw-413')],
          startingHaven: did('tw-421'),
        },
        {
          id: pid('p2'), name: 'Bob',
          draftPool: [did('tw-149')],
          playDeck: makePlayDeck(),
          siteDeck: [did('tw-413')],
          startingHaven: did('tw-408'),
        },
      ],
      seed: 42,
    };

    let state = createGame(config, pool);

    // Pick Aragorn (mind 9) — OK
    let result = reduce(state, { type: 'draft-pick', player: pid('p1'), characterDefId: did('tw-120') });
    state = result.state;
    result = reduce(state, { type: 'draft-pick', player: pid('p2'), characterDefId: did('tw-149') });
    state = result.state;

    // Pick Legolas (mind 6, total 15) — OK
    result = reduce(state, { type: 'draft-pick', player: pid('p1'), characterDefId: did('tw-168') });
    expect(result.error).toBeUndefined();
    state = result.state;
    result = reduce(state, { type: 'draft-stop', player: pid('p2') });
    state = result.state;

    // Pick Gimli (mind 6, total 21) — should be rejected
    result = reduce(state, { type: 'draft-pick', player: pid('p1'), characterDefId: did('tw-159') });
    expect(result.error).toContain('mind limit');
  });
});
