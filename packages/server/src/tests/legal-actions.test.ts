import { describe, it, expect } from 'vitest';
import { computeLegalActions } from '../engine/legal-actions/index.js';
import { createGameQuickStart } from '../engine/init.js';
import type { GameAction, EvaluatedAction } from '@meccg/shared';
import {
  pool, PLAYER_1, PLAYER_2,
  createGame, reduce, Phase, Alignment,
  makePlayDeck, makeDraftConfig, runActions,
  ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, FARAMIR,
  MORIA, RIVENDELL, LORIEN,
  STING, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR,
} from './test-helpers.js';
import type { GameConfig, QuickStartGameConfig } from './test-helpers.js';

/** Extract viable actions from evaluated actions. */
function viableActions(evaluated: readonly EvaluatedAction[]): GameAction[] {
  return evaluated.filter(e => e.viable).map(e => e.action);
}

describe('computeLegalActions', () => {
  describe('character draft', () => {
    it('returns draft-pick for each pool character plus draft-stop', () => {
      const state = createGame(makeDraftConfig(), pool);
      const actions = viableActions(computeLegalActions(state, PLAYER_1));

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
      expect(viableActions(computeLegalActions(state, PLAYER_2)).filter(a => a.type === 'draft-pick')).toHaveLength(3);
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
          { id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard, draftPool: [ARAGORN, BILBO], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [RIVENDELL] },
          { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard, draftPool: [ARAGORN, LEGOLAS], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [LORIEN] },
        ],
        seed: 42,
      };

      let state = createGame(config, pool);
      let result = reduce(state, { type: 'draft-pick', player: PLAYER_1, characterDefId: BILBO });
      state = result.state;
      result = reduce(state, { type: 'draft-pick', player: PLAYER_2, characterDefId: ARAGORN });
      state = result.state;

      // Aragorn should be non-viable for P1 since opponent drafted it
      const evaluated = computeLegalActions(state, PLAYER_1);
      const aragornEval = evaluated.find(e => e.action.type === 'draft-pick' && e.action.characterDefId === ARAGORN);
      expect(aragornEval).toBeDefined();
      expect(aragornEval!.viable).toBe(false);
      expect(aragornEval!.reason).toContain('unique');

      const pickDefIds = viableActions(evaluated)
        .filter((a): a is GameAction & { type: 'draft-pick' } => a.type === 'draft-pick')
        .map(a => a.characterDefId);
      expect(pickDefIds).not.toContain(ARAGORN);
    });

    it('excludes characters that would exceed mind limit of 20', () => {
      const config: GameConfig = {
        players: [
          { id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard, draftPool: [ARAGORN, LEGOLAS, GIMLI, BILBO], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [RIVENDELL] },
          { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard, draftPool: [FARAMIR], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [LORIEN] },
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

      const evaluated = computeLegalActions(state, PLAYER_1);

      // Gimli should be non-viable with a reason about mind limit
      const gimliEval = evaluated.find(e => e.action.type === 'draft-pick' && e.action.characterDefId === GIMLI);
      expect(gimliEval).toBeDefined();
      expect(gimliEval!.viable).toBe(false);
      expect(gimliEval!.reason).toContain('mind');

      const pickDefIds = viableActions(evaluated)
        .filter((a): a is GameAction & { type: 'draft-pick' } => a.type === 'draft-pick')
        .map(a => a.characterDefId);

      expect(pickDefIds).toContain(BILBO); // mind 5, total 20 OK
      expect(pickDefIds).not.toContain(GIMLI); // mind 6, total 21 exceeds
    });

    it('includes player ID in all returned actions', () => {
      const state = createGame(makeDraftConfig(), pool);
      const evaluated = computeLegalActions(state, PLAYER_1);
      for (const ea of evaluated) {
        expect(ea.action.player).toBe(PLAYER_1);
      }
    });
  });

  describe('item draft', () => {
    function makeItemDraftState() {
      // Pool: Aragorn (character), Sting (unique minor item), 2x Dagger (non-unique minor item)
      const config: GameConfig = {
        players: [
          { id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard, draftPool: [ARAGORN, STING, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [RIVENDELL] },
          { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard, draftPool: [LEGOLAS, DAGGER_OF_WESTERNESSE], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [LORIEN] },
        ],
        seed: 42,
      };
      // Draft one character each, then stop → advances to item draft
      return runActions(createGame(config, pool), [
        { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN },
        { type: 'draft-pick', player: PLAYER_2, characterDefId: LEGOLAS },
        { type: 'draft-stop', player: PLAYER_1 },
        { type: 'draft-stop', player: PLAYER_2 },
      ]);
    }

    it('rejects unique minor items with a reason', () => {
      const state = makeItemDraftState();
      expect(state.phaseState.phase).toBe('setup');
      if (state.phaseState.phase !== 'setup') return;
      expect(state.phaseState.setupStep.step).toBe('item-draft');

      const evaluated = computeLegalActions(state, PLAYER_1);
      const stingEval = evaluated.find(
        e => e.action.type === 'assign-starting-item' && e.action.itemDefId === STING,
      );
      expect(stingEval).toBeDefined();
      expect(stingEval!.viable).toBe(false);
      expect(stingEval!.reason).toContain('unique');
    });

    it('allows non-unique minor items', () => {
      const state = makeItemDraftState();
      const evaluated = computeLegalActions(state, PLAYER_1);
      const daggerActions = evaluated.filter(
        e => e.action.type === 'assign-starting-item' && e.action.itemDefId === DAGGER_OF_WESTERNESSE,
      );
      // Should have viable actions (one per character target)
      expect(daggerActions.length).toBeGreaterThan(0);
      expect(daggerActions.every(e => e.viable)).toBe(true);
    });

    it('rejects items beyond the starting item limit of 2', () => {
      // Pool with 3 non-unique items: 2x Dagger + 1 Horn of Anor
      const config: GameConfig = {
        players: [
          { id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard, draftPool: [ARAGORN, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [RIVENDELL] },
          { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard, draftPool: [LEGOLAS, DAGGER_OF_WESTERNESSE], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [LORIEN] },
        ],
        seed: 42,
      };
      let state = runActions(createGame(config, pool), [
        { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN },
        { type: 'draft-pick', player: PLAYER_2, characterDefId: LEGOLAS },
        { type: 'draft-stop', player: PLAYER_1 },
        { type: 'draft-stop', player: PLAYER_2 },
      ]);

      // Assign first dagger
      const p1Char = state.players[0].companies[0].characters[0];
      state = reduce(state, { type: 'assign-starting-item', player: PLAYER_1, itemDefId: DAGGER_OF_WESTERNESSE, characterInstanceId: p1Char }).state;
      // Assign second dagger
      state = reduce(state, { type: 'assign-starting-item', player: PLAYER_1, itemDefId: DAGGER_OF_WESTERNESSE, characterInstanceId: p1Char }).state;

      // Now at limit — Horn of Anor should be non-viable
      const evaluated = computeLegalActions(state, PLAYER_1);
      const hornEval = evaluated.find(
        e => e.action.type === 'assign-starting-item' && e.action.itemDefId === HORN_OF_ANOR,
      );
      expect(hornEval).toBeDefined();
      expect(hornEval!.viable).toBe(false);
      expect(hornEval!.reason).toContain('limit');
    });

    it('rejects characters in pool with a reason', () => {
      const state = makeItemDraftState();
      const evaluated = computeLegalActions(state, PLAYER_1);
      // Aragorn is drafted and in a company — should appear as non-viable
      const charEvals = evaluated.filter(
        e => !e.viable && e.reason !== undefined && e.reason.includes('character'),
      );
      expect(charEvals.length).toBeGreaterThan(0);
    });
  });

  describe('untap phase', () => {
    function makeUntapState() {
      const config: QuickStartGameConfig = {
        players: [
          { id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard, startingCharacters: [ARAGORN], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [RIVENDELL] },
          { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard, startingCharacters: [LEGOLAS], playDeck: makePlayDeck(), siteDeck: [MORIA], startingHavens: [LORIEN] },
        ],
        seed: 42,
      };
      return createGameQuickStart(config, pool);
    }

    it('both players can pass', () => {
      const state = makeUntapState();
      expect(state.phaseState.phase).toBe(Phase.Untap);

      const p1Actions = viableActions(computeLegalActions(state, PLAYER_1));
      expect(p1Actions).toHaveLength(1);
      expect(p1Actions[0].type).toBe('pass');

      const p2Actions = viableActions(computeLegalActions(state, PLAYER_2));
      expect(p2Actions).toHaveLength(1);
      expect(p2Actions[0].type).toBe('pass');
    });

    it('player who passed has no further actions', () => {
      let state = makeUntapState();
      const result = reduce(state, { type: 'pass', player: PLAYER_1 });
      state = result.state;

      expect(state.phaseState.phase).toBe(Phase.Untap);
      expect(computeLegalActions(state, PLAYER_1)).toHaveLength(0);
      expect(viableActions(computeLegalActions(state, PLAYER_2))).toHaveLength(1);
    });

    it('advances to organization after both players pass', () => {
      let state = makeUntapState();
      state = reduce(state, { type: 'pass', player: PLAYER_1 }).state;
      state = reduce(state, { type: 'pass', player: PLAYER_2 }).state;

      expect(state.phaseState.phase).toBe(Phase.Organization);
    });

    it('rejects double pass from same player', () => {
      let state = makeUntapState();
      state = reduce(state, { type: 'pass', player: PLAYER_1 }).state;
      const result = reduce(state, { type: 'pass', player: PLAYER_1 });

      expect(result.error).toBeDefined();
    });
  });
});
