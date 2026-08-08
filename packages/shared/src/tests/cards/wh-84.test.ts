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
 * | 4 | Requires 3 points of influence to control             | IMPLEMENTED   |
 * | 5 | May only be controlled by general influence / a FW    | IMPLEMENTED   |
 * | 6 | Stage point (1) while in play                          | IMPLEMENTED   |
 *
 * Rules 4–6 are now modeled:
 *  - Rule 4 ("requires 3 points of influence to control"): the card carries a
 *    `control-restriction` with `cost: 3`. Every influence-to-control read in
 *    the engine (general-influence accounting, follower direct-influence,
 *    move-to-influence reassignment, opponent/agent influence-away threshold)
 *    routes through `engine/control-cost.ts`, so the cost to keep or steal the
 *    bearer is 3 rather than its printed mind of 2.
 *  - Rule 5 ("may only be controlled by general influence or a Fallen-wizard"):
 *    the same effect carries `sources: ["general", "fallen-wizard"]`.
 *    `directInfluenceControlAllowed` lets the bearer be put under direct
 *    influence only of the player's Fallen-wizard avatar; general influence is
 *    always permitted. A normal (non-avatar) character may not control it.
 *  - Rule 6: `recompute-derived.ts` now sums `stage-points` from characters'
 *    `items` as well as `cardsInPlay`, so the bearer's attached stage point is
 *    counted toward the controller's running total.
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
/** Gandalf's Friend — a sibling control-restriction card (cost 1), used to
 *  test CRF-22's "use the lower number" ruling for stacked restrictions. */
const GANDALFS_FRIEND = 'wh-98' as CardDefinitionId;
/** Gandalf — the Fallen-wizard avatar Gandalf's Friend is specific to. */
const GANDALF = 'wh-4' as CardDefinitionId;
/** Saruman — a Fallen-wizard avatar (race fallen-wizard, mind null) */
const SARUMAN = 'wh-9' as CardDefinitionId;
/** Sly Southerner — a non-Fallen-wizard character (race orc, mind 2) */
const SLY_SOUTHERNER = 'wh-10' as CardDefinitionId;
/** The Mouth — a non-Fallen-wizard, non-avatar character with DI 4 (le-24).
 *  Used as the negative control for the control-source restriction: a normal
 *  character that WOULD be a valid direct-influence controller but for the
 *  "only general influence or a Fallen-wizard" restriction. */
const THE_MOUTH = 'le-24' as CardDefinitionId;
/** Isengard — a Fallen-wizard haven */
const ISENGARD_SITE = 'wh-56' as CardDefinitionId;

// ── Builder ──────────────────────────────────────────────────────────────────

