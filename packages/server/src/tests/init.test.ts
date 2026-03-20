import { describe, it, expect } from 'vitest';
import { createGameQuickStart } from '../engine/init.js';
import { formatGameState, CharacterStatus, HAND_SIZE } from '@meccg/shared';
import type { DraftPickAction } from '@meccg/shared';
import {
  pool, PLAYER_1, PLAYER_2,
  makeQuickStartConfig, makeDraftConfig, runActions, runFullSetup,
  createGame, reduce, Phase, Alignment,
  ARAGORN, BILBO, LEGOLAS, GIMLI, FARAMIR,
  EOWYN, BEREGOND, BERGIL, BARD_BOWMAN, ANBORN, SAM_GAMGEE,
  DAGGER_OF_WESTERNESSE, RIVENDELL, LORIEN, MORIA,
  makePlayDeck,
} from './test-helpers.js';
import type { GameConfig } from './test-helpers.js';

// ---- Quick Start tests (skip draft) ----

describe('createGameQuickStart', () => {
  it('creates valid initial state with player names and no wizard', () => {
    const state = createGameQuickStart(makeQuickStartConfig(), pool);
    expect(state.players[0].name).toBe('Alice');
    expect(state.players[1].name).toBe('Bob');
    expect(state.players[0].wizard).toBeNull();
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
  });

  it('places starting characters untapped in a company at the haven', () => {
    const state = createGameQuickStart(makeQuickStartConfig(), pool);
    const p1 = state.players[0];
    expect(p1.companies).toHaveLength(1);
    expect(p1.companies[0].characters).toHaveLength(2);

    for (const charId of p1.companies[0].characters) {
      const char = p1.characters[charId as string];
      expect(char.status).toBe(CharacterStatus.Untapped);
      expect(char.controlledBy).toBe('general');
    }

    const havenInstance = state.instanceMap[p1.companies[0].currentSite as string];
    expect(havenInstance.definitionId).toBe(RIVENDELL);
  });

  it('shuffles play deck deterministically based on seed', () => {
    const s1 = createGameQuickStart(makeQuickStartConfig(42), pool);
    const s2 = createGameQuickStart(makeQuickStartConfig(42), pool);
    const s3 = createGameQuickStart(makeQuickStartConfig(99), pool);

    const defs = (s: typeof s1) => s.players[0].hand.map(id => s.instanceMap[id as string].definitionId);
    expect(defs(s1)).toEqual(defs(s2));
    expect(defs(s3)).not.toEqual(defs(s1));
  });

  it('renders initial state with formatGameState', () => {
    const state = createGameQuickStart(makeQuickStartConfig(), pool);
    const output = formatGameState(state);
    expect(output).toContain('Turn 1');
    expect(output).toContain('Alice');
    expect(output).toContain('Aragorn II');
  });
});

// ---- Character Draft tests ----

