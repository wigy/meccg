/**
 * @module le-203-the-lidless-eye.test
 *
 * Card test: The Lidless Eye (le-203)
 * Type: minion-resource-event (permanent)
 * Alignment: ringwraith
 *
 * Text:
 *   "Playable if your opponent is a Wizard and you have not revealed a
 *    Ringwraith. You are Sauron, not a Ringwraith. You may not reveal a
 *    Ringwraith or play Ringwraith followers. +7 to your general influence.
 *    You may keep one more card than normal in your hand. Discards and
 *    prevents the subsequent play of Bade to Rule. Once during each of your
 *    organization phases, you may: bring a resource or character from your
 *    sideboard into your play deck and shuffle or choose and discard a card
 *    from your hand to look at up to 5 random cards at once from your
 *    opponent's hand. Cannot be duplicated. Cannot be included in a
 *    Balrog's/Fallen-wizard's deck."
 *
 * A general (non-attached) permanent-event that sits in the controller's
 * `cardsInPlay`. It marks the player as *Sauron* (`play-as-sauron`), which
 * blocks Ringwraith-avatar reveal and Ringwraith-follower play; grants +7 bare
 * general influence and +1 hand size (both collected from `cardsInPlay`); on
 * entering play discards every in-play Bade to Rule (`discard-named-in-play`,
 * paired with `card-not-in-play` play-conditions on le-167 that then forbid
 * replaying it); and grants a once-per-organization-phase dual-mode ability
 * (`sauron-sideboard-fetch` / `sauron-peek-hand`) tracked by
 * `OrganizationPhaseState.sauronOrgActionUsed`.
 *
 * Engine Support:
 * | # | Rule                                                     | Status      |
 * |---|----------------------------------------------------------|-------------|
 * | 1 | Playable if opponent Wizard and no Ringwraith revealed   | IMPLEMENTED |
 * | 2 | +7 general influence                                     | IMPLEMENTED |
 * | 3 | +1 hand size                                             | IMPLEMENTED |
 * | 4 | You are Sauron — may not reveal a Ringwraith             | IMPLEMENTED |
 * | 5 | You are Sauron — may not play Ringwraith followers      | IMPLEMENTED |
 * | 6 | Discards Bade to Rule on entering play                   | IMPLEMENTED |
 * | 7 | Prevents subsequent play of Bade to Rule                 | IMPLEMENTED |
 * | 8 | Once/org phase: fetch a sideboard resource/char to deck  | IMPLEMENTED |
 * | 9 | Once/org phase: discard a hand card to peek opp hand     | IMPLEMENTED |
 * |10 | Cannot be duplicated (game scope)                        | IMPLEMENTED |
 * |11 | Cannot be included in a Balrog's/Fallen-wizard's deck    | OUT OF SCOPE|
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  buildTestState, makePlayDeck, resetMint, mint,
  viableActions,
  findHandCardId,
  attachItemToChar,
  playPermanentEventAndResolve,
  dispatch,
  getCharacter,
  addP1CardsInPlay,
  recomputeDerived,
} from '../test-helpers.js';
import { computeLegalActions, Phase, CardStatus, Alignment, HAND_SIZE } from '../../index.js';
import { resolveHandSize } from '../../engine/effects/index.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayerId } from '../../index.js';
import type { OrganizationPhaseState } from '../../types/state-phases.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** The Lidless Eye — the card under test */
const LIDLESS_EYE = 'le-203' as CardDefinitionId;
/** Bade to Rule — discarded/prevented by The Lidless Eye (le-167) */
const BADE_TO_RULE = 'le-167' as CardDefinitionId;
/** Adûnaphel the Ringwraith — a ringwraith-race avatar (mind null) (le-50) */
const ADUNAPHEL = 'le-50' as CardDefinitionId;
/** The Witch-king — a ringwraith avatar granting two follower slots (le-58) */
const WITCH_KING = 'le-58' as CardDefinitionId;
/** The Mouth — a non-avatar minion character, race man (le-24) */
const THE_MOUTH = 'le-24' as CardDefinitionId;
/** Morgul-blade — a minion resource (permanent event) used as a sideboard fetch target (le-205) */
const MORGUL_BLADE = 'le-205' as CardDefinitionId;
/** Dol Guldur — a minion haven site / Darkhaven (le-367) */
const DOL_GULDUR = 'le-367' as CardDefinitionId;

