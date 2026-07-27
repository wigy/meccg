/**
 * @module wh-16.test
 *
 * Card test: Cruel Claw Perceived (wh-16)
 * Type: hazard-event (permanent, character-targeting influence hazard)
 *
 * Printed text:
 *   "Playable on a Wizard, Fallen-wizard, or Ringwraith. His general influence
 *    is modified by -1. If he is a Fallen-wizard, this modifier is instead: -9
 *    if his stage points (SPs) exceed 20, -7 if his SPs exceed 15, -5 if his
 *    SPs exceed 10, or -3 if his SPs exceed 5 (use the first modifier that
 *    applies). Additionally, the Fallen-wizard's hand size is reduced by 1 if
 *    his SPs exceed 10, and by 1 more if his SPs exceed 20. Cannot be
 *    duplicated on a given character. Discard when any play deck is exhausted."
 *
 * Card shape (data): 10 effects —
 *   1. play-target character, filter
 *      `target.race $in [wizard, fallen-wizard, ringwraith]`
 *   2. duplication-limit scope character, max 1
 *   3. stat-modifier general-influence -1, when `bearer.race $in [wizard,
 *      ringwraith]` — the printed base modifier, which the Fallen-wizard ladder
 *      *replaces* rather than stacks with ("this modifier is instead")
 *   4-7. stat-modifier general-influence -9 / -7 / -5 / -3 for a fallen-wizard
 *      bearer, gated on the half-open `bearer.stagePoints` bands
 *      (>20 / 15<x<=20 / 10<x<=15 / 5<x<=10) so exactly one band ever matches —
 *      the DSL equivalent of "use the first modifier that applies". A
 *      Fallen-wizard at 5 SPs or fewer falls off the bottom of the printed
 *      ladder and therefore takes no modifier at all, exactly as Inner Rot
 *      (wh-23) gives 0 CPs below its own bottom band.
 *   8. hand-size-modifier -1, when fallen-wizard and `bearer.stagePoints > 10`
 *   9. hand-size-modifier -1, when fallen-wizard and `bearer.stagePoints > 20`
 *      (the two stack, so above 20 SPs the reduction is 2)
 *   10. on-event `play-deck-exhausted` → move self → discard
 *
 * Engine Support:
 * | # | Feature                                       | Status      | Notes                                          |
 * |---|-----------------------------------------------|-------------|------------------------------------------------|
 * | 1 | Play on a Wizard / Fallen-wizard / Ringwraith | IMPLEMENTED | play-hazard with a `target.race` filter        |
 * | 2 | Cannot be duplicated on a character           | IMPLEMENTED | duplication-limit scope:character max:1        |
 * | 3 | General influence modified by -1              | IMPLEMENTED | `stat-modifier` general-influence collected    |
 * |   |                                               |             | from an attached **hazard** (new) and honoring |
 * |   |                                               |             | the effect's `when` against the bearer context |
 * | 4 | Fallen-wizard GI ladder by stage points       | IMPLEMENTED | `bearer.stagePoints` added to the              |
 * |   |                                               |             | general-influence collection context           |
 * | 5 | Fallen-wizard hand-size reduction (stacking)  | IMPLEMENTED | `bearer.stagePoints` added to the hand-size    |
 * |   |                                               |             | resolver context; negative modifiers sum       |
 * | 6 | Discard when any play deck is exhausted       | IMPLEMENTED | `completeDeckExhaust` now also sweeps          |
 * |   |                                               |             | character-attached items/hazards carrying the  |
 * |   |                                               |             | `play-deck-exhausted` self-discard trigger     |
 *
 * Playable: YES
 * Certified: 2026-07-27
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachHazardToChar, addCardInPlay, recomputeDerived,
  effectiveGeneralInfluence,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, GANDALF,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  makeMHState, findCharInstanceId, charIdAt,
  dispatch, expectInDiscardPile,
  Alignment,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, PlayHazardAction } from '../../index.js';
import { HAND_SIZE } from '../../constants.js';
import { resolveHandSize } from '../../engine/effects/index.js';

const CRUEL_CLAW = 'wh-16' as CardDefinitionId;
/** Gandalf the Fallen-wizard (race fallen-wizard, printed general influence 18). */
const GANDALF_FW = 'wh-4' as CardDefinitionId;
/** Isengard, a Fallen-wizard Wizardhaven. */
const ISENGARD_WH = 'wh-56' as CardDefinitionId;
/** The Witch-king — Ringwraith avatar (race ringwraith). */
const THE_WITCH_KING = 'le-58' as CardDefinitionId;
/** Gorbag — a non-avatar minion (orc) character, played as a follower. */
const GORBAG = 'le-11' as CardDefinitionId;
/** Dol Guldur / Minas Morgul — minion Darkhavens. */
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
/** A hero creature and item used only as discard-pile filler for deck exhaustion. */
const CAVE_DRAKE = 'tw-56' as CardDefinitionId;
const DAGGER_OF_WESTERNESSE = 'tw-215' as CardDefinitionId;

