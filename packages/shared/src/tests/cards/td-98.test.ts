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
  handCardId, findCharInstanceId, dispatch, resolveChain,
  expectCharStatus, RESOURCE_PLAYER,
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

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const cardInstance = handCardId(base, RESOURCE_PLAYER);

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    const untapAction = actions.find(
      a => a.cardInstanceId === cardInstance && a.targetCharacterId === aragornId,
    );
    expect(untapAction).toBeDefined();

    const state = resolveChain(dispatch(base, untapAction!));
    expectCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
  });

  test('rides the chain of effects — opponent gets a response window before the untap resolves (bug ecb30307a9b1ae0d)', () => {
    // Reported in bug ecb30307a9b1ae0d (game ms4knxxm-yjvsvt, seq 82): playing
    // And Forth He Hastened untapped the target character and discarded the
    // card in the very same step the action was declared, with no chain
    // entry ever created — the opponent never got the response window every
    // short event is owed (CoE 9.4/9.5; CRF 22 "Short-events are discarded
    // when resolved in a chain of effects, not when declared"). Declaring
    // the play must create a chain entry, leave the target character's
    // status unchanged and the card off the discard pile until the chain
    // resolves.
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

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const cardInstance = handCardId(base, RESOURCE_PLAYER);

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    const untapAction = actions.find(
      a => a.cardInstanceId === cardInstance && a.targetCharacterId === aragornId,
    )!;

    const declared = dispatch(base, untapAction);

    // Declaring the play must create a chain entry rather than resolving
    // inline — the opponent gets priority to respond.
    expect(declared.chain).not.toBeNull();
    expect(declared.chain?.entries).toHaveLength(1);
    expect(declared.chain?.priority).toBe(PLAYER_2);

    // The effect has not yet applied: Aragorn is still tapped, and the card
    // has left the hand but not yet reached the discard pile.
    expectCharStatus(declared, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    expect(declared.players[0].hand).toHaveLength(0);
    expect(declared.players[0].discardPile.map(c => c.instanceId)).not.toContain(cardInstance);

    // Once both players pass priority, the chain resolves: Aragorn untaps
    // and the spent card lands in the discard pile.
    const resolved = resolveChain(declared);
    expectCharStatus(resolved, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    expect(resolved.players[0].discardPile.map(c => c.instanceId)).toContain(cardInstance);
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

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);

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

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const cardInstance = handCardId(base, RESOURCE_PLAYER);

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

    const cardInstance = handCardId(base, RESOURCE_PLAYER);

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardInstance);

    expect(actions).toHaveLength(2);
  });
});