/** A bare general permanent-event card-in-play entry for the Sauron player. */
function lidlessEyeInPlay() {
  return { instanceId: mint(), definitionId: LIDLESS_EYE, status: CardStatus.Untapped };
}

/**
 * Minion (Ringwraith) player at Dol Guldur during their organization phase,
 * facing a Wizard opponent. Player 1 (resource) is the Sauron/minion side.
 */
function minionOrgState(opts: {
  p1Characters?: CardDefinitionId[];
  hand?: CardDefinitionId[];
  sideboard?: CardDefinitionId[];
  p2Hand?: CardDefinitionId[];
} = {}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: opts.p1Characters ?? [THE_MOUTH] }],
        hand: opts.hand ?? [],
        siteDeck: [DOL_GULDUR],
        playDeck: makePlayDeck(),
        sideboard: opts.sideboard ?? [],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
        hand: opts.p2Hand ?? [],
        siteDeck: [DOL_GULDUR],
        playDeck: makePlayDeck(),
      },
    ],
  });
}

/** All play-character actions (viable or not) targeting a specific hand instance. */
function playCharacterFor(state: GameState, playerId: PlayerId, charInstanceId: CardInstanceId) {
  return computeLegalActions(state, playerId).filter(
    ea => ea.action.type === 'play-character'
      && (ea.action as { characterInstanceId?: unknown }).characterInstanceId === charInstanceId,
  );
}

