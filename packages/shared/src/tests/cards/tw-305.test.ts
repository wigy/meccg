/**
 * @module tw-305.test
 *
 * Card test: Praise to Elbereth (tw-305)
 * Type: hero-resource-event (short), alignment wizard, 0 MP
 *
 * Card text:
 *   "For each of your characters in play that you choose to tap (when this
 *    card is declared), cancel one Nazgûl event or one Nazgûl attack against
 *    that character's company. Nazgûl events discarded by Praise to Elbereth
 *    have no effect and Nazgûl permanent-events that are targeted by Praise
 *    to Elbereth may not be tapped in response to its play. Additionally, if
 *    Doors of Night is in play, characters gain +1 prowess until the end of
 *    the turn."
 *
 * Three independent pieces:
 *   1. `cancel-attack` (`cost: { tap: "character" }`, `when: { enemy.race:
 *      "ringwraith" }`) — any untapped character in the defending company may
 *      tap to cancel a live Nazgûl attack. Offered only during combat.
 *   2. `tap-discard-in-play` (`filter: { keywords: { $includes: "Nazgûl" } }`)
 *      — a repeatable "tap one of your own characters, discard one of the
 *      opponent's untapped Nazgûl permanent-events (the Nine, per Wizard's
 *      River-horses tw-364 precedent)" sub-flow, resolved with no chain entry
 *      so the opponent gets no window to tap the targeted Nazgûl in response.
 *   3. `on-event: self-enters-play` → `add-constraint` (`company-stat-modifier`,
 *      `target: "player"`), gated on Doors of Night, +1 prowess to every
 *      character the declaring player controls until end of turn.
 *
 * Playable: YES
 */

import { describe, test, expect } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, GANDALF, GIMLI, LEGOLAS,
  ORC_PATROL,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions,
  makeMHState,
  playCreatureHazardAndResolve,
  addCardInPlay,
  dispatch, resolveChain, findCharInstanceId, handCardId,
  expectInDiscardPile,
  CardStatus,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, TapDiscardInPlayAction, MovementHazardPhaseState } from '../../index.js';

const PRAISE_TO_ELBERETH = 'tw-305' as CardDefinitionId;
/** Adûnaphel — one of the Nine, in play in her permanent-event mode. On tap she taps any one character. */
const ADUNAPHEL = 'tw-2' as CardDefinitionId;
/** Ûvatha the Horseman — a second Nazgûl permanent-event, to prove "each" tapped character cancels one. */
const UVATHA = 'tw-107' as CardDefinitionId;
/** A hazard event *about* Nazgûl that is not itself one (no Nazgûl keyword) — must be left untouched. */
const NAZGUL_ARE_ABROAD = 'tw-96' as CardDefinitionId;
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId;

function baseState(
  hand: CardDefinitionId[] = [PRAISE_TO_ELBERETH],
  p2Hand: CardDefinitionId[] = [],
  mhOverrides: Partial<MovementHazardPhaseState> = {},
) {
  resetMint();
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF, ARAGORN, GIMLI] }], hand, siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: p2Hand, siteDeck: [RIVENDELL] },
    ],
  });
  return { ...state, phaseState: makeMHState({ destinationSiteName: 'Barad-dûr', ...mhOverrides }) };
}

/** M/H state resolving a path/destination that satisfies Adûnaphel's base keying (dark-hold site). */
const darkHoldMH: Partial<MovementHazardPhaseState> = {
  resolvedSitePath: [RegionType.Dark],
  resolvedSitePathNames: ['Gorgoroth'],
  destinationSiteType: SiteType.DarkHold,
  destinationSiteName: 'Barad-dûr',
};

