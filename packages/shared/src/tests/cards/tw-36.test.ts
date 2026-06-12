/**
 * @module tw-36.test
 *
 * Card test: Foul Fumes (tw-36)
 * Type: hazard-event (Long-event, Environment)
 * Unique: no. Cannot be duplicated.
 *
 * Card text:
 *   "Environment. Each moving company that has a Shadow-land [{s}] or a
 *    Dark-domain [{d}] in its site path must return to its site of origin
 *    unless it contains a ranger. Additionally, if Doors of Night is in play,
 *    each non-Haven site in play with a Shadow-land [{s}] or a Dark-domain
 *    [{d}] in its site path is tapped. This card has no effect on a minion
 *    player. Cannot be duplicated."
 *
 * Engine Support — CERTIFICATION STATUS: NOT CERTIFIED (PARTIALLY implemented)
 * | # | Rule                                              | Status          | Notes                                                        |
 * |---|---------------------------------------------------|-----------------|--------------------------------------------------------------|
 * | 1 | Moving companies with {s}/{d} return to origin    | NOT ENFORCED    | `force-return-to-origin` effect is only a *tag*; the actual  |
 * |   |                                                   |                 | return is rule 5.31, an engine-wide `test.todo`.             |
 * | 2 | Ranger exception (`rangerException: true`)        | NOT ENFORCED    | depends on (1) being implemented                             |
 * | 3 | Tag consumed by Goldberry's cancel ability        | IMPLEMENTED     | force-return-to-origin enables `cancel-return-to-origin`     |
 * | 4 | Doors of Night → tap non-Haven {s}/{d} sites      | NOT IMPLEMENTED | no DSL effect type, no engine support                        |
 * | 5 | No effect on a minion player                      | NOT IMPLEMENTED | no DSL representation, no engine gating                      |
 * | 6 | Cannot be duplicated                              | NOT IMPLEMENTED | no DSL representation                                        |
 *
 * Playable: PARTIALLY — the card's core effect (forcing companies back to
 * their site of origin) is not enforced by the engine. Only the interaction
 * with Goldberry (tw-245), which keys off the `force-return-to-origin` tag,
 * is implemented. This card MUST NOT be certified until rule 5.31 enforcement,
 * the Doors-of-Night site-tapping clause, and the minion-player gating land.
 *
 * The single real test below asserts the one implemented slice. The remaining
 * rules are recorded as `test.todo()` — a living spec of the deferred work.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachAllyToChar,
  findCharInstanceId,
  makeMHState,
  mint,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type {
  CardDefinitionId,
  CancelReturnToOriginAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { initiateChain } from '../../engine/chain-reducer.js';

const GOLDBERRY = 'tw-245' as CardDefinitionId;
const FOUL_FUMES = 'tw-36' as CardDefinitionId;

describe('Foul Fumes (tw-36)', () => {
  beforeEach(() => resetMint());

  // ─── Implemented slice: force-return-to-origin tag drives Goldberry ───────

  test('Foul Fumes on the M/H chain carries force-return-to-origin, enabling Goldberry to cancel it', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoldberry = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);

    // P2 (hazard) plays Foul Fumes as a long-event onto the chain.
    const foulFumesCard = { instanceId: mint(), definitionId: FOUL_FUMES };
    const withChain = initiateChain(
      { ...withGoldberry, phaseState: makeMHState() },
      PLAYER_2,
      foulFumesCard,
      { type: 'long-event' },
    );

    // After P2 initiates the chain, P1 (resource player) holds priority.
    expect(withChain.chain!.priority).toBe(PLAYER_1);

    const aragornId = findCharInstanceId(withChain, RESOURCE_PLAYER, ARAGORN);
    const goldberryInstanceId =
      withChain.players[RESOURCE_PLAYER].characters[aragornId as string]?.allies[0]?.instanceId;
    expect(goldberryInstanceId).toBeDefined();

    const cancelActions = computeLegalActions(withChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-return-to-origin')
      .map(ea => ea.action as CancelReturnToOriginAction);

    // The cancel action targets the Foul Fumes chain entry specifically —
    // proving the engine reads tw-36's `force-return-to-origin` effect.
    expect(cancelActions.some(a => a.allyInstanceId === goldberryInstanceId
      && a.targetInstanceId === foulFumesCard.instanceId)).toBe(true);
  });

  // ─── Deferred rules — living spec of the unimplemented engine work ────────

  // Rule 5.31: returning a moving company to its site of origin is an
  // engine-wide `test.todo` (see rule-5.31-returned-to-origin.test.ts). Until
  // it lands, Foul Fumes' primary effect does nothing on its own.
  test.todo('Moving company with {s} or {d} in site path is returned to its site of origin');
  test.todo('Company containing a ranger is exempt from the forced return');
  test.todo('Doors of Night in play: each non-Haven site with {s}/{d} in its path is tapped');
  test.todo('Foul Fumes has no effect when the opposing player is a minion player');
  test.todo('Foul Fumes cannot be duplicated');
});
