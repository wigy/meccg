/**
 * @module le-146.test
 *
 * Card test: Veils Flung Away (le-146)
 * Type: hazard-event (short)
 *
 * "Playable on a company moving in a Wilderness [{w}], Border-land [{b}], or
 *  Free-domain [{f}] if Doors of Night is not in play; does not count against
 *  the hazard limit. Make a body check modified by -1 for each character.
 *  Determine if each Orc or Troll character is discarded as indicated on their
 *  cards. Otherwise, the body checks have no effect unless an untapped
 *  character fails his check, in which case he becomes tapped."
 *
 * Characters used:
 *   - le-31  Orc Captain  (orc,   body 8, mind 5) — discard test
 *   - le-1   Asternak     (man,   body 7, mind 5) — tap test
 *   - le-11  Gorbag       (orc,   body 9, mind 6) — second orc for multi-char test
 * Sites used:
 *   - le-367 Dol Guldur   (haven) — starting haven
 *   - le-372 Edoras       (free-hold, path: shadow/wilderness/free) — destination
 *   - le-392 Moria        (shadow-hold, path: dark/shadow/wilderness) — destination
 *
 * Engine Support:
 * | # | Feature                                           | Status |
 * |---|---------------------------------------------------|--------|
 * | 1 | play-restriction no-hazard-limit                  | OK     |
 * | 2 | play-condition site-path (wilderness/border/free)  | OK     |
 * | 3 | play-condition: blocked if Doors of Night in play  | OK     |
 * | 4 | mass-body-check modifier -1 for each character    | OK     |
 * | 5 | Orc/Troll fail → discarded (returned to hand)     | OK     |
 * | 6 | Non-Orc untapped fail → tapped                    | OK     |
 * | 7 | Non-Orc tapped fail → no effect                   | OK     |
 * | 8 | All characters pass → no effect                   | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint,
  viableActions, makeMHState,
  P1_COMPANY,
  handCardId, findCharInstanceId, dispatch,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  expectCharInPlay, expectCharNotInPlay,
  expectCharStatus,
  setCharStatus,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { Phase, RegionType, CardStatus } from '../../index.js';
import type { GameState, MovementHazardPhaseState, CardDefinitionId, BodyCheckCompanyRollAction } from '../../index.js';

const VEILS_FLUNG_AWAY = 'le-146' as CardDefinitionId;
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;   // orc, body 8
const ASTERNAK = 'le-1' as CardDefinitionId;         // man, body 7
const GORBAG = 'le-11' as CardDefinitionId;          // orc, body 9

const DOL_GULDUR = 'le-367' as CardDefinitionId;    // haven (minion)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // haven (minion)
const EDORAS_LE = 'le-372' as CardDefinitionId;     // free-hold, path has wilderness + free
const MORIA_LE = 'le-392' as CardDefinitionId;      // shadow-hold, path: dark/shadow/wilderness
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId; // permanent environment

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build an MH state with a wilderness region in the site path (no DoN). */
function makeWildernessMH(overrides?: Partial<MovementHazardPhaseState>): MovementHazardPhaseState {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: ['Rohan'],
    ...overrides,
  });
}

