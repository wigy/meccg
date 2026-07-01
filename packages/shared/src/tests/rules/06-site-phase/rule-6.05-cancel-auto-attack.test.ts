/**
 * @module rule-6.05-cancel-auto-attack
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.05: Canceling Automatic-Attacks
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A character at one of its home sites may be tapped to cancel an automatic-attack at that site if the home site is named (i.e. not "any Dark-Hold").
 * Removing an automatic-attack from a site is not the same as canceling the actual attack, and thus cannot be done by the resource player during a site phase prior to entering the site.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildSitePhaseTwoPlayer, resetMint, dispatch,
  makeSitePhase, setupAutoAttackStep, viableActions, phaseStateAs,
  PLAYER_1,
  ARAGORN,
  findCharInstanceId,
} from '../../test-helpers.js';
import { FRODO, BAG_END_LE } from '../../../card-ids.js';
import { CardStatus } from '../../../types/common.js';
import type { SitePhaseState } from '../../../index.js';

describe('Rule 6.05 — Canceling Automatic-Attacks', () => {
  beforeEach(() => resetMint());

  test('character at named home site may tap to cancel the next automatic-attack', () => {
    // Bag End (le-350) has 2 auto-attacks: 1st Hobbits (5 strikes, 5 prowess),
    // 2nd Dúnedain (3 strikes, 11 prowess). Frodo's homesite is "Bag End".
    const base = buildSitePhaseTwoPlayer({ site: BAG_END_LE, heroChars: [FRODO] });
    const state = setupAutoAttackStep({ ...base, phaseState: makeSitePhase({ siteEntered: false }) });
    const frodoId = findCharInstanceId(state, 0, FRODO);

    const cancelActions = viableActions(state, PLAYER_1, 'cancel-auto-attack');
    expect(cancelActions).toHaveLength(1);
    expect((cancelActions[0].action as { characterId: unknown }).characterId).toBe(frodoId);

    const afterCancel = dispatch(state, cancelActions[0].action);

    // Canceled — no combat initiated, but the attack still counts as faced.
    expect(afterCancel.combat).toBeNull();
    expect(phaseStateAs<SitePhaseState>(afterCancel).automaticAttacksResolved).toBe(1);
    expect(afterCancel.players[0].characters[frodoId].status).toBe(CardStatus.Tapped);

    // Passing now faces the 2nd (Dúnedain) attack — the 1st was canceled, not removed.
    const afterPass = dispatch(afterCancel, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat).not.toBeNull();
    expect(afterPass.combat!.strikesTotal).toBe(3);
    expect(afterPass.combat!.strikeProwess).toBe(11);
    expect(afterPass.combat!.creatureRace).toBe('dunadan');
  });

  test('a tapped home-site character cannot cancel an attack', () => {
    const base = buildSitePhaseTwoPlayer({ site: BAG_END_LE, heroChars: [FRODO] });
    const state = setupAutoAttackStep({ ...base, phaseState: makeSitePhase({ siteEntered: false }) });
    const frodoId = findCharInstanceId(state, 0, FRODO);
    const tappedState = {
      ...state,
      players: [
        {
          ...state.players[0],
          characters: {
            ...state.players[0].characters,
            [frodoId]: { ...state.players[0].characters[frodoId], status: CardStatus.Tapped },
          },
        },
        state.players[1],
      ] as typeof state.players,
    };

    expect(viableActions(tappedState, PLAYER_1, 'cancel-auto-attack')).toHaveLength(0);
  });

  test('a character whose home site does not match the current site cannot cancel', () => {
    // Aragorn's homesite is "Bree", not "Bag End" — no cancel option offered.
    const base = buildSitePhaseTwoPlayer({ site: BAG_END_LE, heroChars: [ARAGORN] });
    const state = setupAutoAttackStep({ ...base, phaseState: makeSitePhase({ siteEntered: false }) });

    expect(viableActions(state, PLAYER_1, 'cancel-auto-attack')).toHaveLength(0);
    expect(viableActions(state, PLAYER_1, 'pass')).toHaveLength(1);
  });

  // "Removing an automatic-attack from a site is not the same as canceling the
  // actual attack, and thus cannot be done by the resource player during a
  // site phase prior to entering the site": the resource player's only
  // actions before/during the automatic-attacks step are `pass` and (this
  // rule's) `cancel-auto-attack` — there is no action anywhere in the site
  // phase's legal-action set that strips an attack from `siteDef.automaticAttacks`
  // or from `getActiveAutoAttacks`'s output; only hazard-side/permanent-event
  // machinery (e.g. Vile Fumes' `replace-automatic-attacks`) can do that, and
  // it is never offered to the resource player.
  test.todo('resource player has no action that removes (rather than cancels) an automatic-attack');
});
