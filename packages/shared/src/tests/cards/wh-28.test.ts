/**
 * @module wh-28.test
 *
 * Card test: Power Relinquished to Artifice (wh-28)
 * Type: hazard-event (permanent, character-targeting)
 *
 * Printed text:
 *   "Playable on a Wizard, Fallen-wizard, or Ringwraith. His prowess and direct
 *    influence are each modified by -1. If he is a Fallen-wizard, these
 *    modifiers are instead: -5 if his stage points (SPs) exceed 20, -4 if his
 *    SPs exceed 15, -3 if his SPs exceed 10, -2 if his SPs exceed 5 (use the
 *    first modifer that applies). For Alatar and Radagast, reduce the modifier
 *    to 0 for prowess and double it for direct influence. Cannot be duplicated
 *    on a given character. Discard when any play deck is exhausted."
 *
 * Card shape (data): 21 effects —
 *   1.  play-target character, filter
 *       `target.race $in [wizard, fallen-wizard, ringwraith]`
 *   2.  duplication-limit scope character, max 1
 *   3.  stat-modifier prowess -1 for a Wizard/Ringwraith bearer
 *   4-8. stat-modifier prowess -1/-2/-3/-4/-5 for a Fallen-wizard bearer,
 *       gated on the half-open `bearer.stagePoints` bands
 *       (<=5 / 5<x<=10 / 10<x<=15 / 15<x<=20 / >20) so exactly one band ever
 *       matches — the DSL equivalent of "use the first modifier that applies"
 *   9.  stat-modifier direct-influence -1 for a Wizard/Ringwraith bearer
 *   10-14. the same five Fallen-wizard bands for direct-influence
 *   15-20. the Alatar/Radagast variants: no prowess entry at all (the modifier
 *       is 0 for them), and direct-influence at double each band's value
 *   21. on-event `play-deck-exhausted` → self-discard
 *
 * Every prowess/direct-influence entry also carries
 * `{ "$not": { "bearer.name": { "$in": ["Alatar", "Radagast"] } } }` (or its
 * positive form), so exactly one prowess and one direct-influence modifier
 * matches any given bearer.
 *
 * Reading of the Fallen-wizard table: the printed tiers stop at "-2 if his SPs
 * exceed 5" — they never restate -1. A Fallen-wizard at 5 or fewer stage points
 * therefore matches no tier and keeps the card's base -1 (the tiers only replace
 * it when one applies). The alternative reading — no modifier at all below 6 SPs
 * — would make the card a blank against a freshly-staged Fallen-wizard, which
 * its own "Playable on a … Fallen-wizard" line contradicts. Compare Something
 * Else at Work (wh-30), which *does* list a "-1 if his SPs exceed 0" tier
 * because its base modifier is not the same value.
 *
 * Engine Support:
 * | # | Feature                                     | Status      | Notes                                          |
 * |---|---------------------------------------------|-------------|------------------------------------------------|
 * | 1 | Play on a Wizard/Fallen-wizard/Ringwraith   | IMPLEMENTED | play-hazard `play-target` filter on target.race|
 * | 2 | Cannot be duplicated on a character         | IMPLEMENTED | duplication-limit scope:character max:1        |
 * | 3 | -1 prowess / -1 direct influence            | IMPLEMENTED | stat-modifier gated on bearer.race             |
 * | 4 | Fallen-wizard tiers by stage points         | IMPLEMENTED | bearer.stagePoints in effective-stats, and now |
 * |   |                                             |             | in the combat-prowess context too, so the      |
 * |   |                                             |             | penalty survives facing a strike               |
 * | 5 | Alatar/Radagast: 0 prowess, doubled DI      | IMPLEMENTED | bearer.name gate on each band                  |
 * | 6 | DI penalty counted once per influence check | IMPLEMENTED | `checkConditionalEffects` keeps bearer-only     |
 * |   |                                             |             | modifiers out of the influence folds (they are |
 * |   |                                             |             | already inside effectiveStats.directInfluence) |
 * | 7 | Discard when any play deck is exhausted      | IMPLEMENTED | completeDeckExhaust now also sweeps character  |
 * |   |                                             |             | attachments, not only `cardsInPlay`            |
 *
 * Playable: YES
 * Certified: 2026-07-27
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachHazardToChar, addCardInPlay, recomputeDerived,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF, BEREGOND,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, THRANDUILS_HALLS, WOOD_ELVES,
  makeMHState, findCharInstanceId, charIdAt, getCharacter, pool,
  dispatch, expectInDiscardPile, buildSitePhaseState, viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment, computeLegalActions } from '../../index.js';
import { computeCombatProwess } from '../../engine/recompute-derived.js';
import { availableDI } from '../../engine/legal-actions/organization.js';
import type {
  CardDefinitionId, CharacterCard, EndOfTurnPhaseState, GameState,
  InfluenceAttemptAction, PlayHazardAction,
} from '../../index.js';

const POWER_RELINQUISHED = 'wh-28' as CardDefinitionId;

/** Gandalf the Fallen-wizard (race fallen-wizard, prowess 6, DI 9). */
const GANDALF_FW = 'wh-4' as CardDefinitionId;
/** Alatar the Fallen-wizard (prowess 7, DI 10) — named on the card. */
const ALATAR_FW = 'wh-1' as CardDefinitionId;
/** Alatar the hero Wizard (prowess 6, DI 10) — named on the card. */
const ALATAR_WIZARD = 'tw-117' as CardDefinitionId;
/** Radagast the hero Wizard (prowess 6, DI 10) — named on the card. */
const RADAGAST_WIZARD = 'tw-178' as CardDefinitionId;
/** Isengard, a Fallen-wizard Wizardhaven. */
const ISENGARD_WH = 'wh-56' as CardDefinitionId;