describe('The Lidless Eye (le-203)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Playability ──────────────────────────────────────────────────

  test('playable when opponent is a Wizard and no Ringwraith is revealed', () => {
    const state = minionOrgState({ hand: [LIDLESS_EYE], p1Characters: [THE_MOUTH] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const eye = actions.filter(
      ea => (ea.action as { cardInstanceId?: unknown }).cardInstanceId
        === findHandCardId(state, RESOURCE_PLAYER, LIDLESS_EYE),
    );
    expect(eye.length).toBe(1);
  });

  test('NOT playable when the player has revealed a Ringwraith avatar', () => {
    // Adûnaphel (a Ringwraith avatar) is in the player's company → hasRingwraithInPlay.
    const state = minionOrgState({ hand: [LIDLESS_EYE], p1Characters: [ADUNAPHEL] });
    const eyeHandId = findHandCardId(state, RESOURCE_PLAYER, LIDLESS_EYE);
    const viable = viableActions(state, PLAYER_1, 'play-permanent-event').filter(
      ea => (ea.action as { cardInstanceId?: unknown }).cardInstanceId === eyeHandId,
    );
    expect(viable.length).toBe(0);
  });

  // ── Rule 2: +7 general influence ─────────────────────────────────────────

  test('grants +7 general influence while in play', () => {
    const base = minionOrgState({ p1Characters: [THE_MOUTH] });
    const withEye = recomputeDerived(addP1CardsInPlay(base, [lidlessEyeInPlay()]));
    expect(withEye.players[RESOURCE_PLAYER].generalInfluenceBonus).toBe(7);
  });

  // ── Rule 3: +1 hand size ─────────────────────────────────────────────────

  test('grants +1 hand size while in play', () => {
    const base = minionOrgState({ p1Characters: [THE_MOUTH] });
    expect(resolveHandSize(base, RESOURCE_PLAYER)).toBe(HAND_SIZE);
    const withEye = addP1CardsInPlay(base, [lidlessEyeInPlay()]);
    expect(resolveHandSize(withEye, RESOURCE_PLAYER)).toBe(HAND_SIZE + 1);
  });

  // ── Rule 4: You are Sauron — may not reveal a Ringwraith ──────────────────

  test('blocks revealing a Ringwraith avatar while The Lidless Eye is in play', () => {
    const base = minionOrgState({ hand: [ADUNAPHEL], p1Characters: [THE_MOUTH] });
    const adunaphelHandId = findHandCardId(base, RESOURCE_PLAYER, ADUNAPHEL);

    // Without The Lidless Eye, revealing Adûnaphel is a viable avatar play.
    const before = playCharacterFor(base, PLAYER_1, adunaphelHandId);
    expect(before.some(ea => ea.viable)).toBe(true);

    // With The Lidless Eye in play, the reveal is offered but non-viable (Sauron).
    const withEye = addP1CardsInPlay(base, [lidlessEyeInPlay()]);
    const after = playCharacterFor(withEye, PLAYER_1, adunaphelHandId);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every(ea => !ea.viable)).toBe(true);
    expect(after[0].reason).toMatch(/Sauron/i);
  });

  // ── Rule 5: You are Sauron — may not play Ringwraith followers ─────────────

  test('blocks playing a Ringwraith follower while The Lidless Eye is in play', () => {
    // The Witch-king (revealed avatar, 2 follower slots) + a second Ringwraith in hand.
    const base = minionOrgState({ hand: [ADUNAPHEL], p1Characters: [WITCH_KING] });
    const followerHandId = findHandCardId(base, RESOURCE_PLAYER, ADUNAPHEL);

    // Without The Lidless Eye, Adûnaphel is a viable Ringwraith follower of the Witch-king.
    const before = playCharacterFor(base, PLAYER_1, followerHandId);
    expect(before.some(ea => ea.viable)).toBe(true);

    // With The Lidless Eye in play, no viable follower play — blocked for Sauron.
    const withEye = addP1CardsInPlay(base, [lidlessEyeInPlay()]);
    const after = playCharacterFor(withEye, PLAYER_1, followerHandId);
    expect(after.some(ea => ea.viable)).toBe(false);
    expect(after.length).toBeGreaterThan(0);
    expect(after[0].reason).toMatch(/Sauron/i);
  });

  // ── Rule 6: Discards Bade to Rule on entering play ────────────────────────

  test('discards an in-play Bade to Rule when it enters play', () => {
    // Bade to Rule attached to a Ringwraith; play The Lidless Eye into play.
    const base = minionOrgState({ hand: [LIDLESS_EYE], p1Characters: [ADUNAPHEL] });
    const withBade = attachItemToChar(base, RESOURCE_PLAYER, ADUNAPHEL, BADE_TO_RULE);
    expect(getCharacter(withBade, RESOURCE_PLAYER, ADUNAPHEL).items.length).toBe(1);

    const eyeHandId = findHandCardId(withBade, RESOURCE_PLAYER, LIDLESS_EYE);
    const after = playPermanentEventAndResolve(withBade, PLAYER_1, eyeHandId);

    // Bade to Rule is gone from the character and now in the owner's discard pile.
    expect(getCharacter(after, RESOURCE_PLAYER, ADUNAPHEL).items.length).toBe(0);
    const discard = after.players[RESOURCE_PLAYER].discardPile;
    expect(discard.some(c => c.definitionId === BADE_TO_RULE)).toBe(true);
    // The Lidless Eye itself is in play.
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === LIDLESS_EYE)).toBe(true);
  });

  // ── Rule 7: Prevents subsequent play of Bade to Rule ──────────────────────

  test('prevents playing Bade to Rule while The Lidless Eye is in play', () => {
    const base = minionOrgState({ hand: [BADE_TO_RULE], p1Characters: [ADUNAPHEL] });
    const withEye = addP1CardsInPlay(base, [lidlessEyeInPlay()]);
    const badeHandId = findHandCardId(withEye, RESOURCE_PLAYER, BADE_TO_RULE);
    const viable = viableActions(withEye, PLAYER_1, 'play-permanent-event').filter(
      ea => (ea.action as { cardInstanceId?: unknown }).cardInstanceId === badeHandId,
    );
    expect(viable.length).toBe(0);
  });

  // ── Rule 8: Once/org phase — sideboard fetch ──────────────────────────────

  test('offers a once-per-org-phase sideboard fetch that moves the card to the play deck', () => {
    const base = minionOrgState({
      p1Characters: [THE_MOUTH],
      sideboard: [MORGUL_BLADE],
      p2Hand: [], // no opponent hand → isolate the fetch mode
    });
    const withEye = addP1CardsInPlay(base, [lidlessEyeInPlay()]);

    const fetches = viableActions(withEye, PLAYER_1, 'activate-granted-action').filter(
      ea => (ea.action as { actionId?: string }).actionId === 'sauron-sideboard-fetch',
    );
    expect(fetches.length).toBe(1);
    const sbInstanceId = withEye.players[RESOURCE_PLAYER].sideboard[0].instanceId;
    expect((fetches[0].action as { targetCardId?: unknown }).targetCardId).toBe(sbInstanceId);

    const deckBefore = withEye.players[RESOURCE_PLAYER].playDeck.length;
    const after = dispatch(withEye, fetches[0].action);

    expect(after.players[RESOURCE_PLAYER].sideboard.some(c => c.instanceId === sbInstanceId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].playDeck.some(c => c.instanceId === sbInstanceId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].playDeck.length).toBe(deckBefore + 1);
    expect((after.phaseState as OrganizationPhaseState).sauronOrgActionUsed).toBe(true);

    // Used up for the rest of this organization phase.
    const again = viableActions(after, PLAYER_1, 'activate-granted-action').filter(
      ea => {
        const id = (ea.action as { actionId?: string }).actionId;
        return id === 'sauron-sideboard-fetch' || id === 'sauron-peek-hand';
      },
    );
    expect(again.length).toBe(0);
  });

  // ── Rule 9: Once/org phase — peek opponent hand ───────────────────────────

  test('offers a once-per-org-phase peek that reveals 5 random opponent-hand cards', () => {
    const base = minionOrgState({
      p1Characters: [THE_MOUTH],
      hand: [MORGUL_BLADE], // a discardable hand card (the cost)
      p2Hand: [THE_MOUTH, ADUNAPHEL, BADE_TO_RULE, MORGUL_BLADE, DOL_GULDUR, LIDLESS_EYE], // 6 in hand
    });
    const withEye = addP1CardsInPlay(base, [lidlessEyeInPlay()]);

    const costCardId = findHandCardId(withEye, RESOURCE_PLAYER, MORGUL_BLADE);
    const peeks = viableActions(withEye, PLAYER_1, 'activate-granted-action').filter(
      ea => (ea.action as { actionId?: string }).actionId === 'sauron-peek-hand'
        && (ea.action as { targetCardId?: unknown }).targetCardId === costCardId,
    );
    expect(peeks.length).toBe(1);

    const oppHandIds = withEye.players[1].hand.map(c => c.instanceId as string);
    const after = dispatch(withEye, peeks[0].action);

    // Cost card discarded from hand to discard pile.
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === costCardId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === costCardId)).toBe(true);

    // Exactly min(5, 6) = 5 opponent-hand instances are now revealed; the cards
    // remain in the opponent's hand.
    const revealedOppHand = oppHandIds.filter(id => after.revealedInstances[id as CardInstanceId] !== undefined);
    expect(revealedOppHand.length).toBe(5);
    expect(after.players[1].hand.length).toBe(6);

    expect((after.phaseState as OrganizationPhaseState).sauronOrgActionUsed).toBe(true);
  });

  // ── Rule 10: Cannot be duplicated ─────────────────────────────────────────

  test('a second copy cannot be played while one is already in play', () => {
    const base = minionOrgState({ hand: [LIDLESS_EYE], p1Characters: [THE_MOUTH] });
    const withEye = addP1CardsInPlay(base, [lidlessEyeInPlay()]);
    const secondHandId = findHandCardId(withEye, RESOURCE_PLAYER, LIDLESS_EYE);
    const viable = viableActions(withEye, PLAYER_1, 'play-permanent-event').filter(
      ea => (ea.action as { cardInstanceId?: unknown }).cardInstanceId === secondHandId,
    );
    expect(viable.length).toBe(0);
  });
});
