/**
 * @module rule-5.29-other-company-actions
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.29: Other Company Actions During M/H
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * During a company's movement/hazard phase, the company's player may take resource/character actions using entities associated with their other companies unless the action would cancel an attack or untap a site.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, addCardInPlay, makeMHState, viableActions, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, GANDALF, LEGOLAS,
  RIVENDELL, MORIA, LORIEN,
  findCharInstanceId,
} from '../../test-helpers.js';
import type { CardDefinitionId } from '../../test-helpers.js';
import type { PlayShortEventAction } from '../../../types/actions-short-event.js';

// Marvels Told (td-134): "Sage only. Tap a sage to force the discard of a
// hazard non-environment permanent-event or long-event." A tap-cost
// character-target resource short-event — a good probe for whether the
// target search spans all of the player's companies, not just the one
// currently in its M/H sub-phase.
const MARVELS_TOLD = 'td-134' as CardDefinitionId;
// Eye of Sauron (tw-32): hazard-event, long, non-environment — a valid
// discard target for Marvels Told.
const EYE_OF_SAURON_HAZARD = 'tw-32' as CardDefinitionId;

describe('Rule 5.29 — Other Company Actions During M/H', () => {
  beforeEach(() => resetMint());

  test('A sage in a company NOT currently in its M/H sub-phase is still a legal tap-target for a resource short-event', () => {
    // Company A (Aragorn, at Rivendell) is the active company resolving its
    // M/H phase. Company B (Gandalf, at Moria) is a completely different
    // company — not selected, not moving this sub-phase.
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN] },
            { site: MORIA, characters: [GANDALF] },
          ],
          hand: [MARVELS_TOLD],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...addCardInPlay(built, 1, EYE_OF_SAURON_HAZARD), phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const plays = viableActions(state, PLAYER_1, 'play-short-event') as { action: PlayShortEventAction }[];

    expect(plays.some(a => a.action.targetScoutInstanceId === gandalfId)).toBe(true);
  });

  // The "unless the action would cancel an attack or untap a site" carve-out
  // is not separately verified: cancel-attack short-events are scoped to the
  // single active combat by the combat system itself (there is no mechanism
  // by which a character in a different company could name a target for
  // canceling *this* company's attack), and no card currently exercises an
  // "untap a site" resource action to probe against. Both would need bespoke
  // fixtures rather than a general-purpose one.
  test.todo('A resource/character action that would cancel an attack or untap a site is not available using an entity from a different company');
});