function fwOrgState(opts?: { hand?: CardDefinitionId[]; characters?: CardDefinitionId[] }) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: ISENGARD_SITE, characters: opts?.characters ?? [SARUMAN, SLY_SOUTHERNER] }],
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

  // ── Rule 4: requires 3 points of influence to control ──────────────────────

  test('raises the influence-to-control cost from the printed mind (2) to 3', () => {
    const base = fwOrgState();
    const orcId = findCharInstanceId(base, RESOURCE_PLAYER, SLY_SOUTHERNER);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, WIZARDS_MYRMIDON);

    // The orc is held under general influence; the GI it consumes equals its
    // influence-to-control cost.
    const before = base.players[0].generalInfluenceUsed;
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, orcId);

    // Printed mind 2 → control cost 3: GI used rises by exactly 1.
    expect(after.players[0].generalInfluenceUsed).toBe(before + 1);
  });

  // ── Rule 5: only general influence or a Fallen-wizard may control ──────────

  test('may be moved under the Fallen-wizard avatar, but not under a normal character', () => {
    // Company: Saruman (FW avatar, DI 12), The Mouth (normal char, DI 4),
    // and Sly Southerner (the prospective follower).
    const withCard = fwOrgState({ characters: [SARUMAN, THE_MOUTH, SLY_SOUTHERNER] });
    const orcId = findCharInstanceId(withCard, RESOURCE_PLAYER, SLY_SOUTHERNER);
    const avatarId = findCharInstanceId(withCard, RESOURCE_PLAYER, SARUMAN);
    const mouthId = findCharInstanceId(withCard, RESOURCE_PLAYER, THE_MOUTH);
    const cardId = findHandCardId(withCard, RESOURCE_PLAYER, WIZARDS_MYRMIDON);

    const attached = playPermanentEventAndResolve(withCard, PLAYER_1, cardId, orcId);
    const moves = viableActions(attached, PLAYER_1, 'move-to-influence')
      .map(ea => ea.action as { characterInstanceId?: unknown; controlledBy?: unknown })
      .filter(a => a.characterInstanceId === orcId);
    const controllers = moves.map(a => a.controlledBy);

    // The Fallen-wizard avatar may control it (DI 12 ≥ cost 3); the normal
    // character may not, even though its DI 4 ≥ cost 3.
    expect(controllers).toContain(avatarId);
    expect(controllers).not.toContain(mouthId);
  });

  test('without the card, the same normal character IS a valid controller (isolates the restriction)', () => {
    // Identical company but the card is not played: The Mouth (DI 4) can hold
    // the orc (mind 2), proving its exclusion above is the control-source rule.
    const base = fwOrgState({ characters: [SARUMAN, THE_MOUTH, SLY_SOUTHERNER], hand: [] });
    const orcId = findCharInstanceId(base, RESOURCE_PLAYER, SLY_SOUTHERNER);
    const mouthId = findCharInstanceId(base, RESOURCE_PLAYER, THE_MOUTH);

    const controllers = viableActions(base, PLAYER_1, 'move-to-influence')
      .map(ea => ea.action as { characterInstanceId?: unknown; controlledBy?: unknown })
      .filter(a => a.characterInstanceId === orcId)
      .map(a => a.controlledBy);

    expect(controllers).toContain(mouthId);
  });

  // ── CRF-22: stacked control-restriction cards use the lower cost ───────────

  test('stacked with Gandalf\'s Friend (lower cost), the lower control cost governs (CRF-22)', () => {
    // CRF-22 ruling on Wizard's Myrmidon: "Can be played with another card,
    // like Squire of the Hunt, that reduces the influence required to control
    // the character. Use the lower number to control the character." Attach
    // Gandalf's Friend (cost 1) first, then Wizard's Myrmidon (cost 3) — the
    // governing cost must stay 1, not jump to 3.
    const base = fwOrgState({
      characters: [GANDALF, SLY_SOUTHERNER],
      hand: [GANDALFS_FRIEND, WIZARDS_MYRMIDON],
    });
    const orcId = findCharInstanceId(base, RESOURCE_PLAYER, SLY_SOUTHERNER);
    const friendCardId = findHandCardId(base, RESOURCE_PLAYER, GANDALFS_FRIEND);

    const withFriend = playPermanentEventAndResolve(base, PLAYER_1, friendCardId, orcId);
    const giAfterFriend = withFriend.players[0].generalInfluenceUsed;

    const myrmidonCardId = findHandCardId(withFriend, RESOURCE_PLAYER, WIZARDS_MYRMIDON);
    const withBoth = playPermanentEventAndResolve(withFriend, PLAYER_1, myrmidonCardId, orcId);

    // Both control-restriction cards are now attached; the lower cost (1,
    // from Gandalf's Friend) must still govern — GI used does not change.
    expect(withBoth.players[0].generalInfluenceUsed).toBe(giAfterFriend);

    const bearer = getCharacter(withBoth, RESOURCE_PLAYER, SLY_SOUTHERNER);
    expect(bearer.items.some(i => i.definitionId === GANDALFS_FRIEND)).toBe(true);
    expect(bearer.items.some(i => i.definitionId === WIZARDS_MYRMIDON)).toBe(true);
  });

  // ── Rule 6: contributes 1 stage point while attached to a character ─────────

  test('the attached stage point is counted toward the controller stage-point total', () => {
    const base = fwOrgState();
    const orcId = findCharInstanceId(base, RESOURCE_PLAYER, SLY_SOUTHERNER);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, WIZARDS_MYRMIDON);

    expect(base.players[0].stagePoints).toBe(0);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, orcId);
    expect(after.players[0].stagePoints).toBe(1);
  });
});
