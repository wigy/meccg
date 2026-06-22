/**
 * @module wh-84.test
 *
 * Card test: Wizard's Myrmidon (wh-84)
 * Type: minion-resource-event (permanent), alignment: stage
 *
 * Text:
 *   "Playable on one of your non-Fallen-wizard characters. +1 to his direct
 *    influence. The character requires 3 points of influence to control and
 *    may only be controlled by general influence or a Fallen-wizard. Cannot be
 *    duplicated by a given player."
 *
 * Engine Support (see step-7 report):
 * | # | Rule                                                  | Status        |
 * |---|-------------------------------------------------------|---------------|
 * | 1 | Playable on one of your non-Fallen-wizard characters  | IMPLEMENTED   |
 * | 2 | +1 to his direct influence                            | IMPLEMENTED   |
 * | 3 | Cannot be duplicated by a given player                | IMPLEMENTED   |
 * | 4 | Requires 3 points of influence to control             | NOT IMPL.     |
 * | 5 | May only be controlled by general influence / a FW    | NOT IMPL.     |
 * | 6 | Stage point (1) while in play                          | NOT IMPL.*    |
 *
 * THIS CARD IS NOT CERTIFIED.
 *
 * Three distinct mechanics span engine subsystems the engine does not yet model
 * for this card's actual play mode (attached to a character):
 *  - Rule 4 ("requires 3 points of influence to control"): the influence-to-
 *    control cost is resolved from the printed `mind` in `move-to-influence`
 *    (organization-companies.ts) and in opponent-influence resolution
 *    (reducer-site.ts); neither consults an effective/overridable mind, so an
 *    attached card cannot change the cost to control the character.
 *  - Rule 5 ("may only be controlled by general influence or a Fallen-wizard"):
 *    there is no DSL concept for restricting direct-influence control to a
 *    Fallen-wizard avatar. The existing `no-direct-influence` play-flag forbids
 *    ALL direct influence with no avatar exception, so it cannot model this.
 *  - Rule 6 (*): the card carries `stage-points: 1`, but because a character-
 *    targeted resource permanent event is stored in the bearer's `items`
 *    (chain-reducer.ts) while `recompute-derived.ts` sums `stage-points` only
 *    over `cardsInPlay`, the stage point is not counted while the card is played
 *    per its text. Hence no assertion on `stagePoints` here.
 *
 * The tests below exercise the three implemented rules with real assertions, and
 * mark the unimplemented rules with `test.todo()`.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  buildTestState, makePlayDeck, resetMint,
  viableActions,
  findCharInstanceId, findHandCardId,
  playPermanentEventAndResolve,
  getCharacter,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import { Phase, Alignment } from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** Wizard's Myrmidon — the card under test */
const WIZARDS_MYRMIDON = 'wh-84' as CardDefinitionId;
/** Saruman — a Fallen-wizard avatar (race fallen-wizard, mind null) */
const SARUMAN = 'wh-9' as CardDefinitionId;
/** Sly Southerner — a non-Fallen-wizard character (race orc, mind 2) */
const SLY_SOUTHERNER = 'wh-10' as CardDefinitionId;
/** Isengard — a Fallen-wizard haven */
const ISENGARD_SITE = 'wh-56' as CardDefinitionId;

// ── Builder ──────────────────────────────────────────────────────────────────

function fwOrgState(opts?: { hand?: CardDefinitionId[] }) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: ISENGARD_SITE, characters: [SARUMAN, SLY_SOUTHERNER] }],
        hand: opts?.hand ?? [WIZARDS_MYRMIDON],
        siteDeck: [ISENGARD_SITE],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: ISENGARD_SITE, characters: [] }],
        hand: [],
        siteDeck: [ISENGARD_SITE],
        playDeck: makePlayDeck(),
      },
    ],
  });
}

describe('Wizard\'s Myrmidon (wh-84)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Playable only on a non-Fallen-wizard character ─────────────────

  test('offered on the non-Fallen-wizard character, but not on the Fallen-wizard avatar', () => {
    const state = fwOrgState();
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const targetIds = actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);

    const orcId = findCharInstanceId(state, RESOURCE_PLAYER, SLY_SOUTHERNER);
    const avatarId = findCharInstanceId(state, RESOURCE_PLAYER, SARUMAN);

    expect(targetIds).toContain(orcId);
    expect(targetIds).not.toContain(avatarId);
    // Exactly one valid target (the orc) — the avatar is filtered out
    expect(actions.length).toBe(1);
  });

  // ── Rule 2: +1 to his direct influence ─────────────────────────────────────

  test('while attached, increases the bearer direct influence by 1', () => {
    const base = fwOrgState();
    const orcId = findCharInstanceId(base, RESOURCE_PLAYER, SLY_SOUTHERNER);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, WIZARDS_MYRMIDON);

    const before = getCharacter(base, RESOURCE_PLAYER, SLY_SOUTHERNER).effectiveStats.directInfluence;
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, orcId);

    const bearer = getCharacter(after, RESOURCE_PLAYER, SLY_SOUTHERNER);
    expect(bearer.effectiveStats.directInfluence).toBe(before + 1);
    // The card lives as an item on the bearer (resource permanent-event)
    expect(bearer.items.some(i => i.definitionId === WIZARDS_MYRMIDON)).toBe(true);
  });

  // ── Rule 3: Cannot be duplicated by a given player ─────────────────────────

  test('a player cannot play a second copy while one is already in play for them', () => {
    const base = fwOrgState({ hand: [WIZARDS_MYRMIDON, WIZARDS_MYRMIDON] });
    const orcId = findCharInstanceId(base, RESOURCE_PLAYER, SLY_SOUTHERNER);
    const firstId = findHandCardId(base, RESOURCE_PLAYER, WIZARDS_MYRMIDON);

    const attached = playPermanentEventAndResolve(base, PLAYER_1, firstId, orcId);

    // The second copy still in hand must not be playable (player-scope dup limit)
    const actions = viableActions(attached, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Rules 4–6: unimplemented engine mechanics (card NOT certified) ──────────

  test.todo('requires 3 points of influence to control (effective influence-to-control override)');
  test.todo('may only be controlled by general influence or a Fallen-wizard (control restriction)');
  test.todo('contributes 1 stage point while attached to a character (stage-points summed from items)');
});
