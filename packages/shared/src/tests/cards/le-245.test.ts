/**
 * @module le-245.test
 *
 * Card test: Tidings of Death (le-245)
 * Type: minion-resource-event, Long-event, alignment dual, non-unique.
 *
 * Text:
 *   "-1 to each influence check against a faction, but for each influence
 *    check make an additional roll and choose which result to use. May also be
 *    played as a hero resource."
 *
 * Effects:
 * - `check-modifier` influence -1, `target: "all-in-play"`, gated on
 *   `influenceTarget.kind: "faction"` — a long-event resolves bare into its
 *   player's play area and its text reaches "each influence check against a
 *   faction", by either player, whether the faction is being played or is an
 *   opponent's faction in play.
 * - `check-extra-roll` influence, same gate — every such check is rolled twice
 *   and the better total is kept (a higher influence total is never worse, so
 *   "choose which result to use" always picks the higher roll). The dice-roll
 *   effect carries both pairs (kept pair + `alternateRoll`).
 * - "May also be played as a hero resource" is the card's `alignment: "dual"`:
 *   the long-event phase offers it to a Wizard player as well as a Ringwraith.
 *
 * Rule coverage:
 * | # | Rule                                                                   | Status      |
 * |---|------------------------------------------------------------------------|-------------|
 * | 1 | Playable as a minion long-event (Ringwraith player)                    | IMPLEMENTED |
 * | 2 | "May also be played as a hero resource" (Wizard player)                | IMPLEMENTED |
 * | 3 | -1 to a faction influence check, either player's copy                  | IMPLEMENTED |
 * | 4 | Additional roll on a faction influence check, better result kept       | IMPLEMENTED |
 * | 5 | The additional roll can rescue a failing first roll                    | IMPLEMENTED |
 * | 6 | The -1 bites at resolution when neither roll is high enough            | IMPLEMENTED |
 * | 7 | -1 and additional roll on an influence attempt vs an opponent's faction | IMPLEMENTED |
 * | 8 | Not applied to an influence attempt against a non-faction (character)  | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint, makeSitePhase, addCardInPlay,
  firstFactionInfluenceAttempt, firstOpponentInfluenceAttempt,
  viableActions, dispatch, dispatchResult, resolveChain, reduce, findHandCardId,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Phase, Alignment, CardStatus, createRng } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameState, GameEffect,
  FactionInfluenceRollAction,
} from '../../index.js';

const TIDINGS = 'le-245' as CardDefinitionId;

// Bergil is a Dúnadan with 0 direct influence and no effects, so the faction's
// printed influence number is the whole need.
const BERGIL = 'tw-129' as CardDefinitionId;
const WOODMEN = 'tw-368' as CardDefinitionId;       // Man faction, influence # 8
const WOODMEN_TOWN = 'tw-438' as CardDefinitionId;  // its playable site

// Minion fixtures for the long-event play.
const THE_MOUTH = 'le-24' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

type DiceEffect = Extract<GameEffect, { effect: 'dice-roll' }>;

/** Long-event phase with Tidings of Death in P1's hand. */
const longEventState = (alignment: Alignment): GameState => buildTestState({
  activePlayer: PLAYER_1,
  phase: Phase.LongEvent,
  recompute: true,
  players: [
    alignment === Alignment.Ringwraith
      ? { id: PLAYER_1, alignment, companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }], hand: [TIDINGS], siteDeck: [DOL_GULDUR] }
      : { id: PLAYER_1, alignment, companies: [{ site: LORIEN, characters: [BERGIL] }], hand: [TIDINGS], siteDeck: [MINAS_TIRITH] },
    { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
  ],
});

/** Site phase: Bergil at Woodmen-town with Woodmen in hand; Tidings optionally in `owner`'s play area. */
const factionPlayState = (owner?: 0 | 1): GameState => {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: WOODMEN_TOWN, characters: [BERGIL] }], hand: [WOODMEN], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  const withPhase = { ...base, phaseState: makeSitePhase() };
  return owner === undefined ? withPhase : addCardInPlay(withPhase, owner, TIDINGS);
};

