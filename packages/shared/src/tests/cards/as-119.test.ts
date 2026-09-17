/**
 * @module as-119.test
 *
 * Card test: Morgul-orcs (as-119)
 * Type: minion-resource-faction · race orc · unique · 1 faction MP
 *       · influence # 9 · in-play influence # 0
 *
 * Card text:
 *   "Unique. Playable at Minas Morgul if the influence check is greater than 8.
 *    Once in play, the number required to influence this faction is 0.
 *    Standard Modifications: Ungol-orcs (-2), Orcs of Angmar (+2)."
 *
 * Rules modelled (and how):
 *  - "Playable at Minas Morgul" — `playableAt: [{ site: "Minas Morgul" }]`.
 *    Minas Morgul (le-390) is a minion **haven**; nothing in CoE 2.V bars a
 *    faction play at a haven, and the site card's empty `playableResources`
 *    list does not gate factions (a faction's playability is written on the
 *    faction card naming the site, CoE 2.V.3).
 *  - "if the influence check is greater than 8" — `influenceNumber: 9`; the
 *    engine compares `total >= influenceNumber`, so `need = 9 - modifier`.
 *  - "Once in play, the number required to influence this faction is 0" —
 *    `inPlayInfluenceNumber: 0` (CoE 8.3), used by the opponent-influence path.
 *  - "Standard Modifications" — two `check-modifier` effects on the influence
 *    check, gated on `controller.inPlay` so only the influencing player's own
 *    factions count: Ungol-orcs (le-290) -2, Orcs of Angmar (le-274) +2.
 *  - "Unique" — `unique: true`; a copy already in play blocks a second play.
 *  - The card carries **no** leader-control clause (unlike its LE sibling
 *    Ungol-orcs), so no `placeUnderLeaderControl` variant may be offered even
 *    to an eligible Orc Leader.
 *
 * Engine support table:
 * | # | Rule                                                     | Status      | Notes                                    |
 * |---|----------------------------------------------------------|-------------|------------------------------------------|
 * | 1 | Playable only at Minas Morgul (a haven)                  | IMPLEMENTED | `playableAt.site` match in site.ts       |
 * | 2 | Influence # 9 ("greater than 8")                         | IMPLEMENTED | shared faction-influence machinery       |
 * | 3 | Successful check: faction in play, site tapped, 1 MP     | IMPLEMENTED | `resolveInfluenceAttemptRoll`            |
 * | 4 | Failed check: faction discarded                          | IMPLEMENTED | `resolveInfluenceAttemptRoll`            |
 * | 5 | -2 when controller has Ungol-orcs                        | IMPLEMENTED | `check-modifier` on `controller.inPlay`  |
 * | 6 | +2 when controller has Orcs of Angmar                    | IMPLEMENTED | `check-modifier` on `controller.inPlay`  |
 * | 7 | Modifications are per-player (opponent's copies ignored) | IMPLEMENTED | `controller.inPlay` is controller-scoped |
 * | 8 | Unique: a copy in play blocks a second play              | IMPLEMENTED | `countCopiesInPlay` gate in site.ts      |
 * | 9 | Once in play, opponent re-influence value = 0            | IMPLEMENTED | `inPlayInfluenceNumber` (CoE 8.3)        |
 * |10 | No leader-control variant (card lacks the clause)        | IMPLEMENTED | `getLeaderControlEffect` returns none    |
 *
 * Playable: YES
 *
 * Fixtures:
 *   CIRYAHER (le-6)        — minion dúnadan, DI 2, no effects (baseline influencer)
 *   ORC_CAPTAIN (le-31)    — minion orc Leader, DI 0, +3 DI vs orc targets
 *   LAGDUF (le-18)         — minion orc, DI 0, not a Leader
 *   UNGOL_ORCS (le-290)    — the -2 Standard Modification faction
 *   ORCS_OF_ANGMAR (le-274) — the +2 Standard Modification faction
 *   MINAS_MORGUL (le-390)  — minion haven; the only site the faction is playable at
 *   MORIA_LE (le-392)      — shadow-hold, for the wrong-site negative test
 *   DOL_GULDUR (le-367)    — minion haven (opponent's site / site-deck filler)
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

const MORGUL_ORCS = 'as-119' as CardDefinitionId;
const UNGOL_ORCS = 'le-290' as CardDefinitionId;         // -2 Standard Modification
const ORCS_OF_ANGMAR = 'le-274' as CardDefinitionId;     // +2 Standard Modification

const CIRYAHER = 'le-6' as CardDefinitionId;             // dúnadan, DI 2, no effects
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;         // orc Leader, DI 0, +3 vs orc
const LAGDUF = 'le-18' as CardDefinitionId;              // orc, DI 0, not a Leader

const MINAS_MORGUL = 'le-390' as CardDefinitionId;       // minion haven — the home site
const MORIA_LE = 'le-392' as CardDefinitionId;           // shadow-hold (wrong site)
const DOL_GULDUR = 'le-367' as CardDefinitionId;         // minion haven

/** An in-play instance of an already-controlled faction. */
function factionInPlay(definitionId: CardDefinitionId, instanceId: string): CardInPlay {
  return { instanceId: instanceId as CardInstanceId, definitionId, status: CardStatus.Untapped };
}

/**
 * Site-phase state with PLAYER_1's company at `site` holding Morgul-orcs
 * in hand, plus optional already-controlled factions on either side.
 */
