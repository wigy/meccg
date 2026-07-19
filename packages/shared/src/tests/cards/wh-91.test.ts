/**
 * @module wh-91.test
 *
 * Card test: The Great Hunt (wh-91)
 * Type: minion-resource-event (Fallen-wizard stage permanent-event), alignment "stage"
 *
 * Printed text:
 *   "Alatar specific. Playable if you are Alatar and have at least 12 stage
 *    points. Your opponent reveals cards one at a time from his play deck or his
 *    discard pile (your choice). Any hazard creature revealed immediately
 *    attacks Alatar's company. This process stops when 5 creatures or all cards
 *    of the deck (or pile) have been revealed. Reshuffle play deck if used.
 *    Thereafter, your opponent discards face-up. Whenever your opponent discards
 *    a creature during your turn, you may choose to have it attack Alatar's
 *    company instead. Cannot be duplicated."
 *
 * Card shape (data):
 *   - alignment "stage", eventType "permanent"; worth 0 MP (misc) and 3 stage
 *     points. Keyword `alatar-specific` (playable only while the player's avatar
 *     is Alatar; enforced generically via `wizardSpecificName`).
 *   - effects: stage-points (3); play-condition player-state (avatar Alatar AND
 *     stagePoints ≥ 12); reveal-and-attack (maxCreatures 5, attackAvatar
 *     "Alatar"); duplication-limit scope game (max 1).
 *
 * These tests drive the reducer / legal-action / pending-resolution / combat
 * pipeline. The reveal process and the ongoing discard trigger both spawn
 * `great-hunt-attack` combats against Alatar's company; the revealed / discarded
 * creatures are attacked in place (never moved), so no instance is lost.
 * Loop-prevention ruling: each discarded creature is offered at most once per
 * turn (recorded in the `great-hunt-active` tracker).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  viableActions, dispatch, findInPile, findCharInstanceId, executeAction,
  playPermanentEventAndResolve, addCardToDiscardPile,
  ISENGARD, RIVENDELL, MORIA,
} from '../test-helpers.js';
import { Alignment, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

// ─── Local card-ID constants (single-use — not promoted to card-ids.ts) ─────
const THE_GREAT_HUNT = 'wh-91'  as CardDefinitionId;
const ALATAR         = 'wh-1'   as CardDefinitionId; // the Fallen-wizard avatar it's specific to
const SARUMAN        = 'wh-9'   as CardDefinitionId; // a *different* FW avatar (negative control)
const CAVE_DRAKE     = 'tw-020' as CardDefinitionId; // hazard-creature, race dragon, 2 strikes / 10 prowess
const ORC_PATROL     = 'tw-074' as CardDefinitionId; // hazard-creature, race orc
const BARROW_WIGHT   = 'tw-015' as CardDefinitionId; // hazard-creature, race undead
const ORC_GUARD      = 'tw-072' as CardDefinitionId; // hazard-creature, race orc
const GLAMDRING      = 'tw-244' as CardDefinitionId; // non-creature filler for the opponent deck/discard

// A Fallen-wizard organization-phase state: P1 (active) is the Alatar player
// with one company at Moria; P2 is a placeholder Wizard whose play deck /
// discard pile are configurable (the pile The Great Hunt reveals). `stagePoints`
// / `recompute` let the play-gate tests set a starting stage total directly.
function greatHuntState(opts: {
  hand?: CardDefinitionId[];
  avatar?: CardDefinitionId;
  p2Deck?: CardDefinitionId[];
  p2Discard?: CardDefinitionId[];
  stagePoints?: number;
  recompute?: boolean;
} = {}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    recompute: opts.recompute ?? true,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: MORIA, characters: [opts.avatar ?? ALATAR] }],
        hand: opts.hand ?? [],
        siteDeck: [ISENGARD],
        ...(opts.stagePoints !== undefined ? { stagePoints: opts.stagePoints } : {}),
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: RIVENDELL, characters: [] }],
        hand: [],
        siteDeck: [RIVENDELL],
        playDeck: opts.p2Deck ?? [],
        discardPile: opts.p2Discard ?? [],
      },
    ],
  });
}

/** The Alatar company id for the active player. */
function alatarCompanyId(state: GameState): string {
  return state.players[0].companies[0].id as string;
}

