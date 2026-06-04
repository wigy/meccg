/**
 * @module as-94.test
 *
 * Card test: Orders from Lugbúrz (as-94)
 * Type: minion-resource-event (permanent)
 * Alignment: ringwraith
 *
 * Text:
 *   "Playable on a company. May be played with a starting company in lieu of a
 *    minor item. This company may contain a Troll leader in addition to another
 *    leader. +1 to all corruption checks by followers of Troll leaders in this
 *    company. Discard if Ren is your Ringwraith or when a leader leaves the
 *    company. Cannot be duplicated on a given company. Cannot be included in a
 *    Balrog's deck."
 *
 * Effects:
 *   1. play-target: company (binds the event to a company)
 *
 * Engine support table:
 * | # | Rule                                                | Status          | Notes                                               |
 * |---|-----------------------------------------------------|-----------------|-----------------------------------------------------|
 * | 1 | Playable on a company                               | IMPLEMENTED     | play-target: company                                |
 * | 2 | May be played with a starting company in lieu of item| NOT IMPLEMENTED| no DSL type / engine support                        |
 * | 3 | Company may contain Troll leader + another leader   | NOT IMPLEMENTED | no DSL type for extra-leader-slot override          |
 * | 4 | +1 CC for followers of Troll leaders                | NOT IMPLEMENTED | "followers of Troll leaders" condition not supported|
 * | 5 | Discard if Ren is your Ringwraith                   | NOT IMPLEMENTED | ringwraith identity conditions not in engine        |
 * | 6 | Discard when a leader leaves the company            | NOT IMPLEMENTED | company-membership-changes has no conditional discard|
 * | 7 | Cannot be duplicated on a given company             | NOT IMPLEMENTED | duplication-limit:company not enforced for co-events|
 *
 * Playable: PARTIALLY (not certified — rules 2–7 unimplemented)
 *
 * Fixtures:
 *   PERCHEN (as-4)       — minion man scout/diplomat, mind 5
 *   MINAS_MORGUL (le-390)— minion darkhaven (company site)
 *   DOL_GULDUR (le-367)  — minion haven (opponent site)
 *   ASTERNAK (le-1)      — minion man diplomat, opponent character
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  handCardId, viableActions, companyIdAt,
  playPermanentEventAndResolve,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayPermanentEventAction } from '../../index.js';

const ORDERS_FROM_LUGBURZ = 'as-94' as CardDefinitionId;
const PERCHEN = 'as-4' as CardDefinitionId;
const ASTERNAK = 'le-1' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const VARIAG_CAMP = 'le-411' as CardDefinitionId;

describe('Orders from Lugbúrz (as-94)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Playable on a company ─────────────────────────────────────────

  test('play-permanent-event action generated with targetCompanyId during organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [PERCHEN] }], hand: [ORDERS_FROM_LUGBURZ], siteDeck: [VARIAG_CAMP] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
    const action = actions[0].action as PlayPermanentEventAction;
    expect(action.targetCompanyId).toBe(companyIdAt(state, RESOURCE_PLAYER));
  });

  test('resolves into cardsInPlay bound to the target company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [PERCHEN] }], hand: [ORDERS_FROM_LUGBURZ], siteDeck: [VARIAG_CAMP] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });
    const cardInstanceId = handCardId(state, RESOURCE_PLAYER);
    const expectedCompanyId = companyIdAt(state, RESOURCE_PLAYER);

    const after = playPermanentEventAndResolve(state, PLAYER_1, cardInstanceId, undefined, {
      targetCompanyId: expectedCompanyId,
    });

    const inPlay = after.players[RESOURCE_PLAYER].cardsInPlay.find(
      c => c.instanceId === cardInstanceId,
    );
    expect(inPlay).toBeDefined();
    expect(inPlay?.companyId).toBe(expectedCompanyId);
  });

  // ── Rules 2–7: Not yet implemented ────────────────────────────────────────

  test.todo('playable-as-starting-item: may replace a minor item in starting company setup');

  test.todo('extra-troll-leader: company may contain a Troll leader in addition to another leader');

  test.todo('+1 to corruption checks by followers of Troll leaders in the company');

  test.todo('discard-if-ren: discard immediately if the player\'s Ringwraith is Ren');

  test.todo('discard-when-leader-leaves: discard when any leader leaves the bound company');

  test.todo('duplication-limit: cannot play a second copy on the same company');
});
