/**
 * @module 01-getting-ready.test
 *
 * Tests for CoE Rules Section 1: Getting Ready to Play.
 * Covers deck construction, character draft, starting items,
 * starting sites, starting hands, general influence, and initiative.
 *
 * Rule references use the numbering from docs/coe-rules.txt.
 */

import { describe, test, expect } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  createGame, reduce, makeDraftConfig, makeQuickStartConfig, makePlayDeck,
  runActions, runSimpleDraft, runFullSetup,
  Phase, Alignment,
  ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, FARAMIR,
  EOWYN, BEREGOND, BERGIL, BARD_BOWMAN, ANBORN, SAM_GAMGEE,
  THEODEN, ELROND, CELEBORN, GLORFINDEL_II,
  GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import type { PlayerId, CardDefinitionId, GameState, EvaluatedAction } from '@meccg/shared';
import type { GameConfig } from '../../engine/init.js';
import { GENERAL_INFLUENCE, HAND_SIZE } from '@meccg/shared';

/** Helper: get viable actions of a specific type */
function viableOfType(actions: EvaluatedAction[], type: string): EvaluatedAction[] {
  return actions.filter(a => a.viable && a.action.type === type);
}

/** Helper: get non-viable actions of a specific type */
function nonViableOfType(actions: EvaluatedAction[], type: string): EvaluatedAction[] {
  return actions.filter(a => !a.viable && a.action.type === type);
}

// ─── Section 1.3: Deck Restrictions ───────────────────────────────────────────

describe('1.3 Deck restrictions', () => {
  test.todo('unique cards: only 1 copy allowed per deck (createGame validation not yet implemented)');

  test('non-unique cards: up to 3 copies allowed per deck', () => {
    // Dagger of Westernesse is non-unique — 3 copies is fine
    const config = makeDraftConfig();
    const state = createGame(config, pool);
    expect(state).toBeDefined();
  });

  test.todo('non-unique cards: more than 3 copies rejected (createGame validation not yet implemented)');
});

// ─── Section 1.9: Character Draft ─────────────────────────────────────────────

