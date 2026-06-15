/**
 * @module le-219.test
 *
 * Card test: Poisonous Despair (le-219)
 * Type: minion-resource-event (short, magic, spirit-magic)
 * Alignment: ringwraith
 *
 * "Magic. Spirit-magic. Playable on a spirit-magic-using character in response
 *  to an influence attempt against a character, ally, or item in his company.
 *  The attempt is canceled. If the character is a Ringwraith, he can also
 *  cancel an influence attempt against any of his factions. May be played
 *  during opponent's site phase. Unless he is a Ringwraith, he makes a
 *  corruption check modified by -3."
 *
 * Engine Support:
 * | # | Rule                                                        | Status      | Notes                                      |
 * |---|-------------------------------------------------------------|-------------|---------------------------------------------|
 * | 1 | Cancel influence attempt against character/ally in company  | IMPLEMENTED | cancel-influence effect with requiredRace   |
 * | 2 | Ringwraith plays it (spirit-magic via race=ringwraith)      | IMPLEMENTED | requiredRace: "ringwraith"                  |
 * | 3 | Ringwraith can also cancel faction influence                | IMPLEMENTED | Effect 1 has no targetKindFilter (all kinds)|
 * | 4 | Spirit-magic user can cancel char/ally (not faction) + cost | IMPLEMENTED | requiredSkill: spirit-magic + targetKindFilter + cost -3 |
 * | 4b| Shadow-magic-only non-Ringwraith cannot cancel             | IMPLEMENTED | gate is spirit-magic, not shadow-magic      |
 * | 5 | No corruption check for Ringwraith                         | IMPLEMENTED | Effect 1 has no cost field                  |
 * | 6 | Card discarded from hand after use                         | IMPLEMENTED | standard cancel-influence reducer           |
 * | 7 | Opponent influence attempt is canceled (no defense roll)   | IMPLEMENTED | dequeues opponent-influence-defend          |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN,
  MORIA,
  viableActions, makeSitePhase,
  attemptInfluence, dispatch,
  expectInDiscardPile, HAZARD_PLAYER,
  addCardInPlay,
} from '../test-helpers.js';
import type { CancelInfluenceAction } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** Poisonous Despair — the card under test */
const POISONOUS_DESPAIR = 'le-219' as CardDefinitionId;
/** Adûnaphel the Ringwraith — ringwraith-race avatar (le-50) */
const ADUNAPHEL = 'le-50' as CardDefinitionId;
/** Dôgrib — non-avatar minion character (le-7) with mind=5, to be the influence target */
const DOGRIB = 'le-7' as CardDefinitionId;
/** Golodhros — non-ringwraith character with spirit-magic skill, no shadow-magic (dm-14) */
const GOLODHROS = 'dm-14' as CardDefinitionId;
/** Firiel — non-ringwraith character with shadow-magic skill only, no spirit-magic (dm-10) */
const FIRIEL = 'dm-10' as CardDefinitionId;
/** Orcs of Moria — a minion faction playable at Moria (le-278), used to test faction cancel */
const ORCS_OF_MORIA = 'le-278' as CardDefinitionId;

// ── State builder ─────────────────────────────────────────────────────────────

/**
 * Build a Site phase state where:
 * - PLAYER_1 (hero/attacker) has ARAGORN at MORIA, untapped.
 * - PLAYER_2 (ringwraith/defender) has characters at MORIA, with POISONOUS_DESPAIR in hand.
 * - Both companies are at the same site so opponent influence is valid.
 * - Turn 3, siteEntered = true, cheatRollTotal fixed.
 */
function buildCancelState(opts: {
  p2Characters: CardDefinitionId[];
  hand?: CardDefinitionId[];
}): ReturnType<typeof buildTestState> {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      {
        id: PLAYER_2,
        companies: [{ site: MORIA, characters: opts.p2Characters }],
        hand: opts.hand ?? [POISONOUS_DESPAIR],
        siteDeck: [],
      },
    ],
    phase: Phase.Site,
    recompute: true,
  });
  return {
    ...state,
    turnNumber: 3,
    cheatRollTotal: 12,
    phaseState: makeSitePhase(),
  };
}

