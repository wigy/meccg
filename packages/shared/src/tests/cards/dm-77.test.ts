/**
 * @module dm-77.test
 *
 * Card test: Out of the Black Sky (dm-77)
 * Type: hazard-event (permanent), non-unique
 * Marshalling points: 5, kill category
 * Effects: 2
 *   - play-condition requires:"card-in-play" cardName:"Doors of Night"
 *   - nazgul-permanent-event-attack
 *
 * Card text:
 *   "Playable if Doors of Night is in play on a Nazgûl permanent-event that
 *    could immediately attack as if it were in your hand as a creature. The
 *    Nazgûl immediately attacks as a creature from its permanent-event state
 *    (not counting against the hazard limit) and chooses defending
 *    characters. If the Nazgûl is defeated, place this card in opponent's
 *    marshalling point pile and remove the Nazgûl from play. Otherwise,
 *    discard this card. This can be used on an opponent's Nazgûl
 *    permanent-event as well as on your own."
 *
 * Mechanic (nazgul-permanent-event-attack effect, engine/legal-actions/movement-hazard.ts
 * `nazgulPermanentEventAttackActions`, engine/mh-hazard-play.ts `handleAttackNazgulPermanentEvent`):
 *   Scans BOTH players' cardsInPlay for Nazgûl permanent-events
 *   (isNazgulPermanentEvent) and offers one `attack-nazgul-permanent-event`
 *   action per keyable candidate. The targeted Nazgûl is never removed from
 *   its owner's cardsInPlay at play time — it attacks "in place" (a new
 *   `nazgul-permanent-event-attack` AttackSource/ChainEntryPayload), and the
 *   attack forces attacker-chooses-defenders unconditionally. The play does
 *   NOT count against the hazard limit. Disposal (combat-finalize.ts) is the
 *   reverse of a normal creature: on full defeat, the Nazgûl is moved to its
 *   owner's outOfPlayPile ("removed from play" — no kill-MP for its own
 *   printed value) and the triggering event card moves from its resting
 *   discard pile to the defending player's kill pile, awarding its OWN
 *   printed kill-MP (5). An undefeated attack leaves both cards exactly where
 *   they already are.
 *
 * Engine Support:
 * | # | Rule                                                          | Status |
 * |---|-----------------------------------------------------------------|--------|
 * | 1 | Requires Doors of Night in play                                 | IMPL   |
 * | 2 | Offered for a keyable Nazgûl permanent-event, own cardsInPlay    | IMPL   |
 * | 3 | Also offered for opponent's Nazgûl permanent-event               | IMPL   |
 * | 4 | Not offered when target cannot be keyed                          | IMPL   |
 * | 5 | Attack initiated with creature's own stats, attacker chooses defenders | IMPL |
 * | 6 | Does not count against the hazard limit                          | IMPL   |
 * | 7 | Defeat: Nazgûl removed from play; card awards its own kill-MP to defender | IMPL |
 * | 8 | Survival: Nazgûl remains in play; card stays discarded, no MP     | IMPL   |
 *
 * Fixtures:
 *   - WITCH_KING (tw-113): Nazgûl (ringwraith), 17 prowess, 12 body, kill MP 6.
 *     Keyed to Dark-domain [{d}]/Dark-hold [{D}] or named regions.
 *   - KHAMUL (tw-47): Nazgûl (ringwraith), 18 prowess, 8 body, kill MP 6. Same
 *     keying shape as Witch-king; used for the full-defeat test because its
 *     low body (8) is reachable by a maximum (12) cheat roll.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  buildTestState, resetMint, addCardInPlay,
  viableActions, dispatch, resolveChain,
  makeMHState, makeWildernessMHState,
  attachItemToChar, findCharInstanceId, findInPile,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  DOORS_OF_NIGHT,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import { reduce } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, MovementHazardPhaseState } from '../../index.js';

const OUT_OF_THE_BLACK_SKY = 'dm-77' as CardDefinitionId;
const WITCH_KING = 'tw-113' as CardDefinitionId;
const KHAMUL = 'tw-47' as CardDefinitionId;
const SWORD_OF_GONDOLIN = 'tw-336' as CardDefinitionId;

/** MH state describing arrival at a Dark-hold via a Dark-domain region — keys Witch-king/Khamûl. */
function makeDarkMHState(overrides?: Partial<MovementHazardPhaseState>): MovementHazardPhaseState {
  return makeMHState({
    resolvedSitePath: [RegionType.Dark],
    resolvedSitePathNames: ['Udûn'],
    destinationSiteType: SiteType.DarkHold,
    destinationSiteName: 'Barad-dûr',
    ...overrides,
  });
}

/** Active (resource) company at MORIA; hazard player holds dm-77 in hand. */
function setup(mh: MovementHazardPhaseState): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [OUT_OF_THE_BLACK_SKY], siteDeck: [RIVENDELL] },
    ],
  });
  return { ...state, phaseState: mh };
}

