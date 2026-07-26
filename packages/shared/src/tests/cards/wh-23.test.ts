/**
 * @module wh-23.test
 *
 * Card test: Inner Rot (wh-23)
 * Type: hazard-event (permanent, character-targeting corruption hazard)
 *
 * Printed text:
 *   "Corruption. Playable on a Wizard or a Fallen-wizard. He receives 1
 *    corruption point (CP). If he is a Fallen-wizard, he receives 2 stage
 *    points and the CPs received are instead: 4 CPs if his stage points (SPs)
 *    exceed 18, 3 CPs if his SPs exceed 11, 2 CPs if his SPs exceed 5, 1 CP if
 *    his SPs exceed 0 (use the first that applies). The target makes a
 *    corruption check whenever his controlling player plays a stage card.
 *    Cannot be duplicated on a given character. During his organization phase,
 *    target may tap to attempt to remove this card. Make a roll—if this result
 *    is greater than 6, discard this card."
 *
 * Card shape (data): 10 effects —
 *   1. play-target character, filter `target.race $in [wizard, fallen-wizard]`
 *   2. duplication-limit scope character, max 1
 *   3. stage-points 2, when `bearer.race = fallen-wizard`
 *   4. stat-modifier corruption-points +1, when `bearer.race = wizard`
 *   5-8. stat-modifier corruption-points +4/+3/+2/+1 for a fallen-wizard
 *        bearer, gated on the half-open `bearer.stagePoints` bands
 *        (>18 / 11<x<=18 / 5<x<=11 / 0<x<=5) so exactly one band ever matches
 *        — the DSL equivalent of "use the first that applies"
 *   9. on-event `stage-card-played` → force-check corruption on the bearer
 *   10. grant-action remove-self-on-roll, cost tap bearer, threshold 7
 *
 * Engine Support:
 * | # | Feature                                    | Status      | Notes                                        |
 * |---|--------------------------------------------|-------------|----------------------------------------------|
 * | 1 | Play targeting a Wizard/Fallen-wizard      | IMPLEMENTED | play-hazard with targetCharacterId filter    |
 * | 2 | Cannot be duplicated on a character        | IMPLEMENTED | duplication-limit scope:character max:1      |
 * | 3 | Wizard bearer receives 1 CP                | IMPLEMENTED | stat-modifier gated on bearer.race           |
 * | 4 | Fallen-wizard bearer receives 2 SPs        | IMPLEMENTED | `when`-gated stage-points on an attached     |
 * |   |                                            |             | hazard, summed by recompute-derived          |
 * | 5 | Fallen-wizard CP tiers by stage points     | IMPLEMENTED | bearer.stagePoints exposed to effective-stats|
 * |   |                                            |             | (computed before the per-character pass, so  |
 * |   |                                            |             | the card's own 2 SPs are already counted)    |
 * | 6 | Corruption check on each stage card played | IMPLEMENTED | on-event stage-card-played fired from the    |
 * |   |                                            |             | permanent-event / item / ally / faction seams|
 * | 7 | Tap to attempt removal (roll > 6)          | IMPLEMENTED | grant-action remove-self-on-roll             |
 *
 * Playable: YES
 * Certified: 2026-07-26
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachHazardToChar, addCardInPlay, recomputeDerived,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  makeMHState, findCharInstanceId, charIdAt, handCardId,
  viableActions, CardStatus, dispatch, expectCharStatus, expectInDiscardPile,
  playPermanentEventAndResolve,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment, computeLegalActions } from '../../index.js';
import type { ActivateGrantedAction, CardDefinitionId, PlayHazardAction } from '../../index.js';

const INNER_ROT = 'wh-23' as CardDefinitionId;
/** Gandalf the Fallen-wizard (race fallen-wizard). */
const GANDALF_FW = 'wh-4' as CardDefinitionId;
/** Isengard, a Fallen-wizard Wizardhaven. */
const ISENGARD_WH = 'wh-56' as CardDefinitionId;

