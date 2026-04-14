/**
 * @module td-98.test
 *
 * Card test: And Forth He Hastened (td-98)
 * Type: hero-resource-event (short event, wizard alignment)
 * Effects: 2 (play-target with inAvatarCompany filter + play-option untap)
 *
 * "Untap a character in your Wizard's company."
 *
 * A short event that untaps a single tapped character belonging to the
 * same company as the player's Wizard (avatar). Characters outside the
 * Wizard's company or already untapped are not eligible targets.
 *
 * Engine Support:
 * | # | Feature                                    | Status      | Notes                              |
 * |---|-------------------------------------------|-------------|------------------------------------|
 * | 1 | play-target with inAvatarCompany filter     | IMPLEMENTED | buildPlayOptionContext              |
 * | 2 | play-option: set-character-status untapped   | IMPLEMENTED | reducer-events.ts                  |
 *
 * Playable: YES
 * Certified: 2026-04-14
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, GANDALF, AND_FORTH_HE_HASTENED,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  handCardId, charIdAt, dispatch,
  expectCharStatus,
} from '../test-helpers.js';
import type { PlayShortEventAction } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

describe('And Forth He Hastened (td-98)', () => {
  beforeEach(() => resetMint());


  test('untaps a tapped character in Wizard company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              GANDALF,
              { defId: ARAGORN, status: CardStatus.Tapped },
            ],
          }],
          hand: [AND_FORTH_HE_HASTENED],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(base, 0, 0, 1);
    const cardInstance = handCardId(base, 0);

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    const untapAction = actions.find(
      a => a.cardInstanceId === cardInstance && a.targetCharacterId === aragornId,
    );
    expect(untapAction).toBeDefined();

    const state = dispatch(base, untapAction!);
    expectCharStatus(state, 0, ARAGORN, CardStatus.Untapped);
  });

  test('not playable on characters outside Wizard company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [GANDALF] },
            { site: MORIA, characters: [{ defId: ARAGORN, status: CardStatus.Tapped }] },
          ],
          hand: [AND_FORTH_HE_HASTENED],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(base, 0, 1, 0);

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    const targetingAragorn = actions.find(
      a => a.targetCharacterId === aragornId,
    );
    expect(targetingAragorn).toBeUndefined();
  });

  test('not playable on untapped characters', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [GANDALF, ARAGORN],
          }],
          hand: [AND_FORTH_HE_HASTENED],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    expect(actions).toHaveLength(0);
  });

  test('not playable when no Wizard is in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [{ defId: ARAGORN, status: CardStatus.Tapped }],
          }],
          hand: [AND_FORTH_HE_HASTENED],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    expect(actions).toHaveLength(0);
  });

  test('not playable in long-event phase when no Wizard is in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [{ defId: ARAGORN, status: CardStatus.Tapped }],
          }],
          hand: [AND_FORTH_HE_HASTENED],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    expect(actions).toHaveLength(0);
  });

  test('playable in long-event phase with tapped character in Wizard company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              GANDALF,
              { defId: ARAGORN, status: CardStatus.Tapped },
            ],
          }],
          hand: [AND_FORTH_HE_HASTENED],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(base, 0, 0, 1);
    const cardInstance = handCardId(base, 0);

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    const untapAction = actions.find(
      a => a.cardInstanceId === cardInstance && a.targetCharacterId === aragornId,
    );
    expect(untapAction).toBeDefined();
    expect(untapAction!.optionId).toBe('untap');
  });

  test('multiple tapped characters in Wizard company each get a separate action', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              GANDALF,
              { defId: ARAGORN, status: CardStatus.Tapped },
              { defId: GIMLI, status: CardStatus.Tapped },
            ],
          }],
          hand: [AND_FORTH_HE_HASTENED],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const cardInstance = handCardId(base, 0);

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardInstance);

    expect(actions).toHaveLength(2);
  });
});