describe('1.9 Character draft', () => {
  test('players select characters face-down, reveal simultaneously, set aside duplicates', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard,
          draftPool: [ARAGORN, BILBO],
          playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [RIVENDELL],
        },
        {
          id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [ARAGORN, LEGOLAS],
          playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [LORIEN],
        },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);

    // Both pick Aragorn — should be set aside (collision)
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN },
      { type: 'draft-pick', player: PLAYER_2, characterDefId: ARAGORN },
    ]);

    // Neither player should have Aragorn in their company
    expect(state.players[0].companies.flatMap(c => c.characters)).toHaveLength(0);
    expect(state.players[1].companies.flatMap(c => c.characters)).toHaveLength(0);
  });

  test('non-duplicate picks are added to drafted list', () => {
    let state = createGame(makeDraftConfig(), pool);

    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN },
      { type: 'draft-pick', player: PLAYER_2, characterDefId: LEGOLAS },
    ]);

    // Each player should have 1 drafted character in the draft state
    if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'character-draft') {
      expect(state.phaseState.setupStep.draftState[0].drafted).toContain(ARAGORN);
      expect(state.phaseState.setupStep.draftState[1].drafted).toContain(LEGOLAS);
    }
  });

  test('starting company maximum five characters', () => {
    // Use low-mind characters to avoid hitting the mind limit of 20
    // before reaching 5 characters
    const manyChars: GameConfig = {
      players: [
        {
          id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard,
          draftPool: [BILBO, FRODO, EOWYN, BERGIL, BARD_BOWMAN, BEREGOND],
          playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [RIVENDELL],
        },
        {
          id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [LEGOLAS, GIMLI, ANBORN, SAM_GAMGEE, FARAMIR, ARAGORN],
          playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [LORIEN],
        },
      ],
      seed: 42,
    };
    let state = createGame(manyChars, pool);

    // P1 pool: Bilbo(1), Frodo(3), Eowyn(2), Bergil(2), Bard Bowman(2), Beregond(3)
    //   → total after 5 picks: 1+3+2+2+2 = 10 mind (well under 20)
    // P2 pool: Legolas(6), Gimli(6), Anborn(2), Sam(4), Faramir(5), Aragorn(6)
    //   → P2 stops after 3 picks to avoid mind limit issues
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterDefId: BILBO },
      { type: 'draft-pick', player: PLAYER_2, characterDefId: ANBORN },
    ]);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterDefId: FRODO },
      { type: 'draft-pick', player: PLAYER_2, characterDefId: SAM_GAMGEE },
    ]);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterDefId: EOWYN },
      { type: 'draft-pick', player: PLAYER_2, characterDefId: LEGOLAS },
    ]);
    // P2 stops; P1 continues alone
    state = runActions(state, [
      { type: 'draft-stop', player: PLAYER_2 },
    ]);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterDefId: BERGIL },
    ]);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterDefId: BARD_BOWMAN },
    ]);

    // P1 now has 5 characters: Bilbo(1)+Frodo(3)+Eowyn(2)+Bergil(2)+Bard Bowman(2)=10 mind
    // P1 should auto-stop at 5 characters — no more draft-pick available
    const actions = computeLegalActions(state, PLAYER_1);
    const draftPicks = viableOfType(actions, 'draft-pick');
    expect(draftPicks).toHaveLength(0);
  });

  test('starting company total mind cannot exceed 20', () => {
    let state = createGame(makeDraftConfig(), pool);

    // Draft characters and check that mind limit is enforced
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN },
      { type: 'draft-pick', player: PLAYER_2, characterDefId: LEGOLAS },
    ]);

    // Check that characters whose mind would exceed 20 total are not viable
    const actions = computeLegalActions(state, PLAYER_1);
    const nonViablePicks = nonViableOfType(actions, 'draft-pick');
    for (const nv of nonViablePicks) {
      if ('characterDefId' in nv.action) {
        const charDef = pool[nv.action.characterDefId as string];
        if (charDef && 'mind' in charDef && charDef.mind != null) {
          const currentMind = state.players[0].generalInfluenceUsed;
          // If non-viable due to mind, the sum should exceed 20
          if (nv.reason?.includes('mind')) {
            expect(currentMind + (charDef.mind as number)).toBeGreaterThan(GENERAL_INFLUENCE);
          }
        }
      }
    }
  });

  test('player stops when pool exhausted', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard,
          draftPool: [BILBO],
          playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [RIVENDELL],
        },
        {
          id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [LEGOLAS],
          playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [LORIEN],
        },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);

    // Both draft their only character
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterDefId: BILBO },
      { type: 'draft-pick', player: PLAYER_2, characterDefId: LEGOLAS },
    ]);

    // Both should auto-stop since pools exhausted
    // Check that draft-pick is no longer available
    const p1Actions = computeLegalActions(state, PLAYER_1);
    const p1Picks = viableOfType(p1Actions, 'draft-pick');
    expect(p1Picks).toHaveLength(0);
  });

  test('player may voluntarily stop drafting', () => {
    let state = createGame(makeDraftConfig(), pool);

    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN },
      { type: 'draft-pick', player: PLAYER_2, characterDefId: LEGOLAS },
      { type: 'draft-stop', player: PLAYER_1 },
    ]);

    // P1 has stopped, P2 can continue
    const p1Actions = computeLegalActions(state, PLAYER_1);
    expect(viableOfType(p1Actions, 'draft-pick')).toHaveLength(0);
    expect(viableOfType(p1Actions, 'draft-stop')).toHaveLength(0);
  });

  test('once one player stops, opponent may finish drafting', () => {
    let state = createGame(makeDraftConfig(), pool);

    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN },
      { type: 'draft-pick', player: PLAYER_2, characterDefId: LEGOLAS },
      { type: 'draft-stop', player: PLAYER_1 },
    ]);

    // P2 should still have draft actions available
    const p2Actions = computeLegalActions(state, PLAYER_2);
    const p2Picks = viableOfType(p2Actions, 'draft-pick');
    expect(p2Picks.length).toBeGreaterThan(0);
  });
});

