import { describe, it, expect } from 'vitest';
import { computeLegalActions } from '../engine/legal-actions/index.js';
import { createGame, createGameQuickStart } from '../engine/init.js';
import type { GameConfig, QuickStartGameConfig } from '../engine/init.js';
import { reduce } from '../engine/reducer.js';
import { loadCardPool, Phase, Alignment } from '@meccg/shared';
import type { PlayerId, CardDefinitionId, GameAction } from '@meccg/shared';
import {
  ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, FARAMIR,
  SAM_GAMGEE, THEODEN, ELROND, GLORFINDEL_II, CELEBORN,
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
        id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard,
        draftPool: [ARAGORN, BILBO, FRODO],
        startingMinorItems: [DAGGER_OF_WESTERNESSE],
        playDeck: makePlayDeck(),
        siteDeck: [MORIA, MINAS_TIRITH, MOUNT_DOOM],
        startingHavens: [RIVENDELL],
      },
      {
        id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
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
            id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard,
            draftPool: [ARAGORN, LEGOLAS, GIMLI, BILBO],
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

    it('leaves only draft-stop when all remaining characters would exceed GI 20', () => {
      // Elrond(8) + Celeborn(7) = 15. Remaining: Théoden(6), Glorfindel(6) — both exceed 20.
      // Only Sam(1) would fit, but he's not in the pool. So only draft-stop is available.
      const config: GameConfig = {
        players: [
          {
            id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard,
            draftPool: [ELROND, CELEBORN, THEODEN, GLORFINDEL_II],
            startingMinorItems: [],
            playDeck: makePlayDeck(),
            siteDeck: [MORIA],
            startingHavens: [RIVENDELL],
          },
          {
            id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
            draftPool: [SAM_GAMGEE],
            startingMinorItems: [],
            playDeck: makePlayDeck(),
            siteDeck: [MORIA],
            startingHavens: [LORIEN],
          },
        ],
        seed: 42,
      };

      let state = createGame(config, pool);

      // Draft Elrond (mind 8), Bob drafts Sam
      let result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: ELROND });
      state = result.state;
      result = reduce(state, { type: 'draft-pick', player: PLAYER_2, characterDefId: SAM_GAMGEE });
      state = result.state;

      // Draft Celeborn (mind 7, total 15), Bob stops
      result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: CELEBORN });
      state = result.state;
      result = reduce(state, { type: 'draft-stop', player: PLAYER_2 });
      state = result.state;

      // Remaining pool: Théoden(6) and Glorfindel(6) — both would make 21, exceeding 20
      const actions = computeLegalActions(state, PLAYER_1);
      const picks = actions.filter(a => a.type === 'draft-pick');
      expect(picks).toHaveLength(0);

      // Only draft-stop should be available
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('draft-stop');
    });

    it('allows cheap characters when expensive ones exceed GI limit', () => {
      // Elrond(8) + Celeborn(7) = 15. Sam(1) fits (total 16), Théoden(6) doesn't (21).
      const config: GameConfig = {
        players: [
          {
            id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard,
            draftPool: [ELROND, CELEBORN, THEODEN, SAM_GAMGEE],
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

      // Draft Elrond(8) and Celeborn(7) = 15
      let result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: ELROND });
      state = result.state;
      result = reduce(state, { type: 'draft-pick', player: PLAYER_2, characterDefId: FARAMIR });
      state = result.state;
      result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: CELEBORN });
      state = result.state;
      result = reduce(state, { type: 'draft-stop', player: PLAYER_2 });
      state = result.state;

      const actions = computeLegalActions(state, PLAYER_1);
      const pickDefIds = actions
        .filter((a): a is GameAction & { type: 'draft-pick' } => a.type === 'draft-pick')
        .map(a => a.characterDefId);

      // Sam(1) fits (total 16), Théoden(6) doesn't (total 21)
      expect(pickDefIds).toContain(SAM_GAMGEE);
      expect(pickDefIds).not.toContain(THEODEN);
      expect(actions.find(a => a.type === 'draft-stop')).toBeDefined();
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
            id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard,
            startingCharacters: [ARAGORN],
            playDeck: makePlayDeck(),
            siteDeck: [MORIA],
            startingHavens: [RIVENDELL],
          },
          {
            id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
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
