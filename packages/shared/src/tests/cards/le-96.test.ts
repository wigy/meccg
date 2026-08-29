/**
 * @module le-96.test
 *
 * Card test: Uruk-lieutenant (le-96)
 * Type: hazard-creature (orc)
 * Effects: 1
 *
 * Text:
 *   "Orc. One strike. If played on a company that has already faced an Orc
 *    attack this turn, Uruk-lieutenant receives +3 prowess. Orc-lieutenant
 *    receives an additional +3 prowess if played on a company that has
 *    already faced Uruk-lieutenant this turn."
 *
 * Base stats: 1 strike, prowess 9, no body, 1 kill MP. Keyed to two
 * Wildernesses [{w}] or Shadow-lands [{s}], or Ruins & Lairs [{R}] /
 * Shadow-holds [{S}].
 *
 * This tests:
 * 1. Base stats: 1 strike, prowess 9
 * 2. Self stat-modifier: +3 prowess when company.facedRaces includes "orc"
 * 3. The card's second sentence, which is really a cross-card rule on
 *    Orc-lieutenant (tw-073): +3 additional prowess for Orc-lieutenant when
 *    played on a company that has already faced Uruk-lieutenant this turn
 *    (order-sensitive), including across the M/H → Site phase boundary.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI,
  ORC_LIEUTENANT, URUK_LIEUTENANT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, makeSitePhase,
  playCreatureHazardAndResolve, runCreatureCombat, resolveChain,
  handCardId, companyIdAt, dispatch,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  buildSitePhaseTwoPlayer, placeOnGuard,
} from '../test-helpers.js';
import { Phase, SiteType, Race } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const SHADOW_HOLD_KEYING = { method: 'site-type' as const, value: SiteType.ShadowHold };

function twoPlayerMHState(hand: readonly CardDefinitionId[]) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [GIMLI] }],
        hand: [...hand],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

function readyMHState(state: ReturnType<typeof twoPlayerMHState>) {
  return {
    ...state,
    phaseState: makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    }),
  };
}

describe('Uruk-lieutenant (le-96)', () => {
  beforeEach(() => resetMint());

  test('base prowess 9 (1 strike) when company has not faced an Orc attack', () => {
    const ready = readyMHState(twoPlayerMHState([URUK_LIEUTENANT]));
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, cardId, companyId, SHADOW_HOLD_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(9);
  });

  test('+3 prowess (total 12) when company has already faced an Orc attack this turn', () => {
    const ready = readyMHState(twoPlayerMHState([URUK_LIEUTENANT, URUK_LIEUTENANT]));
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    // First Uruk-lieutenant attacks and is defeated (Aragorn wins big).
    const firstId = handCardId(ready, HAZARD_PLAYER, 0);
    const afterFirstChain = playCreatureHazardAndResolve(ready, PLAYER_2, firstId, companyId, SHADOW_HOLD_KEYING);
    expect(afterFirstChain.combat!.creatureRace).toBe('orc');
    const afterFirst = runCreatureCombat(afterFirstChain, ARAGORN, 12, null);
    expect(afterFirst.combat).toBeNull();
    expect(afterFirst.players[RESOURCE_PLAYER].companies[0].facedHazardRaces).toContain(Race.Orc);

    // Second Uruk-lieutenant now gets its own +3 (company already faced an Orc attack).
    const secondId = handCardId(afterFirst, HAZARD_PLAYER, 0);
    const afterSecondChain = playCreatureHazardAndResolve(afterFirst, PLAYER_2, secondId, companyId, SHADOW_HOLD_KEYING);
    expect(afterSecondChain.combat).not.toBeNull();
    expect(afterSecondChain.combat!.strikeProwess).toBe(12);
  });

  test('Orc-lieutenant receives an additional +3 (total 14) when played after Uruk-lieutenant attacked the company this turn', () => {
    const ready = readyMHState(twoPlayerMHState([URUK_LIEUTENANT, ORC_LIEUTENANT]));
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    // Uruk-lieutenant attacks first and is defeated.
    const urukId = handCardId(ready, HAZARD_PLAYER, 0);
    const afterUrukChain = playCreatureHazardAndResolve(ready, PLAYER_2, urukId, companyId, SHADOW_HOLD_KEYING);
    const afterUruk = runCreatureCombat(afterUrukChain, ARAGORN, 12, null);
    expect(afterUruk.combat).toBeNull();
    expect(afterUruk.players[RESOURCE_PLAYER].companies[0].facedHazardNames).toContain('Uruk-lieutenant');

    // Orc-lieutenant now gets +4 (faced an Orc attack) + 3 (faced Uruk-lieutenant by name) = 7 + 4 + 3 = 14.
    const orcId = handCardId(afterUruk, HAZARD_PLAYER, 0);
    const afterOrcChain = playCreatureHazardAndResolve(afterUruk, PLAYER_2, orcId, companyId, SHADOW_HOLD_KEYING);
    expect(afterOrcChain.combat).not.toBeNull();
    expect(afterOrcChain.combat!.strikeProwess).toBe(14);
  });

  test('Orc-lieutenant does NOT receive the Uruk-lieutenant bonus when played before Uruk-lieutenant attacks (order-sensitive)', () => {
    const ready = readyMHState(twoPlayerMHState([ORC_LIEUTENANT, URUK_LIEUTENANT]));
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    // Orc-lieutenant attacks first — no prior Orc attack faced at all, so base 7.
    const orcId = handCardId(ready, HAZARD_PLAYER, 0);
    const afterOrcChain = playCreatureHazardAndResolve(ready, PLAYER_2, orcId, companyId, SHADOW_HOLD_KEYING);
    expect(afterOrcChain.combat!.strikeProwess).toBe(7);
  });

  test('Orc-lieutenant keeps the +3 Uruk-lieutenant bonus when revealed on-guard at a site (cross-phase persistence)', () => {
    // Regression companion to the tw-073 cross-phase test: the company faced
    // Uruk-lieutenant earlier in its M/H phase, then an on-guard Orc-lieutenant
    // is revealed at the site with no site auto-attack in between. The
    // turn-scoped `facedHazardNames` stamp (mirroring `facedHazardRaces`) must
    // still be visible so the named +3 applies.
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN] });
    const { state: withOG } = placeOnGuard(base, RESOURCE_PLAYER, 0, ORC_LIEUTENANT, { revealed: true });
    const state = {
      ...withOG,
      players: withOG.players.map((p, i) => i !== RESOURCE_PLAYER ? p : {
        ...p,
        companies: p.companies.map(c => ({ ...c, facedHazardRaces: [Race.Orc], facedHazardNames: ['Uruk-lieutenant'] })),
      }) as unknown as typeof withOG.players,
      phaseState: makeSitePhase({
        step: 'resolve-attacks',
        automaticAttacksResolved: 0,
        siteEntered: true,
      }),
    };

    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const afterChain = resolveChain(afterPass);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(14);
  });
});
