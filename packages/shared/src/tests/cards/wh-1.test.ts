/**
 * @module wh-1.test
 *
 * Card test: Alatar (wh-1)
 * Type: hero-character (fallen-wizard), unique
 * Prowess 7 / Body 9 / Mind null / DI 10 / GI 17 / MP 0
 * Skills: warrior, scout, ranger, sage
 * Homesite: any non-"Dragon's lair" Ruins & Lairs in a Wilderness
 * Effects: 3 —
 *   1. `fw-kill-mp-full` — hazards his companies defeat (even detainment `*`)
 *      score full kill MP instead of the MEWH §4 flat-1 clamp.
 *   2. `detainment-attacks-normal` (stagePointsAbove 7) — above 7 stage points,
 *      all detainment attacks against his companies attack normally instead.
 *   3. `on-event: creature-attack-begins` → `offer-char-join-attack` — at one of
 *      his Wizardhavens he may join an attacked company (discard his allies,
 *      face a forced strike, then tap + corruption check).
 *
 * "Unique. Hazards your companies defeat (even with *) are worth full kill
 *  marshalling points. If you have more than 7 stage points, all detainment
 *  attacks against your companies attack normally instead. If at one of his
 *  Wizardhavens [{H}] when a hazard creature attacks one of your companies, he
 *  may immediately join that company (discard allies he controls). Alatar must
 *  face a strike from the creature (in all cases). Following all of the
 *  creature's attacks, Alatar must tap (if untapped) and make a corruption
 *  check."
 *
 * Engine Support:
 * | # | Feature                                        | Status      | Notes                                        |
 * |---|------------------------------------------------|-------------|----------------------------------------------|
 * | 1 | Defeated hazards score full kill MP (§4 exempt)| IMPLEMENTED | fw-kill-mp-full (recompute-derived)          |
 * | 2 | Defeated detainment creature routed to killPile| IMPLEMENTED | fw-kill-mp-full (combat-finalize)            |
 * | 3 | >7 stage points: detainment attacks are normal | IMPLEMENTED | detainment-attacks-normal + isDetainmentAttack |
 * | 4 | Haven-join offer only at his Wizardhaven        | IMPLEMENTED | on-event + isHavenForPlayer (fallen-wizard)  |
 * | 5 | Haven-join accept: Alatar joins attacked company| IMPLEMENTED | offer-char-join-attack                       |
 *
 * Playable: YES
 * Certified: 2026-07-08
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, GANDALF,
  MORIA, RIVENDELL, EDORAS,
  resetMint, mint,
  buildTestState, makeMHState, recomputeDerived,
  playCreatureHazardAndResolve, runCreatureCombat,
  viableActions, dispatch,
  companyIdAt, handCardId,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, GameState,
} from '../../index.js';
import { Phase, Alignment, CardStatus, RegionType, SiteType, computeLegalActions } from '../../index.js';

const ALATAR_FW = 'wh-1' as CardDefinitionId;
const HORSE_LORDS = 'le-78' as CardDefinitionId;   // hazard-creature, detainment vs hero/FW, kill MP 2
const ISENGARD_FW = 'wh-56' as CardDefinitionId;    // fallen-wizard Wizardhaven (siteType haven)
const STAGE_4 = 'wh-61' as CardDefinitionId;        // stage resource worth 4 stage points
const STAGE_3 = 'wh-79' as CardDefinitionId;        // stage resource worth 3 stage points
const THE_WHITE_TOWERS = 'tw-430' as CardDefinitionId; // ruins-and-lairs, Arthedain (wilderness), not a Dragon's lair
const THE_LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId; // ruins-and-lairs, Northern Rhovanion (wilderness), a Dragon's lair (lairOf tw-90)
const UNTAPPED = CardStatus.Untapped;

describe('Alatar (wh-1)', () => {
  beforeEach(() => resetMint());

  // ── Home site: "Any non-'Dragon's lair' Ruins & Lairs in a Wilderness" (rule 2.II.2.1.F1) ──

  test('Alatar can be revealed at a non-Dragon\'s-lair Ruins & Lairs in a Wilderness', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          hand: [ALATAR_FW],
          siteDeck: [THE_WHITE_TOWERS],
          companies: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.action.type === 'play-character' && (ea.action as { characterInstanceId: CardInstanceId }).characterInstanceId === handCardId(state, RESOURCE_PLAYER));
    expect(actions.some(ea => ea.viable)).toBe(true);
  });

  test('Alatar cannot be revealed at a Dragon\'s lair even though it is a Wilderness Ruins & Lairs', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          hand: [ALATAR_FW],
          siteDeck: [THE_LONELY_MOUNTAIN],
          companies: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.action.type === 'play-character' && (ea.action as { characterInstanceId: CardInstanceId }).characterInstanceId === handCardId(state, RESOURCE_PLAYER));
    expect(actions.every(ea => !ea.viable)).toBe(true);
    expect(actions.some(ea => ea.reason?.includes('not available'))).toBe(true);
  });

  // ── Effect 1: fw-kill-mp-full — full kill MP (MEWH §4 exemption) ──

  test('a Fallen-wizard with Alatar scores full printed kill MP for defeated creatures', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: MORIA, characters: [ALATAR_FW, ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    // Inject a defeated Horse-lords (kill MP 2) into the FW's kill pile.
    const killed: GameState = {
      ...state,
      players: [
        { ...state.players[0], killPile: [{ instanceId: mint(), definitionId: HORSE_LORDS }] },
        state.players[1],
      ] as typeof state.players,
    };
    const derived = recomputeDerived(killed);
    // Full printed kill MP (2), not the §4 flat-1 clamp.
    expect(derived.players[RESOURCE_PLAYER].marshallingPoints.kill).toBe(2);
  });

  test('without Alatar the same defeated creature is clamped to 1 kill MP (MEWH §4)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    const killed: GameState = {
      ...state,
      players: [
        { ...state.players[0], killPile: [{ instanceId: mint(), definitionId: HORSE_LORDS }] },
        state.players[1],
      ] as typeof state.players,
    };
    const derived = recomputeDerived(killed);
    expect(derived.players[RESOURCE_PLAYER].marshallingPoints.kill).toBe(1);
  });

  // ── Effect 1 (cont.): detainment defeat routing (the "even with *" clause) ──

  test('with Alatar (≤7 stage points), a defeated DETAINMENT creature is routed to the kill pile and scores full MP', () => {
    // 0 stage points (≤7) → detainment stays in force. Horse-lords is detainment
    // against a Fallen-wizard company; defeating it normally awards 0 kill MP
    // (§3.II.3 discard), but Alatar's fw-kill-mp-full routes it to the kill pile.
    // Alatar sits in a *separate*, non-haven company (so no haven-jump offer and
    // the attacked company is a single character for clean strike assignment).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [
            { site: MORIA, characters: [ARAGORN] },
            { site: EDORAS, characters: [ALATAR_FW] },
          ],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [HORSE_LORDS],
          siteDeck: [],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rohan'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const creatureId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const inCombat = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, creatureId, targetCompanyId,
      { method: 'region-name', value: 'Rohan' },
    );
    expect(inCombat.combat).not.toBeNull();
    expect(inCombat.combat!.detainment).toBe(true); // ≤7 stage points: still detainment

    // Defeat the (single) strike with Aragorn: 12 + prowess 7 > Horse-lords 10.
    const finished = runCreatureCombat(inCombat, ARAGORN, 12, 12);
    expect(finished.combat).toBeNull();

    // Routed to the FW's kill pile (not the attacker's discard) and scores full MP.
    const fw = finished.players[RESOURCE_PLAYER];
    expect(fw.killPile.some(c => c.definitionId === HORSE_LORDS)).toBe(true);
    expect(finished.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === HORSE_LORDS)).toBe(false);
    expect(fw.marshallingPoints.kill).toBe(2);
  });

  test('without Alatar, a defeated DETAINMENT creature awards no kill MP (§3.II.3 discard to attacker)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
          stagePoints: 3,
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [HORSE_LORDS],
          siteDeck: [],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rohan'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const creatureId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const inCombat = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, creatureId, targetCompanyId,
      { method: 'region-name', value: 'Rohan' },
    );
    expect(inCombat.combat!.detainment).toBe(true);

    const finished = runCreatureCombat(inCombat, ARAGORN, 12, 12);
    expect(finished.combat).toBeNull();

    const fw = finished.players[RESOURCE_PLAYER];
    expect(fw.killPile.some(c => c.definitionId === HORSE_LORDS)).toBe(false);
    expect(finished.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === HORSE_LORDS)).toBe(true);
    expect(fw.marshallingPoints.kill).toBe(0);
  });

  // ── Effect 2: detainment-attacks-normal — above 7 stage points ──

  test('above 7 stage points, a detainment creature attacks NORMALLY against Alatar\'s company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: MORIA, characters: [ALATAR_FW, ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [HORSE_LORDS],
          siteDeck: [],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rohan'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    // Inject stage cards AFTER buildTestState so their instance IDs don't
    // collide with the internally minted characters/sites (4 + 4 = 8 > 7).
    const stateAtMH: GameState = {
      ...base,
      phaseState: mhState,
      players: [
        { ...base.players[0], cardsInPlay: [
          { instanceId: mint(), definitionId: STAGE_4, status: UNTAPPED },
          { instanceId: mint(), definitionId: STAGE_4, status: UNTAPPED },
        ] },
        base.players[1],
      ] as typeof base.players,
    };

    const creatureId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const inCombat = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, creatureId, targetCompanyId,
      { method: 'region-name', value: 'Rohan' },
    );
    expect(inCombat.combat).not.toBeNull();
    // Sanity: the stage cards really put the player above 7.
    expect(inCombat.players[RESOURCE_PLAYER].stagePoints).toBe(8);
    expect(inCombat.combat!.detainment).toBe(false); // >7 stage points → normal
  });

  test('at 7 stage points (not more than 7), the detainment attack is still detainment', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: MORIA, characters: [ALATAR_FW, ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [HORSE_LORDS],
          siteDeck: [],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rohan'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    // 4 + 3 = exactly 7 stage points — the boundary is "more than 7".
    const stateAtMH: GameState = {
      ...base,
      phaseState: mhState,
      players: [
        { ...base.players[0], cardsInPlay: [
          { instanceId: mint(), definitionId: STAGE_4, status: UNTAPPED },
          { instanceId: mint(), definitionId: STAGE_3, status: UNTAPPED },
        ] },
        base.players[1],
      ] as typeof base.players,
    };

    const creatureId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const inCombat = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, creatureId, targetCompanyId,
      { method: 'region-name', value: 'Rohan' },
    );
    expect(inCombat.players[RESOURCE_PLAYER].stagePoints).toBe(7);
    expect(inCombat.combat!.detainment).toBe(true);
  });

  test('above 7 stage points WITHOUT Alatar, the detainment attack stays detainment (it is Alatar\'s effect)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [HORSE_LORDS],
          siteDeck: [],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rohan'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    // 8 stage points but no Alatar → no detainment-attacks-normal carrier.
    const stateAtMH: GameState = {
      ...base,
      phaseState: mhState,
      players: [
        { ...base.players[0], cardsInPlay: [
          { instanceId: mint(), definitionId: STAGE_4, status: UNTAPPED },
          { instanceId: mint(), definitionId: STAGE_4, status: UNTAPPED },
        ] },
        base.players[1],
      ] as typeof base.players,
    };

    const creatureId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const inCombat = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, creatureId, targetCompanyId,
      { method: 'region-name', value: 'Rohan' },
    );
    expect(inCombat.players[RESOURCE_PLAYER].stagePoints).toBe(8);
    expect(inCombat.combat!.detainment).toBe(true);
  });

  // ── Effect 3: Wizardhaven-join offer ──

  test('haven-join offer is raised when Alatar is at his Wizardhaven and a creature attacks another company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [
            { site: MORIA, characters: [ARAGORN] },       // attacked company
            { site: ISENGARD_FW, characters: [ALATAR_FW] }, // Alatar at his Wizardhaven
          ],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [HORSE_LORDS],
          siteDeck: [],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rohan'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const creatureId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const inCombat = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, creatureId, targetCompanyId,
      { method: 'region-name', value: 'Rohan' },
    );
    expect(inCombat.combat).not.toBeNull();
    expect(inCombat.combat!.havenJumpOffers).toBeDefined();
    expect(inCombat.combat!.havenJumpOffers).toHaveLength(1);
    expect(inCombat.combat!.assignmentPhase).toBe('cancel-window');

    const actions = viableActions(inCombat, PLAYER_1, 'haven-join-attack');
    expect(actions).toHaveLength(1);
  });

  test('NO haven-join offer when Alatar sits at a METW haven that is not his Wizardhaven', () => {
    // Rivendell is a haven, but its alignment is `wizard` — not a Fallen-wizard
    // Wizardhaven — so isHavenForPlayer is false for the FW player and no offer
    // is raised. (Opponent is placed at Moria to free Rivendell for Alatar.)
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [
            { site: MORIA, characters: [ARAGORN] },        // attacked company
            { site: RIVENDELL, characters: [ALATAR_FW] },  // METW haven, NOT a Wizardhaven
          ],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [GANDALF] }],
          hand: [HORSE_LORDS],
          siteDeck: [],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rohan'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const creatureId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const inCombat = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, creatureId, targetCompanyId,
      { method: 'region-name', value: 'Rohan' },
    );
    expect(inCombat.combat).not.toBeNull();
    expect(inCombat.combat!.havenJumpOffers).toBeUndefined();
    const actions = viableActions(inCombat, PLAYER_1, 'haven-join-attack');
    expect(actions).toHaveLength(0);
  });

  test('accepting the Wizardhaven-join offer moves Alatar into the attacked company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [
            { site: MORIA, characters: [ARAGORN] },
            { site: ISENGARD_FW, characters: [ALATAR_FW] },
          ],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [HORSE_LORDS],
          siteDeck: [],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rohan'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const creatureId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const inCombat = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, creatureId, targetCompanyId,
      { method: 'region-name', value: 'Rohan' },
    );

    const havenComp = inCombat.players[RESOURCE_PLAYER].companies[1];
    const alatarId = havenComp.characters[0];
    const after = dispatch(inCombat, {
      type: 'haven-join-attack',
      player: PLAYER_1,
      characterId: alatarId,
    });
    // Alatar was alone in his haven company, so it dissolves the instant he
    // leaves (a "company" is one or more characters — CoE glossary) instead
    // of lingering as a second, now-empty entry.
    const companies = after.players[RESOURCE_PLAYER].companies;
    expect(companies).toHaveLength(1);
    expect(companies[0].characters).toContain(alatarId);
  });

  test('a haven company Alatar leaves alone dissolves instead of getting its own (empty) movement/hazard phase', () => {
    // Regression for a bug report: Alatar haven-jumps out of a company where
    // he was the lone member. Without cleanup, that now-empty company lingers
    // in play and later gets *its own* movement/hazard phase — offering
    // select-company/declare-path/draw-cards for a company with zero
    // characters, when CoE's "company" glossary entry requires at least one.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [
            { site: MORIA, characters: [ARAGORN] },
            { site: ISENGARD_FW, characters: [ALATAR_FW] },
          ],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [HORSE_LORDS],
          siteDeck: [],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rohan'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const creatureId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const inCombat = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, creatureId, targetCompanyId,
      { method: 'region-name', value: 'Rohan' },
    );
    const havenCompanyId = inCombat.players[RESOURCE_PLAYER].companies[1].id;
    const alatarId = inCombat.players[RESOURCE_PLAYER].companies[1].characters[0];

    const after = dispatch(inCombat, {
      type: 'haven-join-attack',
      player: PLAYER_1,
      characterId: alatarId,
    });

    expect(after.players[RESOURCE_PLAYER].companies.some(c => c.id === havenCompanyId)).toBe(false);
  });
});
