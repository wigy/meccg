/**
 * @module rule-3.35-transferring-items
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.35: Transferring Items
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Transferring Items - During the organization phase either before or after organizing, the resource player may attempt to transfer control of an item between two characters at the same site (though not necessarily in the same company) by making a corruption check for the item's initial bearer. If the corruption check is successful, the item is successfully transferred.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableFor, findCharInstanceId, Phase, Alignment,
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS, GIMLI,
  DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  RESOURCE_PLAYER,
} from '../../test-helpers.js';
import { reduce } from '../../../index.js';
import type { CardDefinitionId } from '../../../index.js';
import type { TransferItemAction } from '../../../types/actions-organization.js';
import type { SupportCorruptionCheckAction } from '../../../types/actions-universal.js';

/** Open to the Summons — a permanent resource-event placed *with* an agent, not an item. */
const OPEN_TO_THE_SUMMONS = 'wh-46' as CardDefinitionId;
/** Bill Ferny — minion agent character, the bearer of the placed event. */
const BILL_FERNY = 'dm-3' as CardDefinitionId;
/** Orc-tracker — plain minion character, the transfer recipient. */
const ORC_TRACKER = 'le-34' as CardDefinitionId;
/** Black-hide Shield — a genuine minion minor item, transferable as a control. */
const BLACK_HIDE_SHIELD = 'le-300' as CardDefinitionId;
/** Minas Morgul — Ringwraith Darkhaven the minion company occupies. */
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

