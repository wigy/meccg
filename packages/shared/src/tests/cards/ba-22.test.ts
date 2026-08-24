/**
 * @module ba-22.test
 *
 * Card test: Press-gang (ba-22)
 * Type: hazard-event (permanent), alignment Neutral. Non-unique. "Cannot be
 * duplicated" (duplication-limit scope game, max 1).
 *
 * Card text:
 *   "When a character would otherwise be discarded from play, discard all cards
 *    on him, place him 'off to the side' with this card, and return any
 *    character already with this card to its owner's hand. A character with this
 *    card gives his player negative character marshalling points. Cannot be
 *    duplicated."
 *
 * Effects:
 *   1. press-gang-capture — intercept a would-be *discard* of an opponent's
 *      character; hold it off to the side (negative character MP, 0 GI, no
 *      untap), discarding its possessions and freeing its followers; hold one at
 *      a time (a new capture returns the prior to its owner's hand); return the
 *      held character to its owner's hand when this card leaves play.
 *   2. duplication-limit scope game max 1 — cannot be duplicated.
 *
 * | # | Rule                                                        | Status | Notes                                                  |
 * |---|-------------------------------------------------------------|--------|--------------------------------------------------------|
 * | 1 | A would-be-discarded character is held off to the side      | OK     | capture via the rule-3.22 voluntary discard path       |
 * | 2 | Discard all cards on him (items + allies)                   | OK     | possessions routed to owner's discard on capture       |
 * | 3 | Followers are NOT discarded (CRF) — revert to GI            | OK     | follower stays in play, controlledBy 'general'         |
 * | 4 | Gives his player negative character marshalling points      | OK     | recompute-derived: −(char MP) in the character category |
 * | 5 | Return any character already with this card to owner's hand | OK     | a second capture bounces the first back to hand        |
 * | 6 | Held character returns to owner's hand when card leaves play | OK     | sweepPressGang releases on host removal                 |
 * | 7 | Only *discards* are intercepted, never *eliminations*       | OK     | eliminateCharacter (out-of-play) is not captured        |
 * | 8 | Cannot be duplicated                                        | OK     | play-hazard for a 2nd copy is not offered              |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, viableActions,
  findCharInstanceId, attachItemToChar, attachAllyToChar, addCardInPlay, makeMHState,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, DiscardCharacterOrgAction, GameState } from '../../index.js';
import { eliminateCharacter } from '../../engine/pending-reducers.js';
import { sweepPressGang } from '../../engine/press-gang.js';

const PRESS_GANG = 'ba-22' as CardDefinitionId;

// Hero characters (the victims — Press-gang's controller is their opponent).
const ARAGORN = 'tw-120' as CardDefinitionId;  // hero, 3 character MP, leader-capable
const LEGOLAS = 'tw-168' as CardDefinitionId;  // hero, 2 character MP
const GANDALF = 'tw-156' as CardDefinitionId;  // avatar (cannot be voluntarily discarded)
// Possessions.
const DAGGER = 'tw-206' as CardDefinitionId;   // minor weapon item
const NOBLE_STEED = 'wh-33' as CardDefinitionId; // hero ally
// Sites.
const RIVENDELL = 'tw-421' as CardDefinitionId;  // haven (voluntary discard allowed here)
const LORIEN = 'tw-408' as CardDefinitionId;
const MINAS_TIRITH = 'tw-412' as CardDefinitionId;

const ARAGORN_MP = 3;
const LEGOLAS_MP = 2;

/** Find the pressed-constraint (if any) targeting a character. */
function pressedConstraint(state: GameState, charId: CardInstanceId) {
  return state.activeConstraints.find(
    c => c.target.kind === 'character' && c.target.characterId === charId && c.kind.type === 'character-pressed',
  );
}

/** The instance id of the Press-gang card in the hazard player's cardsInPlay. */
function pressGangId(state: GameState, playerIdx: 0 | 1): CardInstanceId | undefined {
  return state.players[playerIdx].cardsInPlay.find(c => c.definitionId === PRESS_GANG)?.instanceId;
}

