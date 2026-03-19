import { describe, it, expect } from 'vitest';
import { createGame, createGameQuickStart } from './init.js';
import type { GameConfig, QuickStartGameConfig } from './init.js';
import { reduce } from './reducer.js';
import { loadCardPool, Phase, Alignment } from '@meccg/shared';
import type { PlayerId, CardDefinitionId } from '@meccg/shared';
import {
  ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, FARAMIR,
  GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING, DAGGER_OF_WESTERNESSE,
  CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM,
} from '@meccg/shared';

const pool = loadCardPool();
const PLAYER_1 = 'p1' as PlayerId;
const PLAYER_2 = 'p2' as PlayerId;

function makePlayDeck(): CardDefinitionId[] {
  const resources = [GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING];
  const hazards = [CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT];
  const deck: CardDefinitionId[] = [];
  for (let i = 0; i < 5; i++) {
    deck.push(...resources, ...hazards);
  }
  return deck;
}

function makeQuickStartConfig(seed = 42): QuickStartGameConfig {
  return {
    players: [
      {
        id: PLAYER_1, name: 'Alice', alignment: Alignment.Hero,
        startingCharacters: [ARAGORN, BILBO],
        playDeck: makePlayDeck(),
        siteDeck: [MORIA, MINAS_TIRITH, MOUNT_DOOM],
        startingHavens: [RIVENDELL],
      },
      {
        id: PLAYER_2, name: 'Bob', alignment: Alignment.Hero,
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
        id: PLAYER_1, name: 'Alice', alignment: Alignment.Hero,
        draftPool: [ARAGORN, BILBO, FRODO],
        startingMinorItems: [DAGGER_OF_WESTERNESSE],
        playDeck: makePlayDeck(),
        siteDeck: [MORIA, MINAS_TIRITH, MOUNT_DOOM],
        startingHavens: [RIVENDELL],
      },
      {
        id: PLAYER_2, name: 'Bob', alignment: Alignment.Hero,
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

describe('recompute derived values', () => {
  describe('quick-start', () => {
    it('computes general influence from starting characters', () => {
      const state = createGameQuickStart(makeQuickStartConfig(), pool);

      expect(state.players[0].generalInfluenceUsed).toBe(14); // Aragorn 9 + Bilbo 5
      expect(state.players[1].generalInfluenceUsed).toBe(12); // Legolas 6 + Gimli 6
    });

    it('computes character MPs from starting characters', () => {
      const state = createGameQuickStart(makeQuickStartConfig(), pool);

      expect(state.players[0].marshallingPoints.character).toBe(5); // Aragorn 3 + Bilbo 2
      expect(state.players[1].marshallingPoints.character).toBe(4); // Legolas 2 + Gimli 2
    });

    it('starts with zero MPs in non-character categories', () => {
      const state = createGameQuickStart(makeQuickStartConfig(), pool);

      for (const player of state.players) {
        expect(player.marshallingPoints.item).toBe(0);
        expect(player.marshallingPoints.faction).toBe(0);
        expect(player.marshallingPoints.ally).toBe(0);
        expect(player.marshallingPoints.kill).toBe(0);
        expect(player.marshallingPoints.misc).toBe(0);
      }
    });
  });

  describe('after draft', () => {
    it('recomputes GI and MPs after draft completes', () => {
      let state = createGame(makeDraftConfig(), pool);

      // Both players draft one character each then stop
      let result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN });
      state = result.state;
      result = reduce(state, { type: 'draft-pick', player: PLAYER_2, characterDefId: LEGOLAS });
      state = result.state;
      // Round resolved, now both stop
      result = reduce(state, { type: 'draft-stop', player: PLAYER_1 });
      state = result.state;
      result = reduce(state, { type: 'draft-stop', player: PLAYER_2 });
      state = result.state;

      // Should be in untap phase now
      expect(state.phaseState.phase).toBe(Phase.Untap);

      // Aragorn: mind 9, 3 MP
      expect(state.players[0].generalInfluenceUsed).toBe(9);
      expect(state.players[0].marshallingPoints.character).toBe(3);

      // Legolas: mind 6, 2 MP
      expect(state.players[1].generalInfluenceUsed).toBe(6);
      expect(state.players[1].marshallingPoints.character).toBe(2);
    });

    it('accumulates MPs across multiple drafted characters', () => {
      let state = createGame(makeDraftConfig(), pool);

      // Round 1: both pick
      let result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN });
      state = result.state;
      result = reduce(state, { type: 'draft-pick', player: PLAYER_2, characterDefId: LEGOLAS });
      state = result.state;

      // Round 2: both pick again
      result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: BILBO });
      state = result.state;
      result = reduce(state, { type: 'draft-pick', player: PLAYER_2, characterDefId: GIMLI });
      state = result.state;

      // Round 3: both stop
      result = reduce(state, { type: 'draft-stop', player: PLAYER_1 });
      state = result.state;
      result = reduce(state, { type: 'draft-stop', player: PLAYER_2 });
      state = result.state;

      expect(state.phaseState.phase).toBe(Phase.Untap);

      // Aragorn (9 mind, 3 MP) + Bilbo (5 mind, 2 MP)
      expect(state.players[0].generalInfluenceUsed).toBe(14);
      expect(state.players[0].marshallingPoints.character).toBe(5);

      // Legolas (6 mind, 2 MP) + Gimli (6 mind, 2 MP)
      expect(state.players[1].generalInfluenceUsed).toBe(12);
      expect(state.players[1].marshallingPoints.character).toBe(4);
    });
  });
});
