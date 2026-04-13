/**
 * @module tw-204.test
 *
 * Card test: Concealment (tw-204)
 * Type: hero-resource-event (short)
 * Effects: 1 (cancel-attack: tap a scout to cancel one attack)
 *
 * "Scout only. Tap scout to cancel one attack against his company."
 *
 * Engine Support:
 * | # | Feature                                   | Status      | Notes                               |
 * |---|-------------------------------------------|-------------|-------------------------------------|
 * | 1 | cancel-attack during assign-strikes       | IMPLEMENTED | combat legal actions + reducer       |
 * | 2 | Requires untapped scout in company        | IMPLEMENTED | legal action filter                  |
 * | 3 | Taps scout as cost                        | IMPLEMENTED | reducer taps character               |
 * | 4 | Discards Concealment from hand            | IMPLEMENTED | reducer moves card to discard        |
 * | 5 | Cancels combat (nullifies state.combat)   | IMPLEMENTED | reducer sets combat to null          |
 * | 6 | Creature moves to attacker's discard      | IMPLEMENTED | reducer handles creature cleanup     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  ORC_PATROL, CONCEALMENT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  pool, viableActions,
  makeMHState,
  playCreatureHazardAndResolve,
  CardStatus,
  handCardId, companyIdAt, dispatch, expectCharStatus, expectInDiscardPile,
} from '../test-helpers.js';
import type { CancelAttackAction, HeroResourceEventCard } from '../../index.js';
import { RegionType, SiteType, describeAction } from '../../index.js';
import type { CancelAttackEffect } from '../../types/effects.js';
import { computeLegalActions } from '../../index.js';
import { resolveInstanceId } from '../../types/state.js';

describe('Concealment (tw-204)', () => {
  beforeEach(() => resetMint());

  test('card definition has the expected cancel-attack effect', () => {
    const def = pool[CONCEALMENT as string] as HeroResourceEventCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-resource-event');
    expect(def.eventType).toBe('short');

    const cancelAttack = def.effects?.find(
      (e): e is CancelAttackEffect => e.type === 'cancel-attack',
    );
    expect(cancelAttack).toBeDefined();
    expect(cancelAttack!.requiredSkill).toBe('scout');
    expect(cancelAttack!.cost?.tap).toBe('character');
  });

  test('cancel-attack action is available when defending company has untapped scout and Concealment in hand', () => {
    // Aragorn has the scout skill and is untapped.
    // Set up M/H phase with a creature attack against P1's company.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [CONCEALMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    // P2 plays Orc-patrol creature against P1's company
    const orcPatrolId = handCardId(stateAtMH, 1);
    const targetCompanyId = companyIdAt(stateAtMH, 0);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    // Combat should be active
    expect(combatState.combat).toBeDefined();
    expect(combatState.combat!.phase).toBe('assign-strikes');

    // P1 (defending player) should have a cancel-attack action
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);
    const cancelAction = cancelActions[0].action as CancelAttackAction;
    expect(cancelAction.cardInstanceId).toBe(handCardId(combatState, 0));
  });

  test('executing cancel-attack taps scout, discards card, and cancels combat', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [CONCEALMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, 1);
    const targetCompanyId = companyIdAt(stateAtMH, 0);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    // Execute cancel-attack
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);
    const after = dispatch(combatState, cancelActions[0].action);

    // Combat should be canceled
    expect(after.combat).toBeNull();

    // Concealment should be in the discard pile
    expect(after.players[0].hand).toHaveLength(0);
    expectInDiscardPile(after, 0, CONCEALMENT);

    // Aragorn should be tapped (paid the cost)
    expectCharStatus(after, 0, ARAGORN, CardStatus.Tapped);

    // Creature should be in attacker's (P2) discard pile
    expectInDiscardPile(after, 1, ORC_PATROL);
    expect(after.players[1].cardsInPlay.find(c => c.definitionId === ORC_PATROL)).toBeUndefined();
  });

  test('cancel-attack is NOT available when there is no scout in the company', () => {
    // Gimli has warrior/diplomat — no scout skill.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GIMLI] }], hand: [CONCEALMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, 1);
    const targetCompanyId = companyIdAt(stateAtMH, 0);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat).toBeDefined();
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('cancel-attack is NOT available when the scout is tapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, status: CardStatus.Tapped }] }],
          hand: [CONCEALMENT],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, 1);
    const targetCompanyId = companyIdAt(stateAtMH, 0);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat).toBeDefined();
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('Concealment is NOT playable during the long-event phase (no attack)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [CONCEALMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const shortEventActions = actions.filter(a => a.action.type === 'play-short-event');
    expect(shortEventActions).toHaveLength(0);

    // Concealment should be marked not-playable
    const notPlayable = actions.filter(a => a.action.type === 'not-playable');
    expect(notPlayable.length).toBeGreaterThan(0);
  });

  test('cancel-attack action description names card and scout for opponent notification', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [CONCEALMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, 1);
    const targetCompanyId = companyIdAt(stateAtMH, 0);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);

    // describeAction should mention both the card name and the scout name
    // so the opponent notification is informative (bug: cards just disappeared)
    const instLookup = (id: string) => resolveInstanceId(combatState, id as never);
    const desc = describeAction(cancelActions[0].action, pool, instLookup);
    expect(desc).toContain('Cancel attack');
    expect(desc).toContain('Concealment');
    expect(desc).toContain('Aragorn');
  });

  test('cancel-attack is NOT available to the attacking player', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [CONCEALMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, 1);
    const targetCompanyId = companyIdAt(stateAtMH, 0);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat).toBeDefined();
    // P2 is the attacker — should have no cancel-attack actions
    const cancelActions = viableActions(combatState, PLAYER_2, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });
});