// Stage permanent-events whose only effect is `stage-points` — used to dial the
// Fallen-wizard's running total to each ladder boundary.
const A_MERRIER_WORLD = 'wh-59' as CardDefinitionId;        // 2 SP
const BLIND_TO_ALL_ELSE = 'wh-64' as CardDefinitionId;      // 2 SP
const GNAWED_WAYS = 'wh-71' as CardDefinitionId;            // 1 SP
const GREAT_RUSE = 'wh-73' as CardDefinitionId;             // 1 SP
const NEVER_REFUSE = 'wh-78' as CardDefinitionId;           // 2 SP
const PLOTTING_RUIN = 'wh-79' as CardDefinitionId;          // 3 SP
const SHAMEFUL_DEEDS = 'wh-80' as CardDefinitionId;         // 4 SP
const SPELLS_BORN_OF_DISCORD = 'wh-81' as CardDefinitionId; // 2 SP
const OROMES_WARDERS = 'wh-94' as CardDefinitionId;         // 3 SP
const THE_GREY_HAT = 'wh-101' as CardDefinitionId;          // 1 SP

/** Gandalf the Fallen-wizard's printed general influence (wh-4). */
const FW_BASE_GI = 18;
/** The default general-influence pool for every other alignment (CoE 1.54). */
const BASE_GI = 20;

