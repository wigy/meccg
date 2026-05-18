/**
 * @module tw-162.test
 *
 * Card test: Halbarad (tw-162)
 * Type: hero-character
 * Prowess 0 / Body 5 / Mind 1 / DI 1 / MP 0
 * Race: dúnadan
 * Skills: sage, diplomat
 * Homesite: Cameth Brin
 * Effects: 1 — stat-modifier direct-influence +2 vs Hillmen faction
 *
 * "Unique. +2 direct influence against the Hillmen faction."
 *
 * Engine Support:
 * | # | Feature                            | Status      | Notes                                         |
 * |---|------------------------------------|-------------|-----------------------------------------------|
 * | 1 | +2 DI vs Hillmen (faction)         | IMPLEMENTED | stat-modifier, reason=faction-influence-check |
 *
 * Playable: YES
 * Certified: 2026-05-18
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  LEGOLAS, EDORAS, LORIEN, MORIA, MINAS_TIRITH,
  RIDERS_OF_ROHAN,
  buildTestState, resetMint,
  findCharInstanceId, findHandCardId, buildSitePhaseState,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CardDefinitionId, CharacterCard, InfluenceAttemptAction } from '../../index.js';

const HALBARAD = 'tw-162' as CardDefinitionId;
const HILLMEN = 'tw-257' as CardDefinitionId;
const CAMETH_BRIN = 'tw-379' as CardDefinitionId;

describe('Halbarad (tw-162)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +2 DI against Hillmen faction ──

  test('base effective DI is 1 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CAMETH_BRIN, characters: [HALBARAD] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const baseDef = pool[HALBARAD] as CharacterCard;
    expect(getCharacter(state, RESOURCE_PLAYER, HALBARAD).effectiveStats.directInfluence).toBe(baseDef.directInfluence);
    expect(baseDef.directInfluence).toBe(1);
  });

  test('+2 DI bonus applies when Halbarad influences the Hillmen faction', () => {
    // Halbarad (dúnadan, base DI 1) attempts to influence Hillmen at Cameth Brin.
    // Hillmen influence number = 10, Standard Modifications: Men (+1) — Halbarad is dúnadan, not man, so no check modifier.
    // With Halbarad's +2 DI bonus vs Hillmen:
    //   effective modifier = DI(1) + DIbonus(2) = 3
    //   need = 10 - 3 = 7
    const state = buildSitePhaseState({
      characters: [HALBARAD],
      site: CAMETH_BRIN,
      hand: [HILLMEN],
    });

    const halbaradId = findCharInstanceId(state, RESOURCE_PLAYER, HALBARAD);
    const hillmenId = findHandCardId(state, RESOURCE_PLAYER, HILLMEN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const halbaradAttempt = influenceActions.find(
      a => a.influencingCharacterId === halbaradId && a.factionInstanceId === hillmenId,
    );
    expect(halbaradAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(1) - DIbonus(2) = 7 (no Men check modifier for dúnadan)
    expect(halbaradAttempt!.need).toBe(7);
  });

  test('+2 DI bonus does NOT apply when Halbarad influences a different faction', () => {
    // Halbarad (dúnadan, base DI 1) attempts to influence Riders of Rohan at Edoras.
    // Riders of Rohan influence number = 10, +1 check modifier for dúnedain.
    // No DI bonus (not the Hillmen faction):
    //   modifier = DI(1) + dúnadanCheckMod(1) = 2
    //   need = 10 - 2 = 8
    // If the bonus incorrectly fired: 10 - DI(1) - DIbonus(2) - checkMod(1) = 6 — we expect 8.
    const state = buildSitePhaseState({
      characters: [HALBARAD],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    });

    const halbaradId = findCharInstanceId(state, RESOURCE_PLAYER, HALBARAD);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const halbaradAttempt = influenceActions.find(
      a => a.influencingCharacterId === halbaradId,
    );
    expect(halbaradAttempt).toBeDefined();

    // No DI bonus: influenceNumber(10) - baseDI(1) - dúnadanCheckMod(1) = 8
    expect(halbaradAttempt!.need).toBe(8);
  });

  test('non-Halbarad character does not benefit from the DI bonus vs Hillmen', () => {
    // Legolas (elf, base DI 2) at Cameth Brin with Hillmen in hand.
    // Hillmen influence number = 10, +1 check modifier for Men — Legolas is elf, no modifier.
    // No Halbarad-specific DI bonus:
    //   modifier = DI(2)
    //   need = 10 - 2 = 8
    // Legolas has higher base DI than Halbarad (2 vs 1) yet still needs more points (8 vs 7),
    // proving the bonus is Halbarad-specific and not a generic faction modifier.
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: CAMETH_BRIN,
      hand: [HILLMEN],
    });

    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const hillmenId = findHandCardId(state, RESOURCE_PLAYER, HILLMEN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const legolasAttempt = influenceActions.find(
      a => a.influencingCharacterId === legolasId && a.factionInstanceId === hillmenId,
    );
    expect(legolasAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(2) = 8 — Legolas gets no DI bonus or check modifier
    expect(legolasAttempt!.need).toBe(8);
  });
});