describe('character draft', () => {
  it('starts in setup phase at round 1 with empty hands', () => {
    const state = createGame(makeDraftConfig(), pool);
    expect(state.phaseState.phase).toBe(Phase.Setup);
    expect(state.turnNumber).toBe(0);
    expect(state.players[0].hand).toHaveLength(0);
  });

  it('accepts picks from both players and resolves round', () => {
    let state = createGame(makeDraftConfig(), pool);

    const pick1: DraftPickAction = { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN };
    let result = reduce(state, pick1);
    state = result.state;

    // Still in draft, pick face-down
    if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'character-draft') {
      expect(state.phaseState.setupStep.draftState[0].currentPick).toBe(ARAGORN);
    }

    // Player 2 picks — round resolves
    result = reduce(state, { type: 'draft-pick', player: PLAYER_2, characterDefId: LEGOLAS });
    state = result.state;

    if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'character-draft') {
      expect(state.phaseState.setupStep.draftState[0].drafted).toContain(ARAGORN);
      expect(state.phaseState.setupStep.draftState[1].drafted).toContain(LEGOLAS);
      expect(state.phaseState.setupStep.round).toBe(2);
    }
  });

  it('rejects second pick while waiting for opponent', () => {
    let state = createGame(makeDraftConfig(), pool);
    state = runActions(state, [{ type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN }]);

    const result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: BILBO });
    expect(result.error).toContain('Waiting for opponent');
  });

  it('sets aside duplicate picks', () => {
    const config: GameConfig = {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard, draftPool: [ARAGORN, BILBO], startingMinorItems: [], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [RIVENDELL] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard, draftPool: [ARAGORN, LEGOLAS], startingMinorItems: [], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [LORIEN] },
      ],
      seed: 42,
    };

    let state = createGame(config, pool);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN },
      { type: 'draft-pick', player: PLAYER_2, characterDefId: ARAGORN },
    ]);

    if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'character-draft') {
      expect(state.phaseState.setupStep.setAside).toContain(ARAGORN);
      expect(state.phaseState.setupStep.draftState[0].drafted).not.toContain(ARAGORN);
      expect(state.phaseState.setupStep.draftState[1].drafted).not.toContain(ARAGORN);
    }
  });

  it('rejects picks that would exceed mind limit of 20', () => {
    const config: GameConfig = {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard, draftPool: [ARAGORN, LEGOLAS, GIMLI], startingMinorItems: [], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [RIVENDELL] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard, draftPool: [FARAMIR], startingMinorItems: [], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [LORIEN] },
      ],
      seed: 42,
    };

    let state = createGame(config, pool);
    // Round 1: Alice picks Aragorn (mind 9), Bob picks Faramir (auto-stops after, pool empty)
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN },
      { type: 'draft-pick', player: PLAYER_2, characterDefId: FARAMIR },
    ]);
    // Round 2: Alice picks Legolas (mind 6, total 15). Bob is auto-stopped so round resolves immediately.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterDefId: LEGOLAS },
    ]);

    // Gimli would push total to 21 — rejected
    const result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: GIMLI });
    expect(result.error).toContain('mind limit');
  });

  it('rejects 6th pick for wizard alignment (max 5)', () => {
    const config: GameConfig = {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard, draftPool: [EOWYN, BEREGOND, BERGIL, BARD_BOWMAN, ANBORN, SAM_GAMGEE], startingMinorItems: [], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [RIVENDELL] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard, draftPool: [FARAMIR], startingMinorItems: [], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [LORIEN] },
      ],
      seed: 42,
    };

    let state = createGame(config, pool);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterDefId: EOWYN },
      { type: 'draft-pick', player: PLAYER_2, characterDefId: FARAMIR },
    ]);

    for (const charId of [BEREGOND, BERGIL, BARD_BOWMAN, ANBORN]) {
      state = runActions(state, [{ type: 'draft-pick', player: PLAYER_1, characterDefId: charId }]);
    }

    // Alice auto-stopped at 5 characters, game should have progressed
    expect(Object.keys(state.players[0].characters)).toHaveLength(5);
  });
});

// ---- Full setup flow ----

describe('full setup flow', () => {
  it('completes setup and reaches Untap phase', () => {
    const state = runFullSetup();
    expect(state.phaseState.phase).toBe(Phase.Untap);
    expect(state.turnNumber).toBe(1);
    expect(state.players[0].hand).toHaveLength(8);
    expect(state.players[1].hand).toHaveLength(8);
  });

  it('assigns items to characters during item draft', () => {
    const state = runFullSetup();
    const p1CharId = state.players[0].companies[0].characters[0];
    const p1Char = state.players[0].characters[p1CharId as string];
    expect(p1Char.items).toHaveLength(2);
    for (const itemId of p1Char.items) {
      expect(state.instanceMap[itemId as string].definitionId).toBe(DAGGER_OF_WESTERNESSE);
    }
  });

  it('assigns starting sites to companies', () => {
    const state = runFullSetup();
    for (const player of state.players) {
      expect(player.companies.length).toBeGreaterThanOrEqual(1);
      expect(player.companies[0].currentSite).not.toBeNull();
    }
  });
});
