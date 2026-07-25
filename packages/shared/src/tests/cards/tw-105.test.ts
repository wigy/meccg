/**
 * @module tw-105.test
 *
 * Card test: Traitor (tw-105)
 * Type: hazard-event (permanent), keyword: corruption
 *
 * "When the next character fails a corruption check, he becomes a 'traitor'
 *  and an attack is immediately made against a character in the traitor's
 *  company. The character to be attacked is chosen by the player who does not
 *  control the traitor's company. The prowess of the attack is equal to the
 *  prowess of the traitor plus 10. Any resulting body check is modified by +1.
 *  This card is discarded when a character fails his corruption check."
 *
 * CRF: the attack has the same race as the traitor; two copies in play have no
 * extra effect and are both discarded with the one failed check; the attack
 * takes effect in the chain immediately following the one containing the
 * corruption check (so a check failing mid-combat queues the attack until the
 * running combat ends); cannot be revealed as an on-guard card (structural —
 * it matches none of the on-guard reveal paths).
 *
 * Effects (data):
 *   - on-event corruption-check-failed → traitor-attack
 *     (prowessBonus 10, strikes 1, bodyCheckModifier 1)
 *
 * Engine support:
 * | # | Rule                                                        | Status |
 * |---|-------------------------------------------------------------|--------|
 * | 1 | Playable as an untargeted hazard permanent-event (M/H)      | OK     |
 * | 2 | Failed corruption check triggers the attack                 | OK     |
 * | 3 | Attack prowess = traitor's printed prowess + 10             | OK     |
 * | 4 | Opponent of the traitor's controller chooses the target     | OK     |
 * | 5 | Any resulting body check is modified by +1                  | OK     |
 * | 6 | Card discarded on the failed check (all copies, one attack) | OK     |
 * | 7 | Passed check does not trigger; card stays in play           | OK     |
 * | 8 | Check failing mid-combat queues the attack until it ends    | OK     |
 *
 * Characters used:
 *   - tw-120 Aragorn II (prowess 6, body 9, dunadan) — the traitor (6+10 = 16)
 *   - tw-168 Legolas    (prowess 5, body 8, elf) — the attacked companion
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  viableActions, executeAction,
  handCardId, findCharInstanceId, companyIdAt, addCardInPlay,
  playHazardAndResolve,
  expectCharInPlay, expectCharNotInPlay, expectCharStatus,
} from '../test-helpers.js';
import { enqueueResolution } from '../../engine/pending.js';
import { Phase, CardStatus } from '../../index.js';
import type { GameState, CardDefinitionId, CardInstanceId, CombatState } from '../../index.js';

const TRAITOR = 'tw-105' as CardDefinitionId;

// ─── Helpers (inline state builders) ─────────────────────────────────────────

/** Org-phase state: P1's company at Rivendell, Traitor in P2's cardsInPlay. */
function buildWithTraitorInPlay(p1Chars: CardDefinitionId[], copies = 1): GameState {
  let state = buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: p1Chars }], hand: [], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  for (let i = 0; i < copies; i++) state = addCardInPlay(state, 1, TRAITOR);
  return state;
}

/** Queue a corruption check on the given P1 character (modifier makes it fail/pass). */
function withCorruptionCheck(state: GameState, characterId: CardInstanceId, modifier: number): GameState {
  return enqueueResolution(state, {
    source: null,
    actor: PLAYER_1,
    scope: { kind: 'phase', phase: Phase.Organization },
    kind: { type: 'corruption-check', characterId, modifier, reason: 'test', possessions: [], transferredItemId: null },
  });
}

