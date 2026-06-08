/**
 * @module le-140.test
 *
 * Card test: Stay Her Appetite (le-140)
 * Type: hazard-event (short)
 * Effects: 2 (play-target ally, stay-her-appetite)
 *
 * Card text:
 *   "Playable on an ally. Make a roll. If the result plus the ally's mind is
 *    greater than your opponent's unused general influence plus its controlling
 *    character's unused direct influence plus 5, the ally attacks its controlling
 *    character (detainment attack against a hero). This attack has 1 strike and
 *    prowess equal to the ally's normal prowess plus a dice roll. Discard the
 *    ally if it attacks and is not defeated."
 *
 * Engine Support:
 * | # | Feature                                          | Status |
 * |---|--------------------------------------------------|--------|
 * | 1 | Playable targeting an ally during MH phase       | IMPL   |
 * | 2 | Condition roll: roll + mind > GI + DI + 5        | IMPL   |
 * | 3 | No attack when condition fails                   | IMPL   |
 * | 4 | Prowess roll: ally prowess + 2d6                 | IMPL   |
 * | 5 | 1-strike detainment attack on controlling char   | IMPL   |
 * | 6 | Ally discarded if attack not defeated            | IMPL   |
 *
 * Certified: 2026-06-08
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, FATTY_BOLGER,
  GWAIHIR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  viableActions,
  dispatch,
  resolveChain,
  attachAllyToChar,
  handCardId,
  findCharInstanceId,
  getCharacter,
  companyIdAt,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, PlayHazardAction } from '../../index.js';
import { reduce } from '../../index.js';

const STAY_HER_APPETITE = 'le-140' as CardDefinitionId;

describe('Stay Her Appetite (le-140)', () => {
  beforeEach(() => resetMint());

  test('play-hazard is offered targeting an ally in the active company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [STAY_HER_APPETITE],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GWAIHIR);
    const mhState = makeMHState();
    const state = { ...withAlly, phaseState: mhState };

    const actions = viableActions(state, PLAYER_2, 'play-hazard');
    const stayActions = actions.filter(a => {
      const pa = a.action as unknown as PlayHazardAction;
      return pa.cardInstanceId === handCardId(state, HAZARD_PLAYER) && pa.targetAllyId !== undefined;
    });
    expect(stayActions.length).toBeGreaterThan(0);
  });

  test('play-hazard targeting an ally enqueues a stay-her-appetite-roll pending resolution', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [STAY_HER_APPETITE],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GWAIHIR);
    const mhState = makeMHState();
    const state = { ...withAlly, phaseState: mhState };

    const stayId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const allyInstId = getCharacter(state, RESOURCE_PLAYER, ARAGORN).allies[0].instanceId;

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: stayId,
      targetCompanyId: companyId,
      targetAllyId: allyInstId,
    });

    // Chain entry resolves → pending resolution enqueued
    const afterChain = resolveChain(afterPlay);

    const pendingRoll = afterChain.pendingResolutions.find(r => r.kind.type === 'stay-her-appetite-roll');
    expect(pendingRoll).toBeDefined();
    expect(pendingRoll!.kind.type).toBe('stay-her-appetite-roll');
  });

  test('when roll + mind does not exceed threshold, no attack is initiated', () => {
    // Aragorn (DI 3), opponent GI 20 → threshold = 20 + 3 + 5 = 28
    // Gwaihir mind 4. Max roll (12) + 4 = 16 < 28 → condition never met.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [STAY_HER_APPETITE],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GWAIHIR);
    const mhState = makeMHState();
    const state = { ...withAlly, phaseState: mhState };

    const stayId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const allyInstId = getCharacter(state, RESOURCE_PLAYER, ARAGORN).allies[0].instanceId;

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: stayId,
      targetCompanyId: companyId,
      targetAllyId: allyInstId,
    });

    // Resolve chain
    const afterChain = resolveChain(afterPlay);

    expect(afterChain.pendingResolutions.some(r => r.kind.type === 'stay-her-appetite-roll')).toBe(true);

    // Roll with cheat total 2 → roll + mind = 2 + 4 = 6 < 28 → no attack
    const stateWithCheat = { ...afterChain, cheatRollTotal: 2 as number | null };
    const rollActions = viableActions(stateWithCheat, PLAYER_2, 'stay-her-appetite-roll');
    expect(rollActions).toHaveLength(1);

    const afterRoll = reduce(stateWithCheat, rollActions[0].action);
    expect(afterRoll.state.combat).toBeNull();
    expect(afterRoll.state.pendingResolutions.some(r => r.kind.type === 'stay-her-appetite-roll')).toBe(false);

    // Ally should still be attached (no attack → no discard)
    expect(getCharacter(afterRoll.state, RESOURCE_PLAYER, ARAGORN).allies).toHaveLength(1);
  });

  test('when roll + mind exceeds threshold, a detainment attack initiates', () => {
    // Fatty Bolger (DI 0), P2 has Legolas (mind 6) + Aragorn (mind 6) = GI used 12, unused 8
    // threshold = 8 + 0 + 5 = 13. Gwaihir mind 4. Roll 12 → 12+4=16 > 13 → attack.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [FATTY_BOLGER] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS, ARAGORN] }],
          hand: [STAY_HER_APPETITE],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, FATTY_BOLGER, GWAIHIR);
    const mhState = makeMHState();
    const state = { ...withAlly, phaseState: mhState };

    const stayId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const allyInstId = getCharacter(state, RESOURCE_PLAYER, FATTY_BOLGER).allies[0].instanceId;

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: stayId,
      targetCompanyId: companyId,
      targetAllyId: allyInstId,
    });

    const afterChain = resolveChain(afterPlay);
    expect(afterChain.pendingResolutions.some(r => r.kind.type === 'stay-her-appetite-roll')).toBe(true);

    // Roll 12 → condition met (12+4=16 > 13); prowess roll is random after cheat consumed
    const stateWithCheat = { ...afterChain, cheatRollTotal: 12 as number | null };
    const rollActions = viableActions(stateWithCheat, PLAYER_2, 'stay-her-appetite-roll');
    expect(rollActions).toHaveLength(1);

    const afterRoll = reduce(stateWithCheat, rollActions[0].action);

    // Attack initiated: detainment combat with 1 strike
    expect(afterRoll.state.combat).not.toBeNull();
    expect(afterRoll.state.combat!.strikesTotal).toBe(1);
    expect(afterRoll.state.combat!.detainment).toBe(true);
    expect(afterRoll.state.combat!.attackSource.type).toBe('stay-her-appetite-attack');
    // prowess = Gwaihir base (4) + second dice roll (random, min 2)
    expect(afterRoll.state.combat!.strikeProwess).toBeGreaterThanOrEqual(6);
  });

  test('ally is discarded when the attack is not defeated', () => {
    // P2 has Legolas (mind 6) + Aragorn (mind 6) = GI used 12, unused 8
    // threshold = 8 + 0 + 5 = 13. Roll 12 → 12+4=16 > 13 → attack.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [FATTY_BOLGER] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS, ARAGORN] }],
          hand: [STAY_HER_APPETITE],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, FATTY_BOLGER, GWAIHIR);
    const mhState = makeMHState();
    const state = { ...withAlly, phaseState: mhState };

    const stayId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const allyInstId = getCharacter(state, RESOURCE_PLAYER, FATTY_BOLGER).allies[0].instanceId;

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: stayId,
      targetCompanyId: companyId,
      targetAllyId: allyInstId,
    });

    const afterChain = resolveChain(afterPlay);

    // Roll condition: met (roll=12, mind=4, threshold=13 → 16>13)
    const stateWithCheat = { ...afterChain, cheatRollTotal: 12 as number | null };
    const afterRoll = reduce(stateWithCheat, viableActions(stateWithCheat, PLAYER_2, 'stay-her-appetite-roll')[0].action);

    expect(afterRoll.state.combat).not.toBeNull();

    // Assign strike to Fatty Bolger — the sole character in the company
    const fattyId = findCharInstanceId(afterRoll.state, RESOURCE_PLAYER, FATTY_BOLGER);
    const afterAssign = reduce(afterRoll.state, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: fattyId,
    });

    // Resolve strike — character fails (roll 2 + prowess 1 = 3, attack prowess ≥ 6)
    const stateForStrike = { ...afterAssign.state, cheatRollTotal: 2 as number | null };
    const resolveActions = viableActions(stateForStrike, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);

    const afterStrike = reduce(stateForStrike, resolveActions[0].action);

    // After combat ends, ally should be discarded
    if (afterStrike.state.combat === null) {
      // Combat finalized — ally gone from character
      expect(getCharacter(afterStrike.state, RESOURCE_PLAYER, FATTY_BOLGER).allies).toHaveLength(0);
      // Ally in discard pile
      expect(afterStrike.state.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === allyInstId)).toBe(true);
    } else {
      // Body check pending — check after body check resolves
      const bodyActions = viableActions(afterStrike.state, PLAYER_1, 'body-check');
      if (bodyActions.length > 0) {
        const afterBody = reduce({ ...afterStrike.state, cheatRollTotal: 12 as number | null }, bodyActions[0].action);
        expect(getCharacter(afterBody.state, RESOURCE_PLAYER, FATTY_BOLGER).allies).toHaveLength(0);
        expect(afterBody.state.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === allyInstId)).toBe(true);
      }
    }
  });
});
