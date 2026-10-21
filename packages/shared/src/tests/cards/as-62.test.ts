/**
 * @module as-62.test
 *
 * Card test: Angmarim (as-62)
 * Type: minion-resource-faction · race man · unique · 1 faction MP
 *       · influence # 11 · in-play influence # 0
 *
 * Card text:
 *   "Unique. Playable at Carn Dûm if the influence check is greater than 10.
 *    Once in play, the number required to influence this faction is 0.
 *    Standard Modifications: Easterlings (+2), Hillmen (+2)."
 *
 * Rules modelled (and how):
 *  - "Playable at Carn Dûm" — `playableAt: [{ site: "Carn Dûm" }]`. Carn Dûm
 *    (le-359) is a minion haven; the faction card naming the site is what
 *    makes it playable there (CoE 2.V.3).
 *  - "if the influence check is greater than 10" — `influenceNumber: 11`; the
 *    engine compares `total >= influenceNumber`, so `need = 11 - modifier`.
 *  - "Once in play, the number required to influence this faction is 0" —
 *    `inPlayInfluenceNumber: 0` (CoE 8.3), used by the opponent-influence path.
 *  - "Standard Modifications" — two `check-modifier` effects on the influence
 *    check, gated on `controller.inPlay` so only the influencing player's own
 *    factions count: Easterlings (le-264) +2, Hillmen (le-269) +2.
 *  - "Unique" — `unique: true`; a copy already in play blocks a second play.
 *
 * Engine support table:
 * | # | Rule                                                     | Status      | Notes                                    |
 * |---|----------------------------------------------------------|-------------|------------------------------------------|
 * | 1 | Playable only at Carn Dûm (a haven)                      | IMPLEMENTED | `playableAt.site` match in site.ts       |
 * | 2 | Influence # 11 ("greater than 10")                       | IMPLEMENTED | shared faction-influence machinery       |
 * | 3 | Successful check: faction in play, site tapped, 1 MP     | IMPLEMENTED | `resolveInfluenceAttemptRoll`            |
 * | 4 | Failed check: faction discarded                          | IMPLEMENTED | `resolveInfluenceAttemptRoll`            |
 * | 5 | +2 when controller has Easterlings                       | IMPLEMENTED | `check-modifier` on `controller.inPlay`  |
 * | 6 | +2 when controller has Hillmen                           | IMPLEMENTED | `check-modifier` on `controller.inPlay`  |
 * | 7 | Modifications are per-player (opponent's copies ignored) | IMPLEMENTED | `controller.inPlay` is controller-scoped |
 * | 8 | Unique: a copy in play blocks a second play              | IMPLEMENTED | `countCopiesInPlay` gate in site.ts      |
 * | 9 | Once in play, opponent re-influence value = 0            | IMPLEMENTED | `inPlayInfluenceNumber` (CoE 8.3)        |
 *
 * Playable: YES
 *
 * Fixtures:
 *   CIRYAHER (le-6)      — minion dúnadan, DI 2, no effects (baseline influencer)
 *   LAGDUF (le-18)       — minion orc, DI 0
 *   EASTERLINGS (le-264) — the +2 Standard Modification faction
 *   HILLMEN (le-269)     — the +2 Standard Modification faction
 *   CARN_DUM (le-359)    — minion haven; the only site the faction is playable at
 *   MORIA_LE (le-392)    — shadow-hold, for the wrong-site negative test
 *   DOL_GULDUR (le-367)  — minion haven (opponent's site / site-deck filler)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  makeSitePhase, viableActions, dispatch, resolveChain,
  firstFactionInfluenceAttempt, firstOpponentInfluenceAttempt,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId, GameState, InfluenceAttemptAction,
} from '../../index.js';

const ANGMARIM = 'as-62' as CardDefinitionId;
const EASTERLINGS = 'le-264' as CardDefinitionId;        // +2 Standard Modification
const HILLMEN = 'le-269' as CardDefinitionId;            // +2 Standard Modification

const CIRYAHER = 'le-6' as CardDefinitionId;             // dúnadan, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;              // orc, DI 0

const CARN_DUM = 'le-359' as CardDefinitionId;           // minion haven — the home site
const MORIA_LE = 'le-392' as CardDefinitionId;           // shadow-hold (wrong site)
const DOL_GULDUR = 'le-367' as CardDefinitionId;         // minion haven

/** An in-play instance of an already-controlled faction. */
function factionInPlay(definitionId: CardDefinitionId, instanceId: string): CardInPlay {
  return { instanceId: instanceId as CardInstanceId, definitionId, status: CardStatus.Untapped };
}

/**
 * Site-phase state with PLAYER_1's company at `site` holding Angmarim in hand,
 * plus optional already-controlled factions on either side.
 */
