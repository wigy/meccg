/**
 * @module tw-073.test
 *
 * Card test: Orc-lieutenant (tw-073)
 * Type: hazard-creature
 * Effects: 2
 *
 * "Orcs. One strike. If played on a company that has already faced an Orc
 * attack this turn, Orc-lieutenant receives +4 prowess."
 *
 * A second self-effect — "receives an additional +3 prowess if played on a
 * company that has already faced Uruk-lieutenant this turn" — is printed on
 * *Uruk-lieutenant* (le-96), not on this card, but names Orc-lieutenant as
 * the beneficiary; it is implemented here as Orc-lieutenant's own second
 * stat-modifier (see le-96.test.ts for the companion coverage).
 *
 * This tests:
 * 1. Base stats: 1 strike, 7 prowess, no body, 1 kill MP
 * 2. stat-modifier: +4 prowess when company.facedRaces includes "orc"
 * 3. No prowess bonus when no prior Orc attack faced
 * 4. stat-modifier: +3 additional prowess when company.facedNames includes "Uruk-lieutenant"
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI,
  ORC_LIEUTENANT, URUK_LIEUTENANT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, makeSitePhase,
  resolveChain, makeCancelWindowCombat, viableActions,
  playCreatureHazardAndResolve, runCreatureCombat,
  handCardId, companyIdAt, charIdAt, dispatch, RESOURCE_PLAYER, HAZARD_PLAYER,
  buildSitePhaseTwoPlayer, placeOnGuard,
} from '../test-helpers.js';
import { computeLegalActions, Phase, SiteType, Race } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const ESCAPE = 'tw-229' as CardDefinitionId;
const HOBGOBLINS = 'le-77' as CardDefinitionId;
// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Orc-lieutenant (tw-073)', () => {
  beforeEach(() => resetMint());


  test('base prowess 7 when company has not faced an Orc attack', () => {
    const state = buildTestState({
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
          hand: [ORC_LIEUTENANT],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const lieutenantId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: lieutenantId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
    });

    const afterChain = resolveChain(afterPlay);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(7);
    expect(afterChain.combat!.strikesTotal).toBe(1);
  });

  test('+4 prowess (total 11) when company has already faced an Orc attack', () => {
    const state = buildTestState({
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
          hand: [ORC_LIEUTENANT, ORC_LIEUTENANT],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    // --- First attack: play first Orc-lieutenant (1 strike Orc) ---
    const firstLtId = handCardId(gameState, HAZARD_PLAYER, 0);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlayFirst = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: firstLtId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
    });

    const afterFirstChain = resolveChain(afterPlayFirst);
    expect(afterFirstChain.combat).not.toBeNull();
    expect(afterFirstChain.combat!.creatureRace).toBe('orc');
    expect(afterFirstChain.combat!.strikeProwess).toBe(7);

    // Defender assigns strike to Aragorn
    const aragornId = charIdAt(afterFirstChain, RESOURCE_PLAYER);
    let s = dispatch(afterFirstChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: aragornId,
      tapped: false,
    });

    // Resolve the single strike — high roll so Aragorn wins
    s = { ...s, cheatRollTotal: 12 };
    const resolveActions = computeLegalActions(s, PLAYER_1);
    const resolveAction = resolveActions.find(a => a.viable && a.action.type === 'resolve-strike');
    expect(resolveAction).toBeDefined();
    s = dispatch(s, resolveAction!.action);

    // Combat finalized — back in M/H play-hazards
    expect(s.combat).toBeNull();

    // Verify the hazard was recorded in phaseState.hazardsEncountered
    expect(s.phaseState.phase).toBe(Phase.MovementHazard);
    const mh = s.phaseState as typeof mhState;
    expect(mh.hazardsEncountered).toContain('Orc-lieutenant');
    // …and the faced race stamped on the company itself (turn-scoped, so it
    // survives into the site phase — see the cross-phase test below).
    expect(s.players[RESOURCE_PLAYER].companies[0].facedHazardRaces).toContain(Race.Orc);

    // --- Second attack: play second Orc-lieutenant ---
    const secondLtId = handCardId(s, HAZARD_PLAYER, 0);
    const afterPlaySecond = dispatch(s, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: secondLtId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
    });

    const afterSecondChain = resolveChain(afterPlaySecond);
    expect(afterSecondChain.combat).not.toBeNull();
    expect(afterSecondChain.combat!.strikeProwess).toBe(11);
  });

  test('+4 prowess (total 11) when the prior Orc attack was canceled (CoE 3.i.1 / CRF 22 Annotation 14)', () => {
    // Regression: Hobgoblins (an Orc attack) was faced and then canceled (e.g.
    // with Escape). Per CoE 3.i.1 the company is still considered to have faced
    // the attack once combat is initiated, even though it was canceled, so a
    // subsequently-played Orc-lieutenant must receive its +4 prowess.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [ESCAPE],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [ORC_LIEUTENANT],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // The company faces a Hobgoblins (Orc) attack, paused in the cancel window.
    const cancelWindow = makeCancelWindowCombat(base, {
      creatureDefId: HOBGOBLINS,
      creatureRace: Race.Orc,
    });
    const inCombat = {
      ...cancelWindow,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Moria',
      }),
    };

    // Cancel the Hobgoblins attack with Escape.
    const cancelActions = viableActions(inCombat, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBeGreaterThan(0);
    const afterCancel = resolveChain(dispatch(inCombat, cancelActions[0].action));
    expect(afterCancel.combat).toBeNull();

    // The canceled Orc attack is still recorded as faced.
    expect(afterCancel.phaseState.phase).toBe(Phase.MovementHazard);
    const mh = afterCancel.phaseState as ReturnType<typeof makeMHState>;
    expect(mh.hazardsEncountered).toContain('Hobgoblins');

    // Orc-lieutenant played now gets +4 prowess (7 → 11).
    const lieutenantId = handCardId(afterCancel, HAZARD_PLAYER, 0);
    const companyId = companyIdAt(afterCancel, RESOURCE_PLAYER);
    const afterPlay = dispatch(afterCancel, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: lieutenantId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
    });
    const afterChain = resolveChain(afterPlay);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(11);
  });

  test('+4 prowess (total 11) when revealed as on-guard after automatic Orc attack at site', () => {
    // Moria has automatic Orcs attack (4 strikes, 7 prowess). Set up the site
    // phase as if that automatic attack was already resolved, then reveal an
    // on-guard Orc-lieutenant and verify its prowess is 11, not 7.
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN] });
    const { state: withOG } = placeOnGuard(base, RESOURCE_PLAYER, 0, ORC_LIEUTENANT, { revealed: true });
    const state = {
      ...withOG,
      phaseState: makeSitePhase({
        step: 'resolve-attacks',
        automaticAttacksResolved: 1,
        siteEntered: true,
      }),
    };

    // Pass triggers the revealed on-guard creature onto the chain
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.chain).not.toBeNull();

    const afterChain = resolveChain(afterPass);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(11);
    expect(afterChain.combat!.strikesTotal).toBe(1);
  });

  test('+4 prowess when the Orc attack was faced during the SAME TURN\'s M/H phase (cross-phase)', () => {
    // Regression: "this turn" is turn-scoped, but the M/H hazardsEncountered
    // list dies at the phase transition and the site derivation counted only
    // the site's own resolved automatic-attacks — an on-guard Orc-lieutenant
    // revealed at a site with no Orc auto-attack lost the +4 even though the
    // company faced an Orc creature during its M/H phase. The faced race is
    // now stamped on the company (facedHazardRaces) at combat teardown.
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN] });
    const { state: withOG } = placeOnGuard(base, RESOURCE_PLAYER, 0, ORC_LIEUTENANT, { revealed: true });
    const state = {
      ...withOG,
      players: withOG.players.map((p, i) => i !== RESOURCE_PLAYER ? p : {
        ...p,
        companies: p.companies.map(c => ({ ...c, facedHazardRaces: [Race.Orc] })),
      }) as unknown as typeof withOG.players,
      phaseState: makeSitePhase({
        step: 'resolve-attacks',
        automaticAttacksResolved: 0, // NO site auto-attack faced
        siteEntered: true,
      }),
    };

    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const afterChain = resolveChain(afterPass);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(11); // NOT 7
  });

  test('+3 additional prowess (total 14) when played after Uruk-lieutenant (le-96) attacked the company this turn', () => {
    // The bonus is printed on Uruk-lieutenant's own text, not Orc-lieutenant's,
    // but names Orc-lieutenant as the beneficiary — see le-96.test.ts.
    const state = buildTestState({
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
          hand: [URUK_LIEUTENANT, ORC_LIEUTENANT],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const keying = { method: 'site-type' as const, value: SiteType.ShadowHold };

    const urukId = handCardId(gameState, HAZARD_PLAYER, 0);
    const afterUrukChain = playCreatureHazardAndResolve(gameState, PLAYER_2, urukId, companyId, keying);
    const afterUruk = runCreatureCombat(afterUrukChain, ARAGORN, 12, null);
    expect(afterUruk.combat).toBeNull();
    expect(afterUruk.players[RESOURCE_PLAYER].companies[0].facedHazardNames).toContain('Uruk-lieutenant');

    const orcId = handCardId(afterUruk, HAZARD_PLAYER, 0);
    const afterOrcChain = playCreatureHazardAndResolve(afterUruk, PLAYER_2, orcId, companyId, keying);
    expect(afterOrcChain.combat).not.toBeNull();
    expect(afterOrcChain.combat!.strikeProwess).toBe(14); // 7 base + 4 (orc) + 3 (named Uruk-lieutenant)
  });
});
