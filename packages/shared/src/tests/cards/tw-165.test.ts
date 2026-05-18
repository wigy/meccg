/**
 * @module tw-165.test
 *
 * Card test: Háma (tw-165)
 * Type: hero-character (wizard), unique
 * Prowess 4 / Body 8 / Mind 2 / DI 0 / MP 0
 * Skills: warrior
 * Race: man
 * Homesite: Edoras
 *
 * "Unique. -1 to all of his corruption checks. -1 to influence checks against factions."
 *
 * Engine support:
 * | # | Effect Type    | Status | Notes                                       |
 * |---|----------------|--------|---------------------------------------------|
 * | 1 | check-modifier | OK     | -1 to corruption checks                     |
 * | 2 | check-modifier | OK     | -1 to influence checks (faction-influence)  |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, THEODEN,
  RIVENDELL, MORIA, MINAS_TIRITH, EDORAS,
  RIDERS_OF_ROHAN, GLAMDRING,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId, buildSitePhaseState,
  enqueueTransferCorruptionCheck,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, InfluenceAttemptAction, CorruptionCheckAction } from '../../index.js';

const HAMA = 'tw-165' as CardDefinitionId;

describe('Háma (tw-165)', () => {
  beforeEach(() => resetMint());

  test('-1 corruption modifier increases need on pending corruption check', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: EDORAS, characters: [{ defId: HAMA, items: [GLAMDRING] }, ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [THEODEN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const hamaId = findCharInstanceId(state, RESOURCE_PLAYER, HAMA);
    const glamdringInstId = getCharacter(state, RESOURCE_PLAYER, HAMA).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, hamaId, glamdringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(hamaId);
    // Háma's check-modifier is -1 (penalty to corruption checks)
    expect(ccActions[0].corruptionModifier).toBe(-1);
    // need = CP + 1 - modifier; with modifier -1, need increases by 1
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });

  test('-1 influence penalty increases need when influencing Riders of Rohan', () => {
    // Háma (man, DI 0) at Edoras influencing Riders of Rohan (influenceNumber 10).
    // Standard mods: +1 for hobbits, +1 for dunadan — no bonus for men.
    // totalModifier = DI(0) + no race bonus + Háma penalty(-1) = -1
    // need = 10 - (-1) = 11
    const state = buildSitePhaseState({
      characters: [HAMA],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    });

    const hamaId = findCharInstanceId(state, RESOURCE_PLAYER, HAMA);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const hamaAttempt = influenceActions.find(a => a.influencingCharacterId === hamaId);
    expect(hamaAttempt).toBeDefined();
    // need = 10 - (0 + 0 + (-1)) = 11
    expect(hamaAttempt!.need).toBe(11);
  });

  test('-1 influence penalty makes Háma need higher than Théoden for Riders of Rohan', () => {
    // Théoden (man, DI 3, +2 DI bonus vs Riders of Rohan): need = 10 - 3 - 2 = 5
    // Háma (man, DI 0, -1 penalty): need = 10 - (-1) = 11
    const hamaState = buildSitePhaseState({
      characters: [HAMA],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    });
    const hamaId = findCharInstanceId(hamaState, RESOURCE_PLAYER, HAMA);
    const hamaAttempt = computeLegalActions(hamaState, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === hamaId);
    expect(hamaAttempt).toBeDefined();

    const theodenState = buildSitePhaseState({
      characters: [THEODEN],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    });
    const theodenId = findCharInstanceId(theodenState, RESOURCE_PLAYER, THEODEN);
    const theodenAttempt = computeLegalActions(theodenState, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === theodenId);
    expect(theodenAttempt).toBeDefined();

    expect(hamaAttempt!.need).toBeGreaterThan(theodenAttempt!.need);
  });
});