describe('Poisonous Despair (le-219)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1 + 2: Ringwraith cancels character influence ────────────────────

  test('cancel-influence available when Ringwraith is in defending player\'s company', () => {
    // PLAYER_2 has Adûnaphel (Ringwraith) + Dôgrib (non-avatar target) at MORIA
    const state = buildCancelState({ p2Characters: [ADUNAPHEL, DOGRIB] });

    // PLAYER_1 attempts influence against Dôgrib
    const { state: afterAttempt } = attemptInfluence(state, DOGRIB);

    expect(afterAttempt.pendingResolutions).toHaveLength(1);
    expect(afterAttempt.pendingResolutions[0].kind.type).toBe('opponent-influence-defend');

    const cancelActions = viableActions(afterAttempt, PLAYER_2, 'cancel-influence');
    expect(cancelActions).toHaveLength(1);
    const cancelAction = cancelActions[0].action as CancelInfluenceAction;
    expect(cancelAction.cardInstanceId).toBeDefined();
    expect(cancelAction.characterId).toBeDefined();
  });

  test('cancel-influence NOT available when no spirit-magic user in defending company', () => {
    // PLAYER_2 has only Dôgrib (race=man, no spirit-magic skill) and no card that matches
    const state = buildCancelState({ p2Characters: [DOGRIB], hand: [POISONOUS_DESPAIR] });

    // Dôgrib is the only character — PLAYER_1 can't target him if both players need characters
    // Use a state where PLAYER_1 can still attempt influence (requires another character as target)
    // For this test, use PLAYER_2 = [Dôgrib only], PLAYER_1 targets Dôgrib
    const { state: afterAttempt } = attemptInfluence(state, DOGRIB);
    const cancelActions = viableActions(afterAttempt, PLAYER_2, 'cancel-influence');
    expect(cancelActions).toHaveLength(0);
  });

  // ── Rule 7: Executing cancel-influence ───────────────────────────────────

  test('Ringwraith cancel: discards card, clears pending, NO corruption check', () => {
    const state = buildCancelState({ p2Characters: [ADUNAPHEL, DOGRIB] });
    const { state: afterAttempt } = attemptInfluence(state, DOGRIB);

    const cancelActions = viableActions(afterAttempt, PLAYER_2, 'cancel-influence');
    expect(cancelActions).toHaveLength(1);

    const after = dispatch(afterAttempt, cancelActions[0].action);

    // Pending influence defend is cleared
    expect(after.pendingResolutions.filter(r => r.kind.type === 'opponent-influence-defend')).toHaveLength(0);

    // Card discarded from hand
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(after, HAZARD_PLAYER, POISONOUS_DESPAIR);

    // No corruption check for Ringwraith
    expect(after.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  // ── Rule 3: Ringwraith can cancel faction influence ───────────────────────

  test('Ringwraith cancel-influence available for faction influence attempt', () => {
    // Set up a state where PLAYER_2 has Orcs of Moria faction in play (playable at Moria)
    const base = buildCancelState({ p2Characters: [ADUNAPHEL] });

    // Add Orcs of Moria to PLAYER_2's cardsInPlay
    const stateWithFaction = addCardInPlay(base, HAZARD_PLAYER, ORCS_OF_MORIA);

    // PLAYER_1 now attempts influence against the faction
    const factionInfluenceActions = viableActions(stateWithFaction, PLAYER_1, 'opponent-influence-attempt')
      .filter(ea => (ea.action as { targetKind?: string }).targetKind === 'faction');
    expect(factionInfluenceActions.length).toBeGreaterThan(0);

    const factionAttempt = factionInfluenceActions[0];
    const { state: afterAttempt } = { state: dispatch(stateWithFaction, factionAttempt.action) };

    expect(afterAttempt.pendingResolutions.some(r => r.kind.type === 'opponent-influence-defend')).toBe(true);

    const cancelActions = viableActions(afterAttempt, PLAYER_2, 'cancel-influence');
    expect(cancelActions).toHaveLength(1);
  });

  // ── Rule 4: Spirit-magic non-Ringwraith cancels character influence with cost ──

  test('spirit-magic non-Ringwraith cancel-influence available with corruption check cost', () => {
    // PLAYER_2 has Golodhros (race=dúnadan, spirit-magic skill) + Dôgrib (target) at MORIA
    const state = buildCancelState({ p2Characters: [GOLODHROS, DOGRIB] });
    const { state: afterAttempt } = attemptInfluence(state, DOGRIB);

    const cancelActions = viableActions(afterAttempt, PLAYER_2, 'cancel-influence');
    expect(cancelActions).toHaveLength(1);
  });

  test('spirit-magic non-Ringwraith cancel: discards card, clears pending, enqueues corruption check -3', () => {
    const state = buildCancelState({ p2Characters: [GOLODHROS, DOGRIB] });
    const { state: afterAttempt } = attemptInfluence(state, DOGRIB);

    const cancelActions = viableActions(afterAttempt, PLAYER_2, 'cancel-influence');
    expect(cancelActions).toHaveLength(1);

    const after = dispatch(afterAttempt, cancelActions[0].action);

    // Pending influence defend is cleared
    expect(after.pendingResolutions.filter(r => r.kind.type === 'opponent-influence-defend')).toHaveLength(0);

    // Card discarded from hand
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(after, HAZARD_PLAYER, POISONOUS_DESPAIR);

    // Corruption check enqueued with -3 modifier for non-Ringwraith
    const ccPending = after.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(ccPending).toHaveLength(1);
    const ccKind = ccPending[0].kind as { type: 'corruption-check'; modifier: number };
    expect(ccKind.modifier).toBe(-3);
  });

  // ── Rule 4 (negative): Spirit-magic non-Ringwraith cannot cancel faction influence ──

  test('spirit-magic non-Ringwraith cannot cancel faction influence', () => {
    // PLAYER_2 has Golodhros only, no Ringwraith
    const base = buildCancelState({ p2Characters: [GOLODHROS] });
    const stateWithFaction = addCardInPlay(base, HAZARD_PLAYER, ORCS_OF_MORIA);

    const factionInfluenceActions = viableActions(stateWithFaction, PLAYER_1, 'opponent-influence-attempt')
      .filter(ea => (ea.action as { targetKind?: string }).targetKind === 'faction');
    expect(factionInfluenceActions.length).toBeGreaterThan(0);

    const { state: afterAttempt } = { state: dispatch(stateWithFaction, factionInfluenceActions[0].action) };
    const cancelActions = viableActions(afterAttempt, PLAYER_2, 'cancel-influence');
    expect(cancelActions).toHaveLength(0);
  });

  // ── Rule 4b (negative): the gate is spirit-magic, NOT shadow-magic ──────────

  test('shadow-magic-only non-Ringwraith cannot cancel (gate is spirit-magic)', () => {
    // PLAYER_2 has Firiel (dúnadan, shadow-magic only, no spirit-magic) + Dôgrib (target).
    // Before the fix the effect required shadow-magic, so Firiel could wrongly cancel;
    // after the fix the card correctly requires spirit-magic, so she cannot.
    const state = buildCancelState({ p2Characters: [FIRIEL, DOGRIB] });
    const { state: afterAttempt } = attemptInfluence(state, DOGRIB);

    const cancelActions = viableActions(afterAttempt, PLAYER_2, 'cancel-influence');
    expect(cancelActions).toHaveLength(0);
  });

  // ── Defender can roll instead of playing Poisonous Despair ───────────────

  test('defender can choose to roll instead of canceling', () => {
    const state = buildCancelState({ p2Characters: [ADUNAPHEL, DOGRIB] });
    const { state: afterAttempt } = attemptInfluence(state, DOGRIB);

    const defendActions = viableActions(afterAttempt, PLAYER_2, 'opponent-influence-defend');
    expect(defendActions).toHaveLength(1);

    const after = dispatch(afterAttempt, defendActions[0].action);
    expect(after.pendingResolutions.filter(r => r.kind.type === 'opponent-influence-defend')).toHaveLength(0);
  });
});
