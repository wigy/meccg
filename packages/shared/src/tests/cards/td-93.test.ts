/**
 * @module td-93.test
 *
 * Card test: Ioreth (td-93)
 * Type: hero-character (wizard alignment)
 * Effects: 1 (company-rule: healing-affects-all)
 *
 * "Unique. Healing effects affect all characters in her company."
 *
 * Ioreth is a 0-prowess, body-7, mind-1 Dúnadan sage. Her special ability
 * extends any healing effect targeting a character in her company to ALL
 * wounded characters in that company.
 *
 * Engine Support:
 * | # | Feature                                    | Status      | Notes                              |
 * |---|-------------------------------------------|-------------|------------------------------------|
 * | 1 | Basic character stats (prowess/body/mind)  | IMPLEMENTED | always handled by engine            |
 * | 2 | Unique flag                                | IMPLEMENTED | unique: true in card data           |
 * | 3 | company-rule: healing-affects-all           | IMPLEMENTED | reducer-events.ts healing spread    |
 *
 * Playable: YES
 * Certified: 2026-04-14
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, BILBO, IORETH, HALFLING_STRENGTH,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  handCardId, findCharInstanceId, dispatch,
  expectCharStatus, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { PlayShortEventAction } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

describe('Ioreth (td-93)', () => {
  beforeEach(() => resetMint());


  test('Halfling Strength heal on Bilbo extends to wounded Aragorn when Ioreth is in the company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              { defId: BILBO, status: CardStatus.Inverted },
              { defId: ARAGORN, status: CardStatus.Inverted },
              IORETH,
            ],
          }],
          hand: [HALFLING_STRENGTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const bilboId = findCharInstanceId(base, RESOURCE_PLAYER, BILBO);
    const hsInstance = handCardId(base, RESOURCE_PLAYER);

    const state = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: hsInstance,
      targetCharacterId: bilboId,
      optionId: 'heal',
    });

    expectCharStatus(state, RESOURCE_PLAYER, BILBO, CardStatus.Untapped);
    expectCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    expectCharStatus(state, RESOURCE_PLAYER, IORETH, CardStatus.Untapped);
  });

  test('healing does NOT extend when Ioreth is not in the company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            {
              site: RIVENDELL,
              characters: [
                { defId: BILBO, status: CardStatus.Inverted },
                { defId: ARAGORN, status: CardStatus.Inverted },
              ],
            },
          ],
          hand: [HALFLING_STRENGTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const bilboId = findCharInstanceId(base, RESOURCE_PLAYER, BILBO);
    const hsInstance = handCardId(base, RESOURCE_PLAYER);

    const state = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: hsInstance,
      targetCharacterId: bilboId,
      optionId: 'heal',
    });

    expectCharStatus(state, RESOURCE_PLAYER, BILBO, CardStatus.Untapped);
    expectCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
  });

  test('Ioreth herself is healed when another character receives healing in her company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              { defId: BILBO, status: CardStatus.Inverted },
              { defId: IORETH, status: CardStatus.Inverted },
            ],
          }],
          hand: [HALFLING_STRENGTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const bilboId = findCharInstanceId(base, RESOURCE_PLAYER, BILBO);
    const hsInstance = handCardId(base, RESOURCE_PLAYER);

    const state = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: hsInstance,
      targetCharacterId: bilboId,
      optionId: 'heal',
    });

    expectCharStatus(state, RESOURCE_PLAYER, BILBO, CardStatus.Untapped);
    expectCharStatus(state, RESOURCE_PLAYER, IORETH, CardStatus.Untapped);
  });

  test('untap option does NOT trigger healing spread (untapping is not healing)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              { defId: BILBO, status: CardStatus.Tapped },
              { defId: ARAGORN, status: CardStatus.Inverted },
              IORETH,
            ],
          }],
          hand: [HALFLING_STRENGTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const bilboId = findCharInstanceId(base, RESOURCE_PLAYER, BILBO);

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    const untapAction = actions.find(a => a.optionId === 'untap' && a.targetCharacterId === bilboId);
    expect(untapAction).toBeDefined();

    const state = dispatch(base, untapAction!);

    expectCharStatus(state, RESOURCE_PLAYER, BILBO, CardStatus.Untapped);
    expectCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
  });
});
