/**
 * @module wh-106.test
 *
 * Card test: Prophet of Doom (wh-106)
 * Type: minion-resource-event (Fallen-wizard stage resource permanent-event,
 *       Pallando-specific)
 *
 * Printed text:
 *   "Pallando specific. Playable if you are Pallando and have at least 12 stage
 *    points and 5 factions in play. Pallando need not be at the appropriate site
 *    when making an influence attempt on an opponent's resource or character.
 *    Such an influence check is modified by half (rounded up) of Pallando's
 *    unused general influence (to a maximum of 10) instead of his unused direct
 *    influence. Subtract from the attempt the number of regions between
 *    Pallando's site and the site where the influence attempt would normally be
 *    made. Discard if you have fewer than 5 factions in play. Cannot be
 *    duplicated."
 *
 * Card shape (data):
 *   - `alignment: "stage"`, `eventType: "permanent"`, MP 3 (category misc,
 *     unconditional — printed in the top-left corner independent of the
 *     play-condition that gates playing the card);
 *     carries the `pallando-specific` keyword.
 *   - effects:
 *     1. stage-points (3) — its printed stage value (MEWH §1).
 *     2. play-condition player-state — playable only while the player's avatar
 *        is Pallando, `stagePoints >= 12`, and `factionCount >= 5`.
 *     3. opponent-influence-override — while in play, Pallando's opponent
 *        influence attempts (CoE 10.10) may reach any site, add half (rounded
 *        up, max 10) of the player's unused general influence in place of his
 *        unused direct influence, and are reduced by the inclusive region
 *        distance to the target's site (CRF 22).
 *     4. discard-self-when — discarded once `factionCount < 5`.
 *     5. duplication-limit (game) — "Cannot be duplicated".
 *
 * All tests drive the reducer / legal-action / sweep pipeline; the card shape is
 * documented here rather than asserted against the JSON.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint, Phase, Alignment,
  PLAYER_1, RESOURCE_PLAYER, HAZARD_PLAYER,
  buildFallenWizardInfluenceState, viableActions, attemptInfluence, defendInfluence,
  findCharInstanceId, recomputeDerived, opponentInfluenceAttempt,
  expectCharInPlay, expectCharNotInPlay,
  LEGOLAS, GIMLI, BILBO, MORIA, ISENGARD, RIVENDELL,
} from '../test-helpers.js';
import { sweepDiscardSelfWhen } from '../../engine/discard-self-when.js';
import type { CardDefinitionId } from '../../index.js';

const PROPHET_OF_DOOM = 'wh-106' as CardDefinitionId; // the card under test
const PALLANDO_FW = 'wh-7' as CardDefinitionId; // Fallen-wizard Pallando (DI 7, GI 20)
const SARUMAN_FW = 'wh-9' as CardDefinitionId; // a different Fallen-wizard avatar

// Five plain minion factions (no leader-control) to satisfy "5 factions in play".
const FIVE_FACTIONS = ['le-265', 'le-278', 'le-260', 'le-266', 'le-271'] as CardDefinitionId[];

describe('Prophet of Doom (wh-106)', () => {
  beforeEach(() => resetMint());

  // ─── Playable if you are Pallando, ≥12 stage points, 5 factions in play ─────

  test('playable by Pallando with 12 stage points and 5 factions in play', () => {
    const state = buildFallenWizardInfluenceState({
      avatar: PALLANDO_FW, p1Site: ISENGARD, p2Site: RIVENDELL,
      phase: Phase.Organization, p1Hand: [PROPHET_OF_DOOM],
      stagePoints: 12, factions: FIVE_FACTIONS,
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(1);
  });

  test('NOT playable with only 11 stage points', () => {
    const state = buildFallenWizardInfluenceState({
      avatar: PALLANDO_FW, p1Site: ISENGARD, p2Site: RIVENDELL,
      phase: Phase.Organization, p1Hand: [PROPHET_OF_DOOM],
      stagePoints: 11, factions: FIVE_FACTIONS,
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT playable with only 4 factions in play', () => {
    const state = buildFallenWizardInfluenceState({
      avatar: PALLANDO_FW, p1Site: ISENGARD, p2Site: RIVENDELL,
      phase: Phase.Organization, p1Hand: [PROPHET_OF_DOOM],
      stagePoints: 12, factions: FIVE_FACTIONS.slice(0, 4),
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT playable by a non-Pallando Fallen-wizard (Pallando specific)', () => {
    const state = buildFallenWizardInfluenceState({
      avatar: SARUMAN_FW, p1Site: ISENGARD, p2Site: RIVENDELL,
      phase: Phase.Organization, p1Hand: [PROPHET_OF_DOOM],
      stagePoints: 12, factions: FIVE_FACTIONS,
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('Cannot be duplicated: a second copy is not playable while one is in play', () => {
    const state = buildFallenWizardInfluenceState({
      avatar: PALLANDO_FW, p1Site: ISENGARD, p2Site: RIVENDELL,
      phase: Phase.Organization, p1Hand: [PROPHET_OF_DOOM],
      stagePoints: 12, factions: FIVE_FACTIONS, p1CardsInPlay: [PROPHET_OF_DOOM],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ─── Pallando need not be at the appropriate site ───────────────────────────

  test('without the card, Pallando cannot influence an opponent at a different site', () => {
    const state = buildFallenWizardInfluenceState({
      avatar: PALLANDO_FW, p1Site: ISENGARD, p2Site: RIVENDELL,
      p2Chars: [LEGOLAS], p2Alignment: Alignment.Wizard,
    });
    expect(viableActions(state, PLAYER_1, 'opponent-influence-attempt')).toHaveLength(0);
  });

  test('with the card in play, Pallando may influence an opponent at a different site', () => {
    const state = buildFallenWizardInfluenceState({
      avatar: PALLANDO_FW, p1Site: ISENGARD, p2Site: RIVENDELL,
      p2Chars: [LEGOLAS], p2Alignment: Alignment.Wizard,
      p1CardsInPlay: [PROPHET_OF_DOOM],
    });
    const legolasId = findCharInstanceId(state, HAZARD_PLAYER, LEGOLAS);
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt');
    expect(actions.some(a => {
      const act = a.action as { targetInstanceId?: string };
      return act.targetInstanceId === (legolasId as string);
    })).toBe(true);
  });

  // ─── GI substitution and region penalty (payload) ───────────────────────────

  test('influence check uses half of unused general influence (10) instead of DI (7)', () => {
    // Pallando GI 20, no followers → unused GI 20 → ceil(20/2)=10 (cap 10).
    const state = buildFallenWizardInfluenceState({
      avatar: PALLANDO_FW, p1Site: MORIA, p2Site: MORIA,
      p2Chars: [LEGOLAS, GIMLI, BILBO], p2Alignment: Alignment.Wizard,
      p1CardsInPlay: [PROPHET_OF_DOOM],
    });
    const { state: afterAttempt } = attemptInfluence(state, LEGOLAS);
    const attempt = opponentInfluenceAttempt(afterAttempt)!;
    expect(attempt).toBeDefined();
    expect(attempt.influencerDI).toBe(10); // GI substitution, not Pallando's DI (7)
  });

  test('without the card, the same attempt uses Pallando\'s unused DI (7) and no region penalty', () => {
    const state = buildFallenWizardInfluenceState({
      avatar: PALLANDO_FW, p1Site: MORIA, p2Site: MORIA,
      p2Chars: [LEGOLAS, GIMLI, BILBO], p2Alignment: Alignment.Wizard,
    });
    const { state: afterAttempt } = attemptInfluence(state, LEGOLAS);
    const attempt = opponentInfluenceAttempt(afterAttempt)!;
    expect(attempt.influencerDI).toBe(7);
    expect(attempt.regionPenalty ?? 0).toBe(0);
  });

  test('same-region attempt carries an inclusive region penalty of 1', () => {
    const state = buildFallenWizardInfluenceState({
      avatar: PALLANDO_FW, p1Site: MORIA, p2Site: MORIA,
      p2Chars: [LEGOLAS, GIMLI, BILBO], p2Alignment: Alignment.Wizard,
      p1CardsInPlay: [PROPHET_OF_DOOM],
    });
    const { state: afterAttempt } = attemptInfluence(state, LEGOLAS);
    expect(opponentInfluenceAttempt(afterAttempt)!.regionPenalty).toBe(1);
  });

  test('reaching a distant site carries a region penalty greater than 1', () => {
    // Isengard (Gap of Isen) → Rivendell (Rhudaur): several regions apart.
    const state = buildFallenWizardInfluenceState({
      avatar: PALLANDO_FW, p1Site: ISENGARD, p2Site: RIVENDELL,
      p2Chars: [LEGOLAS], p2Alignment: Alignment.Wizard,
      p1CardsInPlay: [PROPHET_OF_DOOM],
    });
    const { state: afterAttempt } = attemptInfluence(state, LEGOLAS);
    expect(opponentInfluenceAttempt(afterAttempt)!.regionPenalty!).toBeGreaterThan(1);
  });

  // ─── The region penalty feeds the resolution math ───────────────────────────
  //
  // Same-region attempt: contribution 10, opponent GI 3, controllerDI 0,
  // cross-alignment 0 (F vs hero), region penalty 1.
  //   final = attackerRoll + 10 - 3 - defenderRoll - 1  =  attackerRoll - defenderRoll + 6
  // Target Legolas mind 6, so success requires final > 6, i.e. attackerRoll >
  // defenderRoll. At equal rolls the -1 region penalty is exactly what makes it
  // fail (without it the result would be 7 > 6).

  test('equal rolls fail because of the region penalty (would succeed without it)', () => {
    let state = buildFallenWizardInfluenceState({
      avatar: PALLANDO_FW, p1Site: MORIA, p2Site: MORIA,
      p2Chars: [LEGOLAS, GIMLI, BILBO], p2Alignment: Alignment.Wizard,
      p1CardsInPlay: [PROPHET_OF_DOOM],
    });
    state = { ...state, cheatRollTotal: 6 };
    const { state: afterAttempt } = attemptInfluence(state, LEGOLAS);
    const { state: afterDefend } = defendInfluence({ ...afterAttempt, cheatRollTotal: 6 });
    const legolasId = findCharInstanceId(state, HAZARD_PLAYER, LEGOLAS);
    expectCharInPlay(afterDefend, HAZARD_PLAYER, legolasId); // final = 6, not > 6 → fails
  });

  test('one higher attacker roll clears the region penalty and succeeds', () => {
    let state = buildFallenWizardInfluenceState({
      avatar: PALLANDO_FW, p1Site: MORIA, p2Site: MORIA,
      p2Chars: [LEGOLAS, GIMLI, BILBO], p2Alignment: Alignment.Wizard,
      p1CardsInPlay: [PROPHET_OF_DOOM],
    });
    state = { ...state, cheatRollTotal: 7 };
    const { state: afterAttempt } = attemptInfluence(state, LEGOLAS);
    const { state: afterDefend } = defendInfluence({ ...afterAttempt, cheatRollTotal: 6 });
    const legolasId = findCharInstanceId(state, HAZARD_PLAYER, LEGOLAS);
    expectCharNotInPlay(afterDefend, HAZARD_PLAYER, legolasId); // final = 7 > 6 → succeeds
  });

  // ─── Discard if you have fewer than 5 factions in play ───────────────────────

  test('discarded once fewer than 5 factions are in play', () => {
    let state = buildFallenWizardInfluenceState({
      avatar: PALLANDO_FW, p1Site: ISENGARD, p2Site: RIVENDELL,
      phase: Phase.Organization,
      factions: FIVE_FACTIONS.slice(0, 4), p1CardsInPlay: [PROPHET_OF_DOOM],
    });
    state = recomputeDerived(sweepDiscardSelfWhen(state));
    const p = state.players[RESOURCE_PLAYER];
    expect(p.cardsInPlay.some(c => c.definitionId === PROPHET_OF_DOOM)).toBe(false);
    expect(p.discardPile.some(c => c.definitionId === PROPHET_OF_DOOM)).toBe(true);
  });

  test('stays in play while 5 factions remain', () => {
    let state = buildFallenWizardInfluenceState({
      avatar: PALLANDO_FW, p1Site: ISENGARD, p2Site: RIVENDELL,
      phase: Phase.Organization,
      factions: FIVE_FACTIONS, p1CardsInPlay: [PROPHET_OF_DOOM],
    });
    state = sweepDiscardSelfWhen(state);
    expect(state.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === PROPHET_OF_DOOM)).toBe(true);
  });

  // ─── Miscellaneous marshalling points: 3, unconditional ─────────────────────
  //
  // The card's printed MP value (top-left corner) is separate from its
  // stage-points value and from the play-condition that gates playing it —
  // once in play, it scores 3 misc MP regardless of stage points or faction
  // count (a report incorrectly assumed it was gated on the play-condition).

  test('scores 3 misc marshalling points while in play, independent of stage points', () => {
    const state = buildFallenWizardInfluenceState({
      avatar: PALLANDO_FW, p1Site: ISENGARD, p2Site: RIVENDELL,
      p1CardsInPlay: [PROPHET_OF_DOOM], stagePoints: 0,
    });
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(3);
  });
});
