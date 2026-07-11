/**
 * @module rule-6.19-other-company-site-actions
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.19: Other Company Actions During Site Phase
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * During a company's site phase, the company's player may take resource/character actions using entities associated with one of their other companies that has already entered its own site this turn (unless the action would cancel an attack or untap a site).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, addCardInPlay, makeSitePhase, viableActions, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, GANDALF, LEGOLAS,
  RIVENDELL, MORIA, LORIEN,
  findCharInstanceId,
} from '../../test-helpers.js';
import type { CardDefinitionId } from '../../test-helpers.js';
import type { PlayShortEventAction } from '../../../types/actions-short-event.js';
import { reduce } from '../../../engine/reducer.js';

// Marvels Told (td-134): "Sage only. Tap a sage to force the discard of a
// hazard non-environment permanent-event or long-event." A tap-cost
// character-target resource short-event — the same probe rule-5.29 uses for
// the M/H phase, reused here to check the site phase's company scoping.
const MARVELS_TOLD = 'td-134' as CardDefinitionId;
// Eye of Sauron (tw-32): hazard-event, long, non-environment — a valid
// discard target for Marvels Told.
const EYE_OF_SAURON_HAZARD = 'tw-32' as CardDefinitionId;

describe('Rule 6.19 — Other Company Actions During Site Phase', () => {
  beforeEach(() => resetMint());

  test('a sage in a company not yet handled this site phase is still a legal tap-target for a resource short-event', () => {
    // Company A (Aragorn, at Rivendell) is the active company in its site
    // phase (select-company step). Company B (Gandalf, at Moria) has not
    // been handled yet this site phase — handledCompanyIds is empty.
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
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
    const state = {
      ...addCardInPlay(built, 1, EYE_OF_SAURON_HAZARD),
      phaseState: makeSitePhase({ step: 'select-company', activeCompanyIndex: 0, handledCompanyIds: [] }),
    };

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const plays = viableActions(state, PLAYER_1, 'play-short-event') as { action: PlayShortEventAction }[];

    expect(plays.some(a => a.action.targetScoutInstanceId === gandalfId)).toBe(true);
  });

  // Regression (game mrevwcn5-itaw75, seq 193): the AI froze after playing a
  // resource short-event during the select-company step. `siteActions` offered
  // the play (per rule 2.1.1, above), but the reducer's select-company handler
  // rejected any action that was not `select-company`, so the play produced an
  // error with no state update — the client/AI received nothing and got stuck.
  // Playing a resource short-event during select-company must be accepted.
  test('a resource short-event played during the select-company step is accepted by the reducer, not rejected', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
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
    const state = {
      ...addCardInPlay(built, 1, EYE_OF_SAURON_HAZARD),
      phaseState: makeSitePhase({ step: 'select-company', activeCompanyIndex: 0, handledCompanyIds: [] }),
    };

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const plays = viableActions(state, PLAYER_1, 'play-short-event') as { action: PlayShortEventAction }[];
    const play = plays.find(a => a.action.targetScoutInstanceId === gandalfId);
    expect(play).toBeDefined();

    const { state: after, error } = reduce(state, play!.action);

    // The reducer must not reject an action it advertised as legal.
    expect(error).toBeUndefined();
    // Marvels Told left the hand — proof the short-event actually played
    // rather than being bounced with the state unchanged.
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === play!.action.cardInstanceId)).toBe(false);
  });

  // The "unless the action would cancel an attack or untap a site" carve-out
  // is not separately verified. Checked both halves concretely, mirroring
  // rule-5.29's M/H-phase equivalent:
  // - "untap a site": `sitePhaseGrantActions` (site-declared untap-site, e.g.
  //   The Worthy Hills as-142) is scoped to the active company's own
  //   `company.characters` only (see rule-6.18) — it never scans sibling
  //   companies, so there is no cross-company path to restrict. The other
  //   untap-site grant-actions in the card pool (Records Unread as-130,
  //   Thrór's Map as-134/td-158) are item-borne and gated to the
  //   organization phase only (no `activeSitePhase`/`anyPhase` flag), so
  //   they are not reachable during the site phase at all yet.
  // - "cancel an attack": cancel-attack short-events are scoped to the
  //   single active combat by the combat system itself — there is no
  //   mechanism by which a character in a different company could even name
  //   a target for canceling *this* company's attack.
  test.todo('a resource/character action that would cancel an attack or untap a site is not available using an entity from a different company');
});
