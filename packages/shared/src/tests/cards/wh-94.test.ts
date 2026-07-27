/**
 * @module wh-94.test
 *
 * Card test: Oromë's Warders (wh-94)
 * Type: minion-resource-event (Fallen-wizard stage permanent-event), alignment "stage"
 *
 * Printed text:
 *   "Unique. Alatar specific. Playable on Alatar if Join the Hunt is in play.
 *    Your weapon/shield/armor/helmet items are each worth full marshalling
 *    points. Your allies with a prowess attribute are each worth full
 *    marshalling points. Your Elf factions are each worth 2 marshalling points."
 *
 * Card shape (data):
 *   - alignment "stage", eventType "permanent"; worth 0 MP (misc) and 3 stage
 *     points. Keyword `alatar-specific` (playable only while the player's avatar
 *     is Alatar; enforced generically via `wizardSpecificName`).
 *   - effects:
 *     1. stage-points (value 3).
 *     2. play-condition `card-in-play` "Join the Hunt" — the prerequisite stage
 *        card (wh-93) must already be in the player's own play area.
 *     3. play-target `character` filter `{ target.name: "Alatar" }` — the card
 *        attaches to Alatar's `items` ("playable on Alatar").
 *     4. fw-item-mp-full — filter matching weapon/armor/shield/helmet items,
 *        **player-wide** (no `inAvatarCompany`, unlike Join the Hunt wh-93).
 *     5. fw-ally-mp-full — filter `{ prowess: $exists }`, likewise player-wide.
 *     6. faction-mp-override — rule `{ when: { faction.race: "elf" }, value: 2 }`.
 *
 * Background: MEWH §4 clamps every non-stage card a Fallen-wizard controls to a
 * flat 1 MP. Oromë's Warders is the follow-up stage to Join the Hunt: it lifts
 * the same two exemptions to the whole play area (not just Alatar's company) and
 * adds a faction re-valuation. Because the card is placed *on Alatar*, it lives
 * in his `items` rather than in `cardsInPlay` — the recompute pass collects its
 * player-wide effects from there. These tests drive the recompute / legal-action
 * pipeline; the card shape is documented here rather than asserted.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  viableActions,
  attachItemToChar, attachAllyToChar, addCardInPlay, addCardToHand, recomputeDerived,
  playPermanentEventAndResolve, findCharInstanceId, findHandCardId, getCharacter,
  makePlayDeck,
  ARAGORN, SAM_GAMGEE, LEGOLAS,
  ISENGARD, RIVENDELL, LORIEN, MORIA,
} from '../test-helpers.js';
import { Alignment, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

// ─── Local card-ID constants (single-use — not promoted to card-ids.ts) ─────
const WARDERS       = 'wh-94'  as CardDefinitionId; // the stage permanent-event under test
const JOIN_THE_HUNT = 'wh-93'  as CardDefinitionId; // its prerequisite stage card
const ALATAR        = 'wh-1'   as CardDefinitionId; // the Fallen-wizard avatar it's specific to
const SARUMAN       = 'wh-9'   as CardDefinitionId; // a *different* FW avatar (negative control)
const GLAMDRING     = 'tw-244' as CardDefinitionId; // weapon item, printed MP 2
const LIGHT_STONE   = 'dm-168' as CardDefinitionId; // plain (non-combat) item, printed MP 2
const TREEBEARD     = 'tw-353' as CardDefinitionId; // ally with prowess (8), printed MP 2
const NENSELDE      = 'td-142' as CardDefinitionId; // ally with NO prowess attribute, printed MP 2
const WOOD_ELVES    = 'tw-367' as CardDefinitionId; // Elf faction, printed MP 3
const ORCS_OF_MORIA = 'le-278' as CardDefinitionId; // Orc faction, printed MP 3 (non-Elf control)

/**
 * Two-company Fallen-wizard state. Company A holds the avatar (Alatar) plus
 * Aragorn at Isengard; company B holds Sam at Rivendell with no avatar — so a
 * card borne by Sam is demonstrably *outside* Alatar's company. `avatar` lets a
 * negative control swap in a different Fallen-wizard.
 */
function alatarFwState(avatar: CardDefinitionId = ALATAR): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [
          { site: ISENGARD, characters: [avatar, ARAGORN] },
          { site: RIVENDELL, characters: [SAM_GAMGEE] },
        ],
        hand: [],
        siteDeck: [MORIA],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [MORIA],
        playDeck: makePlayDeck(),
      },
    ],
  });
}

