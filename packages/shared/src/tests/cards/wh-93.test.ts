/**
 * @module wh-93.test
 *
 * Card test: Join the Hunt (wh-93)
 * Type: minion-resource-event (Fallen-wizard stage permanent-event), alignment "stage"
 *
 * Printed text:
 *   "Unique. Alatar specific. Your weapon/shield/armor/helmet items in Alatar's
 *    company are each worth full marshalling points. Your allies with a prowess
 *    attribute in Alatar's company are each worth full marshalling points."
 *
 * Card shape (data):
 *   - alignment "stage", eventType "permanent"; worth 0 MP (misc) and 2 stage
 *     points. Keyword `alatar-specific` (playable only while the player's avatar
 *     is Alatar; enforced generically via `wizardSpecificName`).
 *   - effects:
 *     1. stage-points (value 2).
 *     2. fw-mp-full (cards: items) — `inAvatarCompany: true`, filter matching weapon/armor/
 *        shield/helmet items. Lifts the MEWH §4 1-MP clamp to full printed MP for
 *        those items borne by characters in Alatar's company.
 *     3. fw-mp-full (cards: allies) — `inAvatarCompany: true`, filter `{ prowess: $exists }`.
 *        Lifts the §4 clamp to full printed MP for allies with a prowess attribute
 *        borne by characters in Alatar's company.
 *
 * Background: MEWH §4 clamps every non-stage card a Fallen-wizard controls to a
 * flat 1 MP. Join the Hunt exempts a filtered subset — but only in the avatar's
 * (Alatar's) company. These tests drive the recompute / legal-action pipeline;
 * the card shape is documented here rather than asserted.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  viableActions,
  attachItemToChar, attachAllyToChar, addCardInPlay, addCardToHand, recomputeDerived,
  makePlayDeck,
  RESOURCE_PLAYER,
  ARAGORN, SAM_GAMGEE, LEGOLAS,
  ISENGARD, RIVENDELL, LORIEN, MORIA,
} from '../test-helpers.js';
import { Alignment, computeLegalActions } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

// ─── Local card-ID constants (single-use — not promoted to card-ids.ts) ─────
const JOIN_THE_HUNT = 'wh-93'  as CardDefinitionId; // FW stage permanent-event
const ALATAR        = 'wh-1'   as CardDefinitionId; // the Fallen-wizard avatar it's specific to
const SARUMAN       = 'wh-9'   as CardDefinitionId; // a *different* FW avatar (negative control)
const GLAMDRING     = 'tw-244' as CardDefinitionId; // weapon item, printed MP 2
const LIGHT_STONE   = 'dm-168' as CardDefinitionId; // plain (non-combat) item, printed MP 2
const TREEBEARD     = 'tw-353' as CardDefinitionId; // ally with prowess (8), printed MP 2
const NENSELDE      = 'td-142' as CardDefinitionId; // ally with NO prowess attribute, printed MP 2

// Two-company Fallen-wizard state. Company A holds the avatar (Alatar) plus
// Aragorn; company B holds Sam with no avatar. Opponent is a plain Wizard.
function twoCompanyState(alatarCompanyAvatar: CardDefinitionId = ALATAR) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [
          { site: ISENGARD, characters: [alatarCompanyAvatar, ARAGORN] },
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

describe('Join the Hunt (wh-93)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: weapon/armor/shield/helmet items in Alatar's company → full MP ───

  test('a weapon item in Alatar\'s company scores full printed MP (2) with Join the Hunt', () => {
    let state = twoCompanyState();
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, GLAMDRING); // Aragorn shares Alatar's company
    state = addCardInPlay(state, RESOURCE_PLAYER, JOIN_THE_HUNT);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);
  });

  test('without Join the Hunt, the same weapon item falls under the §4 1-MP clamp (control)', () => {
    let state = twoCompanyState();
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, GLAMDRING);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1);
  });

  // ─── Rule: restricted to Alatar's company ──────────────────────────────────

  test('a weapon item outside Alatar\'s company stays clamped to 1 even with Join the Hunt', () => {
    // Sam is in company B (no avatar). His weapon is not "in Alatar's company".
    let state = twoCompanyState();
    state = attachItemToChar(state, RESOURCE_PLAYER, SAM_GAMGEE, GLAMDRING);
    state = addCardInPlay(state, RESOURCE_PLAYER, JOIN_THE_HUNT);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1);
  });

  test('the exemption does nothing when the avatar (Alatar) is not in play', () => {
    // No avatar in any company → there is no "Alatar's company", so the
    // company-restricted exemption never fires and the weapon stays clamped.
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [ARAGORN, SAM_GAMGEE] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
      ],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, GLAMDRING);
    state = addCardInPlay(state, RESOURCE_PLAYER, JOIN_THE_HUNT);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1);
  });

  // ─── Rule: only weapon/armor/shield/helmet items (filter) ──────────────────

  test('a non-combat item in Alatar\'s company is unaffected (filter excludes it)', () => {
    let state = twoCompanyState();
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, LIGHT_STONE); // no weapon/armor/shield/helmet keyword
    state = addCardInPlay(state, RESOURCE_PLAYER, JOIN_THE_HUNT);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1);
  });

  // ─── Rule: allies with a prowess attribute in Alatar's company → full MP ────

  test('an ally with a prowess attribute in Alatar\'s company scores full printed MP (2)', () => {
    let state = twoCompanyState();
    state = attachAllyToChar(state, RESOURCE_PLAYER, ARAGORN, TREEBEARD); // prowess 8, MP 2
    state = addCardInPlay(state, RESOURCE_PLAYER, JOIN_THE_HUNT);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(2);
  });

  test('without Join the Hunt, the same ally is clamped to 1 (control)', () => {
    let state = twoCompanyState();
    state = attachAllyToChar(state, RESOURCE_PLAYER, ARAGORN, TREEBEARD);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(1);
  });

  test('an ally without a prowess attribute is unaffected (filter excludes it)', () => {
    let state = twoCompanyState();
    state = attachAllyToChar(state, RESOURCE_PLAYER, ARAGORN, NENSELDE); // no prowess, MP 2
    state = addCardInPlay(state, RESOURCE_PLAYER, JOIN_THE_HUNT);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(1);
  });

  test('an ally with prowess outside Alatar\'s company stays clamped to 1', () => {
    let state = twoCompanyState();
    state = attachAllyToChar(state, RESOURCE_PLAYER, SAM_GAMGEE, TREEBEARD); // company B, no avatar
    state = addCardInPlay(state, RESOURCE_PLAYER, JOIN_THE_HUNT);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(1);
  });

  // ─── Rule: a non-Fallen-wizard is never affected ───────────────────────────

  test('a non-Fallen-wizard player scores printed MP normally regardless of Join the Hunt', () => {
    // A hero player already scores full printed MP; the §4 exemption is a no-op
    // and must never act as a cap. (Also confirms the card, alignment permitting,
    // is inert for non-FW players.)
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
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
      ],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, GLAMDRING);
    state = attachAllyToChar(state, RESOURCE_PLAYER, ARAGORN, TREEBEARD);
    state = recomputeDerived(state);

    // Full printed MP for a hero: Glamdring 2 + Treebeard 2.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(2);
  });

  // ─── Rule: stage points (2) while in play ──────────────────────────────────

  test('Join the Hunt contributes 2 stage points to its Fallen-wizard controller', () => {
    let state = twoCompanyState();
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(0);
    state = addCardInPlay(state, RESOURCE_PLAYER, JOIN_THE_HUNT);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(2);
  });

  // ─── Rule: Unique / Alatar specific (playability) ──────────────────────────

  test('playable from hand while the avatar is Alatar', () => {
    let state = twoCompanyState();
    state = addCardToHand(state, RESOURCE_PLAYER, JOIN_THE_HUNT);

    const handId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === JOIN_THE_HUNT)!.instanceId;
    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(playable).toHaveLength(1);
  });

  test('not playable when the player counts as a different Fallen-wizard (Saruman)', () => {
    let state = twoCompanyState(SARUMAN);
    state = addCardToHand(state, RESOURCE_PLAYER, JOIN_THE_HUNT);

    const handId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === JOIN_THE_HUNT)!.instanceId;
    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(playable).toHaveLength(0);

    const notPlayable = computeLegalActions(state, PLAYER_1)
      .find(ea => ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(notPlayable?.reason ?? '').toContain('Alatar');
  });

  test('a second copy cannot be played while one is already in play (unique)', () => {
    let state = twoCompanyState();
    state = addCardInPlay(state, RESOURCE_PLAYER, JOIN_THE_HUNT);
    state = addCardToHand(state, RESOURCE_PLAYER, JOIN_THE_HUNT);

    const handId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === JOIN_THE_HUNT)!.instanceId;
    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(playable).toHaveLength(0);
  });
});