/** Adûnaphel the Ringwraith (race ringwraith, prowess 8, DI 4). */
const ADUNAPHEL = 'le-50' as CardDefinitionId;
/** Gorbag — minion Orc, the non-targetable control in the Ringwraith company. */
const GORBAG = 'le-11' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // darkhaven
const MORIA_MINION = 'le-392' as CardDefinitionId;  // shadow-hold

// Stage permanent-events whose only effect is `stage-points` — used to dial a
// Fallen-wizard's running total to each tier boundary. wh-28 itself contributes
// no stage points, so the total is exactly the sum of the cards added.
const SP1_GNAWED_WAYS = 'wh-71' as CardDefinitionId;
const SP1_GREAT_RUSE = 'wh-73' as CardDefinitionId;
const SP1_KEYS_OF_ORTHANC = 'wh-88' as CardDefinitionId;
const SP2_A_MERRIER_WORLD = 'wh-59' as CardDefinitionId;
const SP2_BLIND_TO_ALL_ELSE = 'wh-64' as CardDefinitionId;
const SP2_NEVER_REFUSE = 'wh-78' as CardDefinitionId;
const SP2_SPELLS_BORN = 'wh-81' as CardDefinitionId;
const SP3_PLOTTING_RUIN = 'wh-79' as CardDefinitionId;
const SP3_OROMES_WARDERS = 'wh-94' as CardDefinitionId;
const SP4_SHAMEFUL_DEEDS = 'wh-80' as CardDefinitionId;

/** Stage-card sets summing to each tier boundary the card names. */
const SP_0: CardDefinitionId[] = [];
const SP_5 = [SP3_PLOTTING_RUIN, SP2_A_MERRIER_WORLD];
const SP_6 = [SP4_SHAMEFUL_DEEDS, SP2_A_MERRIER_WORLD];
const SP_10 = [SP4_SHAMEFUL_DEEDS, SP3_PLOTTING_RUIN, SP3_OROMES_WARDERS];
const SP_11 = [...SP_10, SP1_GNAWED_WAYS];
const SP_15 = [...SP_10, SP2_A_MERRIER_WORLD, SP2_BLIND_TO_ALL_ELSE, SP1_GNAWED_WAYS];
const SP_16 = [...SP_15, SP1_GREAT_RUSE];
const SP_20 = [...SP_16, SP2_NEVER_REFUSE, SP2_SPELLS_BORN];
const SP_21 = [...SP_20, SP1_KEYS_OF_ORTHANC];

