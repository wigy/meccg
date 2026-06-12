/**
 * @module tw-91.test
 *
 * Card test: Snowstorm (tw-91)
 * Type: hazard-event (Long-event, Environment)
 * Unique: no
 *
 * Card text:
 *   "Environment. Playable if Doors of Night is in play. Each moving company
 *    with a Wilderness [{w}] in its site path must return to its site of
 *    origin. Cannot be duplicated."
 *
 * Effects (data):
 *   - force-return-to-origin, condition { sitePath.wildernessCount: { $gte: 1 } }
 *
 * Engine Support:
 * | # | Rule                                                  | Status          | Notes                                                            |
 * |---|-------------------------------------------------------|-----------------|------------------------------------------------------------------|
 * | 1 | Environment / long-event enters play on resolution    | IMPLEMENTED     | resolveLongEvent adds card to cardsInPlay                         |
 * | 2 | force-return-to-origin tag recognised by chain engine | IMPLEMENTED     | chain.ts cancelReturnToOriginChainActions keys off the tag       |
 * | 3 | Moving company with a Wilderness returns to origin     | NOT IMPLEMENTED | rule 5.31 enforcement is `test.todo`; returnedToOrigin never set  |
 * | 4 | Playable only if Doors of Night is in play            | NOT IMPLEMENTED | no play-condition gate for long-events on an in-play card name    |
 * | 5 | Cannot be duplicated                                   | NOT IMPLEMENTED | no duplication-limit effect / environment-dup gate               |
 *
 * Playable: PARTIALLY — NOT CERTIFIED.
 *
 * The card's defining mechanic — forcing a moving company whose site path
 * contains a Wilderness to return to its site of origin — depends on CoE rule
 * 5.31 ("Company Returned to Origin"), which is currently a `test.todo` in
 * `rule-5.31-returned-to-origin.test.ts`. The `force-return-to-origin` effect
 * is only consumed by the chain engine as a *cancellation target* (Goldberry,
 * tw-245); nothing in the engine actually sets `returnedToOrigin = true` from a
 * hazard resolution, so the company never returns. The "Playable if Doors of
 * Night is in play" gate is likewise unenforced (no play-condition mechanism
 * exists for long-events keyed on an in-play card name). Both gaps are shared
 * with the sibling environment hazards Foul Fumes (tw-36) and Long Winter
 * (le-117), neither of which is certified.
 *
 * The single implemented slice (the `force-return-to-origin` tag being
 * recognised on the chain so Goldberry can cancel it) is exercised here from
 * Snowstorm's perspective; it is also covered from Goldberry's perspective in
 * tw-245.test.ts.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState,
  resetMint,
  Phase,
  attachAllyToChar,
  findCharInstanceId,
  makeMHState,
  mint,
  PLAYER_1,
  PLAYER_2,
  ARAGORN,
  LEGOLAS,
  RIVENDELL,
  LORIEN,
  MORIA,
  MINAS_TIRITH,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { RegionType } from '../../index.js';
import type { CardDefinitionId, CancelReturnToOriginAction } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { initiateChain } from '../../engine/chain-reducer.js';

const SNOWSTORM = 'tw-91' as CardDefinitionId;
const GOLDBERRY = 'tw-245' as CardDefinitionId;

describe('Snowstorm (tw-91)', () => {
  beforeEach(() => {
    resetMint();
  });

  // ─── Implemented: force-return-to-origin tag is recognised on the chain ───

  test('Snowstorm on the M/H chain is recognised as a return-to-origin source (cancelable by Goldberry)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoldberry = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);

    // The active company is moving through a Wilderness — Snowstorm's condition.
    const mhState = makeMHState({ resolvedSitePath: [RegionType.Wilderness] });

    const snowstormCard = { instanceId: mint(), definitionId: SNOWSTORM };
    const withChain = initiateChain(
      { ...withGoldberry, phaseState: mhState },
      PLAYER_2,
      snowstormCard,
      { type: 'long-event' },
    );

    const aragornId = findCharInstanceId(withChain, RESOURCE_PLAYER, ARAGORN);
    const goldberryInstanceId =
      withChain.players[RESOURCE_PLAYER].characters[aragornId as string]?.allies[0]?.instanceId;
    expect(goldberryInstanceId).toBeDefined();

    const cancelActions = computeLegalActions(withChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-return-to-origin')
      .map(ea => ea.action as CancelReturnToOriginAction);

    // The chain engine consults Snowstorm's force-return-to-origin effect, so
    // the targeted cancellation is offered against the Snowstorm chain entry.
    expect(
      cancelActions.some(
        a => a.allyInstanceId === goldberryInstanceId
          && a.targetInstanceId === snowstormCard.instanceId,
      ),
    ).toBe(true);
  });

  test('without a force-return ally, no cancel-return-to-origin action is offered for Snowstorm', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const snowstormCard = { instanceId: mint(), definitionId: SNOWSTORM };
    const withChain = initiateChain(
      { ...base, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness] }) },
      PLAYER_2,
      snowstormCard,
      { type: 'long-event' },
    );

    const cancelActions = computeLegalActions(withChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-return-to-origin');

    expect(cancelActions).toHaveLength(0);
  });

  // ─── Deferred: core mechanics not yet supported by the engine ─────────────

  // CoE rule 5.31 enforcement is `test.todo` (see
  // rule-5.31-returned-to-origin.test.ts). Nothing sets `returnedToOrigin` from
  // a hazard resolution, so the moving company never actually returns to origin.
  test.todo('a moving company with a Wilderness in its site path returns to its site of origin (rule 5.31)');

  // No play-condition mechanism gates a long-event on an in-play card name, so
  // Snowstorm is currently offered regardless of whether Doors of Night is out.
  test.todo('Snowstorm is only playable while Doors of Night is in play');

  // "Cannot be duplicated" is not represented by a duplication-limit effect and
  // there is no environment-duplication gate in the engine.
  test.todo('a second Snowstorm cannot be played while one is in play');
});