// Stage permanent-events whose only effect is `stage-points` — used to dial the
// Fallen-wizard's running total to each tier boundary.
const A_MERRIER_WORLD = 'wh-59' as CardDefinitionId;  // 2 SP
const BLIND_TO_ALL_ELSE = 'wh-64' as CardDefinitionId; // 2 SP
const GNAWED_WAYS = 'wh-71' as CardDefinitionId;       // 1 SP
const NEVER_REFUSE = 'wh-78' as CardDefinitionId;      // 2 SP
const PLOTTING_RUIN = 'wh-79' as CardDefinitionId;     // 3 SP
const SHAMEFUL_DEEDS = 'wh-80' as CardDefinitionId;    // 4 SP
const OROMES_WARDERS = 'wh-94' as CardDefinitionId;    // 3 SP
/** A hero (non-stage) permanent-event: Gates of Morning. */
const GATES_OF_MORNING = 'tw-243' as CardDefinitionId;

describe('Inner Rot (wh-23)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: playable on a Wizard or a Fallen-wizard ──────────────────────────

  test('offered as a viable hazard play only on a Wizard, not on other characters', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INNER_ROT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const viableTargets = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
      .map(ea => (ea.action as PlayHazardAction).targetCharacterId);

    // Gandalf (a Wizard) is the only valid target; Aragorn (Dúnadan) is filtered.
    expect(viableTargets).toEqual([findCharInstanceId(base, RESOURCE_PLAYER, GANDALF)]);
  });

  test('offered on a Fallen-wizard bearer too', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [GANDALF_FW, ARAGORN] }], hand: [], siteDeck: [ISENGARD_WH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INNER_ROT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const viableTargets = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
      .map(ea => (ea.action as PlayHazardAction).targetCharacterId);

    expect(viableTargets).toEqual([findCharInstanceId(base, RESOURCE_PLAYER, GANDALF_FW)]);
  });

  // ─── Rule: cannot be duplicated on a given character ─────────────────────────

  test('cannot be duplicated on a given character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INNER_ROT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // One copy already on Gandalf blocks a second copy on him; Aragorn is
    // race-filtered, so no viable play remains at all.
    const withOne = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, INNER_ROT);
    const stateAtPlayHazards = { ...withOne, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const viablePlays = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');
    expect(viablePlays).toHaveLength(0);
  });

  // ─── Rule: a Wizard bearer receives 1 CP (and no stage points) ───────────────

  test('a Wizard bearer receives exactly 1 corruption point', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gandalfId = charIdAt(base, RESOURCE_PLAYER);
    expect(base.players[0].characters[gandalfId].effectiveStats.corruptionPoints).toBe(0);

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, INNER_ROT));
    expect(withCard.players[0].characters[gandalfId].effectiveStats.corruptionPoints).toBe(1);
    // The stage-point clause is Fallen-wizard only — a hero Wizard's player
    // accrues nothing.
    expect(withCard.players[0].stagePoints).toBe(0);
  });

  // ─── Rule: a Fallen-wizard bearer receives 2 stage points ────────────────────

  test('a Fallen-wizard bearer receives 2 stage points', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: ISENGARD_WH, characters: [GANDALF_FW] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(base.players[0].stagePoints).toBe(0);

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, GANDALF_FW, INNER_ROT));
    expect(withCard.players[0].stagePoints).toBe(2);
  });

  // ─── Rule: Fallen-wizard CP tiers, "use the first that applies" ──────────────
  //
  // Inner Rot's own 2 stage points are part of the total the tier is read from,
  // so each case seeds `extra` stage cards and expects a total of `extra + 2`.

  test.each([
    // extra stage cards in play, resulting SP total, CPs received
    { extras: [PLOTTING_RUIN],                                                                    total: 5,  cps: 1 },
    { extras: [SHAMEFUL_DEEDS],                                                                   total: 6,  cps: 2 },
    { extras: [SHAMEFUL_DEEDS, OROMES_WARDERS, A_MERRIER_WORLD],                                  total: 11, cps: 2 },
    { extras: [SHAMEFUL_DEEDS, OROMES_WARDERS, PLOTTING_RUIN],                                    total: 12, cps: 3 },
    { extras: [SHAMEFUL_DEEDS, OROMES_WARDERS, PLOTTING_RUIN, A_MERRIER_WORLD, BLIND_TO_ALL_ELSE, NEVER_REFUSE],               total: 18, cps: 3 },
    { extras: [SHAMEFUL_DEEDS, OROMES_WARDERS, PLOTTING_RUIN, A_MERRIER_WORLD, BLIND_TO_ALL_ELSE, NEVER_REFUSE, GNAWED_WAYS],  total: 19, cps: 4 },
  ])('a Fallen-wizard at $total stage points receives $cps corruption point(s)', ({ extras, total, cps }) => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: ISENGARD_WH, characters: [GANDALF_FW] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    for (const extra of extras) state = addCardInPlay(state, RESOURCE_PLAYER, extra);
    state = recomputeDerived(attachHazardToChar(state, RESOURCE_PLAYER, GANDALF_FW, INNER_ROT));

    const gandalfId = charIdAt(state, RESOURCE_PLAYER);
    expect(state.players[0].stagePoints).toBe(total);
    expect(state.players[0].characters[gandalfId].effectiveStats.corruptionPoints).toBe(cps);
  });

  // ─── Rule: corruption check whenever the controller plays a stage card ───────

  test('playing a stage card makes the bearer take a corruption check', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: ISENGARD_WH, characters: [GANDALF_FW] }], hand: [A_MERRIER_WORLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF_FW, INNER_ROT);
    expect(withCard.pendingResolutions).toHaveLength(0);

    const stageCardId = handCardId(withCard, RESOURCE_PLAYER);
    const after = playPermanentEventAndResolve(withCard, PLAYER_1, stageCardId);

    // The stage card is in play and the bearer owes a corruption check.
    expect(after.players[0].cardsInPlay.map(c => c.definitionId)).toContain(A_MERRIER_WORLD);
    const pending = after.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.reason).toBe('Inner Rot');
    expect(pending[0].kind.characterId).toBe(charIdAt(after, RESOURCE_PLAYER));
  });

  test('playing a NON-stage permanent event does not trigger the check', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, INNER_ROT);
    const eventId = handCardId(withCard, RESOURCE_PLAYER);
    const after = playPermanentEventAndResolve(withCard, PLAYER_1, eventId);

    expect(after.players[0].cardsInPlay.map(c => c.definitionId)).toContain(GATES_OF_MORNING);
    expect(after.pendingResolutions).toHaveLength(0);
  });

  test('a stage card played by the OPPONENT does not trigger the bearer\'s check', () => {
    // Inner Rot rides player 1's Fallen-wizard; player 2 is the one who plays a
    // stage card. "his controlling player" is player 1, so nothing fires.
    const base = buildTestState({
      activePlayer: PLAYER_2,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: ISENGARD_WH, characters: [GANDALF_FW] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.FallenWizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [A_MERRIER_WORLD], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF_FW, INNER_ROT);
    const stageCardId = handCardId(withCard, HAZARD_PLAYER);
    const after = playPermanentEventAndResolve(withCard, PLAYER_2, stageCardId);

    expect(after.players[1].cardsInPlay.map(c => c.definitionId)).toContain(A_MERRIER_WORLD);
    expect(after.pendingResolutions).toHaveLength(0);
  });

  // ─── Rule: tap during the organization phase to attempt removal ──────────────

  test('successful removal roll (>6) discards the card and taps the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, INNER_ROT);
    const cheated = { ...withCard, cheatRollTotal: 7 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    const standardAction = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)!.action as ActivateGrantedAction;
    expect(standardAction.actionId).toBe('remove-self-on-roll');
    expect(standardAction.rollThreshold).toBe(7);

    const next = dispatch(cheated, standardAction);
    expectCharStatus(next, RESOURCE_PLAYER, GANDALF, CardStatus.Tapped);
    const gandalfId = charIdAt(next, RESOURCE_PLAYER);
    expect(next.players[0].characters[gandalfId].hazards).toHaveLength(0);
    expectInDiscardPile(next, HAZARD_PLAYER, INNER_ROT);
  });

  test('failed removal roll (<=6) keeps the card attached but still taps the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, INNER_ROT);
    const cheated = { ...withCard, cheatRollTotal: 6 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    const standardAction = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)!.action;
    const next = dispatch(cheated, standardAction);

    expectCharStatus(next, RESOURCE_PLAYER, GANDALF, CardStatus.Tapped);
    const gandalfId = charIdAt(next, RESOURCE_PLAYER);
    expect(next.players[0].characters[gandalfId].hazards).toHaveLength(1);
    expect(next.players[0].characters[gandalfId].hazards[0].definitionId).toBe(INNER_ROT);
  });
});
