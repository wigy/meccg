/**
 * @module rule-6.18-untap-site-restriction
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.18: Untap Site Restriction
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A resource/character action can only untap a site if it is on an entity associated with a company at the site.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch,
  makeSitePhase, setCompanySiteStatus, viableActions,
  PLAYER_1, PLAYER_2,
  ELROND, ARAGORN, LEGOLAS,
  LORIEN, MORIA,
  CardStatus, Phase,
} from '../../test-helpers.js';
import type { CardDefinitionId } from '../../test-helpers.js';

// The Worthy Hills (as-142): grant-action "untap-site", cost sage-and-scout-in-company —
// both roles must come from the company currently at the site.
const THE_WORTHY_HILLS = 'as-142' as CardDefinitionId;

function untapActionsFor(playerIdx: 0 | 1, companies: { site: CardDefinitionId; characters: CardDefinitionId[] }[]) {
  const built = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, companies, hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
    ],
  });
  const tapped = setCompanySiteStatus(built, playerIdx, 0, CardStatus.Tapped);
  const state = { ...tapped, phaseState: makeSitePhase({ activeCompanyIndex: 0 }) };
  return viableActions(state, PLAYER_1, 'activate-granted-action')
    .filter(a => (a.action as { actionId?: string }).actionId === 'untap-site');
}

describe('Rule 6.18 — Untap Site Restriction', () => {
  beforeEach(() => resetMint());

  test('a scout in a different company cannot pair with this company\'s sage to untap this site', () => {
    // Company 0 (at the tapped Worthy Hills) has only Elrond (sage, no scout).
    // Company 1 (at Moria) has Aragorn (scout) — a different company entirely.
    const untapActions = untapActionsFor(0, [
      { site: THE_WORTHY_HILLS, characters: [ELROND] },
      { site: MORIA, characters: [ARAGORN] },
    ]);
    expect(untapActions).toHaveLength(0);
  });

  test('both roles present in the company at the site DOES offer untap-site', () => {
    // Positive control: Elrond (sage) and Aragorn (scout) both in the one
    // company actually at The Worthy Hills.
    const untapActions = untapActionsFor(0, [
      { site: THE_WORTHY_HILLS, characters: [ELROND, ARAGORN] },
    ]);
    expect(untapActions.length).toBeGreaterThan(0);
  });

  test('activating untap-site only ever untaps the acting company\'s own current site', () => {
    // Two companies of the same player: company 0 (with the sage+scout pair)
    // is at the tapped Worthy Hills; company 1 sits at a separately-tracked
    // Moria instance. Confirm activating the grant-action untaps company 0's
    // site without touching company 1's site status at all.
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [
          { site: THE_WORTHY_HILLS, characters: [ELROND, ARAGORN] },
          { site: MORIA, characters: [] },
        ], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const tappedBoth = setCompanySiteStatus(
      setCompanySiteStatus(built, 0, 0, CardStatus.Tapped),
      0, 1, CardStatus.Tapped,
    );
    const state = { ...tappedBoth, phaseState: makeSitePhase({ activeCompanyIndex: 0 }) };

    const untapActs = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(a => (a.action as { actionId?: string }).actionId === 'untap-site');
    expect(untapActs.length).toBeGreaterThan(0);

    const next = dispatch(state, untapActs[0].action);
    expect(next.players[0].companies[0].currentSite!.status).toBe(CardStatus.Untapped);
    // Company 1's Moria is untouched — still tapped.
    expect(next.players[0].companies[1].currentSite!.status).toBe(CardStatus.Tapped);
  });
});
