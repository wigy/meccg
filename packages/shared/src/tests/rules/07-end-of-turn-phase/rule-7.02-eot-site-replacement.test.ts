/**
 * @module rule-7.02-eot-site-replacement
 *
 * CoE Rules — Section 7: End-of-Turn Phase
 * Rule 7.02: End-of-Turn Site Replacement
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Replacing one site with another during the end-of-turn phase counts as movement but does not initiate a movement/hazard phase.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA,
  handCardId,
  RESOURCE_PLAYER,
} from '../../test-helpers.js';
import type { CardDefinitionId, PlayShortEventAction, HavenReturnAction } from '../../../index.js';
import { reduce } from '../../../engine/reducer.js';

// Great-road (tw-249): "This is considered movement with no movement/hazard
// phase." — wired via the same end-of-turn site-replacement effect (
// haven-return-option constraint + haven-return action) also used by Ancient
// Stair (dm-115, see tests/cards/dm-115.test.ts — gated by the constraint's
// `requiresMovedToKeyword: "under-deeps"`). Legendary Stair (as-91) and
// Iron-road (le-199) describe the same mechanic in their text but currently
// carry no DSL effects (effects: []), so they are not yet reachable scenarios.
const GREAT_ROAD = 'tw-249' as CardDefinitionId;

describe('Rule 7.02 — End-of-Turn Site Replacement', () => {
  beforeEach(() => resetMint());

  test('haven-return replaces the site without initiating a movement/hazard phase', () => {
    const org = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GREAT_ROAD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const { state: afterPlay } = reduce(org, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: handCardId(org, RESOURCE_PLAYER),
      targetCompanyId: org.players[0].companies[0].id,
    } as PlayShortEventAction);

    // Simulate arriving at end-of-turn with the company having moved to Moria
    // during its M/H phase earlier this turn (the haven-return-option
    // constraint from Great-road carries over unchanged).
    const eot = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const originHavenInstId = (afterPlay.activeConstraints.find(
      c => c.kind.type === 'haven-return-option',
    )!.kind as { originHavenInstanceId: string }).originHavenInstanceId;
    const eotWithConstraints = {
      ...eot,
      activeConstraints: afterPlay.activeConstraints,
      players: eot.players.map((p, i) => i !== 0 ? p : {
        ...p,
        siteDeck: p.siteDeck.map(c =>
          c.definitionId === RIVENDELL ? { ...c, instanceId: originHavenInstId as typeof c.instanceId } : c,
        ),
      }) as unknown as typeof eot.players,
    };

    const companyId = eotWithConstraints.players[0].companies[0].id;
    const { state: afterReturn } = reduce(eotWithConstraints, {
      type: 'haven-return',
      player: PLAYER_1,
      companyId,
    } as HavenReturnAction);

    // The site changed (Moria → Rivendell) — a real site replacement...
    expect(afterReturn.players[0].companies[0].currentSite?.definitionId).toBe(RIVENDELL);
    // ...but the game phase is still End-of-Turn: no movement/hazard phase
    // was initiated as a side effect of this "movement".
    expect(afterReturn.phaseState.phase).toBe(Phase.EndOfTurn);
    // No M/H-phase bookkeeping (declared path, hazard limit, etc.) exists —
    // the company's movement-path/destination fields are untouched by the
    // replacement, confirming it bypassed the M/H phase machinery entirely.
    expect(afterReturn.players[0].companies[0].destinationSite).toBeNull();
    expect(afterReturn.players[0].companies[0].movementPath).toHaveLength(0);
  });
});
