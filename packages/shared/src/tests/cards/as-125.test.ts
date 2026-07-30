/**
 * @module as-125.test
 *
 * Card test: Goblin Earth-plumb (as-125)
 * Type: minion-resource-item (Minor Item), alignment ringwraith, non-unique.
 * Corruption Points: 1.
 *
 * Card text: "Playable only on an Orc or Troll. +1 to all rolls required for
 * bearer's company to move to adjacent Under-deeps sites."
 *
 * Rule coverage:
 *
 * | # | Rule                                                        | Mechanism                                              |
 * |---|--------------------------------------------------------------|---------------------------------------------------------|
 * | 1 | Playable only on an Orc or Troll                              | play-target character filter target.race $in [orc,troll] |
 * | 2 | +1 to rolls required for bearer's company's Under-deeps moves | under-deeps-roll-modifier value:1                        |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  Alignment,
  buildTestState, buildMinionSitePhaseState, resetMint, makeMHState,
  reduce, findHandCardId,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  Phase,
} from '../test-helpers.js';
import { MovementType } from '../../types/common.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState } from '../../index.js';

const EARTH_PLUMB = 'as-125' as CardDefinitionId;
const ORC_CAPTAIN = 'le-31' as CardDefinitionId; // minion, orc
const OLD_TROLL = 'le-29' as CardDefinitionId;   // minion, troll
const LUITPRAND = 'le-23' as CardDefinitionId;   // minion, man (neither orc nor troll)

// Under-deeps sites (same fixtures used by the as-127 Iron Shield of Old test).
const DROWNING_DEEPS = 'ba-89' as CardDefinitionId;  // ruins-and-lairs, under-deeps
const UNDER_VAULTS = 'ba-103' as CardDefinitionId;   // ruins-and-lairs, under-deeps; adjacent to Drowning-deeps (roll 8)

describe('Goblin Earth-plumb (as-125)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playable only on an Orc or Troll ──────────────────────────────

  test('playable on an Orc (Orc Captain)', () => {
    const state = buildMinionSitePhaseState({
      site: DROWNING_DEEPS,
      characters: [ORC_CAPTAIN],
      hand: [EARTH_PLUMB],
    });
    const plumbId = findHandCardId(state, RESOURCE_PLAYER, EARTH_PLUMB);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (plumbId as string),
    );
    expect(plays).toHaveLength(1);
  });

  test('playable on a Troll (Old Troll)', () => {
    const state = buildMinionSitePhaseState({
      site: DROWNING_DEEPS,
      characters: [OLD_TROLL],
      hand: [EARTH_PLUMB],
    });
    const plumbId = findHandCardId(state, RESOURCE_PLAYER, EARTH_PLUMB);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (plumbId as string),
    );
    expect(plays).toHaveLength(1);
  });

  test('NOT playable on a character who is neither Orc nor Troll (Luitprand, a Man)', () => {
    const state = buildMinionSitePhaseState({
      site: DROWNING_DEEPS,
      characters: [LUITPRAND],
      hand: [EARTH_PLUMB],
    });
    const plumbId = findHandCardId(state, RESOURCE_PLAYER, EARTH_PLUMB);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (plumbId as string),
    );
    expect(plays).toHaveLength(0);
  });

  test('in a mixed company, only the Orc is offered as a bearer', () => {
    const state = buildMinionSitePhaseState({
      site: DROWNING_DEEPS,
      characters: [ORC_CAPTAIN, LUITPRAND],
      hand: [EARTH_PLUMB],
    });
    const plumbId = findHandCardId(state, RESOURCE_PLAYER, EARTH_PLUMB);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (plumbId as string),
    );
    expect(plays).toHaveLength(1);
  });

  // ─── Rule 2: +1 to rolls required to move to adjacent Under-deeps sites ───

  test('bearing the Goblin Earth-plumb reduces the required Under-deeps roll by 1 (8 → 7)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DROWNING_DEEPS, characters: [{ defId: ORC_CAPTAIN, items: [EARTH_PLUMB] }], destinationSite: UNDER_VAULTS }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const result = reduce(state, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.UnderDeeps });
    expect(result.error).toBeUndefined();
    const mhState = result.state.phaseState as MovementHazardPhaseState;
    expect(mhState.step).toBe('under-deeps-roll');
    expect(mhState.underDeepsRollRequired).toBe(7);
  });

  test('negative control: without the Earth-plumb the required roll is unmodified (8)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DROWNING_DEEPS, characters: [ORC_CAPTAIN], destinationSite: UNDER_VAULTS }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const result = reduce(state, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.UnderDeeps });
    expect(result.error).toBeUndefined();
    const mhState = result.state.phaseState as MovementHazardPhaseState;
    expect(mhState.underDeepsRollRequired).toBe(8);
  });
});
