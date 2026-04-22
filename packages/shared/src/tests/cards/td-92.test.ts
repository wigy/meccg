/**
 * @module td-92.test
 *
 * Card test: Galdor (td-92)
 * Type: hero-character
 *
 * "Unique. +1 direct influence against Elves and Elf factions."
 *
 * Effects tested:
 * 1. stat-modifier: +1 direct-influence during influence-check when
 *    target.race === "elf" (applied via availableDI when attempting to
 *    influence another elf character).
 * 2. stat-modifier: +1 direct-influence during faction-influence-check
 *    when faction.race === "elf" (observable via the `need` on the
 *    `influence-attempt` action).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GALADRIEL, BEREGOND, RIDERS_OF_ROHAN, WOOD_ELVES,
  THRANDUILS_HALLS, EDORAS,
  buildTestState, buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER, LORIEN, MORIA, MINAS_TIRITH, RIVENDELL,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CharacterCard, InfluenceAttemptAction,
} from '../../index.js';
import { Phase, computeLegalActions } from '../../index.js';
import { availableDI } from '../../engine/legal-actions/organization.js';

const GALDOR = 'td-92' as CardDefinitionId;

describe('Galdor (td-92)', () => {
  beforeEach(() => resetMint());

  test('base effective DI is 2 (conditional bonus does not inflate baseline stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [GALDOR] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const galdorId = findCharInstanceId(state, RESOURCE_PLAYER, GALDOR);
    const baselineDI = availableDI(state, galdorId, state.players[0]);
    expect(baselineDI).toBe(2);
  });

  test('+1 DI bonus applies when checking influence against an elf character (Galadriel)', () => {
    // Galdor base DI 2. Galadriel is an elf → +1 bonus → effective DI 3.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [GALDOR] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const galdorId = findCharInstanceId(state, RESOURCE_PLAYER, GALDOR);
    const galadrielDef = pool[GALADRIEL as string] as CharacterCard;
    expect(galadrielDef.race).toBe('elf');

    const di = availableDI(state, galdorId, state.players[0], galadrielDef);
    expect(di).toBe(3);
  });

  test('+1 DI bonus applies against another elf (Legolas) — keyed on race, not name', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [GALDOR] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const galdorId = findCharInstanceId(state, RESOURCE_PLAYER, GALDOR);
    const legolasDef = pool[LEGOLAS as string] as CharacterCard;
    expect(legolasDef.race).toBe('elf');

    const di = availableDI(state, galdorId, state.players[0], legolasDef);
    expect(di).toBe(3);
  });

  test('+1 DI bonus does NOT apply against a non-elf character (Beregond, dúnadan)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [GALDOR] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const galdorId = findCharInstanceId(state, RESOURCE_PLAYER, GALDOR);
    const beregondDef = pool[BEREGOND as string] as CharacterCard;
    expect(beregondDef.race).not.toBe('elf');

    const di = availableDI(state, galdorId, state.players[0], beregondDef);
    expect(di).toBe(2);
  });

  test('+1 DI bonus applies when attempting to influence an elf faction (Wood-elves)', () => {
    // Wood-elves: race "elf", influenceNumber 8, own check-modifier +1
    // for elf bearers. With Galdor (elf, DI 2), need =
    //   8 - 2 (DI) - 1 (Wood-elves own +1 for elf bearer) - 1 (Galdor's
    //   elf-faction bonus) = 4.
    // The elf-faction bonus is reflected in the explanation as "DI bonus +1".
    const state = buildSitePhaseState({
      characters: [GALDOR],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const galdorId = findCharInstanceId(state, RESOURCE_PLAYER, GALDOR);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const galdorAttempt = influenceActions.find(
      a => a.influencingCharacterId === galdorId,
    );
    expect(galdorAttempt).toBeDefined();
    expect(galdorAttempt!.need).toBe(4);
    expect(galdorAttempt!.explanation).toContain('DI bonus +1');
  });

  test('+1 DI bonus does NOT apply when attempting to influence a non-elf faction (Riders of Rohan)', () => {
    // Riders of Rohan: race "man", influenceNumber 10. Its own +1
    // check-modifier only fires for hobbit/dúnadan bearers; Galdor is an
    // elf, so it does not fire either. Need = 10 - (DI 2) = 8.
    const state = buildSitePhaseState({
      characters: [GALDOR],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    });

    const galdorId = findCharInstanceId(state, RESOURCE_PLAYER, GALDOR);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const galdorAttempt = influenceActions.find(
      a => a.influencingCharacterId === galdorId,
    );
    expect(galdorAttempt).toBeDefined();
    expect(galdorAttempt!.need).toBe(8);
  });
});
