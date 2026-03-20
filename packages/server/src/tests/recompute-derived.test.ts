import { describe, it, expect } from 'vitest';
import { createGameQuickStart } from '../engine/init.js';
import { reduce } from '../engine/reducer.js';
import {
  pool, PLAYER_1,
  makeQuickStartConfig, makeDraftConfig, runSimpleDraft,
  Phase, DAGGER_OF_WESTERNESSE,
} from './test-helpers.js';

describe('recompute derived values', () => {
  describe('quick-start', () => {
    it('computes general influence from starting characters', () => {
      const state = createGameQuickStart(makeQuickStartConfig(), pool);
      // Aragorn (mind 9) + Bilbo (mind 5) = 14
      expect(state.players[0].generalInfluenceUsed).toBe(14);
      // Legolas (mind 6) + Gimli (mind 6) = 12
      expect(state.players[1].generalInfluenceUsed).toBe(12);
    });

    it('computes marshalling points from characters', () => {
      const state = createGameQuickStart(makeQuickStartConfig(), pool);
      // Aragorn (3 MP) + Bilbo (2 MP) = 5
      expect(state.players[0].marshallingPoints.character).toBe(5);
      // Legolas (2 MP) + Gimli (2 MP) = 4
      expect(state.players[1].marshallingPoints.character).toBe(4);
    });

    it('has zero item/faction/ally/kill/misc MPs at start', () => {
      const state = createGameQuickStart(makeQuickStartConfig(), pool);
      const mp = state.players[0].marshallingPoints;
      expect(mp.item).toBe(0);
      expect(mp.faction).toBe(0);
      expect(mp.ally).toBe(0);
      expect(mp.kill).toBe(0);
      expect(mp.misc).toBe(0);
    });
  });

  describe('post-draft', () => {
    it('recomputes GI after character draft', () => {
      const state = runSimpleDraft();
      expect(state.players[0].generalInfluenceUsed).toBe(9); // Aragorn
      expect(state.players[1].generalInfluenceUsed).toBe(6); // Legolas
    });

    it('computes item MPs after item assignment', () => {
      let state = runSimpleDraft(makeDraftConfig());
      const p1Char = state.players[0].companies[0].characters[0];

      if (state.phaseState.phase !== Phase.Setup || state.phaseState.setupStep.step !== 'item-draft') throw new Error('wrong phase');

      const result = reduce(state, { type: 'assign-starting-item', player: PLAYER_1, itemDefId: DAGGER_OF_WESTERNESSE, characterInstanceId: p1Char });
      state = result.state;

      // Dagger of Westernesse has 0 MP
      expect(state.players[0].marshallingPoints.item).toBe(0);
    });
  });
});
