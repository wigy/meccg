import { describe, it, expect } from 'vitest';
import { createGame, createGameQuickStart } from './init.js';
import type { GameConfig, QuickStartGameConfig } from './init.js';
import { reduce } from './reducer.js';
import {
  loadCardPool,
  formatGameState,
  Phase,
  CharacterStatus,
  Alignment,
  HAND_SIZE,
} from '@meccg/shared';
import type { DraftPickAction } from '@meccg/shared';
import type { PlayerId } from '@meccg/shared';
import {
  ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, FARAMIR,
  EOWYN, BEREGOND, BERGIL, BARD_BOWMAN, ANBORN, SAM_GAMGEE,
  GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING, DAGGER_OF_WESTERNESSE,
  CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM,
} from '@meccg/shared';

const PLAYER_1 = 'p1' as PlayerId;
const PLAYER_2 = 'p2' as PlayerId;

const pool = loadCardPool();

function makePlayDeck() {
  const resources = [GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING];
  const hazards = [CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT];
  const deck = [];
  for (let i = 0; i < 5; i++) {
    deck.push(...resources, ...hazards);
  }
  return deck;
}

function makeQuickStartConfig(seed = 42): QuickStartGameConfig {
  return {
    players: [
      {
        id: PLAYER_1,
        name: 'Alice',
        alignment: Alignment.Wizard,
        startingCharacters: [ARAGORN, BILBO],
        playDeck: makePlayDeck(),
        siteDeck: [MORIA, MINAS_TIRITH, MOUNT_DOOM],
        startingHavens: [RIVENDELL],
      },
      {
        id: PLAYER_2,
        name: 'Bob',
        alignment: Alignment.Wizard,
        startingCharacters: [LEGOLAS, GIMLI],
        playDeck: makePlayDeck(),
        siteDeck: [MORIA, MINAS_TIRITH],
        startingHavens: [LORIEN],
      },
    ],
    seed,
  };
}

