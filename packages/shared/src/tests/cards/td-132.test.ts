/**
 * @module td-132.test
 *
 * Card test: Many Turns and Doublings (td-132)
 * Type: hero-resource-event (short)
 * Effects:
 *   1. cancel-attack — cancel one attack by Wolves, Spiders, Animals, or
 *      Undead against a ranger's company (requires untapped ranger, taps ranger)
 *   2. play-target — targets a ranger character with tap cost
 *   3. play-option "decrease-hazard-limit" — if Gates of Morning is in play,
 *      decrease the hazard limit against the ranger's company by 1 (no minimum)
 *
 * "Ranger only. Cancel an attack by Wolves, Spiders, Animals, or Undead
 * against a ranger's company. Alternatively, if Gates of Morning is in play,
 * decrease the hazard limit against the ranger's company by one (no minimum)."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, ELROND,
  ORC_PATROL, BARROW_WIGHT, GATES_OF_MORNING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions,
  makeMHState,
  playCreatureHazardAndResolve,
  CardStatus,
  handCardId, companyIdAt, dispatch, expectCharStatus, expectInDiscardPile,
} from '../test-helpers.js';
import type { CancelAttackAction, PlayShortEventAction } from '../../index.js';
import { RegionType, SiteType, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInPlay, CardInstanceId } from '../../index.js';

const MANY_TURNS_AND_DOUBLINGS = 'td-132' as CardDefinitionId;

describe('Many Turns and Doublings (td-132)', () => {
  beforeEach(() => resetMint());

  // ── Cancel-attack mode ──────────────────────────────────────────────

  test('cancel-attack available against undead with ranger (taps ranger)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [MANY_TURNS_AND_DOUBLINGS], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BARROW_WIGHT], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const barrowWightId = handCardId(stateAtMH, 1);
    const targetCompanyId = companyIdAt(stateAtMH, 0);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, barrowWightId, targetCompanyId,
      { method: 'region-type', value: 'shadow' },
    );

    expect(combatState.combat).toBeDefined();
    expect(combatState.combat!.phase).toBe('assign-strikes');

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);
    const cancelAction = cancelActions[0].action as CancelAttackAction;
    expect(cancelAction.scoutInstanceId).toBeDefined();
  });

  test('executing cancel-attack taps ranger, discards card, cancels combat', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [MANY_TURNS_AND_DOUBLINGS], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BARROW_WIGHT], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const barrowWightId = handCardId(stateAtMH, 1);
    const targetCompanyId = companyIdAt(stateAtMH, 0);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, barrowWightId, targetCompanyId,
      { method: 'region-type', value: 'shadow' },
    );

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    const after = dispatch(combatState, cancelActions[0].action);

    expect(after.combat).toBeNull();
    expect(after.players[0].hand).toHaveLength(0);
    expectInDiscardPile(after, 0, MANY_TURNS_AND_DOUBLINGS);
    expectCharStatus(after, 0, ARAGORN, CardStatus.Tapped);
    expectInDiscardPile(after, 1, BARROW_WIGHT);
  });

  test('cancel-attack NOT available against non-qualifying race (orc)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [MANY_TURNS_AND_DOUBLINGS], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, 1);
    const targetCompanyId = companyIdAt(stateAtMH, 0);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'shadow' },
    );

    expect(combatState.combat).toBeDefined();
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('cancel-attack NOT available when no ranger in company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ELROND] }], hand: [MANY_TURNS_AND_DOUBLINGS], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BARROW_WIGHT], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const barrowWightId = handCardId(stateAtMH, 1);
    const targetCompanyId = companyIdAt(stateAtMH, 0);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, barrowWightId, targetCompanyId,
      { method: 'region-type', value: 'shadow' },
    );

    expect(combatState.combat).toBeDefined();
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  // ── Hazard-limit modifier mode ──────────────────────────────────────

  test('decrease-hazard-limit playable during organization when GoM in play and ranger available', () => {
    const gomInPlay: CardInPlay = { instanceId: 'gom-1' as CardInstanceId, definitionId: GATES_OF_MORNING, status: CardStatus.Untapped };
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [MANY_TURNS_AND_DOUBLINGS], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(playActions).toHaveLength(1);
    expect(playActions[0].optionId).toBe('decrease-hazard-limit');
    expect(playActions[0].targetCharacterId).toBeDefined();
  });

  test('decrease-hazard-limit NOT playable when GoM is NOT in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [MANY_TURNS_AND_DOUBLINGS], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('decrease-hazard-limit NOT playable when no ranger in play', () => {
    const gomInPlay: CardInPlay = { instanceId: 'gom-1' as CardInstanceId, definitionId: GATES_OF_MORNING, status: CardStatus.Untapped };
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MANY_TURNS_AND_DOUBLINGS], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('executing decrease-hazard-limit taps ranger and adds hazard-limit-modifier constraint', () => {
    const gomInPlay: CardInPlay = { instanceId: 'gom-1' as CardInstanceId, definitionId: GATES_OF_MORNING, status: CardStatus.Untapped };
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [MANY_TURNS_AND_DOUBLINGS], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(playActions).toHaveLength(1);

    const after = dispatch(state, playActions[0]);

    expectCharStatus(after, 0, ARAGORN, CardStatus.Tapped);
    expect(after.players[0].hand).toHaveLength(0);
    expectInDiscardPile(after, 0, MANY_TURNS_AND_DOUBLINGS);

    expect(after.activeConstraints).toHaveLength(1);
    const constraint = after.activeConstraints[0];
    expect(constraint.kind.type).toBe('hazard-limit-modifier');
    if (constraint.kind.type === 'hazard-limit-modifier') {
      expect(constraint.kind.value).toBe(-1);
    }
    expect(constraint.target.kind).toBe('company');
    expect(constraint.scope.kind).toBe('company-mh-phase');
  });

  test('not playable during long-event phase without GoM (combat-only in that case)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [MANY_TURNS_AND_DOUBLINGS], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('decrease-hazard-limit playable during long-event phase with GoM', () => {
    const gomInPlay: CardInPlay = { instanceId: 'gom-1' as CardInstanceId, definitionId: GATES_OF_MORNING, status: CardStatus.Untapped };
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [MANY_TURNS_AND_DOUBLINGS], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(playActions).toHaveLength(1);
    expect(playActions[0].optionId).toBe('decrease-hazard-limit');
  });
});