/** Resolves a pending body-check, if any, trying whichever side is offered it. */
function resolveBodyCheckIfPending(s: GameState, roll: number): GameState {
  if (s.combat?.phase !== 'body-check') return s;
  const cheated = { ...s, cheatRollTotal: roll } as GameState;
  const action = viableActions(cheated, PLAYER_1, 'body-check-roll')[0]?.action
    ?? viableActions(cheated, PLAYER_2, 'body-check-roll')[0]?.action;
  if (!action) return s;
  return dispatch(cheated, action);
}

describe('Out of the Black Sky (dm-77)', () => {
  beforeEach(() => resetMint());

  // ─── play-condition: card-in-play (Doors of Night) ────────────────────────

  test('NOT playable without Doors of Night in play, even with a keyable Nazgûl in cardsInPlay', () => {
    let state = setup(makeDarkMHState());
    state = addCardInPlay(state, HAZARD_PLAYER, WITCH_KING);
    expect(viableActions(state, PLAYER_2, 'attack-nazgul-permanent-event')).toHaveLength(0);
  });

  test("playable once Doors of Night is in play, targeting the hazard player's own Nazgûl", () => {
    let state = setup(makeDarkMHState());
    state = addCardInPlay(state, HAZARD_PLAYER, WITCH_KING);
    state = addCardInPlay(state, RESOURCE_PLAYER, DOORS_OF_NIGHT);
    const nazgulId = state.players[HAZARD_PLAYER].cardsInPlay[0].instanceId;

    const actions = viableActions(state, PLAYER_2, 'attack-nazgul-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
    for (const { action } of actions) {
      expect((action as { targetNazgulInstanceId: CardInstanceId }).targetNazgulInstanceId).toBe(nazgulId);
      expect((action as { targetNazgulOwnerId: string }).targetNazgulOwnerId).toBe(PLAYER_2);
    }
  });

  // ─── either player's Nazgûl ────────────────────────────────────────────────

  test("also playable targeting the opponent's (resource player's) Nazgûl permanent-event", () => {
    let state = setup(makeDarkMHState());
    state = addCardInPlay(state, RESOURCE_PLAYER, WITCH_KING);
    state = addCardInPlay(state, RESOURCE_PLAYER, DOORS_OF_NIGHT);
    const nazgulId = state.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === WITCH_KING)!.instanceId;

    const actions = viableActions(state, PLAYER_2, 'attack-nazgul-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
    for (const { action } of actions) {
      expect((action as { targetNazgulInstanceId: CardInstanceId }).targetNazgulInstanceId).toBe(nazgulId);
      expect((action as { targetNazgulOwnerId: string }).targetNazgulOwnerId).toBe(PLAYER_1);
    }
  });

  // ─── keying check ───────────────────────────────────────────────────────────

  test('not offered when the target Nazgûl cannot be keyed (wrong region)', () => {
    let state = setup(makeWildernessMHState());
    state = addCardInPlay(state, HAZARD_PLAYER, WITCH_KING);
    state = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    expect(viableActions(state, PLAYER_2, 'attack-nazgul-permanent-event')).toHaveLength(0);
  });

  // ─── does not count against the hazard limit ───────────────────────────────

  test('does not count against the hazard limit (offered when limit reached; counter unchanged)', () => {
    let state = setup(makeDarkMHState({ hazardsPlayedThisCompany: 4, hazardLimitAtReveal: 4 }));
    state = addCardInPlay(state, HAZARD_PLAYER, WITCH_KING);
    state = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);

    const actions = viableActions(state, PLAYER_2, 'attack-nazgul-permanent-event');
    expect(actions.length).toBeGreaterThan(0);

    const afterPlay = dispatch(state, actions[0].action);
    expect((afterPlay.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(4);
  });

  // ─── attack initiation: own stats, attacker chooses defenders ──────────────

  test("triggers the Nazgûl into combat with its own printed stats and 'attacker chooses defenders'", () => {
    let state = setup(makeDarkMHState());
    state = addCardInPlay(state, HAZARD_PLAYER, WITCH_KING);
    state = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const nazgulId = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === WITCH_KING)!.instanceId;

    const actions = viableActions(state, PLAYER_2, 'attack-nazgul-permanent-event');
    const afterPlay = dispatch(state, actions[0].action);
    const afterChain = resolveChain(afterPlay);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(17);
    expect(afterChain.combat!.creatureBody).toBe(12);
    expect(afterChain.combat!.attackerChoosesDefenders).toBe(true);
    // The Nazgûl is still sitting in its owner's cardsInPlay (never moved at initiation).
    expect(afterChain.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === nazgulId)).toBe(true);
  });

  test('event card is discarded from hand on play (before the outcome is known)', () => {
    let state = setup(makeDarkMHState());
    state = addCardInPlay(state, HAZARD_PLAYER, WITCH_KING);
    state = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const eventId = state.players[HAZARD_PLAYER].hand[0].instanceId;

    const actions = viableActions(state, PLAYER_2, 'attack-nazgul-permanent-event');
    const afterPlay = dispatch(state, actions[0].action);

    const p2 = afterPlay.players[HAZARD_PLAYER];
    expect(p2.hand.some(c => c.instanceId === eventId)).toBe(false);
    expect(p2.discardPile.some(c => c.instanceId === eventId)).toBe(true);
  });

  // ─── disposal: defeat vs survival ───────────────────────────────────────────

  /** Plays dm-77 on the given Nazgûl and advances to the attacker's strike-assignment phase. */
  function reachAttackerAssignment(state: GameState): GameState {
    const actions = viableActions(state, PLAYER_2, 'attack-nazgul-permanent-event');
    const afterPlay = dispatch(state, actions[0].action);
    const afterChain = resolveChain(afterPlay);
    expect(afterChain.combat!.assignmentPhase).toBe('cancel-window');
    const afterCancel = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    expect(afterCancel.combat!.assignmentPhase).toBe('attacker');
    return afterCancel;
  }

  test("defeated: Nazgûl removed from play (owner's outOfPlayPile); card awards its OWN kill-MP to the defender", () => {
    let state = setup(makeDarkMHState());
    state = addCardInPlay(state, HAZARD_PLAYER, KHAMUL);
    state = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, SWORD_OF_GONDOLIN);
    const eventId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    const nazgulId = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === KHAMUL)!.instanceId;

    let s = reachAttackerAssignment(state);
    const aragornId = findCharInstanceId(s, RESOURCE_PLAYER, ARAGORN);
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: aragornId });

    // Aragorn prowess 6 + Sword of Gondolin +2 = 8; roll 12 → 20 > 18 (Khamûl's
    // prowess) beats the strike outright (an 18-18 tie would NOT defeat it).
    const resolveActions = viableActions({ ...s, cheatRollTotal: 12 } as GameState, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    const tapAction = resolveActions.find(a => 'tapToFight' in a.action && (a.action as { tapToFight: boolean }).tapToFight)?.action
      ?? resolveActions[0].action;
    let result = reduce({ ...s, cheatRollTotal: 12 } as GameState, tapAction);
    expect(result.error).toBeUndefined();

    // Creature body check: roll 12 > Khamûl's body 8 → body check fails → strike defeated.
    let final = result.state;
    while (final.combat !== null && final.combat.phase === 'body-check') {
      final = resolveBodyCheckIfPending(final, 12);
    }
    expect(final.combat).toBeNull();

    // Khamûl is removed from play — its owner's outOfPlayPile, never a kill pile.
    expect(final.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === nazgulId)).toBe(false);
    expect(findInPile(final, HAZARD_PLAYER, 'outOfPlayPile', nazgulId)).toBeDefined();
    expect(findInPile(final, RESOURCE_PLAYER, 'killPile', nazgulId)).toBeUndefined();
    expect(findInPile(final, HAZARD_PLAYER, 'killPile', nazgulId)).toBeUndefined();

    // Out of the Black Sky itself moves to the defending player's kill pile,
    // awarding its OWN printed 5 kill-MP — not Khamûl's printed 6.
    expect(findInPile(final, RESOURCE_PLAYER, 'killPile', eventId)).toBeDefined();
    expect(final.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === eventId)).toBe(false);
    expect(final.players[RESOURCE_PLAYER].marshallingPoints.kill).toBe(5);
  });

  test('not defeated: Nazgûl remains in play; the event card stays discarded (no marshalling points)', () => {
    let state = setup(makeDarkMHState());
    state = addCardInPlay(state, HAZARD_PLAYER, WITCH_KING);
    state = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const eventId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    const nazgulId = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === WITCH_KING)!.instanceId;

    let s = reachAttackerAssignment(state);
    const aragornId = findCharInstanceId(s, RESOURCE_PLAYER, ARAGORN);
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: aragornId });

    // Not-tap-to-fight: Aragorn fights at his printed prowess only (no dice
    // bonus) — far below Witch-king's 17 prowess, so the strike auto-fails
    // (Aragorn is wounded).
    const resolveActions = viableActions(s, PLAYER_1, 'resolve-strike');
    const notTapAction = resolveActions.find(a => 'tapToFight' in a.action && !(a.action as { tapToFight: boolean }).tapToFight)?.action;
    expect(notTapAction).toBeDefined();
    let result = reduce(s, notTapAction!);
    expect(result.error).toBeUndefined();

    // Aragorn's own body check (a generous roll keeps him wounded, not eliminated).
    let final = result.state;
    while (final.combat !== null && final.combat.phase === 'body-check') {
      final = resolveBodyCheckIfPending(final, 12);
    }
    expect(final.combat).toBeNull();

    // Witch-king remains in the hazard player's cardsInPlay, untouched.
    expect(final.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === nazgulId)).toBe(true);
    // Out of the Black Sky stays discarded — no marshalling points to anyone.
    expect(final.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === eventId)).toBe(true);
    expect(findInPile(final, RESOURCE_PLAYER, 'killPile', eventId)).toBeUndefined();
    expect(final.players[RESOURCE_PLAYER].marshallingPoints.kill).toBe(0);
  });
});
