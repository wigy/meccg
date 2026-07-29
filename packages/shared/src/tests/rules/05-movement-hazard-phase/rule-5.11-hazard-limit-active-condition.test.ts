/**
 * @module rule-5.11-hazard-limit-active-condition
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.11: Hazard Limit as Active Condition
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Not exceeding the hazard limit is treated as an active condition of the hazard player taking actions during the entirety of a movement/hazard phase; there must be fewer declared actions that count against the hazard limit when compared to that hazard limit at declaration, and there must be no more declared actions that count against the hazard limit when compared to that hazard limit at resolution.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  GATES_OF_MORNING, EYE_OF_SAURON, ORC_PATROL, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, nonViableOfType,
  makeMHState, makeShadowMHState, makeWildernessMHState,
  handCardId, dispatch, resolveChain,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  companyIdAt, CardStatus,
} from '../../test-helpers.js';
import type { CardDefinitionId, CardInPlay, CardInstanceId, PlayShortEventAction } from '../../../index.js';
import { computeLegalActions } from '../../../engine/legal-actions/index.js';

const MANY_TURNS_AND_DOUBLINGS = 'td-132' as CardDefinitionId;

describe('Rule 5.11 — Hazard Limit as Active Condition', () => {
  beforeEach(() => resetMint());

  test('Hazard action offered as viable when hazard count is below limit', () => {
    // hazardsPlayedThisCompany=0 < hazardLimitAtReveal=2 → Eye of Sauron is viable
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [EYE_OF_SAURON], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const state = { ...base, phaseState: makeShadowMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 0 }) };

    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);
  });

  test('Hazard action offered as non-viable when hazard limit is reached', () => {
    // hazardsPlayedThisCompany=2 >= hazardLimitAtReveal=2 → Eye of Sauron is non-viable
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [EYE_OF_SAURON], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const state = { ...base, phaseState: makeShadowMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 2 }) };

    // Eye of Sauron must be listed but not viable (limit reached)
    const allActions = computeLegalActions(state, PLAYER_2);
    const nonViable = nonViableOfType(allActions, 'play-hazard');
    const eyeInst = handCardId(state, HAZARD_PLAYER);
    expect(nonViable.some(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === eyeInst)).toBe(true);
  });

  test('Hazard action with hazard limit of 1 is non-viable when one hazard already played', () => {
    // hazardsPlayedThisCompany=1 >= hazardLimitAtReveal=1 → no more plays allowed
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [EYE_OF_SAURON], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const state = { ...base, phaseState: makeShadowMHState({ hazardLimitAtReveal: 1, hazardsPlayedThisCompany: 1 }) };

    const viable = viableActions(state, PLAYER_2, 'play-hazard');
    expect(viable).toHaveLength(0);
  });

  test('resource player can respond in chain with Many Turns and Doublings to decrease hazard limit when Gates of Morning is in play', () => {
    const gomInPlay: CardInPlay = { instanceId: 'gom-1' as CardInstanceId, definitionId: GATES_OF_MORNING, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [MANY_TURNS_AND_DOUBLINGS], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [EYE_OF_SAURON], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({ activeCompanyIndex: 0, hazardLimitAtReveal: 2 });
    const stateAtMH = { ...base, phaseState: mhState };

    const eyeId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);

    // Hazard player plays Eye of Sauron → chain starts, resource player gets priority
    const afterEye = dispatch(stateAtMH, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: eyeId, targetCompanyId });

    expect(afterEye.chain).not.toBeNull();
    expect(afterEye.chain!.priority).toBe(PLAYER_1);

    // Resource player must have play-short-event for Many Turns and Doublings
    const playActions = viableActions(afterEye, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(playActions).toHaveLength(1);
    expect(playActions[0].optionId).toBe('decrease-hazard-limit');
  });

  test('hazard limit decrease in chain causes already-declared long-event to fizzle at resolution', () => {
    const gomInPlay: CardInPlay = { instanceId: 'gom-1' as CardInstanceId, definitionId: GATES_OF_MORNING, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [MANY_TURNS_AND_DOUBLINGS], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [EYE_OF_SAURON], siteDeck: [RIVENDELL] },
      ],
    });

    // Hazard limit is 2, Eye of Sauron is declared as the 2nd hazard
    const mhState = makeMHState({ activeCompanyIndex: 0, hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 1 });
    const stateAtMH = { ...base, phaseState: mhState };

    const eyeId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);

    // Hazard player plays Eye of Sauron as 2nd hazard (at the limit)
    const afterEye = dispatch(stateAtMH, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: eyeId, targetCompanyId });
    expect(afterEye.chain!.priority).toBe(PLAYER_1);

    // Resource player responds with Many Turns and Doublings, decreasing HL by 1.
    // Resource short events resolve immediately (outside the chain), adding the
    // constraint before chain resolution.
    const playActions = viableActions(afterEye, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    const mtdId = playActions[0].cardInstanceId;
    const afterMtd = dispatch(afterEye, playActions[0]);

    // MTD resolved immediately — chain still has only Eye of Sauron (1 entry)
    expect(afterMtd.chain!.entries).toHaveLength(1);
    // Constraint was applied immediately
    expect(afterMtd.activeConstraints.some(c => c.kind.type === 'hazard-limit-modifier')).toBe(true);

    // Resolve chain: Eye of Sauron checks hazard limit at resolution (now 1, not 2)
    const final = resolveChain(afterMtd);

    expect(final.chain).toBeNull();
    // Eye of Sauron must NOT be in play — it fizzled because HL was decreased to 1
    expect(final.players[HAZARD_PLAYER].cardsInPlay).toHaveLength(0);
    // Eye of Sauron is in hazard player's discard pile
    const hazardDiscard = final.players[HAZARD_PLAYER].discardPile.map(c => c.instanceId);
    expect(hazardDiscard).toContain(eyeId);
    // Many Turns and Doublings is in resource player's discard pile
    const resourceDiscard = final.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId);
    expect(resourceDiscard).toContain(mtdId);
  });

  test('hazard limit decrease in chain causes already-declared creature to fizzle at resolution', () => {
    // The active condition is not long-event specific: CRF 22 says Many Turns and
    // Doublings "can cancel hazards by reducing the hazard limit to the point
    // where the hazard resolving is no longer playable". A creature declared at
    // the limit must therefore never reach combat.
    const gomInPlay: CardInPlay = { instanceId: 'gom-1' as CardInstanceId, definitionId: GATES_OF_MORNING, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [MANY_TURNS_AND_DOUBLINGS], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    // Hazard limit is 2; Orc-patrol is declared as the 2nd hazard.
    const stateAtMH = {
      ...base,
      phaseState: makeWildernessMHState({ activeCompanyIndex: 0, hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 1 }),
    };
    const orcId = handCardId(stateAtMH, HAZARD_PLAYER);

    const creaturePlay = viableActions(stateAtMH, PLAYER_2, 'play-hazard')[0];
    const afterOrc = dispatch(stateAtMH, creaturePlay.action);
    expect(afterOrc.chain).not.toBeNull();

    // Resource player responds with Many Turns and Doublings, dropping the limit to 1.
    const mtdPlays = viableActions(afterOrc, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(mtdPlays[0].optionId).toBe('decrease-hazard-limit');
    const afterMtd = dispatch(afterOrc, mtdPlays[0]);

    const final = resolveChain(afterMtd);

    expect(final.chain).toBeNull();
    // No combat was ever initiated — the creature fizzled before reaching it.
    expect(final.combat).toBeNull();
    expect(final.players[HAZARD_PLAYER].discardPile.map(c => c.instanceId)).toContain(orcId);
  });

  test('hazard limit decrease in chain causes already-declared permanent-event to fizzle at resolution', () => {
    const gomInPlay: CardInPlay = { instanceId: 'gom-1' as CardInstanceId, definitionId: GATES_OF_MORNING, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [MANY_TURNS_AND_DOUBLINGS], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT], siteDeck: [RIVENDELL] },
      ],
    });

    const stateAtMH = {
      ...base,
      phaseState: makeMHState({ activeCompanyIndex: 0, hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 1 }),
    };
    const doorsId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);

    const afterDoors = dispatch(stateAtMH, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: doorsId, targetCompanyId,
    });
    expect(afterDoors.chain).not.toBeNull();

    const mtdPlays = viableActions(afterDoors, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    const afterMtd = dispatch(afterDoors, mtdPlays[0]);

    const final = resolveChain(afterMtd);

    expect(final.chain).toBeNull();
    // Doors of Night must not have entered play.
    expect(final.players[HAZARD_PLAYER].cardsInPlay.map(c => c.definitionId)).not.toContain(DOORS_OF_NIGHT);
    expect(final.players[HAZARD_PLAYER].discardPile.map(c => c.instanceId)).toContain(doorsId);
  });

  test('decrease-hazard-limit NOT available in chain when Gates of Morning is not in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [MANY_TURNS_AND_DOUBLINGS], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [EYE_OF_SAURON], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({ activeCompanyIndex: 0, hazardLimitAtReveal: 2 });
    const stateAtMH = { ...base, phaseState: mhState };

    const eyeId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);

    const afterEye = dispatch(stateAtMH, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: eyeId, targetCompanyId });

    // Without Gates of Morning, Many Turns and Doublings has no valid play-option
    const playActions = viableActions(afterEye, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });
});