function makeDraftConfig(seed = 42): GameConfig {
  return {
    players: [
      {
        id: PLAYER_1,
        name: 'Alice',
        alignment: Alignment.Wizard,
        draftPool: [ARAGORN, BILBO, FRODO],
        startingMinorItems: [DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE],
        playDeck: makePlayDeck(),
        siteDeck: [MORIA, MINAS_TIRITH, MOUNT_DOOM],
        startingHavens: [RIVENDELL],
      },
      {
        id: PLAYER_2,
        name: 'Bob',
        alignment: Alignment.Wizard,
        draftPool: [LEGOLAS, GIMLI, FARAMIR],
        startingMinorItems: [DAGGER_OF_WESTERNESSE],
        playDeck: makePlayDeck(),
        siteDeck: [MORIA, MINAS_TIRITH],
        startingHavens: [LORIEN],
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
    expect(state.activePlayer).toBe(PLAYER_1);
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
    expect(havenInstance.definitionId).toBe(RIVENDELL);
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
    expect(state.players[0].hand).toHaveLength(0);
    expect(state.players[1].hand).toHaveLength(0);
    expect(state.players[0].companies).toHaveLength(0);
    expect(state.players[1].companies).toHaveLength(0);
  });

  it('accepts picks from both players and resolves round', () => {
    let state = createGame(makeDraftConfig(), pool);

    // Player 1 picks — not yet revealed
    const pick1: DraftPickAction = { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN };
    let result = reduce(state, pick1);
    expect(result.error).toBeUndefined();
    state = result.state;

    // Still in draft, pick is face-down, not yet in drafted
    expect(state.phaseState.phase).toBe(Phase.CharacterDraft);
    if (state.phaseState.phase === Phase.CharacterDraft) {
      expect(state.phaseState.draftState[0].currentPick).toBe(ARAGORN);
      expect(state.phaseState.draftState[0].drafted).not.toContain(ARAGORN);
    }

    // Player 2 picks — both revealed, round resolves
    const pick2: DraftPickAction = { type: 'draft-pick', player: PLAYER_2, characterDefId: LEGOLAS };
    result = reduce(state, pick2);
    expect(result.error).toBeUndefined();
    state = result.state;

    // Different picks: both succeed, picks cleared, round advances
    if (state.phaseState.phase === Phase.CharacterDraft) {
      expect(state.phaseState.draftState[0].drafted).toContain(ARAGORN);
      expect(state.phaseState.draftState[1].drafted).toContain(LEGOLAS);
      expect(state.phaseState.draftState[0].currentPick).toBeNull();
      expect(state.phaseState.draftState[1].currentPick).toBeNull();
      expect(state.phaseState.round).toBe(2);
    }
  });

  it('rejects second pick while waiting for opponent', () => {
    let state = createGame(makeDraftConfig(), pool);

    // Player 1 picks Aragorn
    let result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN });
    expect(result.error).toBeUndefined();
    state = result.state;

    // Player 1 tries to pick again — rejected, waiting for opponent
    result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: BILBO });
    expect(result.error).toContain('Waiting for opponent');
  });

  it('sets aside duplicate picks', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard,
          draftPool: [ARAGORN, BILBO],
          startingMinorItems: [],
          playDeck: makePlayDeck(),
          siteDeck: [MORIA],
          startingHavens: [RIVENDELL],
        },
        {
          id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [ARAGORN, LEGOLAS],
          startingMinorItems: [],
          playDeck: makePlayDeck(),
          siteDeck: [MORIA],
          startingHavens: [LORIEN],
        },
      ],
      seed: 42,
    };

    let state = createGame(config, pool);

    // Both pick Aragorn face-down
    let result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN });
    expect(result.error).toBeUndefined();
    state = result.state;

    result = reduce(state, { type: 'draft-pick', player: PLAYER_2, characterDefId: ARAGORN });
    expect(result.error).toBeUndefined();
    state = result.state;

    // Reveal: collision — Aragorn set aside, neither player gets him
    if (state.phaseState.phase === Phase.CharacterDraft) {
      expect(state.phaseState.draftState[0].drafted).not.toContain(ARAGORN);
      expect(state.phaseState.draftState[1].drafted).not.toContain(ARAGORN);
      expect(state.phaseState.draftState[0].currentPick).toBeNull();
      expect(state.phaseState.draftState[1].currentPick).toBeNull();
      expect(state.phaseState.setAside).toContain(ARAGORN);
      // Aragorn also removed from both pools
      expect(state.phaseState.draftState[0].pool).not.toContain(ARAGORN);
      expect(state.phaseState.draftState[1].pool).not.toContain(ARAGORN);
    }
  });

  it('transitions to item-draft phase when both players stop and have items', () => {
    let state = createGame(makeDraftConfig(), pool);

    let result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN });
    state = result.state;
    result = reduce(state, { type: 'draft-pick', player: PLAYER_2, characterDefId: LEGOLAS });
    state = result.state;

    result = reduce(state, { type: 'draft-stop', player: PLAYER_1 });
    state = result.state;
    result = reduce(state, { type: 'draft-stop', player: PLAYER_2 });
    state = result.state;

    // Both players have starting items, so we're in item-draft
    expect(state.phaseState.phase).toBe(Phase.ItemDraft);
    expect(state.players[0].companies).toHaveLength(1);
    expect(state.players[1].companies).toHaveLength(1);
  });

  it('assigns starting minor items to characters during item draft', () => {
    let state = createGame(makeDraftConfig(), pool);

    let result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN });
    state = result.state;
    result = reduce(state, { type: 'draft-pick', player: PLAYER_2, characterDefId: LEGOLAS });
    state = result.state;

    result = reduce(state, { type: 'draft-stop', player: PLAYER_1 });
    state = result.state;
    result = reduce(state, { type: 'draft-stop', player: PLAYER_2 });
    state = result.state;

    expect(state.phaseState.phase).toBe(Phase.ItemDraft);

    // Get character and item instance IDs
    const p1Char = state.players[0].companies[0].characters[0];
    const p2Char = state.players[1].companies[0].characters[0];

    if (state.phaseState.phase !== Phase.ItemDraft) throw new Error('wrong phase');
    const p1Items = state.phaseState.itemDraftState[0].unassignedItems;
    const p2Items = state.phaseState.itemDraftState[1].unassignedItems;

    expect(p1Items).toHaveLength(2); // Alice has 2 daggers
    expect(p2Items).toHaveLength(1); // Bob has 1 dagger

    // Alice assigns both daggers to Aragorn
    result = reduce(state, { type: 'assign-starting-item', player: PLAYER_1, itemInstanceId: p1Items[0], characterInstanceId: p1Char });
    expect(result.error).toBeUndefined();
    state = result.state;

    result = reduce(state, { type: 'assign-starting-item', player: PLAYER_1, itemInstanceId: p1Items[1], characterInstanceId: p1Char });
    expect(result.error).toBeUndefined();
    state = result.state;

    // Bob assigns his dagger to Legolas
    result = reduce(state, { type: 'assign-starting-item', player: PLAYER_2, itemInstanceId: p2Items[0], characterInstanceId: p2Char });
    expect(result.error).toBeUndefined();
    state = result.state;

    // All items assigned → transitions to Untap
    expect(state.phaseState.phase).toBe(Phase.Untap);
    expect(state.turnNumber).toBe(1);

    // Verify items are on the characters
    const p1CharState = state.players[0].characters[p1Char as string];
    expect(p1CharState.items).toHaveLength(2);
    for (const itemId of p1CharState.items) {
      expect(state.instanceMap[itemId as string].definitionId).toBe(DAGGER_OF_WESTERNESSE);
    }

    const p2CharState = state.players[1].characters[p2Char as string];
    expect(p2CharState.items).toHaveLength(1);

    console.log(formatGameState(state));
  });

  it('rejects picks that would exceed mind limit of 20', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard,
          draftPool: [ARAGORN, LEGOLAS, GIMLI], // 9 + 6 + 6 = 21
          startingMinorItems: [],
          playDeck: makePlayDeck(),
          siteDeck: [MORIA],
          startingHavens: [RIVENDELL],
        },
        {
          id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [FARAMIR],
          startingMinorItems: [],
          playDeck: makePlayDeck(),
          siteDeck: [MORIA],
          startingHavens: [LORIEN],
        },
      ],
      seed: 42,
    };

    let state = createGame(config, pool);

    // Pick Aragorn (mind 9) — OK
    let result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN });
    state = result.state;
    result = reduce(state, { type: 'draft-pick', player: PLAYER_2, characterDefId: FARAMIR });
    state = result.state;

    // Pick Legolas (mind 6, total 15) — OK
    result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: LEGOLAS });
    expect(result.error).toBeUndefined();
    state = result.state;
    result = reduce(state, { type: 'draft-stop', player: PLAYER_2 });
    state = result.state;

    // Pick Gimli (mind 6, total 21) — rejected
    result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: GIMLI });
    expect(result.error).toContain('mind limit');
  });

  it('rejects 6th pick for hero alignment (max 5 characters)', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard,
          // 6 low-mind characters (all mind 2) — total mind 12, well under 20
          draftPool: [EOWYN, BEREGOND, BERGIL, BARD_BOWMAN, ANBORN, SAM_GAMGEE],
          startingMinorItems: [],
          playDeck: makePlayDeck(),
          siteDeck: [MORIA],
          startingHavens: [RIVENDELL],
        },
        {
          id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [FARAMIR],
          startingMinorItems: [],
          playDeck: makePlayDeck(),
          siteDeck: [MORIA],
          startingHavens: [LORIEN],
        },
      ],
      seed: 42,
    };

    let state = createGame(config, pool);

    // Round 1: both pick
    let result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: EOWYN });
    expect(result.error).toBeUndefined();
    state = result.state;
    result = reduce(state, { type: 'draft-pick', player: PLAYER_2, characterDefId: FARAMIR });
    expect(result.error).toBeUndefined();
    state = result.state;

    // Bob has exhausted his pool — auto-stopped. Alice picks 4 more.
    const remaining = [BEREGOND, BERGIL, BARD_BOWMAN, ANBORN];
    for (const charId of remaining) {
      result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: charId });
      expect(result.error).toBeUndefined();
      state = result.state;
    }

    // Alice now has 5 characters (mind 2 each = 10 total, well under 20)
    // But hero max is 5, so she should be auto-stopped after the 5th pick.
    // Both players stopped → draft ends, game transitions to untap.
    expect(state.phaseState.phase).toBe(Phase.Untap);

    // Verify Alice has exactly 5 characters in play
    const p1 = state.players[0];
    const allCharIds = p1.companies.flatMap(c => c.characters);
    expect(allCharIds).toHaveLength(5);

    // Attempting a 6th draft-pick is rejected (wrong phase now)
    result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: SAM_GAMGEE });
    expect(result.error).toBeDefined();
  });
});