describe('The Great Hunt (wh-91)', () => {
  beforeEach(resetMint);

  // ── Play gate: "Playable if you are Alatar and have at least 12 stage points" ──
  test('is not playable with fewer than 12 stage points', () => {
    const state = greatHuntState({ hand: [THE_GREAT_HUNT], stagePoints: 11, recompute: false });
    const ghId = findInPile(state, 0, 'hand', THE_GREAT_HUNT)!.instanceId;
    const viable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === ghId);
    expect(viable).toHaveLength(0);
  });

  test('is playable by Alatar with at least 12 stage points', () => {
    const state = greatHuntState({ hand: [THE_GREAT_HUNT], stagePoints: 12, recompute: false });
    const ghId = findInPile(state, 0, 'hand', THE_GREAT_HUNT)!.instanceId;
    const viable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === ghId);
    expect(viable).toHaveLength(1);
  });

  test('is not playable by a non-Alatar Fallen-wizard even with enough stage points', () => {
    const state = greatHuntState({ hand: [THE_GREAT_HUNT], avatar: SARUMAN, stagePoints: 20, recompute: false });
    const ghId = findInPile(state, 0, 'hand', THE_GREAT_HUNT)!.instanceId;
    const viable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === ghId);
    expect(viable).toHaveLength(0);
  });

  // ── On-play reveal: a revealed creature attacks Alatar's company ──
  test('revealing the opponent play deck makes the first creature attack Alatar\'s company', () => {
    const state0 = greatHuntState({ hand: [THE_GREAT_HUNT], p2Deck: [GLAMDRING, CAVE_DRAKE, ORC_PATROL] });
    const ghId = findInPile(state0, 0, 'hand', THE_GREAT_HUNT)!.instanceId;
    const drakeId = findInPile(state0, 1, 'playDeck', CAVE_DRAKE)!.instanceId;

    // Play the card → the `great-hunt-source` resolution is pending for P1.
    const state1 = playPermanentEventAndResolve(state0, PLAYER_1, ghId);
    const sourceRes = state1.pendingResolutions.find(r => r.kind.type === 'great-hunt-source');
    expect(sourceRes).toBeDefined();
    expect(sourceRes!.actor).toBe(PLAYER_1);

    // Choose to reveal the play deck → the Cave-drake attacks.
    const state2 = dispatch(state1, { type: 'choose-great-hunt-source', player: PLAYER_1, source: 'deck' });
    expect(state2.combat).not.toBeNull();
    expect(state2.combat!.attackSource.type).toBe('great-hunt-attack');
    if (state2.combat!.attackSource.type === 'great-hunt-attack') {
      expect(state2.combat!.attackSource.creatureInstanceId).toBe(drakeId);
      expect(state2.combat!.attackSource.continuation).toBe('reveal');
    }
    expect(state2.combat!.defendingPlayerId).toBe(PLAYER_1);
    expect(state2.combat!.attackingPlayerId).toBe(PLAYER_2);
    expect(state2.combat!.companyId as string).toBe(alatarCompanyId(state2));
    expect(state2.combat!.creatureRace).toBe('dragon');
    expect(state2.combat!.strikesTotal).toBe(2);
  });

  test('the reveal queue caps at 5 creatures even when more are present', () => {
    const state0 = greatHuntState({
      hand: [THE_GREAT_HUNT],
      // Six hazard creatures in the deck; only five may attack.
      p2Deck: [CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT, ORC_GUARD, CAVE_DRAKE, ORC_PATROL],
    });
    const ghId = findInPile(state0, 0, 'hand', THE_GREAT_HUNT)!.instanceId;
    const state1 = playPermanentEventAndResolve(state0, PLAYER_1, ghId);
    const state2 = dispatch(state1, { type: 'choose-great-hunt-source', player: PLAYER_1, source: 'deck' });

    const reveal = state2.activeConstraints.find(c => c.kind.type === 'great-hunt-reveal');
    expect(reveal).toBeDefined();
    if (reveal && reveal.kind.type === 'great-hunt-reveal') {
      expect(reveal.kind.creatureInstanceIds).toHaveLength(5);
      expect(reveal.kind.reshuffleDeck).toBe(true);
      // The first creature's attack is in progress (queueIndex advanced past it).
      expect(reveal.kind.queueIndex).toBe(1);
    }
    expect(state2.combat).not.toBeNull();
  });

  test('after one revealed creature\'s attack finalizes, the next queued creature attacks', () => {
    // Barrow-wight (1 strike) first, then Orc-patrol — resolving the first
    // combat must advance the reveal queue and initiate the second attack.
    const state0 = greatHuntState({ hand: [THE_GREAT_HUNT], p2Deck: [BARROW_WIGHT, ORC_PATROL] });
    const ghId = findInPile(state0, 0, 'hand', THE_GREAT_HUNT)!.instanceId;
    const orcId = findInPile(state0, 1, 'playDeck', ORC_PATROL)!.instanceId;
    const state1 = playPermanentEventAndResolve(state0, PLAYER_1, ghId);
    const state2 = dispatch(state1, { type: 'choose-great-hunt-source', player: PLAYER_1, source: 'deck' });

    // Resolve the Barrow-wight's single strike (defender assigns it to Alatar,
    // then rolls high so Alatar parries — the creature has no body).
    const alatarId = findCharInstanceId(state2, 0, ALATAR);
    const afterAssign = dispatch(state2, { type: 'assign-strike', player: PLAYER_1, characterId: alatarId });
    const afterStrike = executeAction(afterAssign, PLAYER_1, 'resolve-strike', 12);

    // The queue advanced: the Orc-patrol's attack is now in progress.
    expect(afterStrike.combat).not.toBeNull();
    if (afterStrike.combat!.attackSource.type === 'great-hunt-attack') {
      expect(afterStrike.combat!.attackSource.creatureInstanceId).toBe(orcId);
    }
  });

  test('revealing an all-non-creature deck spawns no attack and reshuffles it', () => {
    const state0 = greatHuntState({ hand: [THE_GREAT_HUNT], p2Deck: [GLAMDRING, GLAMDRING] });
    const ghId = findInPile(state0, 0, 'hand', THE_GREAT_HUNT)!.instanceId;
    const state1 = playPermanentEventAndResolve(state0, PLAYER_1, ghId);
    const state2 = dispatch(state1, { type: 'choose-great-hunt-source', player: PLAYER_1, source: 'deck' });

    expect(state2.combat).toBeNull();
    expect(state2.activeConstraints.find(c => c.kind.type === 'great-hunt-reveal')).toBeUndefined();
    // Deck is intact (no card lost) after the reshuffle.
    expect(state2.players[1].playDeck).toHaveLength(2);
  });

  test('may reveal the opponent discard pile instead of the play deck', () => {
    const state0 = greatHuntState({ hand: [THE_GREAT_HUNT], p2Deck: [GLAMDRING], p2Discard: [ORC_GUARD] });
    const ghId = findInPile(state0, 0, 'hand', THE_GREAT_HUNT)!.instanceId;
    const guardId = findInPile(state0, 1, 'discardPile', ORC_GUARD)!.instanceId;
    const state1 = playPermanentEventAndResolve(state0, PLAYER_1, ghId);

    // Both a deck and a discard reveal are offered; choosing discard attacks with the Orc-guard.
    const offered = computeLegalActions(state1, PLAYER_1)
      .filter(a => a.action.type === 'choose-great-hunt-source')
      .map(a => (a.action as { source: string }).source);
    expect(offered.sort()).toEqual(['deck', 'discard']);

    const state2 = dispatch(state1, { type: 'choose-great-hunt-source', player: PLAYER_1, source: 'discard' });
    expect(state2.combat).not.toBeNull();
    if (state2.combat!.attackSource.type === 'great-hunt-attack') {
      expect(state2.combat!.attackSource.creatureInstanceId).toBe(guardId);
    }
    // The discarded creature is attacked in place — still in the discard pile.
    expect(findInPile(state2, 1, 'discardPile', guardId)).toBeDefined();
  });

  // ── Ongoing trigger: "Whenever your opponent discards a creature during your turn" ──
  test('offers to attack with a creature the opponent discards after the card is in play', () => {
    const state0 = greatHuntState({ hand: [THE_GREAT_HUNT], p2Deck: [GLAMDRING] });
    const ghId = findInPile(state0, 0, 'hand', THE_GREAT_HUNT)!.instanceId;
    const state1 = playPermanentEventAndResolve(state0, PLAYER_1, ghId);

    // A creature enters the opponent's discard pile *after* the card is in play.
    const state2 = addCardToDiscardPile(state1, 1, CAVE_DRAKE);
    const drakeId = findInPile(state2, 1, 'discardPile', CAVE_DRAKE)!.instanceId;

    // Resolving the (creature-less) deck reveal drives a reduce whose post-reduce
    // sweep detects the newly-discarded creature and offers the attack.
    const state3 = dispatch(state2, { type: 'choose-great-hunt-source', player: PLAYER_1, source: 'deck' });
    const offer = state3.pendingResolutions.find(r => r.kind.type === 'great-hunt-discard-attack');
    expect(offer).toBeDefined();
    expect(offer!.actor).toBe(PLAYER_1);
    if (offer && offer.kind.type === 'great-hunt-discard-attack') {
      expect(offer.kind.creatureInstanceId).toBe(drakeId);
    }

    // Accepting has the discarded creature attack Alatar's company.
    const state4 = dispatch(state3, { type: 'great-hunt-attack-with-creature', player: PLAYER_1, creatureInstanceId: drakeId });
    expect(state4.combat).not.toBeNull();
    expect(state4.combat!.companyId as string).toBe(alatarCompanyId(state4));
    if (state4.combat!.attackSource.type === 'great-hunt-attack') {
      expect(state4.combat!.attackSource.continuation).toBe('none');
    }
    // The creature stays in the opponent's discard pile.
    expect(findInPile(state4, 1, 'discardPile', drakeId)).toBeDefined();
  });

  test('declining a discard offer does not re-offer the same creature (loop prevention)', () => {
    const state0 = greatHuntState({ hand: [THE_GREAT_HUNT], p2Deck: [GLAMDRING] });
    const ghId = findInPile(state0, 0, 'hand', THE_GREAT_HUNT)!.instanceId;
    const state1 = playPermanentEventAndResolve(state0, PLAYER_1, ghId);
    const state2 = addCardToDiscardPile(state1, 1, CAVE_DRAKE);
    const state3 = dispatch(state2, { type: 'choose-great-hunt-source', player: PLAYER_1, source: 'deck' });

    // The offer exists; decline it (pass).
    expect(state3.pendingResolutions.some(r => r.kind.type === 'great-hunt-discard-attack')).toBe(true);
    const state4 = dispatch(state3, { type: 'pass', player: PLAYER_1 });

    // The creature is now recorded as processed → the post-reduce sweep does not
    // re-offer it, even though it remains in the discard pile.
    expect(state4.pendingResolutions.some(r => r.kind.type === 'great-hunt-discard-attack')).toBe(false);
    const tracker = state4.activeConstraints.find(c => c.kind.type === 'great-hunt-active');
    expect(tracker).toBeDefined();
    const drakeId = findInPile(state4, 1, 'discardPile', CAVE_DRAKE)!.instanceId;
    if (tracker && tracker.kind.type === 'great-hunt-active') {
      expect(tracker.kind.processedDiscardIds).toContain(drakeId);
    }
  });

  test('a creature already in the discard pile at play time does not trigger an attack', () => {
    // Pre-existing discard creatures are seeded as processed ("thereafter").
    const state0 = greatHuntState({ hand: [THE_GREAT_HUNT], p2Deck: [GLAMDRING], p2Discard: [ORC_PATROL] });
    const ghId = findInPile(state0, 0, 'hand', THE_GREAT_HUNT)!.instanceId;
    const state1 = playPermanentEventAndResolve(state0, PLAYER_1, ghId);
    // Reveal the deck (no creatures) so a reduce fires the sweep.
    const state2 = dispatch(state1, { type: 'choose-great-hunt-source', player: PLAYER_1, source: 'deck' });
    expect(state2.pendingResolutions.some(r => r.kind.type === 'great-hunt-discard-attack')).toBe(false);
  });

  // ── "Cannot be duplicated" ──
  test('cannot play a second copy while one is already in play', () => {
    const state0 = greatHuntState({ hand: [THE_GREAT_HUNT, THE_GREAT_HUNT], p2Deck: [GLAMDRING] });
    const firstId = state0.players[0].hand[0].instanceId;
    const secondId = state0.players[0].hand[1].instanceId;
    const state1 = playPermanentEventAndResolve(state0, PLAYER_1, firstId);
    // Clear the reveal choice so we are back to normal organization actions.
    const state2 = dispatch(state1, { type: 'choose-great-hunt-source', player: PLAYER_1, source: 'deck' });

    const viable = viableActions(state2, PLAYER_1, 'play-permanent-event')
      .filter(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === secondId);
    expect(viable).toHaveLength(0);
  });
});