function buildState(opts: {
  site?: CardDefinitionId;
  characters?: CardDefinitionId[];
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
        companies: [{ site: opts.site ?? MINAS_MORGUL, characters: opts.characters ?? [CIRYAHER] }],
        hand: [MORGUL_ORCS], siteDeck: [DOL_GULDUR], cardsInPlay: opts.ownInPlay ?? [],
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

describe('Morgul-orcs (as-119)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1–2: playable at Minas Morgul, influence # 9 ────────────────────

  test('influence-attempt is legal at Minas Morgul; baseline need = 9 - DI', () => {
    // Ciryaher: DI 2, no effects, no Standard Modification factions in play.
    // need = influenceNumber(9) - modifier(2) = 7.
    const state = buildState({});
    const factionInstanceId = state.players[0].hand[0].instanceId;

    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('an Orc Captain gets his +3 vs orc factions: need = 6', () => {
    // Orc Captain: DI 0 + 3 (influence-check vs an orc target) = 3; need = 9 - 3 = 6.
    const state = buildState({ characters: [ORC_CAPTAIN] });
    const factionInstanceId = state.players[0].hand[0].instanceId;

    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });

  test('faction is NOT influence-able at a site other than Minas Morgul', () => {
    const state = buildState({ site: MORIA_LE });
    const factionInstanceId = state.players[0].hand[0].instanceId;

    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });

  // ── Rules 3–4: resolving the check ────────────────────────────────────────

  test('a successful check puts the faction in play, taps the site, and scores 1 MP', () => {
    const state = buildState({});
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId)!;

    // need = 7; a total of 10 succeeds.
    const resolved = resolveWithRoll(state, attempt, 10);

    const faction = resolved.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === factionInstanceId);
    expect(faction).toBeDefined();
    // No leader-control clause on this card — it never enters play under a leader.
    expect(faction!.controlledBy).toBeUndefined();
    expect(resolved.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
    expect(resolved.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(1);
  });

  test('a failed check discards the faction and scores nothing', () => {
    const state = buildState({});
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId)!;

    // need = 7; a total of 6 fails.
    const resolved = resolveWithRoll(state, attempt, 6);

    expect(resolved.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === factionInstanceId)).toBe(false);
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === factionInstanceId)).toBe(true);
    expect(resolved.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(0);
  });

  // ── Rules 5–7: Standard Modifications ─────────────────────────────────────

  test('-2 Standard Modification when the controller has Ungol-orcs in play', () => {
    // modifier = DI 2 - 2 = 0; need = 9 - 0 = 9.
    const state = buildState({ ownInPlay: [factionInPlay(UNGOL_ORCS, 'ungol-1')] });
    const factionInstanceId = state.players[0].hand[0].instanceId;

    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('+2 Standard Modification when the controller has Orcs of Angmar in play', () => {
    // modifier = DI 2 + 2 = 4; need = 9 - 4 = 5.
    const state = buildState({ ownInPlay: [factionInPlay(ORCS_OF_ANGMAR, 'angmar-1')] });
    const factionInstanceId = state.players[0].hand[0].instanceId;

    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(5);
  });

  test('the two Standard Modifications stack and cancel out', () => {
    // modifier = DI 2 - 2 + 2 = 2; need = 9 - 2 = 7 (the baseline).
    const state = buildState({
      ownInPlay: [factionInPlay(UNGOL_ORCS, 'ungol-1'), factionInPlay(ORCS_OF_ANGMAR, 'angmar-1')],
    });
    const factionInstanceId = state.players[0].hand[0].instanceId;

    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('Standard Modifications ignore factions controlled by the OPPONENT', () => {
    // Both named factions sit on PLAYER_2's side — `controller.inPlay` is
    // per-player, so the need stays at the baseline 7.
    const state = buildState({
      opponentInPlay: [factionInPlay(UNGOL_ORCS, 'ungol-1'), factionInPlay(ORCS_OF_ANGMAR, 'angmar-1')],
    });
    const factionInstanceId = state.players[0].hand[0].instanceId;

    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  // ── Rule 8: uniqueness ────────────────────────────────────────────────────

  test('unique: a copy already in play blocks a second influence attempt', () => {
    const state = buildState({ ownInPlay: [factionInPlay(MORGUL_ORCS, 'morgul-1')] });
    const factionInstanceId = state.players[0].hand[0].instanceId;

    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });

  // ── Rule 9: in-play influence number ──────────────────────────────────────

  test('opponent re-influence of the in-play faction uses value 0', () => {
    // CoE 8.3: while in play the threshold is `inPlayInfluenceNumber` (0).
    // PLAYER_2 controls the faction; PLAYER_1 is the active player at Minas
    // Morgul, the site where the faction is playable.
    const inPlay = factionInPlay(MORGUL_ORCS, 'morgul-inplay-1');
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [inPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };

    const attempt = firstOpponentInfluenceAttempt(state, inPlay.instanceId, PLAYER_1);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');
    expect(attempt!.targetPlayer).toBe(PLAYER_2);
    expect(attempt!.explanation).toContain('faction in-play influence #: 0');
  });

  // ── Rule 10: no leader-control clause on this card ────────────────────────

  test('no leader-control variant is offered, even to an Orc Leader', () => {
    // Some LE minion factions carry the "place under the control of that
    // leader" clause; Morgul-orcs does not.
    const state = buildState({ characters: [ORC_CAPTAIN] });
    const factionInstanceId = state.players[0].hand[0].instanceId;

    const controlVariants = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.factionInstanceId === factionInstanceId && a.placeUnderLeaderControl === true);

    expect(controlVariants).toHaveLength(0);
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeDefined();
  });
});
