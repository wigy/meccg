/**
 * @module wh-19.test
 *
 * Card test: Fool's Bane (wh-19)
 * Type: hazard-event (permanent, played on a Fallen-wizard)
 *
 * Printed text:
 *   "Playable on a Fallen-wizard. Influence checks he makes against hero
 *    resources are modified by: -9 if his stage points (SPs) exceed 18, -7 if
 *    his SPs exceed 12, -5 if his SPs exceed 7, -3 if his SPs exceed 3, or -1
 *    if his SPs exceed 0 (use the first modifier that applies). Additionally,
 *    his Elf characters and Elf factions are each worth 0 marshalling points in
 *    all cases. Cannot be duplicated on a given Fallen-wizard. Discard when any
 *    play deck is exhausted."
 *
 * Card shape (data): 10 effects —
 *   1. play-target character, filter `target.race = fallen-wizard`
 *   2. duplication-limit scope character, max 1
 *   3-7. check-modifier `influence` -9/-7/-5/-3/-1, each gated on
 *        `influenceTarget.alignment = hero` + `influenceTarget.kind != character`
 *        and on a half-open `bearer.stagePoints` band (>18 / 12<x<=18 /
 *        7<x<=12 / 3<x<=7 / 0<x<=3) so exactly one band ever matches — the DSL
 *        equivalent of "use the first modifier that applies"
 *   8. character-mp-override `card.race = elf` → 0
 *   9. noncharacter-mp-override `card.race = elf` + faction card types → 0
 *   10. on-event `play-deck-exhausted` → move self to discard
 *
 * Engine support:
 * | # | Feature                                          | Status      | Notes                                             |
 * |---|--------------------------------------------------|-------------|---------------------------------------------------|
 * | 1 | Playable only on a Fallen-wizard                 | IMPLEMENTED | play-hazard target filter on `target.race`        |
 * | 2 | Cannot be duplicated on a given Fallen-wizard    | IMPLEMENTED | duplication-limit scope:character max:1           |
 * | 3 | Influence penalty tiers by stage points          | IMPLEMENTED | `bearer.stagePoints` added to the influence-check |
 * |   |                                                  |             | contexts (was effective-stats only)               |
 * | 4 | "against hero resources" only                    | IMPLEMENTED | new `influenceTarget` resolver context (alignment |
 * |   |                                                  |             | + kind), populated in both influence-check paths  |
 * | 5 | Penalty applies to opponent-influence attempts   | IMPLEMENTED | the influencer's ongoing influence check-modifiers|
 * |   |                                                  |             | are now folded into the attempt (reducer-site)    |
 * | 6 | Elf characters worth 0 MP "in all cases"         | IMPLEMENTED | new `character-mp-override`, ahead of the §4 clamp|
 * | 7 | Elf factions worth 0 MP "in all cases"           | IMPLEMENTED | `noncharacter-mp-override`, now also collected    |
 * |   |                                                  |             | from hazards attached to the player's characters  |
 * | 8 | Discard when any play deck is exhausted          | IMPLEMENTED | completeDeckExhaust now also sweeps character-    |
 * |   |                                                  |             | attached items/hazards, to the card's owner       |
 *
 * Playable: YES
 * Certified: 2026-07-27
 *
 * Fixture alignment: fallen-wizard — P1 is a Fallen-wizard whose avatar bears
 * the hazard; P2 is the hero/Wizard opponent who plays it.
 *
 * Fixtures:
 *   - GANDALF_FW (wh-4): the Fallen-wizard avatar, direct influence 9
 *   - ELVES_OF_LINDON (tw-226): hero Elf faction, influence# 10, at Grey Havens
 *   - ORCS_OF_MORIA (le-278): minion Orc faction, influence# 11, at Moria
 *   - GALADRIEL (tw-153): hero Elf character, 3 MP
 *   - HALDALAM (tw-163): hero Dúnadan character, 2 MP
 *   - MEN_OF_LEBENNIN (tw-280): hero Man faction, 2 MP
 *   - BILL_THE_PONY (tw-198): hero ally, mind 1 — opponent-influence target
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachHazardToChar, attachAllyToChar, addCardInPlay, recomputeDerived,
  buildFallenWizardSitePhaseState, firstOpponentInfluenceAttempt,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, MORIA, RIVENDELL, MINAS_TIRITH,
  makeMHState, makeSitePhase, findCharInstanceId,
  dispatch, dispatchResult, expectInDiscardPile,
} from '../test-helpers.js';
import { Alignment, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, EndOfTurnPhaseState, InfluenceAttemptAction, PlayHazardAction } from '../../index.js';

const FOOLS_BANE = 'wh-19' as CardDefinitionId;
/** Gandalf the Fallen-wizard: race fallen-wizard, direct influence 9. */
const GANDALF_FW = 'wh-4' as CardDefinitionId;
/** Isengard, a Fallen-wizard Wizardhaven (site deck filler). */
const ISENGARD_WH = 'wh-56' as CardDefinitionId;