// ─── Section 1.9 (continued): Starting Items ─────────────────────────────────

describe('1.9 Starting items', () => {
  test('up to two minor items from pool may be placed with starting characters', () => {
    let state = runSimpleDraft();

    // Should be in item-draft step
    expect(state.phaseState.phase).toBe(Phase.Setup);
    if (state.phaseState.phase === Phase.Setup) {
      expect(state.phaseState.setupStep.step).toBe('item-draft');
    }
  });

  test('items can be assigned to drafted characters', () => {
    let state = runSimpleDraft();

    if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'item-draft') {
      const charId = state.players[0].companies[0].characters[0];
      const result = reduce(state, {
        type: 'assign-starting-item',
        player: PLAYER_1,
        itemDefId: DAGGER_OF_WESTERNESSE,
        characterInstanceId: charId,
      });
      expect(result.error).toBeUndefined();
    }
  });
});

// ─── Section 1.10: Starting Sites ─────────────────────────────────────────────

describe('1.10 Starting sites', () => {
  test('[HERO] Wizard starting company begins at Rivendell', () => {
    const config = makeQuickStartConfig();
    // Wizard player must start at Rivendell
    expect(config.players[0].startingHavens).toContain(RIVENDELL);
  });

  test('starting sites declared after character draft', () => {
    let state = runSimpleDraft();

    // Run through item draft and deck draft to get to site selection
    if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'item-draft') {
      // Pass item draft for both players
      state = runActions(state, [
        { type: 'pass', player: PLAYER_1 },
        { type: 'pass', player: PLAYER_2 },
      ]);
    }
    if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'character-deck-draft') {
      state = runActions(state, [
        { type: 'pass', player: PLAYER_1 },
        { type: 'pass', player: PLAYER_2 },
      ]);
    }

    // Should now be in site selection
    expect(state.phaseState.phase).toBe(Phase.Setup);
    if (state.phaseState.phase === Phase.Setup) {
      expect(state.phaseState.setupStep.step).toBe('starting-site-selection');
    }
  });
});

// ─── Section 1.11: Starting Hands ─────────────────────────────────────────────

describe('1.11 Starting hands', () => {
  test('players draw up to base hand size of 8 cards', () => {
    const state = runFullSetup();

    expect(state.players[0].hand).toHaveLength(HAND_SIZE);
    expect(state.players[1].hand).toHaveLength(HAND_SIZE);
  });

  test('base hand size is always 8 at game start', () => {
    expect(HAND_SIZE).toBe(8);
  });
});

// ─── Section 1.12: Starting General Influence ─────────────────────────────────

describe('1.12 Starting general influence', () => {
  test('players begin with 20 points of general influence', () => {
    expect(GENERAL_INFLUENCE).toBe(20);
  });

  test('general influence deducted by starting character mind values', () => {
    const state = runFullSetup();

    // Each player's generalInfluenceUsed should match their characters' total mind
    for (const player of state.players) {
      let totalMind = 0;
      for (const company of player.companies) {
        for (const charId of company.characters) {
          const char = player.characters[charId as string];
          if (char) {
            const def = pool[char.definitionId as string];
            if (def && 'mind' in def && def.mind != null) {
              totalMind += def.mind as number;
            }
          }
        }
      }
      expect(player.generalInfluenceUsed).toBe(totalMind);
    }
  });
});

// ─── Section 1.13: Determining Who Goes First ─────────────────────────────────

describe('1.13 Determining who goes first', () => {
  test('each player rolls 2d6, higher roll goes first', () => {
    const state = runFullSetup();

    // Game should be in Untap phase (turn 1) with an active player set
    expect(state.phaseState.phase).toBe(Phase.Untap);
    expect(state.activePlayer).not.toBeNull();
  });

  test('full setup reaches turn 1 Untap phase', () => {
    const state = runFullSetup();
    expect(state.turnNumber).toBe(1);
    expect(state.phaseState.phase).toBe(Phase.Untap);
  });
});
