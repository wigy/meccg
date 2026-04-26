/**
 * @module dm-132.test
 *
 * Card test: Forewarned Is Forearmed (dm-132)
 * Type: hero-resource-event (permanent)
 * Alignment: wizard
 * Effects: 3
 *
 * Text:
 *   "Any non-Dragon Lair site with more than one automatic-attack is reduced
 *    to having one automatic-attack of the hazard player's choice (this attack
 *    cannot be canceled). Any creature or other hazard with more than one
 *    attack is reduced to one attack of the hazard player's choice (this
 *    attack cannot be canceled). Discard when such an isolated attack is
 *    defeated. Cannot be duplicated."
 *
 * Engine Support:
 * | # | Rule                                                              | Status      |
 * |---|-------------------------------------------------------------------|-------------|
 * | 1 | Non-Dragon Lair multi-attack sites reduced to 1 attack (hazard    | IMPLEMENTED |
 * |   | player's choice, via forewarned-select-attack step)               |             |
 * | 2 | Dragon Lair sites are excluded from the reduction                 | IMPLEMENTED |
 * | 3 | Multi-attack creatures reduced to 1 attack (isolated+uncancelable)| IMPLEMENTED |
 * | 4 | The chosen isolated attack cannot be canceled                     | IMPLEMENTED |
 * | 5 | Discard when such isolated attack is defeated                     | IMPLEMENTED |
 * | 6 | Card stays when non-isolated attack is defeated                   | IMPLEMENTED |
 * | 7 | Cannot be duplicated                                              | IMPLEMENTED |
 *
 * Playable: YES
 * Certified: 2026-04-26
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase, CardStatus,
  ARAGORN, LEGOLAS, GIMLI,
  ASSASSIN,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BREE,
  buildTestState, resetMint, makeMHState, buildSitePhaseState,
  resolveChain, setupAutoAttackStep, buildDualHandSitePhaseState,
  viableActions, handCardId, companyIdAt, charIdAt,
  pushCardInPlay, expectInDiscardPile,
  RESOURCE_PLAYER, HAZARD_PLAYER, dispatch, phaseStateAs,
} from '../test-helpers.js';
import { computeLegalActions, Phase as PhaseEnum, SiteType } from '../../index.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId, SitePhaseState, SiteCard } from '../../index.js';

const FOREWARNED_IS_FOREARMED = 'dm-132' as CardDefinitionId;
const ETTENMOORS_LE = 'le-373' as CardDefinitionId;
const CAVES_OF_ULUND = 'tw-381' as CardDefinitionId;

/** Convenience: add Forewarned to RESOURCE_PLAYER's cardsInPlay. */
function withForewarnedInPlay(state: Parameters<typeof pushCardInPlay>[0]) {
  const card: CardInPlay = {
    instanceId: 'fia-test' as CardInstanceId,
    definitionId: FOREWARNED_IS_FOREARMED,
    status: CardStatus.Untapped,
  };
  return pushCardInPlay(state, RESOURCE_PLAYER, card);
}