/** M/H state resolving a path/destination that satisfies Orc-patrol's keying (wilderness). */
const wildernessMH: Partial<MovementHazardPhaseState> = {
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['Hithaeglir'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Moria',
};

describe('Praise to Elbereth (tw-305)', () => {
  // ─── Mode 1: cancel a Nazgûl attack ─────────────────────────────────────────

  test('cancel mode offered to any character (no skill/race requirement) against a Nazgûl attack', () => {
    const state = baseState([PRAISE_TO_ELBERETH], [ADUNAPHEL], darkHoldMH);
    const companyId = state.players[0].companies[0].id;
    const combatState = playCreatureHazardAndResolve(
      state, PLAYER_2, handCardId(state, HAZARD_PLAYER), companyId, { method: 'site-type', value: 'dark-hold' },
    );
    expect(combatState.combat).not.toBeNull();
    expect(combatState.combat!.creatureRace).toBe('ringwraith');

    const cancels = viableActions(combatState, PLAYER_1, 'cancel-attack');
    // One action per untapped character in the defending company (3), no
    // skill/race gate — unlike Concealment/Vanishment-style cards.
    const scouts = cancels.map(c => (c.action as { scoutInstanceId?: CardInstanceId }).scoutInstanceId);
    expect(scouts).toContain(findCharInstanceId(combatState, RESOURCE_PLAYER, GANDALF));
    expect(scouts).toContain(findCharInstanceId(combatState, RESOURCE_PLAYER, ARAGORN));
    expect(scouts).toContain(findCharInstanceId(combatState, RESOURCE_PLAYER, GIMLI));
  });

  test('cancelling a Nazgûl attack taps the chosen character, ends combat, and discards the card', () => {
    const state = baseState([PRAISE_TO_ELBERETH], [ADUNAPHEL], darkHoldMH);
    const companyId = state.players[0].companies[0].id;
    const combatState = playCreatureHazardAndResolve(
      state, PLAYER_2, handCardId(state, HAZARD_PLAYER), companyId, { method: 'site-type', value: 'dark-hold' },
    );
    const gimliId = findCharInstanceId(combatState, RESOURCE_PLAYER, GIMLI);
    const cancels = viableActions(combatState, PLAYER_1, 'cancel-attack');
    const chosen = cancels.find(c => (c.action as { scoutInstanceId?: CardInstanceId }).scoutInstanceId === gimliId)!;

    const after = resolveChain(dispatch(combatState, chosen.action));
    expect(after.combat).toBeNull();
    expect(after.players[0].characters[gimliId].status).toBe(CardStatus.Tapped);
    expect(after.players[0].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, PRAISE_TO_ELBERETH);
  });

  test('cancel mode NOT offered against a non-Nazgûl attack', () => {
    const state = baseState([PRAISE_TO_ELBERETH], [ORC_PATROL], wildernessMH);
    const companyId = state.players[0].companies[0].id;
    const combatState = playCreatureHazardAndResolve(
      state, PLAYER_2, handCardId(state, HAZARD_PLAYER), companyId, { method: 'region-type', value: 'wilderness' },
    );
    expect(combatState.combat).not.toBeNull();
    expect(viableActions(combatState, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  // ─── Mode 2: cancel Nazgûl events (tap-discard-in-play) ────────────────────

  test('tap-discard mode offered when an untapped Nazgûl permanent-event is in the opponent\'s play', () => {
    const state = addCardInPlay(baseState(), 1, ADUNAPHEL);
    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    expect(plays).toHaveLength(1);
  });

  test('NOT playable with no Nazgûl in play and Doors of Night not in play (CoE 9.1)', () => {
    const state = addCardInPlay(baseState(), 1, NAZGUL_ARE_ABROAD);
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('playing it resolves with no chain entry: tapping a character discards the target immediately', () => {
    const state = addCardInPlay(baseState(), 1, ADUNAPHEL);
    const declared = dispatch(state, viableActions(state, PLAYER_1, 'play-short-event')[0].action);

    // No chain entry: the response window the "may not be tapped in
    // response" clause forbids simply doesn't exist here.
    expect(declared.chain).toBeNull();
    expect(declared.pendingEffects).toHaveLength(1);
    expect(declared.pendingEffects[0].effect.type).toBe('tap-discard-in-play');
    // Adûnaphel is still in play — only the pick action discards it.
    expect(declared.players[1].cardsInPlay.some(c => c.definitionId === ADUNAPHEL)).toBe(true);

    const gandalfId = findCharInstanceId(declared, RESOURCE_PLAYER, GANDALF);
    const picks = viableActions(declared, PLAYER_1, 'tap-discard-in-play');
    const pick = picks.find(p => (p.action as TapDiscardInPlayAction).characterId === gandalfId)!;
    expect(pick).toBeDefined();

    const afterPick = dispatch(declared, pick.action);
    expect(afterPick.chain).toBeNull();
    expect(afterPick.players[0].characters[gandalfId].status).toBe(CardStatus.Tapped);
    expect(afterPick.players[1].cardsInPlay.some(c => c.definitionId === ADUNAPHEL)).toBe(false);
    expectInDiscardPile(afterPick, HAZARD_PLAYER, ADUNAPHEL);
    // Discarding a Nazgûl event this way has no effect: Adûnaphel's own
    // on-tap ability ("causes any one character to tap") never fired — no
    // OTHER character was tapped, and no resolution was enqueued for it.
    expect(afterPick.players[1].characters[findCharInstanceId(afterPick, HAZARD_PLAYER, LEGOLAS)].status).toBe(CardStatus.Untapped);
    expect(afterPick.pendingResolutions).toHaveLength(0);

    // The sub-flow is still open (more characters could tap).
    expect(afterPick.pendingEffects).toHaveLength(1);
  });

  test('for each character tapped, cancels one Nazgûl event: two taps discard two Nazgûl in one play', () => {
    let state = addCardInPlay(baseState(), 1, ADUNAPHEL);
    state = addCardInPlay(state, 1, UVATHA);
    const declared = dispatch(state, viableActions(state, PLAYER_1, 'play-short-event')[0].action);

    const gandalfId = findCharInstanceId(declared, RESOURCE_PLAYER, GANDALF);
    const aragornId = findCharInstanceId(declared, RESOURCE_PLAYER, ARAGORN);
    const adunaphelInstanceId = declared.players[1].cardsInPlay.find(c => c.definitionId === ADUNAPHEL)!.instanceId;
    const uvathaInstanceId = declared.players[1].cardsInPlay.find(c => c.definitionId === UVATHA)!.instanceId;

    const firstPicks = viableActions(declared, PLAYER_1, 'tap-discard-in-play');
    const firstPick = firstPicks.find(p => (p.action as TapDiscardInPlayAction).characterId === gandalfId
      && (p.action as TapDiscardInPlayAction).targetInstanceId === adunaphelInstanceId)!;
    const afterFirst = dispatch(declared, firstPick.action);

    const secondPicks = viableActions(afterFirst, PLAYER_1, 'tap-discard-in-play');
    const secondPick = secondPicks.find(p => (p.action as TapDiscardInPlayAction).characterId === aragornId
      && (p.action as TapDiscardInPlayAction).targetInstanceId === uvathaInstanceId)!;
    expect(secondPick).toBeDefined();
    const afterSecond = dispatch(afterFirst, secondPick.action);

    expect(afterSecond.players[1].cardsInPlay).toHaveLength(0);
    expectInDiscardPile(afterSecond, HAZARD_PLAYER, ADUNAPHEL);
    expectInDiscardPile(afterSecond, HAZARD_PLAYER, UVATHA);
    expect(afterSecond.players[0].characters[gandalfId].status).toBe(CardStatus.Tapped);
    expect(afterSecond.players[0].characters[aragornId].status).toBe(CardStatus.Tapped);
  });

  test('passing ends the sub-flow and discards the card', () => {
    const state = addCardInPlay(baseState(), 1, ADUNAPHEL);
    const declared = dispatch(state, viableActions(state, PLAYER_1, 'play-short-event')[0].action);

    const passActions = viableActions(declared, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
    const after = dispatch(declared, passActions[0].action);

    expect(after.pendingEffects).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, PRAISE_TO_ELBERETH);
    // Nothing was tapped/discarded on the opponent's side.
    expect(after.players[1].cardsInPlay.some(c => c.definitionId === ADUNAPHEL)).toBe(true);
  });

  // ─── Mode 3: Doors of Night prowess bonus ──────────────────────────────────

  test('Doors of Night in play: characters gain +1 prowess until end of turn', () => {
    let state = addCardInPlay(baseState(), 1, ADUNAPHEL);
    state = addCardInPlay(state, 1, DOORS_OF_NIGHT);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const before = state.players[0].characters[gandalfId].effectiveStats.prowess;

    const declared = dispatch(state, viableActions(state, PLAYER_1, 'play-short-event')[0].action);
    // Applied immediately (inline on-event resolution), not deferred to the
    // tap-discard sub-flow.
    expect(declared.players[0].characters[gandalfId].effectiveStats.prowess).toBe(before + 1);
    // Applies to every character the player controls, not just the one who
    // will end up tapping.
    const aragornId = findCharInstanceId(declared, RESOURCE_PLAYER, ARAGORN);
    const aragornBefore = state.players[0].characters[aragornId].effectiveStats.prowess;
    expect(declared.players[0].characters[aragornId].effectiveStats.prowess).toBe(aragornBefore + 1);
  });

  test('Doors of Night NOT in play: no prowess bonus', () => {
    const state = addCardInPlay(baseState(), 1, ADUNAPHEL);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const before = state.players[0].characters[gandalfId].effectiveStats.prowess;

    const declared = dispatch(state, viableActions(state, PLAYER_1, 'play-short-event')[0].action);
    expect(declared.players[0].characters[gandalfId].effectiveStats.prowess).toBe(before);
  });

  test('playable purely for the Doors of Night bonus with no Nazgûl event/attack available', () => {
    let state = addCardInPlay(baseState(), 1, NAZGUL_ARE_ABROAD);
    state = addCardInPlay(state, 1, DOORS_OF_NIGHT);
    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    expect(plays).toHaveLength(1);

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const before = state.players[0].characters[gandalfId].effectiveStats.prowess;
    const declared = dispatch(state, plays[0].action);
    expect(declared.players[0].characters[gandalfId].effectiveStats.prowess).toBe(before + 1);

    // No valid tap-discard target exists — only pass is offered, and passing
    // simply discards the spent card.
    expect(viableActions(declared, PLAYER_1, 'tap-discard-in-play')).toHaveLength(0);
    const after = dispatch(declared, viableActions(declared, PLAYER_1, 'pass')[0].action);
    expectInDiscardPile(after, RESOURCE_PLAYER, PRAISE_TO_ELBERETH);
  });
});