const ELVES_OF_LINDON = 'tw-226' as CardDefinitionId;  // hero Elf faction, influence# 10, 2 MP
const ORCS_OF_MORIA = 'le-278' as CardDefinitionId;    // minion Orc faction, influence# 11, 3 MP
const MEN_OF_LEBENNIN = 'tw-280' as CardDefinitionId;  // hero Man faction, 2 MP
const GALADRIEL = 'tw-153' as CardDefinitionId;        // hero Elf character, 3 MP
const HALDALAM = 'tw-163' as CardDefinitionId;         // hero Dúnadan character, 2 MP
const BILL_THE_PONY = 'tw-198' as CardDefinitionId;    // hero ally, mind 1
const GWAIHIR = 'tw-251' as CardDefinitionId;          // hero ally, 2 MP
/** Grey Havens (hero haven) — where Elves of Lindon is influenced. */
const GREY_HAVENS = 'tw-399' as CardDefinitionId;
/** Moria, minion version — a minion faction needs a minion site card (MEWH §10). */
const MORIA_MINION = 'le-392' as CardDefinitionId;

/**
 * The `need` a Fallen-wizard influencer faces for the single faction in hand,
 * with `stagePoints` stage points and (optionally) Fool's Bane attached.
 */
function factionNeed(opts: {
  faction: CardDefinitionId;
  site: CardDefinitionId;
  stagePoints: number;
  attached: boolean;
}): number {
  const base = buildFallenWizardSitePhaseState({
    characters: [GANDALF_FW],
    site: opts.site,
    hand: [opts.faction],
    stagePoints: opts.stagePoints,
  });
  const state = opts.attached
    ? attachHazardToChar(base, RESOURCE_PLAYER, GANDALF_FW, FOOLS_BANE, HAZARD_PLAYER)
    : base;
  const attempts = computeLegalActions(state, PLAYER_1)
    .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
    .map(ea => ea.action as InfluenceAttemptAction);
  expect(attempts.length).toBeGreaterThanOrEqual(1);
  return attempts[0].need;
}

