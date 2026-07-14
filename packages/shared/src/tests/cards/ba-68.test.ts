/**
 * @module ba-68.test
 *
 * Card test: Mine or No One's (ba-68)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0. Balrog specific.
 *
 * Text:
 *   "Balrog specific. +10 to an influence attempt by The Balrog against an
 *    opponent's: item, ally, Troll faction, or Orc faction. Cannot be
 *    duplicated on a given attempt."
 *
 * Implementation:
 *   - `play-target` character filtered to The Balrog (by name).
 *   - `play-option influence-boost` adds a one-shot `check-modifier`
 *     (check "influence", +10) constraint on The Balrog, carrying a
 *     `constraintWhen` gating it to an *opponent-influence* attempt
 *     (`reason: "opponent-influence-check"`) against an item, ally, or
 *     Orc/Troll faction. The +10 is collected and consumed by the
 *     opponent-influence declaration (never by an ordinary faction-influence
 *     roll, whose one-shot boosters carry no `when`).
 *   - `duplication-limit` scope "active-check": "Cannot be duplicated on a
 *     given attempt" — a second copy is not offered once one is applied.
 *
 * This card also relies on newly added engine support for influencing an
 * opponent's **item** (CoE rule 8.1/8.3), exercised below.
 *
 * Rule coverage:
 * | # | Rule                                                                 | Status      |
 * |---|----------------------------------------------------------------------|-------------|
 * | 1 | Playing the boost adds a +10 opponent-influence check-modifier       | IMPLEMENTED |
 * | 2 | +10 applies to an opponent-influence attempt vs an ally              | IMPLEMENTED |
 * | 3 | +10 applies vs an Orc faction                                        | IMPLEMENTED |
 * | 4 | +10 applies vs an item (identical item reveal)                       | IMPLEMENTED |
 * | 5 | +10 does NOT apply vs a character (constraint not consumed)          | IMPLEMENTED |
 * | 6 | The +10 turns a failing attempt into a success (target discarded)    | IMPLEMENTED |
 * | 7 | Item influence: not offered without an identical item in hand        | IMPLEMENTED |
 * | 8 | Item influence: item discarded on success; reveal returns to hand    | IMPLEMENTED |
 * | 9 | Cannot be duplicated on a given attempt                              | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   MINE_OR_NO_ONES (ba-68) - this card
 *   THE_BALROG (ba-3)       - balrog avatar, name "The Balrog", DI 6
 *   LUITPRAND (le-23)       - minion man, mind 1, DI 0 (opponent target holder)
 *   WAR_WOLF (le-157)       - minion ally, mind 1
 *   WHIP (le-348)           - minion minor item
 *   ORCS_OF_MORIA (le-278)  - minion orc faction, influence# 11, playable at Moria
 *   MORIA                   - ruins & lairs site (both companies here)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeSitePhase,
  attachAllyToChar, attachItemToChar, addCardInPlay, addCardToHand,
  dispatch, dispatchResult, resolveChain, viableActions,
  findCharInstanceId, findHandCardId,
  expectInDiscardPile, expectNotInHand,
  MORIA, LORIEN, MINAS_TIRITH,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER, Phase, Alignment,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, GameState, OpponentInfluenceAttemptAction } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const MINE_OR_NO_ONES = 'ba-68' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId;
const LUITPRAND = 'le-23' as CardDefinitionId;   // mind 1, DI 0
const NEVIDO = 'le-27' as CardDefinitionId;       // mind 4 filler (fixes opponent GI at 15)
const WAR_WOLF = 'le-157' as CardDefinitionId;
const WHIP = 'le-348' as CardDefinitionId;
const ORCS_OF_MORIA = 'le-278' as CardDefinitionId;

let base: GameState;

/** Locate the opponent-influence-attempt action for a given target instance. */
function attemptFor(state: GameState, targetInstanceId: CardInstanceId, kind: OpponentInfluenceAttemptAction['targetKind']) {
  const acts = viableActions(state, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
  return acts.find(a => a.action.targetKind === kind && a.action.targetInstanceId === targetInstanceId)?.action;
}

/** Play Mine or No One's on The Balrog and resolve the chain (both pass). */
function playBoost(state: GameState): GameState {
  const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
  const offers = computeLegalActions(state, PLAYER_1)
    .filter(ea => ea.viable && ea.action.type === 'play-short-event'
      && (ea.action as { optionId?: string }).optionId === 'influence-boost'
      && (ea.action as { targetCharacterId?: CardInstanceId }).targetCharacterId === balrogId);
  expect(offers).toHaveLength(1);
  return resolveChain(dispatch(state, offers[0].action));
}

describe("Mine or No One's (ba-68)", () => {
  beforeEach(() => {
    resetMint();
    let state = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Balrog,
          companies: [{ site: MORIA, characters: [THE_BALROG] }],
          hand: [MINE_OR_NO_ONES, WHIP],
          siteDeck: [MINAS_TIRITH],
        },
        {
          // Luitprand (mind 1) + Nevido (mind 4) → 5 mind under GI, so the
          // opponent's unused general influence is a fixed 15 (20 − 5). This is
          // recompute-stable (unlike a manually-patched generalInfluenceUsed).
          id: PLAYER_2, alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA, characters: [LUITPRAND, NEVIDO] }],
          hand: [],
          siteDeck: [LORIEN],
        },
      ],
      phase: Phase.Site,
    });
    // Give Luitprand an ally and an item to influence, and put an Orc faction in play.
    state = attachAllyToChar(state, HAZARD_PLAYER, LUITPRAND, WAR_WOLF);
    state = attachItemToChar(state, HAZARD_PLAYER, LUITPRAND, WHIP);
    state = addCardInPlay(state, HAZARD_PLAYER, ORCS_OF_MORIA);
    state = { ...state, turnNumber: 3, phaseState: makeSitePhase() };
    base = state;
  });

  function allyId(state: GameState): CardInstanceId {
    const luit = findCharInstanceId(state, HAZARD_PLAYER, LUITPRAND);
    return state.players[HAZARD_PLAYER].characters[luit].allies[0].instanceId;
  }
  function itemId(state: GameState): CardInstanceId {
    const luit = findCharInstanceId(state, HAZARD_PLAYER, LUITPRAND);
    return state.players[HAZARD_PLAYER].characters[luit].items[0].instanceId;
  }
  function factionId(state: GameState): CardInstanceId {
    return state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === ORCS_OF_MORIA)!.instanceId;
  }

  test('playing the boost adds a +10 opponent-influence check-modifier on The Balrog', () => {
    const boosted = playBoost(base);
    const balrogId = findCharInstanceId(boosted, RESOURCE_PLAYER, THE_BALROG);
    const constraints = boosted.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(constraints).toHaveLength(1);
    const k = constraints[0].kind;
    expect(k.type).toBe('check-modifier');
    if (k.type === 'check-modifier') {
      expect(k.value).toBe(10);
      // The constraint must be gated to opponent-influence (not a bare booster).
      expect(k.when).toBeDefined();
    }
    expect(constraints[0].target.kind).toBe('character');
    if (constraints[0].target.kind === 'character') {
      expect(constraints[0].target.characterId).toBe(balrogId);
    }
    const ba68 = findHandCardId(base, RESOURCE_PLAYER, MINE_OR_NO_ONES);
    expectInDiscardPile(boosted, RESOURCE_PLAYER, ba68);
  });

  test('+10 applies to an opponent-influence attempt against an ally', () => {
    const boosted = playBoost(base);
    const attempt = attemptFor(boosted, allyId(boosted), 'ally');
    expect(attempt).toBeDefined();
    const result = dispatchResult(boosted, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    expect(pending).toBeDefined();
    if (pending?.kind.type !== 'opponent-influence-defend') return;
    expect(pending.kind.attempt.boostModifier).toBe(10);
    // The one-shot constraint is consumed by the attempt.
    expect(result.state.activeConstraints.some(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    )).toBe(false);
  });

  test('+10 applies to an opponent-influence attempt against an Orc faction', () => {
    const boosted = playBoost(base);
    const attempt = attemptFor(boosted, factionId(boosted), 'faction');
    expect(attempt).toBeDefined();
    const result = dispatchResult(boosted, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no pending');
    expect(pending.kind.attempt.boostModifier).toBe(10);
  });

  test('+10 applies to an opponent-influence attempt against an item (identical item revealed)', () => {
    const boosted = playBoost(base);
    const attempt = attemptFor(boosted, itemId(boosted), 'item');
    expect(attempt).toBeDefined();
    // Item influence requires revealing an identical item from hand.
    expect(attempt!.revealedCardInstanceId).toBeDefined();
    const result = dispatchResult(boosted, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no pending');
    expect(pending.kind.attempt.boostModifier).toBe(10);
  });

  test('+10 does NOT apply to an opponent-influence attempt against a character', () => {
    const boosted = playBoost(base);
    const luit = findCharInstanceId(boosted, HAZARD_PLAYER, LUITPRAND);
    const attempt = attemptFor(boosted, luit, 'character');
    expect(attempt).toBeDefined();
    const result = dispatchResult(boosted, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no pending');
    expect(pending.kind.attempt.boostModifier ?? 0).toBe(0);
    // The constraint is left in place for a qualifying attempt — not consumed.
    expect(result.state.activeConstraints.some(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    )).toBe(true);
  });

  test('the +10 turns a failing ally influence into a success (ally discarded)', () => {
    // Balrog DI 6, opponent GI 15, controller (Luitprand) DI 0, ally mind 1.
    // attacker roll 12, defender roll 2 → base result 1 (fail: not > 1);
    // with +10 → 11 (success).
    const boosted = { ...playBoost(base), cheatRollTotal: 12 };
    const ally = allyId(boosted);
    const attempt = attemptFor(boosted, ally, 'ally')!;
    const afterAttack = dispatchResult(boosted, attempt);
    expect(afterAttack.error).toBeUndefined();
    // Force the defender's roll low, then resolve the defense.
    const readyToDefend = { ...afterAttack.state, cheatRollTotal: 2 };
    const defend = viableActions(readyToDefend, PLAYER_2, 'opponent-influence-defend');
    expect(defend).toHaveLength(1);
    const resolved = dispatch(readyToDefend, defend[0].action);
    // Success — the War-wolf ally leaves Luitprand and hits the discard pile.
    const luit = findCharInstanceId(resolved, HAZARD_PLAYER, LUITPRAND);
    expect(resolved.players[HAZARD_PLAYER].characters[luit].allies).toHaveLength(0);
    expectInDiscardPile(resolved, HAZARD_PLAYER, ally);
  });

  test('without the boost the same ally influence fails (ally survives)', () => {
    const state = { ...base, cheatRollTotal: 12 };
    const ally = allyId(state);
    const attempt = attemptFor(state, ally, 'ally')!;
    const afterAttack = dispatchResult(state, attempt);
    expect(afterAttack.error).toBeUndefined();
    const readyToDefend = { ...afterAttack.state, cheatRollTotal: 2 };
    const defend = viableActions(readyToDefend, PLAYER_2, 'opponent-influence-defend');
    const resolved = dispatch(readyToDefend, defend[0].action);
    const luit = findCharInstanceId(resolved, HAZARD_PLAYER, LUITPRAND);
    expect(resolved.players[HAZARD_PLAYER].characters[luit].allies).toHaveLength(1);
  });

  test('item influence is not offered without an identical item in the influencer hand', () => {
    // Remove the Whip from The Balrog's hand: item influence needs the reveal.
    const noReveal: GameState = {
      ...base,
      players: base.players.map((p, i) =>
        i === RESOURCE_PLAYER ? { ...p, hand: p.hand.filter(c => c.definitionId !== WHIP) } : p,
      ) as unknown as typeof base.players,
    };
    const item = itemId(noReveal);
    expect(attemptFor(noReveal, item, 'item')).toBeUndefined();
    // The other target kinds are still available.
    expect(attemptFor(noReveal, allyId(noReveal), 'ally')).toBeDefined();
  });

  test('item influence on success discards the item and returns the revealed item to hand', () => {
    const boosted = { ...playBoost(base), cheatRollTotal: 12 };
    const item = itemId(boosted);
    const attempt = attemptFor(boosted, item, 'item')!;
    const revealedId = attempt.revealedCardInstanceId!;
    const afterAttack = dispatchResult(boosted, attempt);
    expect(afterAttack.error).toBeUndefined();
    // Reveal left the attacker's hand at declaration.
    expectNotInHand(afterAttack.state, RESOURCE_PLAYER, revealedId);
    const readyToDefend = { ...afterAttack.state, cheatRollTotal: 2 };
    const defend = viableActions(readyToDefend, PLAYER_2, 'opponent-influence-defend');
    const resolved = dispatch(readyToDefend, defend[0].action);
    // Success (Luitprand mind 1): the Whip is discarded from Luitprand.
    const luit = findCharInstanceId(resolved, HAZARD_PLAYER, LUITPRAND);
    expect(resolved.players[HAZARD_PLAYER].characters[luit].items).toHaveLength(0);
    expectInDiscardPile(resolved, HAZARD_PLAYER, item);
    // The un-played revealed item returns to the attacker's hand (rule 8.4).
    expect(resolved.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === revealedId)).toBe(true);
  });

  test('cannot be duplicated on a given attempt — no second boost offered once applied', () => {
    const boosted = playBoost(base);
    const balrogId = findCharInstanceId(boosted, RESOURCE_PLAYER, THE_BALROG);
    // A second copy would need to be in hand; add one and confirm it is not offered.
    const withSecond = addCardToHand(boosted, RESOURCE_PLAYER, MINE_OR_NO_ONES);
    const offers = computeLegalActions(withSecond, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && (ea.action as { optionId?: string }).optionId === 'influence-boost'
        && (ea.action as { targetCharacterId?: CardInstanceId }).targetCharacterId === balrogId);
    expect(offers).toHaveLength(0);
  });
});