describe("Oromë's Warders (wh-94)", () => {
  beforeEach(() => resetMint());

  // ─── Rule: weapon/shield/armor/helmet items → full marshalling points ──────

  test('a weapon item scores full printed MP (2) while the Warders are on Alatar', () => {
    let state = alatarFwState();
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, GLAMDRING);
    state = attachItemToChar(state, RESOURCE_PLAYER, ALATAR, WARDERS); // "on Alatar"
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);
  });

  test('without the Warders, the same weapon item falls under the §4 1-MP clamp (control)', () => {
    let state = alatarFwState();
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, GLAMDRING);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1);
  });

  test('the item exemption is player-wide: a weapon outside Alatar\'s company also scores full MP', () => {
    // Sam is in company B (no avatar). Join the Hunt (wh-93) restricts its own
    // exemption to Alatar's company, so it alone would leave Sam's weapon at 1;
    // the Warders' player-wide exemption lifts it to the printed 2.
    let state = alatarFwState();
    state = attachItemToChar(state, RESOURCE_PLAYER, SAM_GAMGEE, GLAMDRING);
    state = addCardInPlay(state, RESOURCE_PLAYER, JOIN_THE_HUNT);
    state = recomputeDerived(state);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1); // Join the Hunt alone: clamped

    state = attachItemToChar(state, RESOURCE_PLAYER, ALATAR, WARDERS);
    state = recomputeDerived(state);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);
  });

  test('a non-combat item is unaffected (the filter excludes it)', () => {
    let state = alatarFwState();
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, LIGHT_STONE); // no weapon/armor/shield/helmet keyword
    state = attachItemToChar(state, RESOURCE_PLAYER, ALATAR, WARDERS);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1);
  });

  // ─── Rule: allies with a prowess attribute → full marshalling points ───────

  test('an ally with a prowess attribute scores full printed MP (2)', () => {
    let state = alatarFwState();
    state = attachAllyToChar(state, RESOURCE_PLAYER, ARAGORN, TREEBEARD); // prowess 8, MP 2
    state = attachItemToChar(state, RESOURCE_PLAYER, ALATAR, WARDERS);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(2);
  });

  test('without the Warders, the same ally is clamped to 1 (control)', () => {
    let state = alatarFwState();
    state = attachAllyToChar(state, RESOURCE_PLAYER, ARAGORN, TREEBEARD);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(1);
  });

  test('the ally exemption is player-wide: an ally outside Alatar\'s company also scores full MP', () => {
    let state = alatarFwState();
    state = attachAllyToChar(state, RESOURCE_PLAYER, SAM_GAMGEE, TREEBEARD); // company B
    state = attachItemToChar(state, RESOURCE_PLAYER, ALATAR, WARDERS);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(2);
  });

  test('an ally without a prowess attribute is unaffected (the filter excludes it)', () => {
    let state = alatarFwState();
    state = attachAllyToChar(state, RESOURCE_PLAYER, ARAGORN, NENSELDE); // no prowess, MP 2
    state = attachItemToChar(state, RESOURCE_PLAYER, ALATAR, WARDERS);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(1);
  });

  // ─── Rule: Elf factions are each worth 2 marshalling points ────────────────

  test('an Elf faction printed at 3 MP scores exactly 2 while the Warders are in play', () => {
    let state = alatarFwState();
    state = addCardInPlay(state, RESOURCE_PLAYER, WOOD_ELVES); // Elf faction, printed 3
    state = attachItemToChar(state, RESOURCE_PLAYER, ALATAR, WARDERS);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(2);
  });

  test('without the Warders, the same Elf faction is FW-clamped to 1 (control)', () => {
    let state = alatarFwState();
    state = addCardInPlay(state, RESOURCE_PLAYER, WOOD_ELVES);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(1);
  });

  test('a non-Elf faction keeps the §4 clamp (only Elf factions are re-valued)', () => {
    let state = alatarFwState();
    state = addCardInPlay(state, RESOURCE_PLAYER, ORCS_OF_MORIA); // Orc faction, printed 3
    state = attachItemToChar(state, RESOURCE_PLAYER, ALATAR, WARDERS);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(1);
  });

  test('Elf and non-Elf factions are scored independently in the same game', () => {
    let state = alatarFwState();
    state = addCardInPlay(state, RESOURCE_PLAYER, WOOD_ELVES);    // → 2
    state = addCardInPlay(state, RESOURCE_PLAYER, ORCS_OF_MORIA); // → 1 (clamped)
    state = attachItemToChar(state, RESOURCE_PLAYER, ALATAR, WARDERS);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(3);
  });

  // ─── Rule: Playable on Alatar if Join the Hunt is in play ──────────────────

  test('not playable while Join the Hunt is absent, and the reason names it', () => {
    const state = addCardToHand(alatarFwState(), RESOURCE_PLAYER, WARDERS);
    const handId = findHandCardId(state, RESOURCE_PLAYER, WARDERS);

    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(playable).toHaveLength(0);

    const blocked = computeLegalActions(state, PLAYER_1)
      .find(ea => ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(blocked?.reason ?? '').toContain('Join the Hunt');
  });

  test('an opponent\'s Join the Hunt does not satisfy the prerequisite', () => {
    let state = addCardToHand(alatarFwState(), RESOURCE_PLAYER, WARDERS);
    state = addCardInPlay(state, 1, JOIN_THE_HUNT); // in the *opponent's* play area
    const handId = findHandCardId(state, RESOURCE_PLAYER, WARDERS);

    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(playable).toHaveLength(0);
  });

  test('playable once Join the Hunt is in play, and offered only on Alatar', () => {
    let state = addCardInPlay(alatarFwState(), RESOURCE_PLAYER, JOIN_THE_HUNT);
    state = addCardToHand(state, RESOURCE_PLAYER, WARDERS);
    const handId = findHandCardId(state, RESOURCE_PLAYER, WARDERS);

    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    const targetIds = playable.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);

    expect(targetIds).toContain(findCharInstanceId(state, RESOURCE_PLAYER, ALATAR));
    expect(targetIds).not.toContain(findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN));
    expect(targetIds).not.toContain(findCharInstanceId(state, RESOURCE_PLAYER, SAM_GAMGEE));
    expect(playable).toHaveLength(1); // exactly Alatar
  });

  test('playing the card places it on Alatar and its abilities take effect', () => {
    let state = addCardInPlay(alatarFwState(), RESOURCE_PLAYER, JOIN_THE_HUNT);
    state = attachItemToChar(state, RESOURCE_PLAYER, SAM_GAMGEE, GLAMDRING); // outside Alatar's company
    state = addCardToHand(state, RESOURCE_PLAYER, WARDERS);
    const alatarId = findCharInstanceId(state, RESOURCE_PLAYER, ALATAR);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, WARDERS);

    state = playPermanentEventAndResolve(state, PLAYER_1, cardId, alatarId);

    expect(getCharacter(state, RESOURCE_PLAYER, ALATAR).items.some(i => i.definitionId === WARDERS)).toBe(true);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2); // player-wide exemption now live
  });

  // ─── Rule: stage points (3) while in play ─────────────────────────────────

  test("Oromë's Warders contributes 3 stage points on top of Join the Hunt's 2", () => {
    let state = addCardInPlay(alatarFwState(), RESOURCE_PLAYER, JOIN_THE_HUNT);
    state = recomputeDerived(state);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(2);

    state = attachItemToChar(state, RESOURCE_PLAYER, ALATAR, WARDERS);
    state = recomputeDerived(state);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(5);
  });

  // ─── Rule: Alatar specific ────────────────────────────────────────────────

  test('not playable when the player counts as a different Fallen-wizard (Saruman)', () => {
    let state = addCardInPlay(alatarFwState(SARUMAN), RESOURCE_PLAYER, JOIN_THE_HUNT);
    state = addCardToHand(state, RESOURCE_PLAYER, WARDERS);
    const handId = findHandCardId(state, RESOURCE_PLAYER, WARDERS);

    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(playable).toHaveLength(0);

    const blocked = computeLegalActions(state, PLAYER_1)
      .find(ea => ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(blocked?.reason ?? '').toContain('Alatar');
  });

  // ─── Rule: Unique ─────────────────────────────────────────────────────────

  test('a second copy cannot be played while one is already on Alatar (unique)', () => {
    let state = addCardInPlay(alatarFwState(), RESOURCE_PLAYER, JOIN_THE_HUNT);
    state = addCardToHand(state, RESOURCE_PLAYER, WARDERS);
    const alatarId = findCharInstanceId(state, RESOURCE_PLAYER, ALATAR);
    const firstId = findHandCardId(state, RESOURCE_PLAYER, WARDERS);
    state = playPermanentEventAndResolve(state, PLAYER_1, firstId, alatarId);

    state = addCardToHand(state, RESOURCE_PLAYER, WARDERS);
    const secondId = findHandCardId(state, RESOURCE_PLAYER, WARDERS);
    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === secondId);
    expect(playable).toHaveLength(0);
  });

  // ─── Rule: a non-Fallen-wizard is never affected ──────────────────────────

  test('a non-Fallen-wizard player scores printed item/ally MP normally (the exemption is never a cap)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
      ],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, GLAMDRING);
    state = attachAllyToChar(state, RESOURCE_PLAYER, ARAGORN, TREEBEARD);
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, WARDERS);
    state = recomputeDerived(state);

    // A non-Fallen-wizard is not under the §4 clamp, so the two full-MP
    // exemptions are inert: Glamdring 2 and Treebeard 2, exactly as printed.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(2);
  });
});
