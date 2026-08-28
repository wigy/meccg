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
  resetMint, dispatch,
  makeSitePhase, placeOnGuard, viableActions, viableFor,
  phaseStateAs, buildSitePhaseTwoPlayer,
  PLAYER_1, PLAYER_2,
  ARAGORN,
  ASSASSIN, BARROW_WIGHT, HOBGOBLINS,
  RIVENDELL, MORIA, RESOURCE_PLAYER, HAZARD_PLAYER,
  BANDIT_LAIR,
} from '../../test-helpers.js';
import type { SitePhaseState, RevealOnGuardAction, CardDefinitionId } from '../../../index.js';

const FIRST_COMPANY = 0;
const REVEAL_ON_GUARD_STEP = makeSitePhase({ step: 'reveal-on-guard-attacks', siteEntered: false });
const AROUSE_DENIZENS = 'tw-6' as CardDefinitionId;

describe('Rule 6.02 — Step 1: Revealing On-Guard Attacks', () => {
  beforeEach(() => resetMint());

  test('hazard player gets RevealOnGuardAction for creatures keyed to the site', () => {
    // Barrow-wight is keyed to shadow-hold sites. Moria is a shadow-hold with auto-attacks.
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN] });
    const { state: withOG, ogCard } = placeOnGuard(base, RESOURCE_PLAYER, FIRST_COMPANY, BARROW_WIGHT);
    const testState = { ...withOG, phaseState: REVEAL_ON_GUARD_STEP };

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
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN] });
    const { state: og1 } = placeOnGuard(base, RESOURCE_PLAYER, FIRST_COMPANY, ASSASSIN);
    const { state: og2, ogCard: bwCard } = placeOnGuard(og1, RESOURCE_PLAYER, FIRST_COMPANY, BARROW_WIGHT);
    const testState = { ...og2, phaseState: REVEAL_ON_GUARD_STEP };

    const reveals = viableActions(testState, PLAYER_2, 'reveal-on-guard');
    // Only the keyable Barrow-wight is offered; Assassin is filtered out.
    expect(reveals).toHaveLength(1);
    expect((reveals[0].action as RevealOnGuardAction).cardInstanceId).toBe(bwCard.instanceId);
  });

  test('active player (resource) has no actions during reveal-on-guard-attacks step', () => {
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN] });
    const { state: withOG } = placeOnGuard(base, RESOURCE_PLAYER, FIRST_COMPANY, BARROW_WIGHT);
    const testState = { ...withOG, phaseState: REVEAL_ON_GUARD_STEP };

    expect(viableFor(testState, PLAYER_1)).toHaveLength(0);
  });

  test('hazard player passing advances to automatic-attacks step', () => {
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN] });
    const testState = { ...base, phaseState: REVEAL_ON_GUARD_STEP };

    const nextState = dispatch(testState, { type: 'pass', player: PLAYER_2 });
    expect(phaseStateAs<SitePhaseState>(nextState).step).toBe('automatic-attacks');
  });

  test('revealing a creature marks it as revealed in onGuardCards', () => {
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN] });
    const { state: withOG, ogCard } = placeOnGuard(base, RESOURCE_PLAYER, FIRST_COMPANY, BARROW_WIGHT);
    const testState = { ...withOG, phaseState: REVEAL_ON_GUARD_STEP };

    const nextState = dispatch(testState, { type: 'reveal-on-guard', player: PLAYER_2, cardInstanceId: ogCard.instanceId });
    const og = nextState.players[0].companies[FIRST_COMPANY].onGuardCards;
    expect(og).toHaveLength(1);
    expect(og[0].instanceId).toBe(ogCard.instanceId);
    expect(og[0].revealed).toBe(true);
  });

  test('creature reveal is NOT offered at sites without automatic-attacks', () => {
    // Rivendell is a haven with no automatic-attacks.
    // Even a keyable creature cannot be revealed here per rule 2.V.i.
    const base = buildSitePhaseTwoPlayer({ site: RIVENDELL, heroChars: [ARAGORN] });
    const { state: withOG } = placeOnGuard(base, RESOURCE_PLAYER, FIRST_COMPANY, BARROW_WIGHT);
    const testState = { ...withOG, phaseState: REVEAL_ON_GUARD_STEP };

    const revealActions = viableActions(testState, PLAYER_2, 'reveal-on-guard');
    expect(revealActions).toHaveLength(0);
    expect(viableActions(testState, PLAYER_2, 'pass')).toHaveLength(1);
  });

  test('region-type-only keyed creature is NOT offered for reveal (rule 2.V.i)', () => {
    // Hobgoblins is keyed only to region types {w}{w} (two wildernesses) —
    // it has no site-type keying. Moria is a shadow-hold whose sitePath
    // happens to have two wildernesses, but "keyed to the site" per rule
    // 2.V.i means site-type or site-name keying only. Region-type keying
    // is for the movement/hazard phase, not the site phase.
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN] });
    const { state: withOG } = placeOnGuard(base, RESOURCE_PLAYER, FIRST_COMPANY, HOBGOBLINS);
    const testState = { ...withOG, phaseState: REVEAL_ON_GUARD_STEP };

    const revealActions = viableActions(testState, PLAYER_2, 'reveal-on-guard');
    expect(revealActions).toHaveLength(0);
    expect(viableActions(testState, PLAYER_2, 'pass')).toHaveLength(1);
  });

  test('hazard event with an auto-attack-boost effect (Arouse Denizens) is offered for reveal at a matching site', () => {
    // Bandit Lair is a ruins-and-lairs site with a Men automatic-attack.
    // Arouse Denizens (tw-6) boosts the prowess of one automatic-attack at a
    // Ruins & Lairs — a raw `auto-attack-boost` effect, not the `on-event`
    // shape used by Choking Shadows (tw-21) — so it must also be eligible
    // for on-guard reveal per rule 2.V.i's second bullet.
    const base = buildSitePhaseTwoPlayer({ site: BANDIT_LAIR, heroChars: [ARAGORN] });
    const { state: withOG, ogCard } = placeOnGuard(base, RESOURCE_PLAYER, FIRST_COMPANY, AROUSE_DENIZENS);
    const testState = { ...withOG, phaseState: REVEAL_ON_GUARD_STEP };

    const revealActions = viableActions(testState, PLAYER_2, 'reveal-on-guard');
    expect(revealActions).toHaveLength(1);
    expect((revealActions[0].action as RevealOnGuardAction).cardInstanceId).toBe(ogCard.instanceId);
  });

  test('revealing an auto-attack-boost hazard event installs the boost constraint and discards the card', () => {
    const base = buildSitePhaseTwoPlayer({ site: BANDIT_LAIR, heroChars: [ARAGORN] });
    const { state: withOG, ogCard } = placeOnGuard(base, RESOURCE_PLAYER, FIRST_COMPANY, AROUSE_DENIZENS);
    const testState = { ...withOG, phaseState: REVEAL_ON_GUARD_STEP };

    const nextState = dispatch(testState, { type: 'reveal-on-guard', player: PLAYER_2, cardInstanceId: ogCard.instanceId });

    const company = nextState.players[RESOURCE_PLAYER].companies[FIRST_COMPANY];
    expect(company.onGuardCards).toHaveLength(0);
    expect(nextState.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === ogCard.instanceId)).toBe(true);

    const boost = nextState.activeConstraints.find(c => c.kind.type === 'auto-attack-boost');
    expect(boost).toBeDefined();
    if (boost?.kind.type !== 'auto-attack-boost') throw new Error('unreachable');
    expect(boost.kind.prowessBonus).toBe(3);
    expect(boost.kind.siteDefinitionId).toBe(BANDIT_LAIR);
    expect(boost.scope.kind).toBe('company-site-phase');
  });
});
