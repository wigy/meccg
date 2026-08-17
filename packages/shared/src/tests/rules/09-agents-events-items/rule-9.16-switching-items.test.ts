/**
 * @module rule-9.16-switching-items
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.16: Switching Items
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The resource player may declare that one of their characters will begin using an item that the character is bearing but not currently using, which causes the item's effects to be implemented upon resolution for as long as the item is still in use on the character.
 * A character may bear multiple items with the same keyword, but only one weapon, armor, shield, and helmet item may be in use on a character at a time (i.e. one of each type). If a character begins using a new item while already using an item of the same type of which only one item can be in use, the previous item's effects cease immediately.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, viableActions, findCharInstanceId,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  BEREGOND, LEGOLAS,
  GLAMDRING, DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, MINAS_TIRITH,
} from '../../test-helpers.js';
import { Phase } from '../../../types/state-phases.js';
import type { CardDefinitionId } from '../../../types/common.js';
import type { UseItemAction } from '../../../types/actions-organization.js';

/** Hauberk of Bright Mail — armor, so it occupies a different slot to a weapon. */
const HAUBERK_OF_BRIGHT_MAIL = 'tw-254' as CardDefinitionId;

describe('Rule 9.16 — Switching Items', () => {
  beforeEach(() => resetMint());

  test('a character bearing two weapons uses only the first, and may declare the other', () => {
    // Beregond (prowess 4) bears the Dagger of Westernesse (+1 prowess) and
    // then Glamdring (+3) — both well under either item's maximum, so the
    // difference between them is visible. Only one weapon is in use at a time,
    // and absent a declaration the engine takes the first-carried: the Dagger
    // is live and Glamdring is merely borne. The rule lets the player say
    // otherwise.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: BEREGOND, items: [DAGGER_OF_WESTERNESSE, GLAMDRING] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const beregondId = findCharInstanceId(state, RESOURCE_PLAYER, BEREGOND);
    const beregond = state.players[RESOURCE_PLAYER].characters[beregondId];
    const daggerId = beregond.items[0].instanceId;
    const glamdringId = beregond.items[1].instanceId;
    const withDagger = beregond.effectiveStats.prowess;

    // Only the unused weapon is offered — declaring the one already in use
    // would change nothing.
    const offers = viableActions(state, PLAYER_1, 'use-item') as { action: UseItemAction }[];
    expect(offers).toHaveLength(1);
    expect(offers[0].action.characterInstanceId).toBe(beregondId);
    expect(offers[0].action.itemInstanceId).toBe(glamdringId);

    // Declaring Glamdring puts it in use; the Dagger's +1 ceases at the same
    // moment, so the net change is +3 − +1 = +2.
    const after = dispatch(state, offers[0].action);
    const afterBeregond = after.players[RESOURCE_PLAYER].characters[beregondId];
    expect(afterBeregond.itemsInUse).toEqual([glamdringId]);
    expect(afterBeregond.effectiveStats.prowess).toBe(withDagger + 2);
    // Both items are still borne — a switch moves nothing.
    expect(afterBeregond.items.map(i => i.instanceId)).toEqual([daggerId, glamdringId]);
  });

  test('after switching, the displaced weapon becomes the one that may be declared', () => {
    // The offer set follows what is actually in use: once Glamdring holds the
    // weapon slot, the Dagger is the item the player may switch back to.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: BEREGOND, items: [DAGGER_OF_WESTERNESSE, GLAMDRING] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const beregondId = findCharInstanceId(state, RESOURCE_PLAYER, BEREGOND);
    const beregond = state.players[RESOURCE_PLAYER].characters[beregondId];
    const daggerId = beregond.items[0].instanceId;
    const glamdringId = beregond.items[1].instanceId;
    const withDagger = beregond.effectiveStats.prowess;

    const switched = dispatch(state, {
      type: 'use-item', player: PLAYER_1,
      characterInstanceId: beregondId, itemInstanceId: glamdringId,
    });
    const back = viableActions(switched, PLAYER_1, 'use-item') as { action: UseItemAction }[];
    expect(back.map(a => a.action.itemInstanceId)).toEqual([daggerId]);

    // Switching back drops Glamdring's +3 and restores the Dagger's +1 — one
    // weapon per slot throughout, never both at once.
    const restored = dispatch(switched, back[0].action);
    const restoredBeregond = restored.players[RESOURCE_PLAYER].characters[beregondId];
    expect(restoredBeregond.itemsInUse).toEqual([daggerId]);
    expect(restoredBeregond.effectiveStats.prowess).toBe(withDagger);
  });

  test('switching back is marked as undoing the switch', () => {
    // Two items sharing a slot can be declared against each other forever:
    // whichever is in use, the other is a legal declaration. The engine's
    // reverse-action bookkeeping is what stops an AI riding that loop — the
    // switch back must come stamped `regress`, as a re-merge of a split company
    // does. Unstamped, a self-play game spent 23000 decisions passing one
    // character's armor slot between two copies of the same hauberk.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: BEREGOND, items: [DAGGER_OF_WESTERNESSE, GLAMDRING] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const beregondId = findCharInstanceId(state, RESOURCE_PLAYER, BEREGOND);
    const beregond = state.players[RESOURCE_PLAYER].characters[beregondId];
    const daggerId = beregond.items[0].instanceId;
    const glamdringId = beregond.items[1].instanceId;

    // The first declaration undoes nothing, so it carries no flag.
    const first = viableActions(state, PLAYER_1, 'use-item') as { action: UseItemAction }[];
    expect(first[0].action.regress).toBeUndefined();

    const switched = dispatch(state, {
      type: 'use-item', player: PLAYER_1,
      characterInstanceId: beregondId, itemInstanceId: glamdringId,
    });

    const back = viableActions(switched, PLAYER_1, 'use-item') as { action: UseItemAction }[];
    expect(back.map(a => a.action.itemInstanceId)).toEqual([daggerId]);
    expect(back[0].action.regress).toBe(true);
  });

  test('a character with one item per slot has nothing to declare', () => {
    // Glamdring (weapon) and the Hauberk of Bright Mail (armor) occupy
    // different slots, so both are already in use and neither is a candidate.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: BEREGOND, items: [GLAMDRING, HAUBERK_OF_BRIGHT_MAIL] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'use-item')).toHaveLength(0);
  });

  test('an item the character does not bear cannot be declared in use', () => {
    // The declaration is scoped to items the character is *bearing* — Legolas's
    // weapon is not Beregond's to wield.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              { defId: BEREGOND, items: [DAGGER_OF_WESTERNESSE, GLAMDRING] },
              { defId: LEGOLAS, items: [DAGGER_OF_WESTERNESSE] },
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const beregondId = findCharInstanceId(state, RESOURCE_PLAYER, BEREGOND);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const legolasDagger = state.players[RESOURCE_PLAYER].characters[legolasId].items[0].instanceId;

    const offered = viableActions(state, PLAYER_1, 'use-item') as { action: UseItemAction }[];
    expect(offered.some(a =>
      a.action.characterInstanceId === beregondId && a.action.itemInstanceId === legolasDagger,
    )).toBe(false);
  });

  test('a declared item that later leaves the character does not hold its slot', () => {
    // Beregond declares Glamdring, then transfers it to Legolas. The stale
    // declaration must not keep the weapon slot reserved: the Dagger he still
    // bears comes back into use on its own.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              { defId: BEREGOND, items: [DAGGER_OF_WESTERNESSE, GLAMDRING] },
              { defId: LEGOLAS },
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const beregondId = findCharInstanceId(state, RESOURCE_PLAYER, BEREGOND);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const beregond = state.players[RESOURCE_PLAYER].characters[beregondId];
    const glamdringId = beregond.items[1].instanceId;
    const withDagger = beregond.effectiveStats.prowess;

    const switched = dispatch(state, {
      type: 'use-item', player: PLAYER_1,
      characterInstanceId: beregondId, itemInstanceId: glamdringId,
    });
    const given = dispatch(switched, {
      type: 'transfer-item', player: PLAYER_1,
      itemInstanceId: glamdringId, fromCharacterId: beregondId, toCharacterId: legolasId,
    });
    const afterBeregond = given.players[RESOURCE_PLAYER].characters[beregondId];
    expect(afterBeregond.items.map(i => i.instanceId)).not.toContain(glamdringId);
    expect(afterBeregond.effectiveStats.prowess).toBe(withDagger);
  });
});
