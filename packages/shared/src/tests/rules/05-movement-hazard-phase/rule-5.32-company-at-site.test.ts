/**
 * @module rule-5.32-company-at-site
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.32: Company "At" Its Site
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A company is considered to be "at" its site card at all times except from the moment when its new site card is revealed until immediately prior to the company's player's site phases after the end of all movement/hazard phases for the turn.
 */

import { describe, test, expect } from 'vitest';
import {
  buildTestState, resetMint, viableActions, makeMHState,
  PLAYER_1, PLAYER_2, MINAS_TIRITH, LORIEN, ARAGORN, LEGOLAS,
} from '../../test-helpers.js';
import type { CardDefinitionId, GameState } from '../../../index.js';
import { Phase } from '../../../index.js';

// tw-316 Return of the King: "Only playable in Minas Tirith" — a
// site-name-gated permanent event with no site-phase timing of its own,
// evaluated directly by the movement/hazard-phase legal-action path (rule
// 2.1.1). Single-use card ID per project convention.
const RETURN_OF_THE_KING = 'tw-316' as CardDefinitionId;

describe('Rule 5.32 — Company "At" Its Site', () => {
  // The engine has no separate "en route" / "not at a site" state field: a
  // moving company's `currentSite` is reassigned to the new site as soon as
  // ITS OWN M/H sub-phase completes (mh-hazard-play.ts, "Step 8a: Complete
  // movement"), not deferred until every company's M/H phase for the turn
  // has finished. `isCompanyAtSite` (reducer-utils.ts) derives the "at site"
  // predicate rule 5.32 describes without a new field: a company that moved
  // this turn (`company.moved === true`) is "en route" for as long as
  // `state.phaseState.phase === Phase.MovementHazard`, regardless of which
  // company is currently active — matching CRF-22 Annotation 25's
  // clarification that a moving company is not at a site until the site
  // phase. `matchesCompanyContextCondition` and the Return of the King
  // site-target path consult it before matching a card's site-name/type
  // condition.
  //
  // Concrete violation this closes: a player moved a company (Aragorn II)
  // to Minas Tirith, its own hazard resolution finished, and priority moved
  // to another company still in its own M/H sub-phase — yet Return of the
  // King (tw-316, "Only playable in Minas Tirith") and Choice of Lúthien
  // (dm-120, "Playable on Arwen in Minas Tirith") were both offered, even
  // though the company had not yet reached its site phase.
  test('a company that moved to Minas Tirith this turn is not "at" it until the site phase — Return of the King (tw-316) not offered', () => {
    resetMint();
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [RETURN_OF_THE_KING], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state: GameState = {
      ...base,
      players: [
        { ...base.players[0], companies: [{ ...base.players[0].companies[0], moved: true }] },
        base.players[1],
      ] as typeof base.players,
      phaseState: makeMHState({ activeCompanyIndex: 0 }),
    };
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });
});
