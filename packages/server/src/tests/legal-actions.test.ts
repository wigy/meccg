import { describe, it, expect } from 'vitest';
import { computeLegalActions } from '../engine/legal-actions/index.js';
import { createGameQuickStart } from '../engine/init.js';
import type { GameAction } from '@meccg/shared';
import {
  pool, PLAYER_1, PLAYER_2,
  createGame, reduce, Phase, Alignment,
  makePlayDeck, makeDraftConfig,
  ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, FARAMIR,
  MORIA, RIVENDELL, LORIEN,
} from './test-helpers.js';
import type { GameConfig, QuickStartGameConfig } from './test-helpers.js';

describe('computeLegalActions', () => {
  describe('character draft', () => {
    it('returns draft-pick for each pool character plus draft-stop', () => {
      const state = createGame(makeDraftConfig(), pool);
      const actions = computeLegalActions(state, PLAYER_1);

      const picks = actions.filter(a => a.type === 'draft-pick');
      expect(picks).toHaveLength(3);

      const pickDefIds = picks.map(a => a.type === 'draft-pick' ? a.characterDefId : null);
      expect(pickDefIds).toContain(ARAGORN);
      expect(pickDefIds).toContain(BILBO);
      expect(pickDefIds).toContain(FRODO);
      expect(actions.find(a => a.type === 'draft-stop')).toBeDefined();
    });

    it('returns empty when player has already picked (waiting for opponent)', () => {
      let state = createGame(makeDraftConfig(), pool);
      const result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN });
      state = result.state;

      expect(computeLegalActions(state, PLAYER_1)).toHaveLength(0);
      expect(computeLegalActions(state, PLAYER_2).filter(a => a.type === 'draft-pick')).toHaveLength(3);
    });

    it('returns empty when player has stopped', () => {
      let state = createGame(makeDraftConfig(), pool);
      const result = reduce(state, { type: 'draft-stop', player: PLAYER_1 });
      state = result.state;

      expect(computeLegalActions(state, PLAYER_1)).toHaveLength(0);
    });

    it('excludes characters already drafted by the opponent', () => {
      const config: GameConfig = {
        players: [
          { id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard, draftPool: [ARAGORN, BILBO], startingMinorItems: [], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [RIVENDELL] },
          { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard, draftPool: [ARAGORN, LEGOLAS], startingMinorItems: [], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [LORIEN] },
        ],
        seed: 42,
      };

      let state = createGame(config, pool);
      let result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: BILBO });
      state = result.state;
      result = reduce(state, { type: 'draft-pick', player: PLAYER_2, characterDefId: ARAGORN });
      state = result.state;

      const pickDefIds = computeLegalActions(state, PLAYER_1)
        .filter((a): a is GameAction & { type: 'draft-pick' } => a.type === 'draft-pick')
        .map(a => a.characterDefId);
      expect(pickDefIds).not.toContain(ARAGORN);
    });

    it('excludes characters that would exceed mind limit of 20', () => {
      const config: GameConfig = {
        players: [
          { id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard, draftPool: [ARAGORN, LEGOLAS, GIMLI, BILBO], startingMinorItems: [], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [RIVENDELL] },
          { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard, draftPool: [FARAMIR], startingMinorItems: [], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [LORIEN] },
        ],
        seed: 42,
      };

      let state = createGame(config, pool);
      let result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN });
      state = result.state;
      result = reduce(state, { type: 'draft-pick', player: PLAYER_2, characterDefId: FARAMIR });
      state = result.state;
      result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: LEGOLAS });
      state = result.state;
      result = reduce(state, { type: 'draft-stop', player: PLAYER_2 });
      state = result.state;

      const pickDefIds = computeLegalActions(state, PLAYER_1)
        .filter((a): a is GameAction & { type: 'draft-pick' } => a.type === 'draft-pick')
        .map(a => a.characterDefId);

      expect(pickDefIds).toContain(BILBO); // mind 5, total 20 OK
      expect(pickDefIds).not.toContain(GIMLI); // mind 6, total 21 exceeds
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
          { id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard, startingCharacters: [ARAGORN], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [RIVENDELL] },
          { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard, startingCharacters: [LEGOLAS], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [LORIEN] },
        ],
        seed: 42,
      };
      const state = createGameQuickStart(config, pool);

      expect(state.phaseState.phase).toBe(Phase.Untap);
      const actions = computeLegalActions(state, PLAYER_1);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('pass');
    });
  });
});