/** Build an MH state with only shadow/dark in path (not wilderness/border/free). */
function makeShadowOnlyMH(): MovementHazardPhaseState {
  return makeMHState({
    resolvedSitePath: [RegionType.Shadow],
    resolvedSitePathNames: ['Gorgoroth'],
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Veils Flung Away (le-146)', () => {
  beforeEach(() => resetMint());

  // ── Playability: region path conditions ──────────────────────────────────────

  test('playable when company is moving through a Wilderness', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA_LE] },
      ],
    });
    const s: GameState = { ...state, phaseState: makeWildernessMH() };
    const actions = viableActions(s, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
  });

  test('playable when company is moving through a Border-land', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA_LE] },
      ],
    });
    const s: GameState = { ...state, phaseState: makeMHState({ resolvedSitePath: [RegionType.Border] }) };
    const actions = viableActions(s, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
  });

  test('playable when company is moving through a Free-domain', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA_LE] },
      ],
    });
    const s: GameState = { ...state, phaseState: makeMHState({ resolvedSitePath: [RegionType.Free] }) };
    const actions = viableActions(s, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
  });

  test('NOT playable when company path is only Shadow/Dark (no Wilderness, Border, or Free)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA_LE] },
      ],
    });
    const s: GameState = { ...state, phaseState: makeShadowOnlyMH() };
    const actions = viableActions(s, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('NOT playable when Doors of Night is in play', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA_LE] },
      ],
    });

    // Simulate Doors of Night in play by adding it to cardsInPlay
    const donInstance = { instanceId: 'don-test' as import('../../index.js').CardInstanceId, definitionId: DOORS_OF_NIGHT, status: CardStatus.Untapped };
    const stateWithDoN: GameState = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], cardsInPlay: [...state.players[1].cardsInPlay, donInstance] },
      ] as typeof state.players,
      phaseState: makeWildernessMH(),
    };
    const actions = viableActions(stateWithDoN, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  // ── No-hazard-limit ────────────────────────────────────────────────────────

  test('does not count against the hazard limit — playable when limit is reached', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA_LE] },
      ],
    });
    const s: GameState = {
      ...state,
      phaseState: makeWildernessMH({
        hazardsPlayedThisCompany: 4,
        hazardLimitAtReveal: 4,
      }),
    };
    const actions = viableActions(s, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
  });

  // ── Body check: Orc/Troll discard ─────────────────────────────────────────

  test('Orc character is discarded (returned to hand) when body check fails', () => {
    // Orc Captain: body 8, modifier -1, effective threshold 7.
    // Force roll of 6 (< 7) to trigger failure.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ASTERNAK] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA_LE] },
      ],
    });
    const mh = makeWildernessMH();
    let s: GameState = { ...state, phaseState: mh };
    const orcId = findCharInstanceId(s, RESOURCE_PLAYER, ORC_CAPTAIN);
    const veilId = handCardId(s, HAZARD_PLAYER);

    // Play Veils Flung Away targeting the company
    s = dispatch(s, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: veilId, targetCompanyId: P1_COMPANY });
    expect(s.chain).not.toBeNull();

    // Resolve chain (both players pass)
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    // Body check pending resolution should be queued for PLAYER_1
    expect(s.pendingResolutions).toHaveLength(1);
    expect(s.pendingResolutions[0].kind.type).toBe('body-check-company');
    expect(s.pendingResolutions[0].actor).toBe(PLAYER_1);

    // Force roll of 6 (< 7 effective body) → fail
    s = { ...s, cheatRollTotal: 6 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'body-check-company-roll');
    expect(rollActions).toHaveLength(1);

    const rollAction = rollActions[0].action as BodyCheckCompanyRollAction;
    expect(rollAction.characterId).toBe(orcId);

    s = dispatch(s, rollAction);

    // Orc Captain should be discarded (returned to hand)
    expectCharNotInPlay(s, RESOURCE_PLAYER, orcId);
    const handDefIds = s.players[0].hand.map(c => c.definitionId);
    expect(handDefIds).toContain(ORC_CAPTAIN);
  });

  test('Orc character stays when body check passes', () => {
    // Orc Captain: body 8, effective threshold 7.
    // Force roll of 7 (= effective body) → passes.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ASTERNAK] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA_LE] },
      ],
    });
    let s: GameState = { ...state, phaseState: makeWildernessMH() };
    const orcId = findCharInstanceId(s, RESOURCE_PLAYER, ORC_CAPTAIN);
    const veilId = handCardId(s, HAZARD_PLAYER);

    s = dispatch(s, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: veilId, targetCompanyId: P1_COMPANY });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });
    expect(s.pendingResolutions[0].kind.type).toBe('body-check-company');

    // Force roll of 7 (= effective body) → passes
    s = { ...s, cheatRollTotal: 7 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'body-check-company-roll');
    s = dispatch(s, rollActions[0].action);

    // Orc Captain should still be in play
    expectCharInPlay(s, RESOURCE_PLAYER, orcId);
  });

  // ── Body check: non-Orc/Troll tap ─────────────────────────────────────────

  test('untapped non-Orc character becomes tapped when body check fails', () => {
    // Asternak: body 7, modifier -1, effective threshold 6.
    // Force roll of 5 (< 6) → fail. Character is untapped → should be tapped.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA_LE] },
      ],
    });
    let s: GameState = { ...state, phaseState: makeWildernessMH() };
    const astarId = findCharInstanceId(s, RESOURCE_PLAYER, ASTERNAK);
    const veilId = handCardId(s, HAZARD_PLAYER);

    s = dispatch(s, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: veilId, targetCompanyId: P1_COMPANY });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    // Force roll of 5 (< 6 effective body) → fail
    s = { ...s, cheatRollTotal: 5 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'body-check-company-roll');
    expect(rollActions).toHaveLength(1);

    s = dispatch(s, rollActions[0].action);

    // Asternak should be tapped, not discarded
    expectCharInPlay(s, RESOURCE_PLAYER, astarId);
    expectCharStatus(s, RESOURCE_PLAYER, ASTERNAK, CardStatus.Tapped);
  });

  test('already-tapped non-Orc character has no effect when body check fails', () => {
    // Asternak: body 7, effective threshold 6.
    // Character is tapped already — even a failed check has no further effect.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA_LE] },
      ],
    });
    let s: GameState = { ...state, phaseState: makeWildernessMH() };
    const astarId = findCharInstanceId(s, RESOURCE_PLAYER, ASTERNAK);

    // Pre-tap the character
    s = setCharStatus(s, RESOURCE_PLAYER, ASTERNAK, CardStatus.Tapped);

    const veilId = handCardId(s, HAZARD_PLAYER);
    s = dispatch(s, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: veilId, targetCompanyId: P1_COMPANY });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    // Force roll of 2 (clearly < 6) → fail
    s = { ...s, cheatRollTotal: 2 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'body-check-company-roll');
    s = dispatch(s, rollActions[0].action);

    // Asternak should still be in play and still tapped (no change)
    expectCharInPlay(s, RESOURCE_PLAYER, astarId);
    expectCharStatus(s, RESOURCE_PLAYER, ASTERNAK, CardStatus.Tapped);
  });

  test('non-Orc character stays untapped when body check passes', () => {
    // Asternak: body 7, effective threshold 6.
    // Force roll of 10 (>= 6) → passes. Character stays untapped.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA_LE] },
      ],
    });
    let s: GameState = { ...state, phaseState: makeWildernessMH() };
    const astarId = findCharInstanceId(s, RESOURCE_PLAYER, ASTERNAK);
    const veilId = handCardId(s, HAZARD_PLAYER);

    s = dispatch(s, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: veilId, targetCompanyId: P1_COMPANY });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    // Force roll of 10 (>= 6 effective body) → passes
    s = { ...s, cheatRollTotal: 10 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'body-check-company-roll');
    s = dispatch(s, rollActions[0].action);

    expectCharInPlay(s, RESOURCE_PLAYER, astarId);
    expectCharStatus(s, RESOURCE_PLAYER, ASTERNAK, CardStatus.Untapped);
  });

  // ── Multi-character company ────────────────────────────────────────────────

  test('enqueues one body-check resolution per character in the company', () => {
    // Two characters: Orc Captain and Asternak.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [ORC_CAPTAIN, ASTERNAK] }], hand: [], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA_LE] },
      ],
    });
    let s: GameState = { ...state, phaseState: makeWildernessMH() };
    const veilId = handCardId(s, HAZARD_PLAYER);

    s = dispatch(s, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: veilId, targetCompanyId: P1_COMPANY });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    // Two body-check-company pending resolutions should be queued
    expect(s.pendingResolutions.filter(r => r.kind.type === 'body-check-company')).toHaveLength(2);
  });

  test('short event is discarded after all body checks resolve', () => {
    // Play Veils, resolve both body checks with passing rolls.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ASTERNAK] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA_LE] },
      ],
    });
    let s: GameState = { ...state, phaseState: makeWildernessMH() };
    const veilId = handCardId(s, HAZARD_PLAYER);

    s = dispatch(s, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: veilId, targetCompanyId: P1_COMPANY });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    // Resolve the body check with a passing roll
    s = { ...s, cheatRollTotal: 12 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'body-check-company-roll');
    expect(rollActions).toHaveLength(1);
    s = dispatch(s, rollActions[0].action);

    // Card should be in hazard player's discard pile (short event)
    expect(s.players[1].discardPile.map(c => c.instanceId)).toContain(veilId);
    expect(s.players[1].hand).toHaveLength(0);
  });
});