/** Fail Aragorn's corruption check (roll 2 - 12 = -10 vs CP → hard fail) with Traitor in play. */
function failedCheckState(p1Chars: CardDefinitionId[], copies = 1): GameState {
  const base = buildWithTraitorInPlay(p1Chars, copies);
  const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
  const s = withCorruptionCheck(base, aragornId, -12);
  return executeAction(s, PLAYER_1, 'corruption-check', 2);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Traitor (tw-105)', () => {
  beforeEach(() => resetMint());

  // ── #1: playable as an untargeted hazard permanent-event ───────────────────

  test('playable as a hazard permanent-event during the M/H phase', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TRAITOR], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };
    expect(viableActions(mhState, PLAYER_2, 'play-hazard')).toHaveLength(1);

    const traitorId = handCardId(mhState, HAZARD_PLAYER);
    const companyId = companyIdAt(mhState, RESOURCE_PLAYER);
    const s = playHazardAndResolve(mhState, PLAYER_2, traitorId, companyId);
    expect(s.players[1].cardsInPlay.map(c => c.definitionId)).toContain(TRAITOR);
  });

  // ── #2/#3/#6: failed check → traitor removed, card discarded, attack begins ─

  test('failed corruption check: traitor eliminated, Traitor discarded, 16-prowess attack initiated', () => {
    const s = failedCheckState([ARAGORN, LEGOLAS]);

    // The traitor failed hard (roll 2 - 12) → eliminated to the out-of-play pile.
    expect(s.players[0].outOfPlayPile.map(c => c.definitionId)).toContain(ARAGORN);

    // The Traitor card is consumed: out of cardsInPlay, into its owner's discard.
    expect(s.players[1].cardsInPlay).toHaveLength(0);
    expect(s.players[1].discardPile.map(c => c.definitionId)).toContain(TRAITOR);

    // The attack: 1 strike, prowess = Aragorn 6 + 10, traitor's race, no
    // creature body, body checks +1, opponent chooses the defender.
    const combat = s.combat!;
    expect(combat).not.toBeNull();
    expect(combat.attackSource.type).toBe('traitor-attack');
    expect(combat.strikesTotal).toBe(1);
    expect(combat.strikeProwess).toBe(16);
    expect(combat.creatureBody).toBeNull();
    expect(combat.creatureRace).toBe('dunadan');
    expect(combat.bodyCheckModifier).toBe(1);
    expect(combat.detainment).toBe(false);
    expect(combat.defendingPlayerId).toBe(PLAYER_1);
    expect(combat.attackingPlayerId).toBe(PLAYER_2);
    expect(combat.companyId).toBe(companyIdAt(s, RESOURCE_PLAYER));
    expect(combat.assignmentPhase).toBe('cancel-window');
    expect(combat.attackerChoosesDefenders).toBe(true);
  });

  // ── #4: the opponent of the traitor's controller chooses the target ────────

  test('the player who does not control the traitor\'s company assigns the strike', () => {
    let s = failedCheckState([ARAGORN, LEGOLAS]);
    const legolasId = findCharInstanceId(s, RESOURCE_PLAYER, LEGOLAS);

    // The defender's cancel-window: only P1 may act; passing hands assignment
    // to the ATTACKING player (P2), not the defender.
    s = executeAction(s, PLAYER_1, 'pass');
    expect(s.combat!.assignmentPhase).toBe('attacker');
    expect(viableActions(s, PLAYER_1, 'assign-strike')).toHaveLength(0);

    const assigns = viableActions(s, PLAYER_2, 'assign-strike');
    expect(assigns.length).toBeGreaterThan(0);
    expect(assigns.map(a => (a.action as { characterId: CardInstanceId }).characterId)).toContain(legolasId);

    s = executeAction(s, PLAYER_2, 'assign-strike');
    expect(s.combat!.strikeAssignments[0].characterId).toBe(legolasId);
  });

  // ── #5: any resulting body check is modified by +1 ─────────────────────────

  test('body check +1: a roll equal to body eliminates the struck character', () => {
    // Legolas body 8. Strike (16) vs his prowess → wounded. Body check roll 8:
    // 8 + 1 (attack modifier) = 9 > 8 → eliminated. Without the +1, a roll of
    // 8 equals body 8 and would only wound.
    let s = failedCheckState([ARAGORN, LEGOLAS]);
    const legolasId = findCharInstanceId(s, RESOURCE_PLAYER, LEGOLAS);

    s = executeAction(s, PLAYER_1, 'pass');
    s = executeAction(s, PLAYER_2, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    expect(s.combat!.phase).toBe('body-check');

    s = executeAction(s, PLAYER_2, 'body-check-roll', 8);
    expect(s.combat).toBeNull();
    expectCharNotInPlay(s, RESOURCE_PLAYER, legolasId);
    expect(s.players[0].outOfPlayPile.map(c => c.definitionId)).toContain(LEGOLAS);
  });

  test('body check boundary: a roll one below body survives (wounded, not eliminated)', () => {
    // Body check roll 7: 7 + 1 = 8, which equals body 8 (not greater) → wounded.
    let s = failedCheckState([ARAGORN, LEGOLAS]);
    const legolasId = findCharInstanceId(s, RESOURCE_PLAYER, LEGOLAS);

    s = executeAction(s, PLAYER_1, 'pass');
    s = executeAction(s, PLAYER_2, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = executeAction(s, PLAYER_2, 'body-check-roll', 7);

    expect(s.combat).toBeNull();
    expectCharInPlay(s, RESOURCE_PLAYER, legolasId);
    expectCharStatus(s, RESOURCE_PLAYER, LEGOLAS, CardStatus.Inverted);
  });

  // ── #6 (CRF): two copies — no extra effect, both discarded, one attack ─────

  test('two copies in play: both discarded on the one failed check, single 1-strike attack', () => {
    const s = failedCheckState([ARAGORN, LEGOLAS], 2);

    expect(s.players[1].cardsInPlay).toHaveLength(0);
    expect(s.players[1].discardPile.filter(c => c.definitionId === TRAITOR)).toHaveLength(2);

    expect(s.combat).not.toBeNull();
    expect(s.combat!.strikesTotal).toBe(1);
    expect(s.combat!.strikeProwess).toBe(16);
  });

  // ── no survivor: card still consumed, no attack possible ───────────────────

  test('traitor was alone in his company: Traitor is discarded but no attack is made', () => {
    const s = failedCheckState([ARAGORN]);

    expect(s.players[0].outOfPlayPile.map(c => c.definitionId)).toContain(ARAGORN);
    expect(s.players[1].cardsInPlay).toHaveLength(0);
    expect(s.players[1].discardPile.map(c => c.definitionId)).toContain(TRAITOR);
    expect(s.combat).toBeNull();
  });

  // ── #7: a passed check does not trigger ────────────────────────────────────

  test('passed corruption check: no attack, Traitor stays in play', () => {
    const base = buildWithTraitorInPlay([ARAGORN, LEGOLAS]);
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const s = executeAction(withCorruptionCheck(base, aragornId, 0), PLAYER_1, 'corruption-check', 12);

    expectCharInPlay(s, RESOURCE_PLAYER, aragornId);
    expect(s.combat).toBeNull();
    expect(s.players[1].cardsInPlay.map(c => c.definitionId)).toContain(TRAITOR);
    expect(s.players[1].discardPile.map(c => c.definitionId)).not.toContain(TRAITOR);
  });

  // ── #8 (CRF timing): a check failing mid-combat queues the attack ──────────

  test('check failed during an active combat: attack is queued and initiated when that combat ends', () => {
    const base = buildWithTraitorInPlay([ARAGORN, LEGOLAS]);
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    // A running zero-strike combat against P1's company (the shape a combat
    // takes when its strikes were all removed before assignment — it can only
    // fizzle via pass). The corruption check resolves while it is active.
    const runningCombat: CombatState = {
      attackSource: { type: 'company-strike-event', eventInstanceId: 'synthetic-combat' as CardInstanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 0,
      strikeProwess: 8,
      creatureBody: null,
      strikeAssignments: [],
      currentStrikeIndex: 0,
      phase: 'assign-strikes',
      assignmentPhase: 'defender',
      bodyCheckTarget: null,
      detainment: false,
    };
    let s: GameState = { ...withCorruptionCheck(base, aragornId, -12), combat: runningCombat };

    s = executeAction(s, PLAYER_1, 'corruption-check', 2);

    // The trigger consumed the card and queued the attack — the running combat
    // is untouched.
    expect(s.players[1].discardPile.map(c => c.definitionId)).toContain(TRAITOR);
    expect(s.combat!.attackSource.type).toBe('company-strike-event');
    expect(s.activeConstraints.some(c => c.kind.type === 'traitor-attack-queued')).toBe(true);

    // The running combat fizzles (zero strikes → pass) — the traitor attack
    // starts immediately after it ends.
    s = executeAction(s, PLAYER_1, 'pass');
    expect(s.activeConstraints.some(c => c.kind.type === 'traitor-attack-queued')).toBe(false);
    const combat = s.combat!;
    expect(combat).not.toBeNull();
    expect(combat.attackSource.type).toBe('traitor-attack');
    expect(combat.strikeProwess).toBe(16);
    expect(combat.strikesTotal).toBe(1);
    expect(combat.bodyCheckModifier).toBe(1);
    expect(combat.attackerChoosesDefenders).toBe(true);
  });
});