describe('Forewarned Is Forearmed (dm-132)', () => {
  beforeEach(() => resetMint());

  // ── Rule 7: Cannot be duplicated ─────────────────────────────────────────

  test('cannot be duplicated — second copy blocked when one is already in play (same player)', () => {
    const inPlay: CardInPlay = {
      instanceId: 'fia-pre' as CardInstanceId,
      definitionId: FOREWARNED_IS_FOREARMED,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [FOREWARNED_IS_FOREARMED],
          siteDeck: [MORIA],
          cardsInPlay: [inPlay],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('cannot be duplicated — second copy blocked when opponent has one in play', () => {
    const inPlay: CardInPlay = {
      instanceId: 'fia-opp' as CardInstanceId,
      definitionId: FOREWARNED_IS_FOREARMED,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [FOREWARNED_IS_FOREARMED],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          cardsInPlay: [inPlay],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('playable when no copy is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [FOREWARNED_IS_FOREARMED],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
  });

  // ── Rule 1: Non-Dragon Lair site with multiple attacks → select step ──────

  test('non-Dragon Lair site with multiple auto-attacks: forewarned-select-attack step inserted', () => {
    // le-373 (Ettenmoors) has 2 auto-attacks: Troll (1×9) and Wolves (2×8)
    const base = buildDualHandSitePhaseState({
      site: ETTENMOORS_LE,
      step: 'reveal-on-guard-attacks',
    });
    const state = withForewarnedInPlay(base);

    // Resource player passes → transitions to forewarned-select-attack
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const siteState = phaseStateAs<SitePhaseState>(afterPass);
    expect(siteState.step).toBe('forewarned-select-attack');
  });

  test('forewarned-select-attack: hazard player gets one action per auto-attack', () => {
    const base = buildDualHandSitePhaseState({
      site: ETTENMOORS_LE,
      step: 'reveal-on-guard-attacks',
    });
    const state = withForewarnedInPlay(base);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const p2Actions = viableActions(afterPass, PLAYER_2, 'select-forewarned-attack');
    // 2 auto-attacks → 2 possible selections (index 0 and 1)
    expect(p2Actions).toHaveLength(2);
    const indices = p2Actions.map(a => (a.action as { attackIndex: number }).attackIndex).sort();
    expect(indices).toEqual([0, 1]);
  });

  test('forewarned-select-attack: resource player has no actions during selection', () => {
    const base = buildDualHandSitePhaseState({
      site: ETTENMOORS_LE,
      step: 'reveal-on-guard-attacks',
    });
    const state = withForewarnedInPlay(base);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const p1Actions = viableActions(afterPass, PLAYER_1, 'select-forewarned-attack');
    expect(p1Actions).toHaveLength(0);
  });

  test('after selection, only the chosen attack is resolved as automatic-attack', () => {
    // Hazard player selects Troll (index 0). Only 1 attack should trigger.
    const base = buildDualHandSitePhaseState({
      site: ETTENMOORS_LE,
      step: 'reveal-on-guard-attacks',
    });
    const state = withForewarnedInPlay(base);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const afterSelect = dispatch(afterPass, {
      type: 'select-forewarned-attack',
      player: PLAYER_2,
      attackIndex: 0,
    });
    const siteState = phaseStateAs<SitePhaseState>(afterSelect);
    expect(siteState.step).toBe('automatic-attacks');
    expect(siteState.selectedAutoAttackIndex).toBe(0);

    // Trigger auto-attack by passing
    const afterAttack = dispatch(afterSelect, { type: 'pass', player: PLAYER_1 });
    expect(afterAttack.combat).not.toBeNull();
    // Attack[0] is Troll: 1 strike at prowess 9
    expect(afterAttack.combat!.strikesTotal).toBe(1);
    expect(afterAttack.combat!.strikeProwess).toBe(9);
    expect(afterAttack.combat!.creatureRace).toBe('troll');
    // Marked as isolated and uncancelable
    expect(afterAttack.combat!.isolated).toBe(true);
    expect(afterAttack.combat!.uncancelable).toBe(true);
  });

  // ── Rule 2: Dragon Lair sites excluded ───────────────────────────────────

  test('Dragon Lair site is NOT affected — step goes directly to automatic-attacks', () => {
    // Inject a second attack on Caves of Ûlund so the only difference is lairOf
    const base = buildDualHandSitePhaseState({
      site: CAVES_OF_ULUND,
      step: 'reveal-on-guard-attacks',
    });
    const state = withForewarnedInPlay(base);

    // Patch the card pool: give Caves of Ûlund a second auto-attack
    const siteDef = state.cardPool[CAVES_OF_ULUND as string] as SiteCard;
    const patchedSite = {
      ...siteDef,
      automaticAttacks: [
        ...siteDef.automaticAttacks,
        { creatureType: 'Dragon', strikes: 1, prowess: 12 },
      ],
    };
    const patchedState = {
      ...state,
      cardPool: { ...state.cardPool, [CAVES_OF_ULUND as string]: patchedSite },
    };

    const afterPass = dispatch(patchedState, { type: 'pass', player: PLAYER_1 });
    const siteState = phaseStateAs<SitePhaseState>(afterPass);
    // Dragon Lair exclusion: must NOT insert forewarned-select-attack step
    expect(siteState.step).toBe('automatic-attacks');
  });

  // ── Rule 3: Multi-attack creature reduced to 1 ───────────────────────────

  test('multi-attack creature (Assassin, 3 attacks) is reduced to 1 when Forewarned is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: PhaseEnum.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [ASSASSIN],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const stateWithFia = withForewarnedInPlay(state);

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const gameState = { ...stateWithFia, phaseState: mhState };

    const assassinId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: assassinId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    expect(afterChain.combat).not.toBeNull();
    // Assassin normally has 3 strikes (3×1); Forewarned reduces to 1
    expect(afterChain.combat!.strikesTotal).toBe(1);
    // Marked isolated and uncancelable
    expect(afterChain.combat!.isolated).toBe(true);
    expect(afterChain.combat!.uncancelable).toBe(true);
  });

  // ── Rule 4: Isolated attack cannot be canceled ───────────────────────────

  test('isolated attack from Forewarned cannot be canceled', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: PhaseEnum.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [ASSASSIN],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const stateWithFia = withForewarnedInPlay(state);

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const gameState = { ...stateWithFia, phaseState: mhState };

    const assassinId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: assassinId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.uncancelable).toBe(true);

    // Defending player (P1) must NOT have cancel-attack actions
    const cancelActions = viableActions(afterChain, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  // ── Rule 5: Discard when isolated attack is defeated ─────────────────────

  test('Forewarned is discarded when the isolated attack is defeated', () => {
    // Build a state at automatic-attacks step with Forewarned in play and
    // selectedAutoAttackIndex set to 0 (Troll: 1 strike at prowess 9).
    const base = buildSitePhaseState({ site: ETTENMOORS_LE, characters: [ARAGORN] });
    const withFia = withForewarnedInPlay(base);
    const autoAttackBase = setupAutoAttackStep(withFia);
    const siteState = autoAttackBase.phaseState as SitePhaseState;
    const isolatedState = {
      ...autoAttackBase,
      phaseState: { ...siteState, selectedAutoAttackIndex: 0 } as SitePhaseState,
    };

    // Trigger the (isolated) Troll attack
    const afterAttack = dispatch(isolatedState, { type: 'pass', player: PLAYER_1 });
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.isolated).toBe(true);

    // Assign the strike to Aragorn
    const aragornId = charIdAt(afterAttack, RESOURCE_PLAYER);
    const afterAssign = dispatch(afterAttack, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: aragornId,
    });

    // Aragorn prowess 6 + roll 4 = 10 ≥ 9 (Troll prowess) → strike defeated
    const stateWithRoll = { ...afterAssign, cheatRollTotal: 4 };
    const resolveActions = computeLegalActions(stateWithRoll, PLAYER_1);
    const resolveAction = resolveActions.find(a => a.viable && a.action.type === 'resolve-strike');
    expect(resolveAction).toBeDefined();
    const afterStrike = dispatch(stateWithRoll, resolveAction!.action);

    // Combat should be cleared (Troll had body: null, no body check)
    expect(afterStrike.combat).toBeNull();
    // Forewarned must be removed from P1's cardsInPlay and be in discard
    const fiaInPlay = afterStrike.players[RESOURCE_PLAYER].cardsInPlay.find(
      c => c.definitionId === (FOREWARNED_IS_FOREARMED as string),
    );
    expect(fiaInPlay).toBeUndefined();
    expectInDiscardPile(afterStrike, RESOURCE_PLAYER, FOREWARNED_IS_FOREARMED);
  });

  // ── Rule 6: Card stays when non-isolated attack is defeated ───────────────

  test('Forewarned stays in play when a non-isolated attack is defeated', () => {
    // Normal auto-attack (no selectedAutoAttackIndex → isolated = false)
    const base = buildSitePhaseState({ site: ETTENMOORS_LE, characters: [ARAGORN] });
    const withFia = withForewarnedInPlay(base);
    const readyState = setupAutoAttackStep(withFia);

    // Trigger the Troll auto-attack (not isolated)
    const afterAttack = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.isolated).toBeFalsy();

    // Assign and defeat the strike
    const aragornId = charIdAt(afterAttack, RESOURCE_PLAYER);
    const afterAssign = dispatch(afterAttack, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: aragornId,
    });

    const stateWithRoll = { ...afterAssign, cheatRollTotal: 4 };
    const resolveActions = computeLegalActions(stateWithRoll, PLAYER_1);
    const resolveAction = resolveActions.find(a => a.viable && a.action.type === 'resolve-strike');
    expect(resolveAction).toBeDefined();
    const afterStrike = dispatch(stateWithRoll, resolveAction!.action);

    expect(afterStrike.combat).toBeNull();
    // Forewarned must still be in P1's cardsInPlay (attack was not isolated)
    const fiaInPlay = afterStrike.players[RESOURCE_PLAYER].cardsInPlay.find(
      c => c.definitionId === (FOREWARNED_IS_FOREARMED as string),
    );
    expect(fiaInPlay).toBeDefined();
  });
});