/** Declare the Woodmen influence attempt and pass the chain to the paused roll. */
const toFactionRoll = (state: GameState): { cur: GameState; roll: FactionInfluenceRollAction } => {
  const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
  const attempt = firstFactionInfluenceAttempt(state, factionInst);
  expect(attempt).toBeDefined();
  const cur = resolveChain(dispatch(state, attempt!));
  const rolls = viableActions(cur, PLAYER_1, 'faction-influence-roll');
  expect(rolls).toHaveLength(1);
  return { cur, roll: rolls[0].action as FactionInfluenceRollAction };
};

const diceEffect = (effects: readonly GameEffect[] | undefined): DiceEffect => {
  const e = (effects ?? []).find(x => x.effect === 'dice-roll');
  if (!e) throw new Error('no dice-roll effect');
  return e;
};

const sum = (r: { die1: number; die2: number }) => r.die1 + r.die2;

/**
 * Resolve the faction-influence roll with the first roll forced to `first`,
 * scanning RNG seeds until the additional (second) roll satisfies `want`.
 */
const resolveFactionRoll = (cur: GameState, roll: FactionInfluenceRollAction, first: number, want: (second: number) => boolean) => {
  for (let seed = 1; seed < 500; seed++) {
    const result = reduce({ ...cur, rng: createRng(seed), cheatRollTotal: first }, roll);
    expect(result.error).toBeUndefined();
    const dice = diceEffect(result.effects);
    const pairs = [sum(dice), sum(dice.alternateRoll!)];
    const second = pairs[0] === first ? pairs[1] : pairs[0];
    if (want(second)) return { result, dice };
  }
  throw new Error('no seed produced the wanted additional roll');
};

/** Site phase: P2 controls Woodmen at Woodmen-town, P1's Bergil may reach for it or for Legolas. */
const reInfluenceState = (withTidings: boolean): { state: GameState; factionId: CardInstanceId; legolasId: CardInstanceId } => {
  const faction: CardInPlay = { instanceId: 'faction-1' as CardInstanceId, definitionId: WOODMEN, status: CardStatus.Untapped };
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: WOODMEN_TOWN, characters: [BERGIL] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: WOODMEN_TOWN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [faction] },
    ],
  });
  const withPhase = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };
  return {
    state: withTidings ? addCardInPlay(withPhase, 1, TIDINGS) : withPhase,
    factionId: faction.instanceId,
    legolasId: withPhase.players[1].companies[0].characters[0],
  };
};

