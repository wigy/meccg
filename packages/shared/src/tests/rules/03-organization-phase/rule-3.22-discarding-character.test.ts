/**
 * @module rule-3.22-discarding-character
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.22: Discarding a Character
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The resource player can only discard a character while organizing if that character is not an avatar and is at a haven or its home site.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase } from '../../../index.js';
import type { DiscardCharacterOrgAction } from '../../../index.js';
import {
  buildTestState, resetMint, dispatch, viableActions,
  findCharInstanceId, attachItemToChar, expectInDiscardPile,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS, GIMLI, GANDALF,
  RIVENDELL, BREE, LORIEN, MINAS_TIRITH, DAGGER_OF_WESTERNESSE,
} from '../../test-helpers.js';

describe('Rule 3.22 — Discarding a Character', () => {
  beforeEach(() => resetMint());

  test('a non-avatar character at a haven can be discarded while organizing', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);

    const actions = viableActions(state, PLAYER_1, 'discard-character');
    // Both non-avatar characters qualify at a haven.
    expect(actions).toHaveLength(2);
    const discardLegolas = actions.find(
      ea => (ea.action as DiscardCharacterOrgAction).characterInstanceId === legolasId,
    );
    expect(discardLegolas).toBeDefined();

    const after = dispatch(state, discardLegolas!.action);
    expect(after.players[RESOURCE_PLAYER].characters[legolasId]).toBeUndefined();
    expect(after.players[RESOURCE_PLAYER].companies[0].characters).not.toContain(legolasId);
    expectInDiscardPile(after, RESOURCE_PLAYER, LEGOLAS);
  });

  test('at a non-haven site only a character at its home site can be discarded', () => {
    // Bree is Aragorn II's home site but not Legolas's — so while organizing
    // at Bree (a border-hold, not a haven) only Aragorn may be discarded.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const actions = viableActions(state, PLAYER_1, 'discard-character');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as DiscardCharacterOrgAction).characterInstanceId).toBe(aragornId);
  });

  test('an avatar can never be discarded, even at a haven', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);

    const actions = viableActions(state, PLAYER_1, 'discard-character');
    const targets = actions.map(ea => (ea.action as DiscardCharacterOrgAction).characterInstanceId);
    expect(targets).not.toContain(gandalfId);
    expect(targets).toHaveLength(1); // only Aragorn
  });

  test('discarding a leader sends possessions to the discard pile and frees followers to GI immediately', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              { defId: ARAGORN },
              { defId: LEGOLAS, followerOf: 0 },
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);

    const discardAragorn = viableActions(state, PLAYER_1, 'discard-character')
      .find(ea => (ea.action as DiscardCharacterOrgAction).characterInstanceId === aragornId);
    expect(discardAragorn).toBeDefined();
    const after = dispatch(state, discardAragorn!.action);

    // Aragorn and his item are discarded; the company keeps Legolas.
    expectInDiscardPile(after, RESOURCE_PLAYER, ARAGORN);
    expectInDiscardPile(after, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE);
    expect(after.players[RESOURCE_PLAYER].companies[0].characters).toEqual([legolasId]);

    // Legolas reverts to general influence immediately — the removal happens
    // during the player's own organization phase, so rule 3.13's deferral
    // does not apply.
    const legolas = after.players[RESOURCE_PLAYER].characters[legolasId];
    expect(legolas.controlledBy).toBe('general');
    expect(legolas.influenceUnsubtracted).toBeUndefined();
  });
});