describe('Rule 3.35 — Transferring Items', () => {
  beforeEach(() => resetMint());

  test('During org phase, may transfer item between characters at same site by passing corruption check', () => {
    // Aragorn carries a Dagger at Rivendell; Bilbo is also at Rivendell.
    // The engine must offer a transfer-item action from Aragorn to Bilbo.
    // Both are in the same company here, but the rule allows cross-company
    // transfers at the same site as well.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }, BILBO] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
      recompute: true,
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const daggerInstId = state.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;

    const transfers = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'transfer-item') as { action: TransferItemAction }[];

    expect(transfers.some(a =>
      a.action.itemInstanceId === daggerInstId &&
      a.action.fromCharacterId === aragornId &&
      a.action.toCharacterId === bilboId,
    )).toBe(true);
  });

  test('Characters at different sites cannot transfer items', () => {
    // Aragorn is at Rivendell with a Dagger; Bilbo is at Moria. Since
    // they are at different sites, no transfer action must be offered.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }] },
            { site: MORIA, characters: [BILBO] },
          ],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
      recompute: true,
    });

    const transfers = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'transfer-item');

    expect(transfers).toHaveLength(0);
  });

  test('A non-item card placed with a character is never offered for transfer', () => {
    // Reproduces game ms1ut2yf-ndju07 (seq 41): Open to the Summons (wh-46) had
    // been drafted "in lieu of a minor item" and placed with the agent it
    // summoned. It rides in CharacterInPlay.items so its -1 mind applies, but it
    // is a permanent resource-event, not an item — rule 3.35 transfers items
    // only, so the engine must not offer it. The Black-hide Shield on the same
    // bearer is a real item and must still be transferable.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: MINAS_MORGUL,
            characters: [
              { defId: BILL_FERNY, items: [OPEN_TO_THE_SUMMONS, BLACK_HIDE_SHIELD] },
              ORC_TRACKER,
            ],
          }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const fernyId = findCharInstanceId(state, RESOURCE_PLAYER, BILL_FERNY);
    const trackerId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_TRACKER);
    const ferny = state.players[RESOURCE_PLAYER].characters[fernyId];
    const summonsInstId = ferny.items.find(i => i.definitionId === OPEN_TO_THE_SUMMONS)!.instanceId;
    const shieldInstId = ferny.items.find(i => i.definitionId === BLACK_HIDE_SHIELD)!.instanceId;

    const transfers = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'transfer-item') as { action: TransferItemAction }[];

    // The permanent event is never offered…
    expect(transfers.some(a => a.action.itemInstanceId === summonsInstId)).toBe(false);
    // …while the real item on the same bearer still is.
    expect(transfers.some(a =>
      a.action.itemInstanceId === shieldInstId &&
      a.action.fromCharacterId === fernyId &&
      a.action.toCharacterId === trackerId,
    )).toBe(true);

    // A hand-crafted transfer of the non-item is rejected by the reducer too.
    expect(reduce(state, {
      type: 'transfer-item',
      player: PLAYER_1,
      itemInstanceId: summonsInstId,
      fromCharacterId: fernyId,
      toCharacterId: trackerId,
    }).error).toBeDefined();
  });

  test('CoE 7.1.1: an untapped company mate may tap in support of the transfer corruption check', () => {
    // Reproduces game ms8r75ta-8kkqyo (seq 1017-1018): Aragorn transfers the
    // Dagger to Bilbo while Gimli, an untapped company mate, stands by. The
    // engine enqueues a corruption check for Aragorn (the item's initial
    // bearer, CoE 2.II.5) but never offered Gimli's tap-in-support option
    // (CoE 7.1.1), which applies to any corruption check that has been
    // declared but not yet resolved — not just the Free Council window.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }, BILBO, GIMLI] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
      recompute: true,
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const daggerInstId = state.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;

    const afterTransfer = reduce(state, {
      type: 'transfer-item',
      player: PLAYER_1,
      itemInstanceId: daggerInstId,
      fromCharacterId: aragornId,
      toCharacterId: bilboId,
    });
    expect(afterTransfer.error).toBeUndefined();

    const supports = viableFor(afterTransfer.state, PLAYER_1)
      .filter(a => a.action.type === 'support-corruption-check') as { action: SupportCorruptionCheckAction }[];

    expect(supports.some(a =>
      a.action.supportingCharacterId === gimliId &&
      a.action.targetCharacterId === aragornId,
    )).toBe(true);
  });

  test('Transferring an item back to any earlier bearer this phase is regressive, not just the last one', () => {
    // Bug report (game mscbx9w6-tt13e2, seq 125): the AI cycled Cram
    // Aragorn -> Bilbo -> Gimli -> Aragorn -> Bilbo -> Gimli -> ... forever.
    // The engine only ever flagged the *immediately preceding* hop's reverse
    // (Bilbo->Aragorn right after Aragorn->Bilbo), so returning the item to
    // Aragorn two hops later — after it had also passed through Gimli — was
    // never marked `regress`, and nothing stopped the cycle. Every character
    // that has held the item this phase must be a regressive destination.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }, BILBO, GIMLI] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
      recompute: true,
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const daggerInstId = state.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;

    // Hop 1: Aragorn -> Bilbo, forcing the corruption check to succeed.
    const afterHop1 = reduce({ ...state, cheatRollTotal: 12 }, {
      type: 'transfer-item',
      player: PLAYER_1,
      itemInstanceId: daggerInstId,
      fromCharacterId: aragornId,
      toCharacterId: bilboId,
    });
    expect(afterHop1.error).toBeUndefined();
    const checkAction1 = viableFor(afterHop1.state, PLAYER_1)
      .find(a => a.action.type === 'corruption-check')!.action;
    const afterCheck1 = reduce({ ...afterHop1.state, cheatRollTotal: 12 }, checkAction1);
    expect(afterCheck1.error).toBeUndefined();

    // Hop 2: Bilbo -> Gimli, forcing the corruption check to succeed.
    const afterHop2 = reduce({ ...afterCheck1.state, cheatRollTotal: 12 }, {
      type: 'transfer-item',
      player: PLAYER_1,
      itemInstanceId: daggerInstId,
      fromCharacterId: bilboId,
      toCharacterId: gimliId,
    });
    expect(afterHop2.error).toBeUndefined();
    const checkAction2 = viableFor(afterHop2.state, PLAYER_1)
      .find(a => a.action.type === 'corruption-check')!.action;
    const afterCheck2 = reduce({ ...afterHop2.state, cheatRollTotal: 12 }, checkAction2);
    expect(afterCheck2.error).toBeUndefined();

    // The item is now on Gimli. Both Aragorn (its original bearer, two hops
    // back) and Bilbo (the intermediate bearer) must be offered as
    // regressive destinations.
    const transfers = viableFor(afterCheck2.state, PLAYER_1)
      .filter(a => a.action.type === 'transfer-item' && a.action.itemInstanceId === daggerInstId) as
      { action: TransferItemAction }[];

    const toAragorn = transfers.find(a => a.action.fromCharacterId === gimliId && a.action.toCharacterId === aragornId);
    const toBilbo = transfers.find(a => a.action.fromCharacterId === gimliId && a.action.toCharacterId === bilboId);

    expect(toAragorn?.action.regress).toBe(true);
    expect(toBilbo?.action.regress).toBe(true);
  });
});
