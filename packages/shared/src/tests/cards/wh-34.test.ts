/**
 * @module wh-34.test
 *
 * Card test: Promptings of Wisdom (wh-34)
 * Type: hero-resource-event (permanent), Light Enchantment
 * Corruption Points: 2
 * Effects:
 *   1. play-target — character with ranger skill
 *   2. duplication-limit — scope: company, max: 1
 *   3. grant-action — cancel-return-and-site-tap (cost: tap bearer)
 *
 * "Light Enchantment. Playable during the organization phase on a ranger.
 * Target ranger may tap to cancel all hazard effects for the rest of the
 * turn that: force his company to return to its site of origin or that tap
 * his company's current or new site. If so tapped, target ranger makes a
 * corruption check. Cannot be duplicated in a given company."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, FARAMIR, LEGOLAS, ELROND, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, CardStatus,
  charIdAt, dispatch, setCharStatus,
  expectCharStatus, attachItemToChar, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { PlayPermanentEventAction, ActivateGrantedAction, CardDefinitionId } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const PROMPTINGS_OF_WISDOM = 'wh-34' as CardDefinitionId;

describe('Promptings of Wisdom (wh-34)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: play-target — playable on a ranger ───────────────────

  test('playable on a ranger during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, FARAMIR] }], hand: [PROMPTINGS_OF_WISDOM], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(playActions.length).toBe(2);

    const targets = playActions.map(
      ea => (ea.action as PlayPermanentEventAction).targetCharacterId,
    );
    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const faramirId = charIdAt(state, RESOURCE_PLAYER, 0, 1);
    expect(new Set(targets)).toEqual(new Set([aragornId, faramirId]));
  });

  test('NOT playable on a non-ranger (Elrond)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [PROMPTINGS_OF_WISDOM], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(playActions).toHaveLength(0);

    const notPlayable = computeLegalActions(state, PLAYER_1)
      .filter(ea => !ea.viable && ea.action.type === 'not-playable');
    expect(notPlayable.some(ea =>
      ea.reason?.includes('no valid target'),
    )).toBe(true);
  });

  // ── Effect 2: duplication-limit — company scope ────────────────────

  test('cannot be duplicated in the same company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, FARAMIR] }], hand: [PROMPTINGS_OF_WISDOM], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withPoW = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PROMPTINGS_OF_WISDOM);

    const playActions = viableActions(withPoW, PLAYER_1, 'play-permanent-event');
    expect(playActions).toHaveLength(0);
  });

  test('CAN be played in a different company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN] },
            { site: MINAS_TIRITH, characters: [FARAMIR] },
          ],
          hand: [PROMPTINGS_OF_WISDOM],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withPoW = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PROMPTINGS_OF_WISDOM);

    const playActions = viableActions(withPoW, PLAYER_1, 'play-permanent-event');
    expect(playActions).toHaveLength(1);

    const target = (playActions[0].action as PlayPermanentEventAction).targetCharacterId;
    const faramirId = charIdAt(withPoW, RESOURCE_PLAYER, 1, 0);
    expect(target).toBe(faramirId);
  });

  // ── Effect 3: grant-action — cancel-return-and-site-tap ────────────

  test('untapped ranger with PoW can activate cancel-return-and-site-tap', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withPoW = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PROMPTINGS_OF_WISDOM);
    const actions = viableActions(withPoW, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(1);

    const action = actions[0].action as ActivateGrantedAction;
    expect(action.actionId).toBe('cancel-return-and-site-tap');
  });

  test('tapped ranger cannot activate cancel-return-and-site-tap', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withPoW = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PROMPTINGS_OF_WISDOM);
    const tapped = setCharStatus(withPoW, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    const actions = viableActions(tapped, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(0);
  });

  test('activating taps ranger, adds constraint, and enqueues corruption check', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withPoW = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PROMPTINGS_OF_WISDOM);
    const actions = viableActions(withPoW, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(1);

    const after = dispatch(withPoW, actions[0].action);

    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    expect(after.activeConstraints).toHaveLength(1);
    const constraint = after.activeConstraints[0];
    expect(constraint.kind.type).toBe('cancel-return-and-site-tap');
    expect(constraint.target.kind).toBe('company');
    expect(constraint.scope.kind).toBe('turn');

    expect(after.pendingResolutions).toHaveLength(1);
    expect(after.pendingResolutions[0].kind.type).toBe('corruption-check');
    if (after.pendingResolutions[0].kind.type === 'corruption-check') {
      const aragornId = charIdAt(after, RESOURCE_PLAYER, 0, 0);
      expect(after.pendingResolutions[0].kind.characterId).toBe(aragornId);
      expect(after.pendingResolutions[0].kind.reason).toBe('Promptings of Wisdom');
    }
  });
});