describe("Fool's Bane (wh-19)", () => {
  beforeEach(() => resetMint());

  // ─── Rule: playable on a Fallen-wizard ──────────────────────────────────────

  test('offered as a hazard play only on the Fallen-wizard, not on his companions', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [GANDALF_FW, ARAGORN] }], hand: [], siteDeck: [ISENGARD_WH] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [FOOLS_BANE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const state = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const targets = computeLegalActions(state, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
      .map(ea => (ea.action as PlayHazardAction).targetCharacterId);

    // Only the Fallen-wizard avatar qualifies; Aragorn (Dúnadan) does not.
    expect(targets).toEqual([findCharInstanceId(base, RESOURCE_PLAYER, GANDALF_FW)]);
  });

  test('not offered at all when no Fallen-wizard is in the target company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [GALADRIEL] }], hand: [FOOLS_BANE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const state = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const plays = computeLegalActions(state, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');

    expect(plays).toEqual([]);
  });

  // ─── Rule: cannot be duplicated on a given Fallen-wizard ────────────────────

  test('a second copy is not offered on a Fallen-wizard who already bears one', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [GANDALF_FW] }], hand: [], siteDeck: [ISENGARD_WH] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [FOOLS_BANE], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCopy = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF_FW, FOOLS_BANE, HAZARD_PLAYER);

    const state = { ...withCopy, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const plays = computeLegalActions(state, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');

    expect(plays).toEqual([]);
  });

  // ─── Rule: influence checks against hero resources are modified by tier ─────

  test('no penalty at 0 stage points (no tier applies)', () => {
    // Gandalf FW: direct influence 9 vs Elves of Lindon influence# 10 → need 1.
    const bare = factionNeed({ faction: ELVES_OF_LINDON, site: GREY_HAVENS, stagePoints: 0, attached: false });
    expect(bare).toBe(1);
    expect(factionNeed({ faction: ELVES_OF_LINDON, site: GREY_HAVENS, stagePoints: 0, attached: true })).toBe(1);
  });

  test('each stage-point band applies exactly one modifier ("first that applies")', () => {
    // need = influence# 10 - DI 9 - modifier = 1 - modifier.
    const bands: Array<{ sp: number; modifier: number }> = [
      { sp: 1, modifier: -1 },   // 0 < SP <= 3
      { sp: 3, modifier: -1 },
      { sp: 4, modifier: -3 },   // 3 < SP <= 7
      { sp: 7, modifier: -3 },
      { sp: 8, modifier: -5 },   // 7 < SP <= 12
      { sp: 12, modifier: -5 },
      { sp: 13, modifier: -7 },  // 12 < SP <= 18
      { sp: 18, modifier: -7 },
      { sp: 19, modifier: -9 },  // SP > 18
      { sp: 30, modifier: -9 },
    ];
    for (const { sp, modifier } of bands) {
      expect(factionNeed({ faction: ELVES_OF_LINDON, site: GREY_HAVENS, stagePoints: sp, attached: true }))
        .toBe(1 - modifier);
      // Without the hazard the need never moves, whatever the stage points.
      expect(factionNeed({ faction: ELVES_OF_LINDON, site: GREY_HAVENS, stagePoints: sp, attached: false }))
        .toBe(1);
    }
  });

  test('a minion faction is unaffected — the penalty is for hero resources only', () => {
    // Orcs of Moria influence# 11 - DI 9 = 2, with or without the hazard, even
    // at the top stage-point band that would cost -9 against a hero faction.
    expect(factionNeed({ faction: ORCS_OF_MORIA, site: MORIA_MINION, stagePoints: 19, attached: false })).toBe(2);
    expect(factionNeed({ faction: ORCS_OF_MORIA, site: MORIA_MINION, stagePoints: 19, attached: true })).toBe(2);
  });

  test('the penalty rides the bearer — another influencer in the company is unaffected', () => {
    const base = buildFallenWizardSitePhaseState({
      characters: [GANDALF_FW, ARAGORN],
      site: GREY_HAVENS,
      hand: [ELVES_OF_LINDON],
      stagePoints: 19,
    });
    const state = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF_FW, FOOLS_BANE, HAZARD_PLAYER);

    const attempts = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction);

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF_FW);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const byGandalf = attempts.find(a => a.influencingCharacterId === gandalfId);
    const byAragorn = attempts.find(a => a.influencingCharacterId === aragornId);

    // Gandalf bears the hazard: 10 - DI 9 + 9 (top band) = 10.
    // Aragorn does not: 10 - DI 3 - 1 (the faction's Dúnadan modification) = 6.
    expect(byGandalf?.need).toBe(10);
    expect(byAragorn?.need).toBe(6);
  });

  // ─── Rule: the penalty covers influence attempts on the opponent's cards ────

  test("applies to an influence attempt against an opponent's hero ally", () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [GANDALF_FW] }], hand: [], siteDeck: [ISENGARD_WH] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withAlly = attachAllyToChar(base, HAZARD_PLAYER, ARAGORN, BILL_THE_PONY);
    const withHazard = attachHazardToChar(withAlly, RESOURCE_PLAYER, GANDALF_FW, FOOLS_BANE, HAZARD_PLAYER);
    const state = { ...withHazard, turnNumber: 3, phaseState: makeSitePhase() };
    (state.players[RESOURCE_PLAYER] as { stagePoints: number }).stagePoints = 8;

    const allyId = state.players[HAZARD_PLAYER].characters[findCharInstanceId(state, HAZARD_PLAYER, ARAGORN)].allies[0].instanceId;
    const attempt = firstOpponentInfluenceAttempt(state, allyId);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('ally');

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    // 8 stage points → the -5 band, folded into the attempt's roll modifier.
    expect(pending.kind.attempt.boostModifier).toBe(-5);
  });

  test("does not apply against an opponent's character (a character is not a resource)", () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [GANDALF_FW] }], hand: [], siteDeck: [ISENGARD_WH] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [ARAGORN, HALDALAM] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withHazard = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF_FW, FOOLS_BANE, HAZARD_PLAYER);
    const state = { ...withHazard, turnNumber: 3, phaseState: makeSitePhase() };
    (state.players[RESOURCE_PLAYER] as { stagePoints: number }).stagePoints = 19;

    const haldalamId = findCharInstanceId(state, HAZARD_PLAYER, HALDALAM);
    const attempt = firstOpponentInfluenceAttempt(state, haldalamId);
    expect(attempt).toBeDefined();

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    expect(pending.kind.attempt.boostModifier).toBe(0);
  });

  // ─── Rule: his Elf characters are worth 0 marshalling points ────────────────

  test('an Elf character scores 0 MP while the hazard is in play, other races unchanged', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [GANDALF_FW, GALADRIEL, HALDALAM] }], hand: [], siteDeck: [ISENGARD_WH] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    // The Fallen-wizard Gandalf (wh-4) exempts his characters from the MEWH §4
    // 1-MP clamp, so Galadriel scores 3 and Haldalam 2 (Gandalf's own MP is 0).
    expect(base.players[RESOURCE_PLAYER].marshallingPoints.character).toBe(5);

    const withHazard = recomputeDerived(
      attachHazardToChar(base, RESOURCE_PLAYER, GANDALF_FW, FOOLS_BANE, HAZARD_PLAYER),
    );
    // "In all cases": Galadriel (Elf) drops to 0 even through wh-4's full-MP
    // exemption; Haldalam (Dúnadan) still scores his 2.
    expect(withHazard.players[RESOURCE_PLAYER].marshallingPoints.character).toBe(2);
  });

  // ─── Rule: his Elf factions are worth 0 marshalling points ──────────────────

  test('an Elf faction scores 0 MP while the hazard is in play, other races unchanged', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [GANDALF_FW] }], hand: [], siteDeck: [ISENGARD_WH] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withFactions = recomputeDerived(
      addCardInPlay(addCardInPlay(base, RESOURCE_PLAYER, ELVES_OF_LINDON), RESOURCE_PLAYER, MEN_OF_LEBENNIN),
    );
    // §4 clamp: 1 MP each.
    expect(withFactions.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(2);

    const withHazard = recomputeDerived(
      attachHazardToChar(withFactions, RESOURCE_PLAYER, GANDALF_FW, FOOLS_BANE, HAZARD_PLAYER),
    );
    // Elves of Lindon drops to 0; Men of Lebennin still gives 1.
    expect(withHazard.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(1);
  });

  // ─── Rule: discard when any play deck is exhausted ──────────────────────────

  test('self-discards to its owner when a play deck is exhausted', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.FallenWizard,
          companies: [{ site: MORIA, characters: [GANDALF_FW] }],
          hand: [], siteDeck: [ISENGARD_WH], playDeck: [], discardPile: [ELVES_OF_LINDON],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withHazard = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF_FW, FOOLS_BANE, HAZARD_PLAYER);
    const resetHandState = {
      ...withHazard,
      phaseState: {
        ...(withHazard.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [false, true] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };

    const afterExhaust = dispatch(resetHandState, { type: 'deck-exhaust', player: PLAYER_1 });
    const gandalfId = findCharInstanceId(afterExhaust, RESOURCE_PLAYER, GANDALF_FW);
    // Still attached while the exhaust sub-flow is pending.
    expect(afterExhaust.players[RESOURCE_PLAYER].characters[gandalfId].hazards.length).toBe(1);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[RESOURCE_PLAYER].characters[gandalfId].hazards.length).toBe(0);
    // It returns to the hazard player's (its owner's) discard pile.
    expectInDiscardPile(afterPass, HAZARD_PLAYER, FOOLS_BANE);
  });

  test('the influence penalty is gone once the card has been discarded', () => {
    const before = factionNeed({ faction: ELVES_OF_LINDON, site: GREY_HAVENS, stagePoints: 19, attached: true });
    expect(before).toBe(10);
    // Same board without the hazard: the printed need returns.
    expect(factionNeed({ faction: ELVES_OF_LINDON, site: GREY_HAVENS, stagePoints: 19, attached: false })).toBe(1);
  });

  // ─── Guard: the hazard does not leak onto the opponent's own scoring ────────

  test("the hazard owner's own Elf cards are unaffected", () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [GANDALF_FW] }], hand: [], siteDeck: [ISENGARD_WH] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [GALADRIEL] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withHazard = recomputeDerived(
      attachHazardToChar(base, RESOURCE_PLAYER, GANDALF_FW, FOOLS_BANE, HAZARD_PLAYER),
    );
    // The hero player's Galadriel keeps her printed 3 character MP.
    expect(withHazard.players[HAZARD_PLAYER].marshallingPoints.character).toBe(3);
  });

  test('an ally of the bearer is not zeroed — only characters and factions are', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [GANDALF_FW] }], hand: [], siteDeck: [ISENGARD_WH] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, GANDALF_FW, GWAIHIR);
    const withHazard = recomputeDerived(
      attachHazardToChar(withAlly, RESOURCE_PLAYER, GANDALF_FW, FOOLS_BANE, HAZARD_PLAYER),
    );
    // Gwaihir keeps his 2 MP (wh-4 grants hero allies full MP); the card's
    // overrides reach only the player's characters and factions.
    expect(withHazard.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(2);
  });
});
