/**
 * @module dm-132.test
 *
 * Card test: Forewarned Is Forearmed (dm-132)
 * Type: hero-resource-event (permanent)
 * Alignment: wizard
 * Effects: 1 (duplication-limit)
 *
 * Text:
 *   "Any non-Dragon Lair site with more than one automatic-attack is reduced
 *    to having one automatic-attack of the hazard player's choice (this attack
 *    cannot be canceled). Any creature or other hazard with more than one
 *    attack is reduced to one attack of the hazard player's choice (this
 *    attack cannot be canceled). Discard when such an isolated attack is
 *    defeated. Cannot be duplicated."
 *
 * Engine Support:
 * | # | Rule                                                              | Status          |
 * |---|-------------------------------------------------------------------|-----------------|
 * | 1 | Non-Dragon Lair multi-attack sites reduced to 1 attack (hazard    | NOT IMPLEMENTED |
 * |   | player's choice)                                                  |                 |
 * | 2 | Multi-attack creatures/hazards reduced to 1 attack (hazard        | NOT IMPLEMENTED |
 * |   | player's choice)                                                  |                 |
 * | 3 | The chosen isolated attack cannot be canceled                     | NOT IMPLEMENTED |
 * | 4 | Discard when such isolated attack is defeated                     | NOT IMPLEMENTED |
 * | 5 | Cannot be duplicated                                              | IMPLEMENTED     |
 *
 * Playable: NO — NOT CERTIFIED. The card's core mechanics require engine
 * support that does not exist:
 *
 *   - There is no DSL effect type or engine path that reduces the NUMBER of
 *     automatic-attack entries on a site (as opposed to the number of
 *     strikes per attack). The `stat-modifier` with `target:
 *     "all-automatic-attacks"` and `stat: "strikes"` modifies strikes per
 *     attack; it cannot remove individual attack entries from the site's
 *     `automaticAttacks` array.
 *
 *   - Reducing a multi-attack creature (e.g. a Dragon with multiple attack
 *     modes) to one hazard-player-chosen attack is similarly unexpressible
 *     in the DSL.  No effect type maps to "select one from N attack entries
 *     on a creature card."
 *
 *   - Making the selected attack non-cancelable has no representation in
 *     the DSL or the engine: `cancel-attack` effects are evaluated without
 *     consulting any "this attack is non-cancelable" flag on combat state,
 *     and no such flag or constraint kind exists today.
 *
 *   - The discard trigger ("discard when such isolated attack is defeated")
 *     requires an `on-event` trigger for attack completion. No
 *     "attack-defeated" or equivalent event type is in the implemented
 *     event list (`docs/card-effects-dsl.md`).
 *
 * Once the above mechanics are implemented the test.todos below should be
 * replaced with real assertions and the card re-certified.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase, CardStatus,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId } from '../../index.js';

const FOREWARNED_IS_FOREARMED = 'dm-132' as CardDefinitionId;

describe('Forewarned Is Forearmed (dm-132)', () => {
  beforeEach(() => resetMint());

  // ── Rule 5: Cannot be duplicated ─────────────────────────────────────────

  test('cannot be duplicated — second copy blocked when one is already in play (same player)', () => {
    const inPlay: CardInPlay = {
      instanceId: 'fia-pre' as CardInstanceId,
      definitionId: FOREWARNED_IS_FOREARMED,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [FOREWARNED_IS_FOREARMED],
          siteDeck: [MORIA],
          cardsInPlay: [inPlay],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('cannot be duplicated — second copy blocked when opponent has one in play', () => {
    const inPlay: CardInPlay = {
      instanceId: 'fia-opp' as CardInstanceId,
      definitionId: FOREWARNED_IS_FOREARMED,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [FOREWARNED_IS_FOREARMED],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          cardsInPlay: [inPlay],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('playable when no copy is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [FOREWARNED_IS_FOREARMED],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
  });

  // ── Rules 1-4: Unimplemented ──────────────────────────────────────────────

  test.todo('non-Dragon Lair site with multiple auto-attacks is reduced to one (hazard player chooses)');
  test.todo('Dragon Lair site is NOT affected by Forewarned Is Forearmed');
  test.todo('multi-attack creature is reduced to one attack of the hazard player\'s choice');
  test.todo('the isolated attack cannot be canceled');
  test.todo('card is discarded when the isolated attack is defeated');
  test.todo('card stays in play when the isolated attack is not defeated');
});
