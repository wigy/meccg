/**
 * @module rule-9.11-short-event-duplication
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.11: Short-Event Cannot Be Duplicated
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Short-events that "cannot be duplicated" cannot be played if a card of the same name is currently having an effect on the entity specified by the short-event. If no entity is specified (i.e. the short-event is affecting the game generally), they cannot be played if a card of the same name is having an effect on the game.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  companyIdAt, nonViableOfType, viableOfType,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ELROND, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH, MORIA,
} from '../../test-helpers.js';
import type { CardDefinitionId, CardInstanceId } from '../../test-helpers.js';
import { addConstraint } from '../../../engine/pending.js';
import { computeLegalActions } from '../../../engine/legal-actions/index.js';

// Vilya (tw-358): short event targeting Elrond, "Cannot be duplicated on a given turn"
const VILYA = 'tw-358' as CardDefinitionId;

describe('Rule 9.11 — Short-Event Cannot Be Duplicated', () => {
  beforeEach(() => resetMint());

  test('Short-event with turn-scoped duplication limit cannot be played if already having effect this turn', () => {
    // Vilya targets Elrond and "cannot be duplicated on a given turn."
    // Simulate Vilya already played this turn by injecting an active constraint
    // sourced from Vilya's definition. The duplication-limit check counts
    // constraints by sourceDefinitionId; once the count reaches max (1) the
    // card is blocked regardless of how many copies remain in hand.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [VILYA],
          siteDeck: [MORIA],
          companies: [{ site: RIVENDELL, characters: [ELROND] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
      recompute: true,
    });

    // Vilya must be viable before any constraint is added
    const actionsClean = computeLegalActions(state, PLAYER_1);
    expect(viableOfType(actionsClean, 'play-short-event').length).toBeGreaterThan(0);

    // Inject a constraint from Vilya's definition — simulating it was played once
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const withConstraint = addConstraint(state, {
      source: 'vilya-prior' as CardInstanceId,
      sourceDefinitionId: VILYA,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'no-creature-hazards-on-company' },
    });

    // Now Vilya in hand must be blocked — cannot be duplicated this turn
    const actionsBlocked = computeLegalActions(withConstraint, PLAYER_1);
    expect(viableOfType(actionsBlocked, 'play-short-event')).toHaveLength(0);
    expect(nonViableOfType(actionsBlocked, 'not-playable').some(
      a => a.reason?.includes('cannot be duplicated'),
    )).toBe(true);
  });
});