function buildState(opts: {
  site?: CardDefinitionId;
  ownInPlay?: CardInPlay[];
  opponentInPlay?: CardInPlay[];
}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: opts.site ?? CARN_DUM, characters: [CIRYAHER] }],
        hand: [ANGMARIM], siteDeck: [DOL_GULDUR], cardsInPlay: opts.ownInPlay ?? [],
      },
      {
        id: PLAYER_2,
        companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }],
        hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: opts.opponentInPlay ?? [],
      },
    ],
  });
  return { ...base, phaseState: makeSitePhase() };
}

/** Resolve a declared influence attempt with a fixed 2d6 total. */
function resolveWithRoll(state: GameState, attempt: InfluenceAttemptAction, total: number): GameState {
  const afterChain = resolveChain(dispatch(state, attempt));
  const rollAction = viableActions(afterChain, PLAYER_1, 'faction-influence-roll')[0].action;
  return dispatch({ ...afterChain, cheatRollTotal: total }, rollAction);
}

describe('Angmarim (as-62)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1–2: playable at Carn Dûm, influence # 11 ───────────────────────

  test('influence-attempt is legal at Carn Dûm; baseline need = 11 - DI', () => {
    // Ciryaher: DI 2, no effects. need = 11 - 2 = 9.
    const state = buildState({});
    const factionInstanceId = state.players[0].hand[0].instanceId;

    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('faction is NOT influence-able at a site other than Carn Dûm', () => {
    const state = buildState({ site: MORIA_LE });
    const factionInstanceId = state.players[0].hand[0].instanceId;

    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });

  // ── Rules 3–4: resolving the check ────────────────────────────────────────

  test('a successful check puts the faction in play, taps the site, and scores 1 MP', () => {
    const state = buildState({});
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId)!;

    // need = 9; a total of 9 succeeds (2 + 9 = 11 > 10).
    const resolved = resolveWithRoll(state, attempt, 9);

    expect(resolved.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === factionInstanceId)).toBe(true);
    expect(resolved.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
    expect(resolved.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(1);
  });

  test('a failed check (total exactly 10) discards the faction and scores nothing', () => {
    const state = buildState({});
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId)!;

    // need = 9; a roll of 8 gives 8 + 2 = 10, not greater than 10.
    const resolved = resolveWithRoll(state, attempt, 8);

    expect(resolved.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === factionInstanceId)).toBe(false);
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === factionInstanceId)).toBe(true);
    expect(resolved.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(0);
  });

  // ── Rules 5–7: Standard Modifications ─────────────────────────────────────

  test('+2 Standard Modification when the controller has Easterlings in play', () => {
    // modifier = DI 2 + 2 = 4; need = 11 - 4 = 7.
    const state = buildState({ ownInPlay: [factionInPlay(EASTERLINGS, 'east-1')] });
    const factionInstanceId = state.players[0].hand[0].instanceId;

    expect(firstFactionInfluenceAttempt(state, factionInstanceId)!.need).toBe(7);
  });

  test('+2 Standard Modification when the controller has Hillmen in play', () => {
    // modifier = DI 2 + 2 = 4; need = 11 - 4 = 7.
    const state = buildState({ ownInPlay: [factionInPlay(HILLMEN, 'hill-1')] });
    const factionInstanceId = state.players[0].hand[0].instanceId;

    expect(firstFactionInfluenceAttempt(state, factionInstanceId)!.need).toBe(7);
  });

  test('the two Standard Modifications stack', () => {
    // modifier = DI 2 + 2 + 2 = 6; need = 11 - 6 = 5.
    const state = buildState({
      ownInPlay: [factionInPlay(EASTERLINGS, 'east-1'), factionInPlay(HILLMEN, 'hill-1')],
    });
    const factionInstanceId = state.players[0].hand[0].instanceId;

    expect(firstFactionInfluenceAttempt(state, factionInstanceId)!.need).toBe(5);
  });

  test('Standard Modifications ignore factions controlled by the OPPONENT', () => {
    const state = buildState({
      opponentInPlay: [factionInPlay(EASTERLINGS, 'east-1'), factionInPlay(HILLMEN, 'hill-1')],
    });
    const factionInstanceId = state.players[0].hand[0].instanceId;

    expect(firstFactionInfluenceAttempt(state, factionInstanceId)!.need).toBe(9);
  });

  // ── Rule 8: uniqueness ────────────────────────────────────────────────────

  test('unique: a copy already in play blocks a second influence attempt', () => {
    const state = buildState({ ownInPlay: [factionInPlay(ANGMARIM, 'angmarim-1')] });
    const factionInstanceId = state.players[0].hand[0].instanceId;

    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });

  // ── Rule 9: in-play influence number ──────────────────────────────────────

  test('opponent re-influence of the in-play faction uses value 0', () => {
    // CoE 8.3: while in play the threshold is `inPlayInfluenceNumber` (0).
    const inPlay = factionInPlay(ANGMARIM, 'angmarim-inplay-1');
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CARN_DUM, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [inPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };

    const attempt = firstOpponentInfluenceAttempt(state, inPlay.instanceId, PLAYER_1);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');
    expect(attempt!.targetPlayer).toBe(PLAYER_2);
    expect(attempt!.explanation).toContain('faction in-play influence #: 0');
  });
});