describe('Tidings of Death (le-245)', () => {
  beforeEach(() => resetMint());

  // ─── #1–#2: playable by either alignment ──────────────────────────────────

  for (const alignment of [Alignment.Ringwraith, Alignment.Wizard]) {
    test(`playable as a long-event by a ${alignment} player and resolves into play`, () => {
      const state = longEventState(alignment);
      const tidingsId = findHandCardId(state, RESOURCE_PLAYER, TIDINGS);
      const plays = viableActions(state, PLAYER_1, 'play-long-event')
        .filter(ea => (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId === tidingsId);
      expect(plays).toHaveLength(1);

      const after = resolveChain(dispatch(state, plays[0].action));
      expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === TIDINGS)).toBe(true);
      expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === TIDINGS)).toBe(false);
    });
  }

  // ─── #3: -1 to faction influence checks ───────────────────────────────────

  test('baseline: Woodmen (influence # 8) needs 8 without Tidings of Death', () => {
    const state = factionPlayState();
    const attempt = firstFactionInfluenceAttempt(state, state.players[RESOURCE_PLAYER].hand[0].instanceId);
    expect(attempt!.need).toBe(8);
  });

  test('-1 raises the need to 9 whether Tidings is in the influencer\'s or the opponent\'s play area', () => {
    for (const owner of [0, 1] as const) {
      const state = factionPlayState(owner);
      const attempt = firstFactionInfluenceAttempt(state, state.players[RESOURCE_PLAYER].hand[0].instanceId);
      expect(attempt!.need).toBe(9);
    }
    const { roll } = toFactionRoll(factionPlayState(1));
    expect(roll.need).toBe(9);
  });

  // ─── #4–#6: additional roll, better result kept ───────────────────────────

  test('control: without Tidings a single roll is made (no alternate roll)', () => {
    const { cur, roll } = toFactionRoll(factionPlayState());
    const result = reduce({ ...cur, cheatRollTotal: 8 }, roll);
    const dice = diceEffect(result.effects);
    expect(dice.alternateRoll).toBeUndefined();
    expect(sum(dice)).toBe(8);
    expect(result.state.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.definitionId)).toContain(WOODMEN);
  });

  test('an additional roll is made and the higher result is used', () => {
    const { cur, roll } = toFactionRoll(factionPlayState(1));
    const { result, dice } = resolveFactionRoll(cur, roll, 5, second => second > 5);
    expect(dice.alternateRoll).toBeDefined();
    expect(sum(dice)).toBeGreaterThan(sum(dice.alternateRoll!));
    expect(sum(dice.alternateRoll!)).toBe(5);
    expect(result.state.players[RESOURCE_PLAYER].lastDiceRoll).toEqual({ die1: dice.die1, die2: dice.die2 });
  });

  test('the additional roll rescues a failing first roll', () => {
    // First roll 2 would fail; a second roll of 9+ gives 9 - 1 = 8 >= 8.
    const { cur, roll } = toFactionRoll(factionPlayState(0));
    const { result, dice } = resolveFactionRoll(cur, roll, 2, second => second >= 9);
    expect(sum(dice)).toBeGreaterThanOrEqual(9);
    expect(result.state.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.definitionId)).toContain(WOODMEN);
  });

  test('the -1 bites: best roll of 8 gives 7 < 8 and the faction is discarded', () => {
    const { cur, roll } = toFactionRoll(factionPlayState(1));
    const { result, dice } = resolveFactionRoll(cur, roll, 8, second => second <= 8);
    expect(sum(dice)).toBe(8);
    const p1 = result.state.players[RESOURCE_PLAYER];
    expect(p1.cardsInPlay.map(c => c.definitionId)).not.toContain(WOODMEN);
    expect(p1.discardPile.map(c => c.definitionId)).toContain(WOODMEN);
  });

  // ─── #7–#8: opponent influence attempts ───────────────────────────────────

  test('an influence attempt against an opponent\'s faction gets -1 and an additional roll', () => {
    const { state, factionId } = reInfluenceState(true);
    const attempt = firstOpponentInfluenceAttempt(state, factionId, PLAYER_1);
    expect(attempt).toBeDefined();
    const result = dispatchResult(state, attempt!);
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no pending defend');
    expect(pending.kind.attempt.boostModifier).toBe(-1);
    const dice = diceEffect(result.effects);
    expect(dice.alternateRoll).toBeDefined();
    expect(pending.kind.attempt.attackerRoll).toBe(Math.max(sum(dice), sum(dice.alternateRoll!)));
  });

  test('control: no Tidings → no modifier and a single roll on the same attempt', () => {
    const { state, factionId } = reInfluenceState(false);
    const result = dispatchResult(state, firstOpponentInfluenceAttempt(state, factionId, PLAYER_1)!);
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no pending defend');
    expect(pending.kind.attempt.boostModifier ?? 0).toBe(0);
    expect(diceEffect(result.effects).alternateRoll).toBeUndefined();
  });

  test('an influence attempt against an opponent\'s character is unaffected', () => {
    const { state, legolasId } = reInfluenceState(true);
    const attempt = firstOpponentInfluenceAttempt(state, legolasId, PLAYER_1);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('character');
    const result = dispatchResult(state, attempt!);
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no pending defend');
    expect(pending.kind.attempt.boostModifier ?? 0).toBe(0);
    expect(diceEffect(result.effects).alternateRoll).toBeUndefined();
  });
});
