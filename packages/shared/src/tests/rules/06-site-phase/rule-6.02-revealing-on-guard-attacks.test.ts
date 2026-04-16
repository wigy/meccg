/**
 * @module rule-6.02-revealing-on-guard-attacks
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.02: Step 1 — Revealing On-Guard Attacks
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Entering a Site, Step 1 (Revealing On-Guard Attacks) - If the site has one or more automatic-attacks when the company enters, the hazard player may reveal and play on-guard cards placed on the site if either of the following criteria is met:
 * • The on-guard card is a creature that may be keyed to the site (in which case, it attacks after the automatic-attacks).
 * • The on-guard card is a hazard event that would affect the automatic-attack(s) of the site.
 * Other on-guard events may also be revealed when the company attempts to play a resource that taps the site (as described later in the site phase rules). No other actions can be taken during this step, which happens immediately.
 * Adding an additional automatic-attack or removing an existing automatic-attack counts as affecting a site's automatic-attack(s) for the purpose of revealing an on-guard event.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, dispatch,
  makeSitePhase, placeOnGuard, viableActions, viableFor,
  phaseStateAs,
  PLAYER_1, PLAYER_2,
  LEGOLAS, ARAGORN,
  ASSASSIN, BARROW_WIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';
import type { SitePhaseState, RevealOnGuardAction } from '../../../index.js';

/** Common two-player state with PLAYER_1 at a given site. */
function buildSiteState(site: typeof MORIA) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, companies: [{ site, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

describe('Rule 6.02 — Step 1: Revealing On-Guard Attacks', () => {
  beforeEach(() => resetMint());

  test('hazard player gets RevealOnGuardAction for creatures keyed to the site', () => {
    // Barrow-wight is keyed to shadow-hold sites. Moria is a shadow-hold with auto-attacks.
    const base = buildSiteState(MORIA);
    const { state: withOG, ogCard } = placeOnGuard(base, 0, 0, BARROW_WIGHT);
    const testState = { ...withOG, phaseState: makeSitePhase({ step: 'reveal-on-guard-attacks', siteEntered: false }) };

    const revealActions = viableActions(testState, PLAYER_2, 'reveal-on-guard');
    expect(revealActions.length).toBeGreaterThanOrEqual(1);
    expect((revealActions[0].action as RevealOnGuardAction).cardInstanceId).toBe(ogCard.instanceId);
  });

  test('non-keyable creatures are NOT offered for reveal', () => {
    // Assassin is keyed only to free-hold and border-hold sites (no
    // wilderness/shadow/dark region match either). Moria is a shadow-hold
    // with sitePath ["wilderness","wilderness"] — Assassin is NOT keyable
    // here, so it must not appear among reveal-on-guard actions even
    // though Barrow-wight on the same company would be keyable.
    const base = buildSiteState(MORIA);
    const { state: og1 } = placeOnGuard(base, 0, 0, ASSASSIN);
    const { state: og2, ogCard: bwCard } = placeOnGuard(og1, 0, 0, BARROW_WIGHT);
    const testState = { ...og2, phaseState: makeSitePhase({ step: 'reveal-on-guard-attacks', siteEntered: false }) };

    const reveals = viableActions(testState, PLAYER_2, 'reveal-on-guard');
    // Only the keyable Barrow-wight is offered; Assassin is filtered out.
    expect(reveals).toHaveLength(1);
    expect((reveals[0].action as RevealOnGuardAction).cardInstanceId).toBe(bwCard.instanceId);
  });

  test('active player (resource) has no actions during reveal-on-guard-attacks step', () => {
    const base = buildSiteState(MORIA);
    const { state: withOG } = placeOnGuard(base, 0, 0, BARROW_WIGHT);
    const testState = { ...withOG, phaseState: makeSitePhase({ step: 'reveal-on-guard-attacks', siteEntered: false }) };

    expect(viableFor(testState, PLAYER_1)).toHaveLength(0);
  });

  test('hazard player passing advances to automatic-attacks step', () => {
    const base = buildSiteState(MORIA);
    const testState = { ...base, phaseState: makeSitePhase({ step: 'reveal-on-guard-attacks', siteEntered: false }) };

    const nextState = dispatch(testState, { type: 'pass', player: PLAYER_2 });
    expect(phaseStateAs<SitePhaseState>(nextState).step).toBe('automatic-attacks');
  });

  test('revealing a creature marks it as revealed in onGuardCards', () => {
    const base = buildSiteState(MORIA);
    const { state: withOG, ogCard } = placeOnGuard(base, 0, 0, BARROW_WIGHT);
    const testState = { ...withOG, phaseState: makeSitePhase({ step: 'reveal-on-guard-attacks', siteEntered: false }) };

    const nextState = dispatch(testState, { type: 'reveal-on-guard', player: PLAYER_2, cardInstanceId: ogCard.instanceId });
    const og = nextState.players[0].companies[0].onGuardCards;
    expect(og).toHaveLength(1);
    expect(og[0].instanceId).toBe(ogCard.instanceId);
    expect(og[0].revealed).toBe(true);
  });

  test('creature reveal is NOT offered at sites without automatic-attacks', () => {
    // Rivendell is a haven with no automatic-attacks.
    // Even a keyable creature cannot be revealed here per rule 2.V.i.
    const base = buildSiteState(RIVENDELL);
    const { state: withOG } = placeOnGuard(base, 0, 0, BARROW_WIGHT);
    const testState = { ...withOG, phaseState: makeSitePhase({ step: 'reveal-on-guard-attacks', siteEntered: false }) };

    const revealActions = viableActions(testState, PLAYER_2, 'reveal-on-guard');
    expect(revealActions).toHaveLength(0);
    expect(viableActions(testState, PLAYER_2, 'pass')).toHaveLength(1);
  });
});