describe('Cruel Claw Perceived (wh-16)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: playable on a Wizard, Fallen-wizard, or Ringwraith ───────────────

  test('offered as a viable hazard play on a Wizard, but not on other characters', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CRUEL_CLAW], siteDeck: [MINAS_TIRITH] },
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
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CRUEL_CLAW], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const viableTargets = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
      .map(ea => (ea.action as PlayHazardAction).targetCharacterId);

    expect(viableTargets).toEqual([findCharInstanceId(base, RESOURCE_PLAYER, GANDALF_FW)]);
  });

  test('offered on a Ringwraith bearer, but not on his Orc follower', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_WITCH_KING, { defId: GORBAG, followerOf: 0 }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CRUEL_CLAW], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const viableTargets = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
      .map(ea => (ea.action as PlayHazardAction).targetCharacterId);

    expect(viableTargets).toEqual([findCharInstanceId(base, RESOURCE_PLAYER, THE_WITCH_KING)]);
  });

  // ─── Rule: cannot be duplicated on a given character ─────────────────────────

  test('cannot be duplicated on a given character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CRUEL_CLAW], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // One copy already on Gandalf blocks a second copy on him; Aragorn is
    // race-filtered, so no viable play remains at all.
    const withOne = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, CRUEL_CLAW, HAZARD_PLAYER);
    const stateAtPlayHazards = { ...withOne, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const viablePlays = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');
    expect(viablePlays).toHaveLength(0);
  });

  // ─── Rule: "His general influence is modified by -1" ─────────────────────────

  test('a Wizard bearer costs his player 1 point of general influence', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(base.players[RESOURCE_PLAYER].generalInfluenceBonus).toBe(0);
    expect(effectiveGeneralInfluence(base, PLAYER_1)).toBe(BASE_GI);

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, CRUEL_CLAW, HAZARD_PLAYER));
    expect(withCard.players[RESOURCE_PLAYER].generalInfluenceBonus).toBe(-1);
    expect(effectiveGeneralInfluence(withCard, PLAYER_1)).toBe(BASE_GI - 1);
    // The hazard rides the opponent's character, so the hazard player's own
    // pool is untouched.
    expect(effectiveGeneralInfluence(withCard, PLAYER_2)).toBe(BASE_GI);
  });

  test('a Ringwraith bearer costs his player 1 point of general influence', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_WITCH_KING] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(effectiveGeneralInfluence(base, PLAYER_1)).toBe(BASE_GI);

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, THE_WITCH_KING, CRUEL_CLAW, HAZARD_PLAYER));
    expect(withCard.players[RESOURCE_PLAYER].generalInfluenceBonus).toBe(-1);
    expect(effectiveGeneralInfluence(withCard, PLAYER_1)).toBe(BASE_GI - 1);
  });

  // ─── Rule: the Fallen-wizard ladder, "use the first modifier that applies" ───
  //
  // Cruel Claw grants no stage points of its own, so each case seeds exactly the
  // stage cards that add up to the tested total. The flat -1 never applies to a
  // Fallen-wizard: it is *replaced* by the ladder, which bottoms out above 5 SPs.

  test.each([
    { sp: 5,  extras: [PLOTTING_RUIN, A_MERRIER_WORLD],                                                                                            gi: 0,  hand: HAND_SIZE },
    { sp: 6,  extras: [SHAMEFUL_DEEDS, A_MERRIER_WORLD],                                                                                           gi: -3, hand: HAND_SIZE },
    { sp: 10, extras: [SHAMEFUL_DEEDS, OROMES_WARDERS, PLOTTING_RUIN],                                                                             gi: -3, hand: HAND_SIZE },
    { sp: 11, extras: [SHAMEFUL_DEEDS, OROMES_WARDERS, PLOTTING_RUIN, GNAWED_WAYS],                                                                gi: -5, hand: HAND_SIZE - 1 },
    { sp: 15, extras: [SHAMEFUL_DEEDS, OROMES_WARDERS, PLOTTING_RUIN, GNAWED_WAYS, A_MERRIER_WORLD, BLIND_TO_ALL_ELSE],                            gi: -5, hand: HAND_SIZE - 1 },
    { sp: 16, extras: [SHAMEFUL_DEEDS, OROMES_WARDERS, PLOTTING_RUIN, GNAWED_WAYS, A_MERRIER_WORLD, BLIND_TO_ALL_ELSE, GREAT_RUSE],                gi: -7, hand: HAND_SIZE - 1 },
    { sp: 20, extras: [SHAMEFUL_DEEDS, OROMES_WARDERS, PLOTTING_RUIN, GNAWED_WAYS, A_MERRIER_WORLD, BLIND_TO_ALL_ELSE, GREAT_RUSE, NEVER_REFUSE, SPELLS_BORN_OF_DISCORD],                gi: -7, hand: HAND_SIZE - 1 },
    { sp: 21, extras: [SHAMEFUL_DEEDS, OROMES_WARDERS, PLOTTING_RUIN, GNAWED_WAYS, A_MERRIER_WORLD, BLIND_TO_ALL_ELSE, GREAT_RUSE, NEVER_REFUSE, SPELLS_BORN_OF_DISCORD, THE_GREY_HAT],  gi: -9, hand: HAND_SIZE - 2 },
  ])('a Fallen-wizard at $sp stage points takes $gi general influence and hand size $hand', ({ sp, extras, gi, hand }) => {
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
    state = recomputeDerived(state);

    // Baseline before the hazard lands: the printed pool and normal hand size.
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(sp);
    expect(effectiveGeneralInfluence(state, PLAYER_1)).toBe(FW_BASE_GI);
    expect(resolveHandSize(state, RESOURCE_PLAYER)).toBe(HAND_SIZE);

    state = recomputeDerived(attachHazardToChar(state, RESOURCE_PLAYER, GANDALF_FW, CRUEL_CLAW, HAZARD_PLAYER));

    expect(state.players[RESOURCE_PLAYER].generalInfluenceBonus).toBe(gi);
    expect(effectiveGeneralInfluence(state, PLAYER_1)).toBe(FW_BASE_GI + gi);
    expect(resolveHandSize(state, RESOURCE_PLAYER)).toBe(hand);
  });

  // ─── Rule: the hand-size clause is Fallen-wizard only ────────────────────────

  test('a Wizard bearer keeps his normal hand size', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, CRUEL_CLAW, HAZARD_PLAYER));
    expect(resolveHandSize(withCard, RESOURCE_PLAYER)).toBe(HAND_SIZE);
  });

  // ─── Rule: discard when any play deck is exhausted ───────────────────────────

  test('discarded when the bearer\'s own player exhausts his play deck', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [],
          playDeck: [],
          discardPile: [CAVE_DRAKE, DAGGER_OF_WESTERNESSE],
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
        },
        { id: PLAYER_2, hand: [], siteDeck: [MINAS_TIRITH], companies: [{ site: LORIEN, characters: [LEGOLAS] }] },
      ],
    });

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, CRUEL_CLAW, HAZARD_PLAYER));
    const gandalfId = charIdAt(withCard, RESOURCE_PLAYER);
    expect(withCard.players[RESOURCE_PLAYER].characters[gandalfId].hazards).toHaveLength(1);
    expect(effectiveGeneralInfluence(withCard, PLAYER_1)).toBe(BASE_GI - 1);

    // Advance to reset-hand, then exhaust and complete.
    const p1Pass = dispatch(withCard, { type: 'pass', player: PLAYER_1 });
    const p2Pass = dispatch(p1Pass, { type: 'pass', player: PLAYER_2 });
    const afterExhaust = dispatch(p2Pass, { type: 'deck-exhaust', player: PLAYER_1 });
    const after = recomputeDerived(dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 }));

    expect(after.players[RESOURCE_PLAYER].characters[gandalfId].hazards).toHaveLength(0);
    // Hazards belong to the hazard player, so the card returns to his discard.
    expectInDiscardPile(after, HAZARD_PLAYER, CRUEL_CLAW);
    // …and the general-influence penalty is lifted.
    expect(effectiveGeneralInfluence(after, PLAYER_1)).toBe(BASE_GI);
  });

  test('discarded when the OPPONENT\'s play deck is exhausted ("any play deck")', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [MORIA],
          playDeck: [CAVE_DRAKE, DAGGER_OF_WESTERNESSE],
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          playDeck: [],
          discardPile: [CAVE_DRAKE, DAGGER_OF_WESTERNESSE],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
    });

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, CRUEL_CLAW, HAZARD_PLAYER));
    const gandalfId = charIdAt(withCard, RESOURCE_PLAYER);
    expect(withCard.players[RESOURCE_PLAYER].characters[gandalfId].hazards).toHaveLength(1);

    const p1Pass = dispatch(withCard, { type: 'pass', player: PLAYER_1 });
    const p2Pass = dispatch(p1Pass, { type: 'pass', player: PLAYER_2 });
    // Player 2 — not the bearer's controller — is the one who exhausts.
    const afterExhaust = dispatch(p2Pass, { type: 'deck-exhaust', player: PLAYER_2 });
    const after = recomputeDerived(dispatch(afterExhaust, { type: 'pass', player: PLAYER_2 }));

    expect(after.players[RESOURCE_PLAYER].characters[gandalfId].hazards).toHaveLength(0);
    expectInDiscardPile(after, HAZARD_PLAYER, CRUEL_CLAW);
    expect(effectiveGeneralInfluence(after, PLAYER_1)).toBe(BASE_GI);
  });
});
