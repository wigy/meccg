/**
 * @module le-143.test
 *
 * Card test: Tidings of Bold Spies (le-143)
 * Type: hazard-event (short)
 *
 * Card text:
 *   "Playable on a company moving to a site with an automatic-attack. This card
 *    creates one or more attacks on the company, the total of which duplicates
 *    exactly (including modifications) all automatic-attacks at the site. These
 *    attacks must be faced immediately and are not considered automatic-attacks."
 *
 * Effects:
 *   1. play-restriction: only playable when destination site has at least one
 *      automatic-attack (not currently enforced by engine)
 *   2. duplicate-site-auto-attacks: creates immediate combat attacks matching
 *      the site's auto-attacks exactly; attacks are NOT auto-attacks
 *
 * | # | Effect                            | Status          | Notes                                                 |
 * |---|-----------------------------------|-----------------|-------------------------------------------------------|
 * | 1 | play-restriction (auto-attack site)| NOT IMPLEMENTED | engine does not check destination site auto-attacks   |
 * | 2 | duplicate-site-auto-attacks        | NOT IMPLEMENTED | automatic attacks are not implemented (pass-through); |
 * |   |                                   |                 | no mechanic exists for short events to create combat  |
 *
 * Playable: PARTIALLY
 * NOT CERTIFIED — auto-attack system not implemented; short-event-creates-combat not implemented.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  MORIA, RIVENDELL, LORIEN, MINAS_TIRITH,
  makeMHState,
  viableActions,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const TIDINGS_OF_BOLD_SPIES = 'le-143' as CardDefinitionId;

describe('Tidings of Bold Spies (le-143)', () => {
  beforeEach(() => resetMint());

  // ─── Basic playability ────────────────────────────────────────────────────
  // Tidings is a hazard short-event. The engine currently does not check
  // whether the target company's destination site has auto-attacks, so the
  // card is offered against any moving company. Once auto-attacks are
  // implemented, the offering should be restricted to companies whose
  // destination has at least one auto-attack.

  test('offered as a hazard short-event against a moving company in M/H phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [TIDINGS_OF_BOLD_SPIES],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    // Moria (ruins-and-lairs) has auto-attacks. Put the company moving toward it.
    const readyState = {
      ...state,
      phaseState: makeMHState({
        hazardsPlayedThisCompany: 0,
        hazardLimitAtReveal: 4,
        destinationSiteName: 'Moria',
      }),
    };

    const actions = viableActions(readyState, PLAYER_2, 'play-hazard');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ─── Core rule — NOT IMPLEMENTED ─────────────────────────────────────────

  test.todo(
    'only playable against a company whose destination site has at least one automatic-attack',
  );

  test.todo(
    'creates immediate non-auto-attack attacks duplicating all site auto-attacks ' +
    '(same number of strikes, prowess, and body as the original auto-attacks)',
  );

  test.todo(
    'created attacks must be faced immediately during the M/H phase, before the site phase',
  );

  test.todo(
    'created attacks are NOT considered automatic-attacks (auto-attack modifiers do not apply)',
  );
});
