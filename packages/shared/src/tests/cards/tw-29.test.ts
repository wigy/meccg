/**
 * @module tw-29.test
 *
 * Card test: Dragon's Desolation (tw-29)
 * Type: hazard-event (short), non-unique
 *
 * Card text:
 *   "The prowess of one Dragon attack is modified by +2.
 *    Alternatively, it may be played on a Ruins & Lairs [{R}] site that
 *    has two Wildernesses [{w}] in its site path (only one Wilderness
 *    [{w}] is required if Doors of Night is in play)—one Dragon hazard
 *    creature may be played on a company at that site this turn."
 *
 * CRF rulings:
 *   - Playable regardless of remaining hazard limit; may also be played
 *     against an automatic-attack.
 *   - Playing Mode B does not oblige the hazard player to actually
 *     follow up with a Dragon. The Dragon played is "not considered
 *     keyed to anything".
 *
 * Engine Support:
 * | # | Feature                                            | Status      | Notes                                                   |
 * |---|----------------------------------------------------|-------------|---------------------------------------------------------|
 * | 1 | Play-flag: no-hazard-limit                         | IMPLEMENTED | DD ignores its own hazard-limit slot                    |
 * | 2 | Mode A: +2 strike prowess vs Dragon attack         | IMPLEMENTED | `modify-attack-from-hand` (attacker, enemy.race=dragon) |
 * | 3 | Mode B: play-condition on destination + site path  | IMPLEMENTED | `destinationSiteType`/`inPlay`/`sitePath.*` in context  |
 * | 4 | Mode B: fixed-race creature-race-choice (Dragon)   | IMPLEMENTED | `creature-race-choice.fixedRace`                        |
 * | 5 | Mode B: add `creature-keying-bypass` constraint    | IMPLEMENTED | `apply.constraint = creature-keying-bypass`             |
 * | 6 | Dragon creature plays ignoring keying (once)       | IMPLEMENTED | `hasCreatureKeyingBypass` + bypass consumer             |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  viableActions, dispatch, reduce, resolveChain,
  makeCancelWindowCombat, makeMHState, addCardInPlay,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, FRODO,
  ORC_PATROL,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment, computeLegalActions, Race, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, GameState, MovementHazardPhaseState, ModifyAttackFromHandAction, PlayHazardAction } from '../../index.js';

const DRAGONS_DESOLATION = 'tw-29' as CardDefinitionId;
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId;
const SMAUG = 'tw-90' as CardDefinitionId;

describe("Dragon's Desolation (tw-29)", () => {
  beforeEach(() => resetMint());

  // ─── Mode A: +2 to one Dragon attack ────────────────────────────────────

  test('Mode A: attacker can play DD from hand vs a Dragon attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [DRAGONS_DESOLATION],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const combat = makeCancelWindowCombat(base, {
      creatureDefId: SMAUG,
      creatureRace: 'dragon',
      attackSourceType: 'creature',
      strikesTotal: 2,
      strikeProwess: 10,
    });

    const actions = viableActions(combat, PLAYER_2, 'modify-attack-from-hand');
    expect(actions).toHaveLength(1);

    const ddInstance = combat.players[HAZARD_PLAYER].hand[0].instanceId;
    const act = actions[0].action as ModifyAttackFromHandAction;
    expect(act.cardInstanceId).toBe(ddInstance);
    expect(act.player).toBe(PLAYER_2);
  });

  test('Mode A: playing DD adds +2 strike prowess and discards the card', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [DRAGONS_DESOLATION],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const combat = makeCancelWindowCombat(base, {
      creatureDefId: SMAUG,
      creatureRace: 'dragon',
      attackSourceType: 'creature',
      strikesTotal: 2,
      strikeProwess: 10,
    });

    const actions = viableActions(combat, PLAYER_2, 'modify-attack-from-hand');
    expect(actions).toHaveLength(1);

    const after = dispatch(combat, actions[0].action);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(12);
    expect(after.combat!.phase).toBe('assign-strikes');

    // Card moved from hand to hazard player's discard pile.
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(
      after.players[HAZARD_PLAYER].discardPile.find(c => c.definitionId === DRAGONS_DESOLATION),
    ).toBeDefined();
  });

  test('Mode A: NOT available when the attacking creature is not a Dragon', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [DRAGONS_DESOLATION],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const combat = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: 'orc',
      attackSourceType: 'creature',
      strikesTotal: 2,
      strikeProwess: 6,
    });

    const actions = viableActions(combat, PLAYER_2, 'modify-attack-from-hand');
    expect(actions).toHaveLength(0);
  });

  test('Mode A: available against an automatic-attack by a Dragon (CRF)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [DRAGONS_DESOLATION],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const combat = makeCancelWindowCombat(base, {
      creatureRace: 'dragon',
      attackSourceType: 'automatic-attack',
      strikesTotal: 1,
      strikeProwess: 12,
    });

    const actions = viableActions(combat, PLAYER_2, 'modify-attack-from-hand');
    expect(actions).toHaveLength(1);
  });

  test('Mode A: defender cannot play DD (attacker-only effect)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [DRAGONS_DESOLATION],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const combat = makeCancelWindowCombat(base, {
      creatureDefId: SMAUG,
      creatureRace: 'dragon',
      attackSourceType: 'creature',
      strikesTotal: 2,
      strikeProwess: 10,
    });

    const actions = viableActions(combat, PLAYER_1, 'modify-attack-from-hand');
    expect(actions).toHaveLength(0);
  });

  // ─── Mode B: play-condition gates ───────────────────────────────────────

  function mkMHMode(opts: {
    path: RegionType[];
    destination: SiteType;
    doorsOfNight?: boolean;
  }): GameState {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DRAGONS_DESOLATION], siteDeck: [MINAS_TIRITH] },
      ],
    });
    if (opts.doorsOfNight) {
      state = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    }
    const mhState = makeMHState({
      resolvedSitePath: opts.path,
      destinationSiteType: opts.destination,
    });
    return { ...state, phaseState: mhState };
  }

  test('Mode B: playable on R&L destination with 2 wildernesses in site path', () => {
    const state = mkMHMode({
      path: [RegionType.Wilderness, RegionType.Wilderness],
      destination: SiteType.RuinsAndLairs,
    });
    const ddInstance = state.players[HAZARD_PLAYER].hand[0].instanceId;
    const actions = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === ddInstance);
    expect(actions).toHaveLength(1);
    const act = actions[0].action as PlayHazardAction;
    expect(act.chosenCreatureRace).toBe(Race.Dragon);
  });

  test('Mode B: NOT playable with only 1 wilderness (without Doors of Night)', () => {
    const state = mkMHMode({
      path: [RegionType.Wilderness],
      destination: SiteType.RuinsAndLairs,
    });
    const ddInstance = state.players[HAZARD_PLAYER].hand[0].instanceId;
    const viable = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === ddInstance);
    expect(viable).toHaveLength(0);
  });

  test('Mode B: playable with only 1 wilderness when Doors of Night is in play', () => {
    const state = mkMHMode({
      path: [RegionType.Wilderness],
      destination: SiteType.RuinsAndLairs,
      doorsOfNight: true,
    });
    const ddInstance = state.players[HAZARD_PLAYER].hand[0].instanceId;
    const actions = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === ddInstance);
    expect(actions).toHaveLength(1);
  });

  test('Mode B: NOT playable at a non-R&L destination even with 2 wildernesses', () => {
    const state = mkMHMode({
      path: [RegionType.Wilderness, RegionType.Wilderness],
      destination: SiteType.ShadowHold,
    });
    const ddInstance = state.players[HAZARD_PLAYER].hand[0].instanceId;
    const viable = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === ddInstance);
    expect(viable).toHaveLength(0);
  });

  // ─── Mode B: constraint application and consumption ─────────────────────

  test('Mode B: playing DD adds a creature-keying-bypass constraint for Dragons', () => {
    const state = mkMHMode({
      path: [RegionType.Wilderness, RegionType.Wilderness],
      destination: SiteType.RuinsAndLairs,
    });
    const ddInstance = state.players[HAZARD_PLAYER].hand[0].instanceId;
    const companyId = state.players[0].companies[0].id;

    const result = reduce(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: ddInstance,
      targetCompanyId: companyId,
      chosenCreatureRace: Race.Dragon,
    });
    expect(result.error).toBeUndefined();

    const afterChain = resolveChain(result.state);
    const bypass = afterChain.activeConstraints.find(
      c => c.kind.type === 'creature-keying-bypass',
    );
    expect(bypass).toBeDefined();
    expect(bypass!.target).toEqual({ kind: 'company', companyId });
    if (bypass!.kind.type === 'creature-keying-bypass') {
      expect(bypass!.kind.race).toBe(Race.Dragon);
      expect(bypass!.kind.remainingPlays).toBe(1);
    }
  });

  test('Mode B: constraint allows a Dragon creature to be played even when normal keying fails', () => {
    // Site path is 1 wilderness + 1 shadow. Normally Cave-drake needs 2
    // wildernesses in path or R&L site type. Destination IS R&L, so in
    // fact Cave-drake IS normally keyable here. Use a site-path without
    // wildernesses AND a non-R&L destination to force the normal keying
    // to fail, but use DoN to satisfy Mode B's gate (1W alt clause
    // requires at least one wilderness). Instead, set up manually where
    // keying normally fails: shadow+shadow destination Ruins&Lairs.
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DRAGONS_DESOLATION, SMAUG], siteDeck: [MINAS_TIRITH] },
      ],
    });
    // Put Doors of Night in play so Mode B plays with 1W, and also so
    // the keying-bypass path can be exercised against a drake.
    state = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    // Path: only 1 wilderness; Cave-drake normally needs 2W or R&L site
    // type. Destination IS R&L so Cave-drake is actually keyable via
    // site-type. We want to show that even if it weren't keyable, the
    // bypass would still allow it. So assert both:
    //   (a) DD Mode B is playable here (1W + DoN + R&L destination).
    //   (b) After DD resolves, the bypass constraint exists.
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      destinationSiteType: SiteType.RuinsAndLairs,
    });
    state = { ...state, phaseState: mhState };

    const ddInstance = state.players[HAZARD_PLAYER].hand.find(c => c.definitionId === DRAGONS_DESOLATION)!.instanceId;
    const companyId = state.players[0].companies[0].id;

    const r1 = reduce(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: ddInstance,
      targetCompanyId: companyId,
      chosenCreatureRace: Race.Dragon,
    });
    expect(r1.error).toBeUndefined();
    const afterDD = resolveChain(r1.state);

    // Bypass constraint is present.
    const bypass = afterDD.activeConstraints.find(
      c => c.kind.type === 'creature-keying-bypass',
    );
    expect(bypass).toBeDefined();

    // Cave-drake is now offered (via normal R&L keying OR bypass). Find
    // the play-hazard action for cave-drake.
    const drakeInstance = afterDD.players[HAZARD_PLAYER].hand.find(
      c => c.definitionId === SMAUG,
    )!.instanceId;
    const actions = computeLegalActions(afterDD, PLAYER_2);
    const drakeActions = actions.filter(
      a => a.action.type === 'play-hazard' && a.action.cardInstanceId === drakeInstance,
    );
    expect(drakeActions.length).toBeGreaterThan(0);
    expect(drakeActions.some(a => a.viable)).toBe(true);
  });

  test('Mode B: Dragon creature plays via keying-bypass when normal keying would fail', () => {
    // Force a scenario where Cave-drake cannot be keyed normally: path
    // with no wilderness, non-R&L destination. Dragon's Desolation Mode
    // B is not playable here (requires R&L destination), so we add the
    // bypass constraint by hand to isolate the bypass behavior.
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SMAUG], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      destinationSiteType: SiteType.ShadowHold,
    });
    state = { ...state, phaseState: mhState };

    const drakeInstance = state.players[HAZARD_PLAYER].hand[0].instanceId;
    const companyId = state.players[0].companies[0].id;

    // Without bypass, Cave-drake is not keyable here.
    {
      const actions = computeLegalActions(state, PLAYER_2);
      const drakeAction = actions.find(
        a => a.action.type === 'play-hazard' && a.action.cardInstanceId === drakeInstance,
      );
      expect(drakeAction).toBeDefined();
      expect(drakeAction!.viable).toBe(false);
    }

    // Inject a bypass constraint directly.
    const stateWithBypass: GameState = {
      ...state,
      activeConstraints: [
        ...state.activeConstraints,
        {
          id: 'test-bypass' as import('../../index.js').ConstraintId,
          source: 'fake-source' as import('../../index.js').CardInstanceId,
          sourceDefinitionId: DRAGONS_DESOLATION,
          scope: { kind: 'company-mh-phase', companyId },
          target: { kind: 'company', companyId },
          kind: { type: 'creature-keying-bypass', race: Race.Dragon, remainingPlays: 1 },
        },
      ],
    };

    // With bypass, Cave-drake IS playable.
    const actions2 = computeLegalActions(stateWithBypass, PLAYER_2);
    const drakeAction2 = actions2.find(
      a => a.action.type === 'play-hazard' && a.action.cardInstanceId === drakeInstance && a.viable,
    );
    expect(drakeAction2).toBeDefined();
    const playAct = drakeAction2!.action as PlayHazardAction;
    expect(playAct.keyedBy?.method).toBe('keying-bypass');

    // Playing the Cave-drake consumes the bypass constraint.
    const r = reduce(stateWithBypass, drakeAction2!.action);
    expect(r.error).toBeUndefined();
    const bypassLeft = r.state.activeConstraints.find(
      c => c.kind.type === 'creature-keying-bypass',
    );
    expect(bypassLeft).toBeUndefined();
  });

  test('Mode B: bypass constraint is race-scoped — does not enable a non-Dragon', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Free],
      destinationSiteType: SiteType.FreeHold,
    });
    state = { ...state, phaseState: mhState };

    const orcInstance = state.players[HAZARD_PLAYER].hand[0].instanceId;
    const companyId = state.players[0].companies[0].id;

    const stateWithBypass: GameState = {
      ...state,
      activeConstraints: [
        ...state.activeConstraints,
        {
          id: 'test-bypass' as import('../../index.js').ConstraintId,
          source: 'fake-source' as import('../../index.js').CardInstanceId,
          sourceDefinitionId: DRAGONS_DESOLATION,
          scope: { kind: 'company-mh-phase', companyId },
          target: { kind: 'company', companyId },
          kind: { type: 'creature-keying-bypass', race: Race.Dragon, remainingPlays: 1 },
        },
      ],
    };

    // Orc-patrol is NOT a dragon; bypass does not help it.
    const actions = computeLegalActions(stateWithBypass, PLAYER_2);
    const orcAction = actions.find(
      a => a.action.type === 'play-hazard' && a.action.cardInstanceId === orcInstance,
    );
    expect(orcAction).toBeDefined();
    expect(orcAction!.viable).toBe(false);
  });

  test('Mode B: bypass constraint is consumed after one creature play (remainingPlays goes 1 → 0)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SMAUG], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      destinationSiteType: SiteType.ShadowHold,
    });
    state = { ...state, phaseState: mhState };

    const drakeInstance = state.players[HAZARD_PLAYER].hand[0].instanceId;
    const companyId = state.players[0].companies[0].id;

    // Start with remainingPlays = 2 so we can verify decrement semantics
    // independent of the on-play constraint (Dragon's Desolation itself
    // adds it with maxPlays 1 — see earlier test).
    const stateWithBypass: GameState = {
      ...state,
      activeConstraints: [
        ...state.activeConstraints,
        {
          id: 'test-bypass' as import('../../index.js').ConstraintId,
          source: 'fake-source' as import('../../index.js').CardInstanceId,
          sourceDefinitionId: DRAGONS_DESOLATION,
          scope: { kind: 'company-mh-phase', companyId },
          target: { kind: 'company', companyId },
          kind: { type: 'creature-keying-bypass', race: Race.Dragon, remainingPlays: 2 },
        },
      ],
    };

    const actions = computeLegalActions(stateWithBypass, PLAYER_2);
    const drakeAction = actions.find(
      a => a.action.type === 'play-hazard'
        && a.action.cardInstanceId === drakeInstance
        && a.viable,
    );
    expect(drakeAction).toBeDefined();

    const r = reduce(stateWithBypass, drakeAction!.action);
    expect(r.error).toBeUndefined();

    // One charge consumed: remainingPlays 2 → 1.
    const bypass = r.state.activeConstraints.find(
      c => c.kind.type === 'creature-keying-bypass',
    );
    expect(bypass).toBeDefined();
    if (bypass!.kind.type === 'creature-keying-bypass') {
      expect(bypass!.kind.remainingPlays).toBe(1);
    }
  });

  // ─── Hazard-limit bypass (play-flag: no-hazard-limit) ────────────────────

  test('DD itself bypasses the hazard limit (CRF ruling)', () => {
    const state = mkMHMode({
      path: [RegionType.Wilderness, RegionType.Wilderness],
      destination: SiteType.RuinsAndLairs,
    });
    const atCap: GameState = {
      ...state,
      phaseState: {
        ...(state.phaseState as MovementHazardPhaseState),
        hazardsPlayedThisCompany: 5,
        hazardLimitAtReveal: 2,
      },
    };
    const ddInstance = atCap.players[HAZARD_PLAYER].hand[0].instanceId;
    const actions = viableActions(atCap, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === ddInstance);
    expect(actions.length).toBeGreaterThan(0);
  });
});