/**
 * A resource player (P1) at Rivendell with the given characters, opposed by a
 * hazard player (P2) who has a Press-gang in play. The active player is P1 in
 * its organization phase, so rule 3.22 voluntary discards are legal at the haven.
 */
function buildOrgWithPressGang(chars: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters']): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: chars }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return addCardInPlay(base, HAZARD_PLAYER, PRESS_GANG);
}

/** The rule-3.22 voluntary-discard action for a named character. */
function discardAction(state: GameState, charId: CardInstanceId) {
  return viableActions(state, PLAYER_1, 'discard-character')
    .find(ea => (ea.action as DiscardCharacterOrgAction).characterInstanceId === charId)!.action;
}

describe('Press-gang (ba-22)', () => {
  beforeEach(() => resetMint());

  // ─── 1. Capture instead of discard ───────────────────────────────────────────

  test('a would-be-discarded character is held off to the side, not discarded', () => {
    const state = buildOrgWithPressGang([ARAGORN]);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const hostId = pressGangId(state, HAZARD_PLAYER)!;

    const after = dispatch(state, discardAction(state, aragornId));

    // Held off to the side: still in its owner's characters map, in no company.
    expect(after.players[RESOURCE_PLAYER].characters[aragornId]).toBeDefined();
    expect(after.players[RESOURCE_PLAYER].companies.some(c => c.characters.includes(aragornId))).toBe(false);
    // NOT in the discard pile.
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === aragornId)).toBe(false);
    // Marked pressed, pointing back at the Press-gang card.
    const con = pressedConstraint(after, aragornId);
    expect(con).toBeDefined();
    expect(con!.kind.type === 'character-pressed' && con!.kind.hostInstanceId).toBe(hostId);
    // The Press-gang card is still in play (postReduce sweep did not release it).
    expect(pressGangId(after, HAZARD_PLAYER)).toBe(hostId);
  });

  // ─── 2 + 3. Discard all cards on him; followers are not discarded ─────────────

  test('captures discard the character\'s items and allies but free (not discard) his followers', () => {
    let state = buildOrgWithPressGang([{ defId: ARAGORN }, { defId: LEGOLAS, followerOf: 0 }]);
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, DAGGER);
    state = attachAllyToChar(state, RESOURCE_PLAYER, ARAGORN, NOBLE_STEED);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const daggerId = state.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;
    const steedId = state.players[RESOURCE_PLAYER].characters[aragornId].allies[0].instanceId;

    const after = dispatch(state, discardAction(state, aragornId));

    // Items and allies were discarded to the owner's discard pile.
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === daggerId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === steedId)).toBe(true);
    // The captured character is stripped of possessions.
    expect(after.players[RESOURCE_PLAYER].characters[aragornId].items).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].characters[aragornId].allies).toHaveLength(0);
    // The follower is NOT discarded (CRF) — it reverts to general influence
    // with the mind subtraction deferred to the owner's next organization
    // phase (CoE 2.II.2.2.3), like every other freed follower.
    const legolas = after.players[RESOURCE_PLAYER].characters[legolasId];
    expect(legolas).toBeDefined();
    expect(legolas.controlledBy).toBe('general');
    expect(legolas.influenceUnsubtracted).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === legolasId)).toBe(false);
  });

  // ─── 4. Negative character marshalling points ────────────────────────────────

  test('a pressed character gives its owner negative character marshalling points', () => {
    const state = buildOrgWithPressGang([ARAGORN]);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    // In play normally Aragorn contributes +3 character MP.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.character).toBe(ARAGORN_MP);

    const after = dispatch(state, discardAction(state, aragornId));

    // Off to the side he contributes −3 instead.
    expect(after.players[RESOURCE_PLAYER].marshallingPoints.character).toBe(-ARAGORN_MP);
  });

  // ─── 5. One at a time — a new capture returns the prior to its owner's hand ───

  test('holds at most one character; a new capture returns the prior one to its owner\'s hand', () => {
    const state = buildOrgWithPressGang([ARAGORN, LEGOLAS]);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);

    const afterFirst = dispatch(state, discardAction(state, aragornId));
    expect(pressedConstraint(afterFirst, aragornId)).toBeDefined();

    // Legolas is still in the company and can be discarded next.
    const afterSecond = dispatch(afterFirst, discardAction(afterFirst, legolasId));

    // Legolas is now the held character; Aragorn was returned to P1's hand.
    expect(pressedConstraint(afterSecond, legolasId)).toBeDefined();
    expect(pressedConstraint(afterSecond, aragornId)).toBeUndefined();
    expect(afterSecond.players[RESOURCE_PLAYER].characters[aragornId]).toBeUndefined();
    expect(afterSecond.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === aragornId)).toBe(true);
    // Only one negative contribution now (Legolas −2), Aragorn back in hand counts 0.
    expect(afterSecond.players[RESOURCE_PLAYER].marshallingPoints.character).toBe(-LEGOLAS_MP);
  });

  // ─── 6. Host removal releases the held character to its owner's hand ──────────

  test('the held character returns to its owner\'s hand when the Press-gang card leaves play', () => {
    const state = buildOrgWithPressGang([ARAGORN]);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const captured = dispatch(state, discardAction(state, aragornId));
    expect(pressedConstraint(captured, aragornId)).toBeDefined();

    // Remove the Press-gang card from play, then run the disposition sweep.
    const hostGone: GameState = {
      ...captured,
      players: [
        captured.players[0],
        { ...captured.players[1], cardsInPlay: [] },
      ] as unknown as GameState['players'],
    };
    const released = sweepPressGang(hostGone);

    expect(pressedConstraint(released, aragornId)).toBeUndefined();
    expect(released.players[RESOURCE_PLAYER].characters[aragornId]).toBeUndefined();
    expect(released.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === aragornId)).toBe(true);
  });

  // ─── 7. Only discards are intercepted, never eliminations ────────────────────

  test('an eliminated character is not captured (only discards are intercepted)', () => {
    const state = buildOrgWithPressGang([ARAGORN]);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const charInPlay = state.players[RESOURCE_PLAYER].characters[aragornId];

    const after = eliminateCharacter(state, RESOURCE_PLAYER, aragornId, charInPlay);

    // Eliminated → out-of-play pile, not captured off to the side.
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === aragornId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].characters[aragornId]).toBeUndefined();
    expect(pressedConstraint(after, aragornId)).toBeUndefined();
  });

  // ─── 8. Cannot be duplicated ─────────────────────────────────────────────────

  test('cannot be duplicated — a second copy is not offered while one is in play', () => {
    // A hero company (P1) moving; the hazard player (P2) holds Press-gang.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [PRESS_GANG], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mh = makeMHState({ activeCompanyIndex: 0, resolvedSitePath: [RegionType.Wilderness] });
    const state: GameState = { ...base, phaseState: mh };

    // With no copy in play, Press-gang is a legal hazard play.
    const offered = viableActions(state, PLAYER_2, 'play-hazard')
      .some(ea => (ea.action as { cardInstanceId?: unknown }).cardInstanceId
        === state.players[HAZARD_PLAYER].hand[0].instanceId);
    expect(offered).toBe(true);

    // With one already in play, the second is not offered (duplication-limit game).
    const withCopy = addCardInPlay(state, HAZARD_PLAYER, PRESS_GANG);
    const stillOffered = viableActions(withCopy, PLAYER_2, 'play-hazard')
      .some(ea => (ea.action as { cardInstanceId?: unknown }).cardInstanceId
        === withCopy.players[HAZARD_PLAYER].hand[0].instanceId);
    expect(stillOffered).toBe(false);
  });

  // Avatars can never be voluntarily discarded, so Press-gang never captures one
  // through the rule-3.22 path — a sanity guard that the fixture uses a real
  // avatar constant. (GANDALF is referenced to keep the shape self-documenting.)
  test('an avatar is never offered for voluntary discard (so is never pressed this way)', () => {
    const state = buildOrgWithPressGang([GANDALF, ARAGORN]);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const targets = viableActions(state, PLAYER_1, 'discard-character')
      .map(ea => (ea.action as DiscardCharacterOrgAction).characterInstanceId);
    expect(targets).not.toContain(gandalfId);
  });
});
