/**
 * @module wh-47.test
 *
 * Card test: Piercing All Shadows (wh-47)
 * Type: minion-resource-event (permanent)
 * Alignment: ringwraith
 * Effects:
 *   1. play-target — character with ranger skill
 *   2. duplication-limit — scope: company, max: 1
 *   3. grant-action — cancel-return-and-site-tap (cost: tap bearer)
 *
 * "Playable during the organization phase on a ranger. Target ranger may tap
 * to cancel all hazard effects for the rest of the turn that: force his
 * company to return to its site of origin or that tap his company's current
 * or new site. If so tapped, target ranger makes a corruption check.
 * Cannot be duplicated in a given company."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  viableActions, CardStatus,
  charIdAt, dispatch, setCharStatus,
  expectCharStatus, attachItemToChar, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { PlayPermanentEventAction, ActivateGrantedAction, CardDefinitionId } from '../../index.js';
import { computeLegalActions, Alignment } from '../../index.js';

const PIERCING_ALL_SHADOWS = 'wh-47' as CardDefinitionId;

// Minion rangers (ringwraith-aligned)
const NEVIDO_SMOD = 'le-27' as CardDefinitionId;   // ringwraith, man, warrior/ranger, mind 4
const ODOACER = 'le-28' as CardDefinitionId;        // ringwraith, man, ranger only, mind 1

// Minion non-ranger (ringwraith-aligned)
const HADOR = 'le-14' as CardDefinitionId;          // ringwraith, dunadan, warrior/sage, mind 6

// Minion sites (both are darkhavens)
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // minion haven

describe('Piercing All Shadows (wh-47)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: play-target — playable on a ranger ───────────────────

  test('playable on a ranger during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [NEVIDO_SMOD, ODOACER] }],
          hand: [PIERCING_ALL_SHADOWS],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [HADOR] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(playActions.length).toBe(2);

    const targets = playActions.map(
      ea => (ea.action as PlayPermanentEventAction).targetCharacterId,
    );
    const nevidoId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const odoacerId = charIdAt(state, RESOURCE_PLAYER, 0, 1);
    expect(new Set(targets)).toEqual(new Set([nevidoId, odoacerId]));
  });

  test('NOT playable outside the organization phase ("Playable during the organization phase")', () => {
    // Regression: the card declared no phase gate, so the permanent-event
    // emitter offered it in every resource-play window despite the printed
    // restriction.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [NEVIDO_SMOD, ODOACER] }],
          hand: [PIERCING_ALL_SHADOWS],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [HADOR] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT playable on a non-ranger (Hador)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HADOR] }],
          hand: [PIERCING_ALL_SHADOWS],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [ODOACER] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
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
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [NEVIDO_SMOD, ODOACER] }],
          hand: [PIERCING_ALL_SHADOWS],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [HADOR] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    const withPaS = attachItemToChar(base, RESOURCE_PLAYER, NEVIDO_SMOD, PIERCING_ALL_SHADOWS);

    const playActions = viableActions(withPaS, PLAYER_1, 'play-permanent-event');
    expect(playActions).toHaveLength(0);
  });

  test('CAN be played in a different company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: DOL_GULDUR, characters: [NEVIDO_SMOD] },
            { site: MINAS_MORGUL, characters: [ODOACER] },
          ],
          hand: [PIERCING_ALL_SHADOWS],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HADOR] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
      ],
    });

    const withPaS = attachItemToChar(base, RESOURCE_PLAYER, NEVIDO_SMOD, PIERCING_ALL_SHADOWS);

    const playActions = viableActions(withPaS, PLAYER_1, 'play-permanent-event');
    expect(playActions).toHaveLength(1);

    const target = (playActions[0].action as PlayPermanentEventAction).targetCharacterId;
    const odoacerId = charIdAt(withPaS, RESOURCE_PLAYER, 1, 0);
    expect(target).toBe(odoacerId);
  });

  // ── Effect 3: grant-action — cancel-return-and-site-tap ────────────

  test('untapped ranger with PaS can activate cancel-return-and-site-tap', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [NEVIDO_SMOD] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [HADOR] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    const withPaS = attachItemToChar(base, RESOURCE_PLAYER, NEVIDO_SMOD, PIERCING_ALL_SHADOWS);
    const actions = viableActions(withPaS, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(1);

    const action = actions[0].action as ActivateGrantedAction;
    expect(action.actionId).toBe('cancel-return-and-site-tap');
  });

  test('tapped ranger cannot activate cancel-return-and-site-tap', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [NEVIDO_SMOD] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [HADOR] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    const withPaS = attachItemToChar(base, RESOURCE_PLAYER, NEVIDO_SMOD, PIERCING_ALL_SHADOWS);
    const tapped = setCharStatus(withPaS, RESOURCE_PLAYER, NEVIDO_SMOD, CardStatus.Tapped);

    const actions = viableActions(tapped, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(0);
  });

  test('activating taps ranger, adds cancel-return-and-site-tap constraint, enqueues corruption check', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [NEVIDO_SMOD] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [HADOR] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    const withPaS = attachItemToChar(base, RESOURCE_PLAYER, NEVIDO_SMOD, PIERCING_ALL_SHADOWS);
    const actions = viableActions(withPaS, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(1);

    const after = dispatch(withPaS, actions[0].action);

    expectCharStatus(after, RESOURCE_PLAYER, NEVIDO_SMOD, CardStatus.Tapped);

    expect(after.activeConstraints).toHaveLength(1);
    const constraint = after.activeConstraints[0];
    expect(constraint.kind.type).toBe('cancel-return-and-site-tap');
    expect(constraint.target.kind).toBe('company');
    expect(constraint.scope.kind).toBe('turn');

    expect(after.pendingResolutions).toHaveLength(1);
    expect(after.pendingResolutions[0].kind.type).toBe('corruption-check');
    if (after.pendingResolutions[0].kind.type === 'corruption-check') {
      const nevidoId = charIdAt(after, RESOURCE_PLAYER, 0, 0);
      expect(after.pendingResolutions[0].kind.characterId).toBe(nevidoId);
      expect(after.pendingResolutions[0].kind.reason).toBe('Piercing All Shadows');
    }
  });
});