describe('Power Relinquished to Artifice (wh-28)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: playable on a Wizard, Fallen-wizard, or Ringwraith ───────────────

  test('offered only against the Wizard in a hero company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [BEREGOND] }], hand: [POWER_RELINQUISHED], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const atPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const viableTargets = computeLegalActions(atPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
      .map(ea => (ea.action as PlayHazardAction).targetCharacterId);

    expect(viableTargets).toEqual([findCharInstanceId(base, RESOURCE_PLAYER, GANDALF)]);
  });

  test('offered against a Fallen-wizard', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [GANDALF_FW, ARAGORN] }], hand: [], siteDeck: [ISENGARD_WH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [POWER_RELINQUISHED], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const atPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const viableTargets = computeLegalActions(atPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
      .map(ea => (ea.action as PlayHazardAction).targetCharacterId);

    expect(viableTargets).toEqual([findCharInstanceId(base, RESOURCE_PLAYER, GANDALF_FW)]);
  });

  test('offered against a Ringwraith, but not against the Orc beside him', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [ADUNAPHEL, GORBAG] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [POWER_RELINQUISHED], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const atPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const viableTargets = computeLegalActions(atPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
      .map(ea => (ea.action as PlayHazardAction).targetCharacterId);

    expect(viableTargets).toEqual([findCharInstanceId(base, RESOURCE_PLAYER, ADUNAPHEL)]);
  });

  // ─── Rule: cannot be duplicated on a given character ────────────────────────

  test('cannot be duplicated on a given character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [POWER_RELINQUISHED], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Gandalf is the only legal target; a copy already on him leaves no play.
    const withOne = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, POWER_RELINQUISHED);
    const atPlayHazards = { ...withOne, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    expect(
      computeLegalActions(atPlayHazards, PLAYER_2).filter(ea => ea.viable && ea.action.type === 'play-hazard'),
    ).toHaveLength(0);
  });

  // ─── Rule: -1 prowess and -1 direct influence ──────────────────────────────

  test('a Wizard bearer loses 1 prowess and 1 direct influence', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const before = getCharacter(base, RESOURCE_PLAYER, GANDALF).effectiveStats;
    expect([before.prowess, before.directInfluence]).toEqual([6, 10]);

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, POWER_RELINQUISHED));
    const after = getCharacter(withCard, RESOURCE_PLAYER, GANDALF).effectiveStats;
    expect([after.prowess, after.directInfluence]).toEqual([5, 9]);
  });

  test('a Ringwraith bearer loses 1 prowess and 1 direct influence', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [ADUNAPHEL] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const before = getCharacter(base, RESOURCE_PLAYER, ADUNAPHEL).effectiveStats;
    expect([before.prowess, before.directInfluence]).toEqual([8, 4]);

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, ADUNAPHEL, POWER_RELINQUISHED));
    const after = getCharacter(withCard, RESOURCE_PLAYER, ADUNAPHEL).effectiveStats;
    expect([after.prowess, after.directInfluence]).toEqual([7, 3]);
  });

  // ─── Rule: Fallen-wizard tiers, "use the first modifier that applies" ───────
  //
  // Gandalf the Fallen-wizard: printed prowess 6, direct influence 9.

  test.each([
    { stageCards: SP_0, total: 0, modifier: -1 },
    { stageCards: SP_5, total: 5, modifier: -1 },
    { stageCards: SP_6, total: 6, modifier: -2 },
    { stageCards: SP_10, total: 10, modifier: -2 },
    { stageCards: SP_11, total: 11, modifier: -3 },
    { stageCards: SP_15, total: 15, modifier: -3 },
    { stageCards: SP_16, total: 16, modifier: -4 },
    { stageCards: SP_20, total: 20, modifier: -4 },
    { stageCards: SP_21, total: 21, modifier: -5 },
  ])('a Fallen-wizard at $total stage points is modified by $modifier', ({ stageCards, total, modifier }) => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: ISENGARD_WH, characters: [GANDALF_FW] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    for (const stageCard of stageCards) state = addCardInPlay(state, RESOURCE_PLAYER, stageCard);
    state = recomputeDerived(attachHazardToChar(state, RESOURCE_PLAYER, GANDALF_FW, POWER_RELINQUISHED));

    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(total);
    const stats = getCharacter(state, RESOURCE_PLAYER, GANDALF_FW).effectiveStats;
    expect([stats.prowess, stats.directInfluence]).toEqual([6 + modifier, 9 + modifier]);
  });

  // ─── Rule: for Alatar and Radagast, 0 prowess and doubled DI ───────────────

  test.each([
    { name: 'Alatar', defId: ALATAR_WIZARD },
    { name: 'Radagast', defId: RADAGAST_WIZARD },
  ])('the hero Wizard $name keeps his prowess and loses 2 direct influence', ({ defId }) => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [defId] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, defId, POWER_RELINQUISHED));
    const stats = getCharacter(withCard, RESOURCE_PLAYER, defId).effectiveStats;
    // Printed 6 prowess / 10 direct influence: prowess untouched, DI 2 × -1.
    expect([stats.prowess, stats.directInfluence]).toEqual([6, 8]);
  });

  test.each([
    { stageCards: SP_0, total: 0, modifier: -1 },
    { stageCards: SP_6, total: 6, modifier: -2 },
    { stageCards: SP_11, total: 11, modifier: -3 },
    { stageCards: SP_16, total: 16, modifier: -4 },
    { stageCards: SP_21, total: 21, modifier: -5 },
  ])('Alatar the Fallen-wizard at $total stage points keeps his prowess and doubles the $modifier on direct influence', ({ stageCards, total, modifier }) => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: ISENGARD_WH, characters: [ALATAR_FW] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    for (const stageCard of stageCards) state = addCardInPlay(state, RESOURCE_PLAYER, stageCard);
    state = recomputeDerived(attachHazardToChar(state, RESOURCE_PLAYER, ALATAR_FW, POWER_RELINQUISHED));

    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(total);
    const stats = getCharacter(state, RESOURCE_PLAYER, ALATAR_FW).effectiveStats;
    // Printed 7 prowess / 10 direct influence.
    expect([stats.prowess, stats.directInfluence]).toEqual([7, 10 + 2 * modifier]);
  });

  // ─── The prowess penalty still applies when the bearer faces a strike ───────

  test('the Fallen-wizard prowess penalty applies to combat prowess', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: ISENGARD_WH, characters: [GANDALF_FW] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    for (const stageCard of SP_11) state = addCardInPlay(state, RESOURCE_PLAYER, stageCard);

    const charId = charIdAt(state, RESOURCE_PLAYER);
    const gandalfDef = pool[GANDALF_FW as string] as CharacterCard;
    const before = state.players[RESOURCE_PLAYER].characters[charId];
    expect(computeCombatProwess(state, before, gandalfDef, 'orc')).toBe(6);

    // Combat prowess is re-resolved from the printed value rather than read off
    // effectiveStats, so the stage-point-tiered penalty must be visible there too.
    const withCard = recomputeDerived(attachHazardToChar(state, RESOURCE_PLAYER, GANDALF_FW, POWER_RELINQUISHED));
    const after = withCard.players[RESOURCE_PLAYER].characters[charId];
    expect(computeCombatProwess(withCard, after, gandalfDef, 'orc')).toBe(3);
  });

  // ─── The DI penalty is applied exactly once per influence check ─────────────

  test('the direct-influence penalty counts once when influencing a follower', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [BEREGOND], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gandalfId = findCharInstanceId(base, RESOURCE_PLAYER, GANDALF);
    const beregondDef = pool[BEREGOND as string] as CharacterCard;
    expect(availableDI(base, gandalfId, base.players[RESOURCE_PLAYER], beregondDef)).toBe(10);

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, POWER_RELINQUISHED));
    // Exactly 9 — the penalty already inside effective DI must not be folded in
    // a second time by the influence-check pass.
    expect(availableDI(withCard, gandalfId, withCard.players[RESOURCE_PLAYER], beregondDef)).toBe(9);
  });

  test('the direct-influence penalty counts once when influencing a faction', () => {
    const base = buildSitePhaseState({
      characters: [GANDALF],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const gandalfId = findCharInstanceId(base, RESOURCE_PLAYER, GANDALF);
    const needFor = (state: GameState): number => {
      const attempt = computeLegalActions(state, PLAYER_1)
        .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
        .map(ea => ea.action as InfluenceAttemptAction)
        .find(a => a.influencingCharacterId === gandalfId);
      expect(attempt).toBeDefined();
      return attempt!.need;
    };

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, POWER_RELINQUISHED));
    // One point of direct influence lost → the roll needed goes up by exactly 1.
    expect(needFor(withCard)).toBe(needFor(base) + 1);
  });

  // ─── Rule: discard when any play deck is exhausted ──────────────────────────

  test('discarded to the hazard player when a play deck is exhausted', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: [],
          discardPile: [ARAGORN],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, POWER_RELINQUISHED));
    const charId = charIdAt(withCard, RESOURCE_PLAYER);

    const atResetHand = {
      ...withCard,
      phaseState: {
        ...(withCard.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [false, true] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };

    // Still attached while the exhaustion is pending.
    const afterExhaust = dispatch(atResetHand, { type: 'deck-exhaust', player: PLAYER_1 });
    expect(afterExhaust.players[RESOURCE_PLAYER].characters[charId].hazards).toHaveLength(1);

    // Completing the exhaust fires play-deck-exhausted: the card leaves the
    // Wizard and returns to its owner — the hazard player's — discard pile.
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[RESOURCE_PLAYER].characters[charId].hazards).toHaveLength(0);
    expectInDiscardPile(afterPass, HAZARD_PLAYER, POWER_RELINQUISHED);

    // With the card gone, Gandalf is back to his printed stats.
    const stats = getCharacter(afterPass, RESOURCE_PLAYER, GANDALF).effectiveStats;
    expect([stats.prowess, stats.directInfluence]).toEqual([6, 10]);
  });

  // ─── Sanity: the card stays out of unrelated windows ────────────────────────

  test('not offered as a hazard against a company with no Wizard, Fallen-wizard or Ringwraith', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [BEREGOND] }], hand: [POWER_RELINQUISHED], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const atPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    expect(viableActions(atPlayHazards, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });
});
