/**
 * @module tw-248.test
 *
 * Card test: Great Ship (tw-248)
 * Type: hero-resource-event (short)
 * Effects: 3 (play-window end-of-org, play-target company with tap cost,
 *             on-event self-enters-play → add-constraint cancel-hazard-by-tap)
 *
 * "Tap a character in target company during the organization phase to play
 *  Great Ship on that company. Until the end of the turn, if the company's
 *  current site path contains a Coastal Sea region and no consecutive
 *  non-Coastal Seas regions, any character in the company may tap to cancel
 *  a hazard that targets the company or an entity associated with it."
 *
 * Engine Support:
 * | # | Feature                                    | Status      | Notes                                   |
 * |---|--------------------------------------------|-------------|-----------------------------------------|
 * | 1 | Play window = end of organization          | IMPLEMENTED | play-window phase:organization step:end-of-org |
 * | 2 | Target = company, cost = tap character      | IMPLEMENTED | play-target company with tap cost        |
 * | 3 | Adds cancel-hazard-by-tap constraint        | IMPLEMENTED | on-event self-enters-play apply          |
 * | 4 | Constraint enables cancel during M/H chain  | IMPLEMENTED | cancel-hazard-by-tap actions in M/H      |
 * | 5 | Coastal path condition enforced              | IMPLEMENTED | isCoastalPath in movement-hazard.ts      |
 * | 6 | Cancel negates chain entry + taps character  | IMPLEMENTED | handleCancelHazardByTap reducer          |
 * | 7 | Constraint clears at turn-end               | IMPLEMENTED | sweepExpired turn-end                    |
 *
 * Certified: 2026-04-14
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF, CAVE_DRAKE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, EDHELLOND,
  mint,
  makeMHState,
  handCardId, charIdAt, companyIdAt, dispatch,
} from '../test-helpers.js';
import type {
  CancelHazardByTapAction,
  CardDefinitionId,
} from '../../index.js';

const GREAT_SHIP = 'tw-248' as CardDefinitionId;
import { RegionType, SiteType, CardStatus } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { addConstraint, sweepExpired } from '../../engine/pending.js';
import { initiateChain } from '../../engine/chain-reducer.js';

describe('Great Ship (tw-248)', () => {
  beforeEach(() => resetMint());


  test('Great Ship is playable during organization when there is an untapped character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GREAT_SHIP], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const greatShipInstance = handCardId(base, 0);

    const playActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string; targetScoutInstanceId?: string });
    const gsActions = playActions.filter(a => a.cardInstanceId === greatShipInstance);
    expect(gsActions.length).toBeGreaterThan(0);
    expect(gsActions[0].targetScoutInstanceId).toBeDefined();
  });

  test('playing Great Ship taps the chosen character and adds cancel-hazard-by-tap constraint', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GREAT_SHIP], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const greatShipInstance = handCardId(base, 0);
    const aragornInstance = charIdAt(base, 0);
    const companyId = companyIdAt(base, 0);

    const nextState = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: greatShipInstance,
      targetScoutInstanceId: aragornInstance,
    });

    expect(nextState.players[0].characters[aragornInstance as string].status).toBe(CardStatus.Tapped);
    expect(nextState.activeConstraints).toHaveLength(1);
    const constraint = nextState.activeConstraints[0];
    expect(constraint.kind.type).toBe('cancel-hazard-by-tap');
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.target).toEqual({ kind: 'company', companyId });
  });

  test('playing Great Ship implicitly transitions into the end-of-org sub-step', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GREAT_SHIP], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const greatShipInstance = handCardId(base, 0);
    const aragornInstance = charIdAt(base, 0);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: greatShipInstance,
      targetScoutInstanceId: aragornInstance,
    });
    expect(afterPlay.phaseState.phase).toBe(Phase.Organization);
    expect((afterPlay.phaseState as { step?: string }).step).toBe('end-of-org');
  });

  test('Great Ship is not playable when all characters are tapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GREAT_SHIP], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornInstance = charIdAt(base, 0);
    const tappedState = {
      ...base,
      players: [
        {
          ...base.players[0],
          characters: {
            ...base.players[0].characters,
            [aragornInstance as string]: {
              ...base.players[0].characters[aragornInstance as string],
              status: CardStatus.Tapped,
            },
          },
        },
        base.players[1],
      ] as const,
    };

    const playActions = computeLegalActions(tappedState, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(playActions.length).toBe(0);
  });

  test('cancel-hazard-by-tap actions appear during M/H when chain has a hazard and path is coastal', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EDHELLOND, characters: [ARAGORN, GANDALF] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE], siteDeck: [RIVENDELL] },
      ],
    });

    const companyId = companyIdAt(base, 0);
    const aragornInstance = charIdAt(base, 0, 0, 0);
    const gandalfInstance = charIdAt(base, 0, 0, 1);

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Coastal, RegionType.Coastal, RegionType.Coastal],
      resolvedSitePathNames: ['Anfalas', 'Anfalas', 'Lindon'],
      destinationSiteType: SiteType.Haven,
      destinationSiteName: 'Grey Havens',
    });

    const caveDrakeCard = { instanceId: mint(), definitionId: CAVE_DRAKE };
    const withChain = initiateChain(
      { ...base, phaseState: mhState },
      PLAYER_2,
      caveDrakeCard,
      { type: 'creature' },
    );

    const constrained = addConstraint(withChain, {
      source: mint(),
      sourceDefinitionId: GREAT_SHIP,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'cancel-hazard-by-tap' },
    });

    const actions = computeLegalActions(constrained, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-hazard-by-tap');
    expect(actions.length).toBe(2);

    const cancelActions = actions.map(ea => ea.action as CancelHazardByTapAction);
    const charIds = cancelActions.map(a => a.characterInstanceId);
    expect(charIds).toContain(aragornInstance);
    expect(charIds).toContain(gandalfInstance);
    expect(cancelActions[0].chainEntryIndex).toBe(0);
  });

  test('cancel-hazard-by-tap is NOT available when path has no coastal region', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE], siteDeck: [RIVENDELL] },
      ],
    });

    const companyId = companyIdAt(base, 0);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir', 'Hollin'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });

    const caveDrakeCard = { instanceId: mint(), definitionId: CAVE_DRAKE };
    const withChain = initiateChain(
      { ...base, phaseState: mhState },
      PLAYER_2,
      caveDrakeCard,
      { type: 'creature' },
    );

    const constrained = addConstraint(withChain, {
      source: mint(),
      sourceDefinitionId: GREAT_SHIP,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'cancel-hazard-by-tap' },
    });

    const actions = computeLegalActions(constrained, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-hazard-by-tap');
    expect(actions.length).toBe(0);
  });

  test('cancel-hazard-by-tap is NOT available when path has consecutive non-coastal regions', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EDHELLOND, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE], siteDeck: [RIVENDELL] },
      ],
    });

    const companyId = companyIdAt(base, 0);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Coastal, RegionType.Wilderness, RegionType.Free, RegionType.Coastal],
      resolvedSitePathNames: ['Anfalas', 'Enedhwaith', 'Cardolan', 'Lindon'],
      destinationSiteType: SiteType.Haven,
      destinationSiteName: 'Grey Havens',
    });

    const caveDrakeCard = { instanceId: mint(), definitionId: CAVE_DRAKE };
    const withChain = initiateChain(
      { ...base, phaseState: mhState },
      PLAYER_2,
      caveDrakeCard,
      { type: 'creature' },
    );

    const constrained = addConstraint(withChain, {
      source: mint(),
      sourceDefinitionId: GREAT_SHIP,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'cancel-hazard-by-tap' },
    });

    const actions = computeLegalActions(constrained, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-hazard-by-tap');
    expect(actions.length).toBe(0);
  });

  test('cancel-hazard-by-tap IS available with isolated non-coastal region in coastal path', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EDHELLOND, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE], siteDeck: [RIVENDELL] },
      ],
    });

    const companyId = companyIdAt(base, 0);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Coastal, RegionType.Free, RegionType.Coastal, RegionType.Coastal],
      resolvedSitePathNames: ['Anfalas', 'Cardolan', 'Lindon', 'Lindon'],
      destinationSiteType: SiteType.Haven,
      destinationSiteName: 'Grey Havens',
    });

    const caveDrakeCard = { instanceId: mint(), definitionId: CAVE_DRAKE };
    const withChain = initiateChain(
      { ...base, phaseState: mhState },
      PLAYER_2,
      caveDrakeCard,
      { type: 'creature' },
    );

    const constrained = addConstraint(withChain, {
      source: mint(),
      sourceDefinitionId: GREAT_SHIP,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'cancel-hazard-by-tap' },
    });

    const actions = computeLegalActions(constrained, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-hazard-by-tap');
    expect(actions.length).toBe(1);
  });

  test('cancel-hazard-by-tap is NOT available when no chain exists', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EDHELLOND, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const companyId = companyIdAt(base, 0);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Coastal, RegionType.Coastal],
      resolvedSitePathNames: ['Anfalas', 'Lindon'],
    });

    const constrained = addConstraint({ ...base, phaseState: mhState }, {
      source: mint(),
      sourceDefinitionId: GREAT_SHIP,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'cancel-hazard-by-tap' },
    });

    const actions = computeLegalActions(constrained, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-hazard-by-tap');
    expect(actions.length).toBe(0);
  });

  test('dispatching cancel-hazard-by-tap negates chain entry and taps character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EDHELLOND, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornInstance = charIdAt(base, 0);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Coastal, RegionType.Coastal],
      resolvedSitePathNames: ['Anfalas', 'Lindon'],
    });

    const caveDrakeCard = { instanceId: mint(), definitionId: CAVE_DRAKE };
    const withChain = initiateChain(
      { ...base, phaseState: mhState },
      PLAYER_2,
      caveDrakeCard,
      { type: 'creature' },
    );

    const result = dispatch(withChain, {
      type: 'cancel-hazard-by-tap',
      player: PLAYER_1,
      characterInstanceId: aragornInstance,
      chainEntryIndex: 0,
    });

    expect(result.players[0].characters[aragornInstance as string].status).toBe(CardStatus.Tapped);
    expect(result.chain!.entries[0].negated).toBe(true);
  });

  test('constraint clears at turn-end via sweepExpired', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: EDHELLOND, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const companyId = companyIdAt(base, 0);
    const constrained = addConstraint(base, {
      source: mint(),
      sourceDefinitionId: GREAT_SHIP,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'cancel-hazard-by-tap' },
    });
    expect(constrained.activeConstraints).toHaveLength(1);

    const swept = sweepExpired(constrained, { kind: 'turn-end' });
    expect(swept.activeConstraints).toHaveLength(0);
  });

  test('Great Ship is discarded after being played (short event)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GREAT_SHIP], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const greatShipInstance = handCardId(base, 0);
    const aragornInstance = charIdAt(base, 0);

    const nextState = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: greatShipInstance,
      targetScoutInstanceId: aragornInstance,
    });

    expect(nextState.players[0].hand.length).toBe(0);
    expect(nextState.players[0].discardPile.find(c => c.instanceId === greatShipInstance)).toBeDefined();
  });
});
