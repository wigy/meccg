import { describe, it, expect } from 'vitest';
import { computeLegalActions } from './legal-actions/index.js';
import { createGame, createGameQuickStart } from './init.js';
import type { GameConfig, QuickStartGameConfig } from './init.js';
import { reduce } from './reducer.js';
import { loadCardPool, Phase, HAND_SIZE } from '@meccg/shared';
import type { PlayerId, CardDefinitionId, GameAction } from '@meccg/shared';
import {
  ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, FARAMIR,
  GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING, DAGGER_OF_WESTERNESSE,
  CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM,
} from '@meccg/shared';

const pool = loadCardPool();
const PLAYER_1 = 'p1' as PlayerId;
const PLAYER_2 = 'p2' as PlayerId;

function makePlayDeck() {
  const resources = [GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING];
  const hazards = [CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT];
  const deck: CardDefinitionId[] = [];
  for (let i = 0; i < 5; i++) {
    deck.push(...resources, ...hazards);
  }
  return deck;
}

function makeDraftConfig(seed = 42): GameConfig {
  return {
    players: [
      {
        id: PLAYER_1, name: 'Alice',
        draftPool: [ARAGORN, BILBO, FRODO],
        startingMinorItems: [DAGGER_OF_WESTERNESSE],
        playDeck: makePlayDeck(),
        siteDeck: [MORIA, MINAS_TIRITH, MOUNT_DOOM],
        startingHavens: [RIVENDELL],
      },
      {
        id: PLAYER_2, name: 'Bob',
        draftPool: [LEGOLAS, GIMLI, FARAMIR],
        startingMinorItems: [],
        playDeck: makePlayDeck(),
        siteDeck: [MORIA, MINAS_TIRITH],
        startingHavens: [LORIEN],
      },
    ],
    seed,
  };
}

describe('computeLegalActions', () => {
  describe('character draft', () => {
    it('returns draft-pick for each pool character plus draft-stop', () => {
      const state = createGame(makeDraftConfig(), pool);
      const actions = computeLegalActions(state, PLAYER_1);

      // Alice has 3 characters in pool: Aragorn, Bilbo, Frodo
      const picks = actions.filter(a => a.type === 'draft-pick');
      expect(picks).toHaveLength(3);

      const pickDefIds = picks.map(a => a.type === 'draft-pick' ? a.characterDefId : null);
      expect(pickDefIds).toContain(ARAGORN);
      expect(pickDefIds).toContain(BILBO);
      expect(pickDefIds).toContain(FRODO);

      // Plus draft-stop
      expect(actions.find(a => a.type === 'draft-stop')).toBeDefined();
    });

    it('returns empty when player has already picked (waiting for opponent)', () => {
      let state = createGame(makeDraftConfig(), pool);

      // Alice picks Aragorn
      const result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN });
      state = result.state;

      // Alice should have no actions — waiting for Bob
      const actions = computeLegalActions(state, PLAYER_1);
      expect(actions).toHaveLength(0);

      // Bob should still have his picks
      const bobActions = computeLegalActions(state, PLAYER_2);
      expect(bobActions.filter(a => a.type === 'draft-pick')).toHaveLength(3);
    });

    it('returns empty when player has stopped', () => {
      let state = createGame(makeDraftConfig(), pool);

      const result = reduce(state, { type: 'draft-stop', player: PLAYER_1 });
      state = result.state;

      const actions = computeLegalActions(state, PLAYER_1);
      expect(actions).toHaveLength(0);
    });

    it('excludes characters already drafted by the opponent', () => {
      // Both players have Aragorn. Bob drafts Aragorn first.
      const config: GameConfig = {
        players: [
          {
            id: PLAYER_1, name: 'Alice',
            draftPool: [ARAGORN, BILBO],
            startingMinorItems: [],
            playDeck: makePlayDeck(),
            siteDeck: [MORIA],
            startingHavens: [RIVENDELL],
          },
          {
            id: PLAYER_2, name: 'Bob',
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

      // Alice picks Bilbo, Bob picks Aragorn — no collision, both succeed
      let result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: BILBO });
      state = result.state;
      result = reduce(state, { type: 'draft-pick', player: PLAYER_2, characterDefId: ARAGORN });
      state = result.state;

      // Now Alice still has Aragorn in her pool, but Bob already drafted him
      // Aragorn should NOT appear in Alice's legal actions
      const actions = computeLegalActions(state, PLAYER_1);
      const pickDefIds = actions
        .filter((a): a is GameAction & { type: 'draft-pick' } => a.type === 'draft-pick')
        .map(a => a.characterDefId);

      expect(pickDefIds).not.toContain(ARAGORN);
      // draft-stop should still be available
      expect(actions.find(a => a.type === 'draft-stop')).toBeDefined();
    });

    it('excludes characters that would exceed mind limit of 20', () => {
      // Aragorn has mind 9 — after drafting him + Legolas (6), total is 15
      // Next pick: Gimli (6) would make 21 — should be excluded
      const config: GameConfig = {
        players: [
          {
            id: PLAYER_1, name: 'Alice',
            draftPool: [ARAGORN, LEGOLAS, GIMLI, BILBO],
            startingMinorItems: [],
            playDeck: makePlayDeck(),
            siteDeck: [MORIA],
            startingHavens: [RIVENDELL],
          },
          {
            id: PLAYER_2, name: 'Bob',
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

      // Draft Aragorn (mind 9) for Alice, Faramir for Bob
      let result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN });
      state = result.state;
      result = reduce(state, { type: 'draft-pick', player: PLAYER_2, characterDefId: FARAMIR });
      state = result.state;

      // Draft Legolas (mind 6, total 15) for Alice, Bob stops
      result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: LEGOLAS });
      state = result.state;
      result = reduce(state, { type: 'draft-stop', player: PLAYER_2 });
      state = result.state;

      // Alice's legal actions: Bilbo (mind 5, total 20 OK) but NOT Gimli (mind 6, total 21)
      const actions = computeLegalActions(state, PLAYER_1);
      const pickDefIds = actions
        .filter((a): a is GameAction & { type: 'draft-pick' } => a.type === 'draft-pick')
        .map(a => a.characterDefId);

      expect(pickDefIds).toContain(BILBO);
      expect(pickDefIds).not.toContain(GIMLI);
    });

    it('includes player ID in all returned actions', () => {
      const state = createGame(makeDraftConfig(), pool);
      const actions = computeLegalActions(state, PLAYER_1);

      for (const action of actions) {
        expect(action.player).toBe(PLAYER_1);
      }
    });
  });

  describe('untap phase', () => {
    it('returns only pass', () => {
      const config: QuickStartGameConfig = {
        players: [
          {
            id: PLAYER_1, name: 'Alice',
            startingCharacters: [ARAGORN],
            playDeck: makePlayDeck(),
            siteDeck: [MORIA],
            startingHavens: [RIVENDELL],
          },
          {
            id: PLAYER_2, name: 'Bob',
            startingCharacters: [LEGOLAS],
            playDeck: makePlayDeck(),
            siteDeck: [MORIA],
            startingHavens: [LORIEN],
          },
        ],
        seed: 42,
      };
      const state = createGameQuickStart(config, pool);

      expect(state.phaseState.phase).toBe(Phase.Untap);
      const actions = computeLegalActions(state, PLAYER_1);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('pass');
      expect(actions[0].player).toBe(PLAYER_1);
    });
  });
});
