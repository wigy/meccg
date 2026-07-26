/**
 * @module as-75.test
 *
 * Card test: Great Lord of Goblin-gate (as-75)
 * Type: minion-resource-ally
 * Alignment: ringwraith
 * Stats: prowess 5, body 7, mind 3, 2 MP (ally)
 *
 * Card text:
 *   "Unique. Playable at Goblin-gate. Orc. Manifestation of The Great Goblin.
 *    Its controlling character's company is overt.
 *    Tap to give +2 prowess to all Orcs in its company: against one attack or
 *    in company versus company combat."
 *
 * Effects:
 *   1. company-overt — controlling character's company is overt
 *   2. combat-tap-company-boost — tap (self) to give +2 prowess to all Orcs in
 *      the ally's company for the current attack / CvCC
 *   + playableAt: [{ site: "Goblin-gate" }]
 *   + unique: true
 *
 * | # | Rule                                                  | Status | Notes                                                |
 * |---|-------------------------------------------------------|--------|------------------------------------------------------|
 * | 1 | Unique                                                | OK     | unique:true → site.ts unique-in-play gate            |
 * | 2 | Playable at Goblin-gate                               | OK     | playableAt site name match in site.ts                |
 * | 3 | Orc / Manifestation of The Great Goblin               | OK     | No other Great Goblin manifestation in pool;         |
 * |   |                                                       |        | identity rule reduces to uniqueness (rule 1)         |
 * | 4 | Its controlling character's company is overt          | OK     | company-overt via reducer-utils isCovertCompany      |
 * | 5 | Tap → +2 prowess to all Orcs (one attack)             | OK     | combat-tap-company-boost → attack-scoped constraints |
 * | 6 | Tap → +2 prowess to all Orcs (company vs company)     | OK     | same effect, attacker-side company in CvCC           |
 *
 * Playable: YES
 *
 * Note on "Manifestation of The Great Goblin": no other manifestation of The
 * Great Goblin exists in the implemented card pool, so the manifestation note
 * carries no mechanical effect beyond the card's own uniqueness, which the
 * engine already enforces (rule 1). It is therefore not modelled separately.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  resetMint, buildTestState, buildSitePhaseState,
  attachAllyToChar, getCharacter,
  companyIdAt, viableActions, dispatch, runCreatureCombat,
  makeCancelWindowCombat,
  Phase, CardStatus,
} from '../test-helpers.js';
import { computeLegalActions, Race } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CharacterCard, GameState,
  PlayHeroResourceAction, CombatState,
} from '../../index.js';
import { computeCombatProwess } from '../../engine/recompute-derived.js';
import { isCovertCompany } from '../../engine/reducer-utils.js';

const GREAT_LORD = 'as-75' as CardDefinitionId;

// Minion Orc characters (race "orc")
const GORBAG = 'le-11' as CardDefinitionId;      // orc, prowess 6, body 9
const ORC_CAPTAIN = 'le-31' as CardDefinitionId; // orc, prowess 5, body 8
// Minion non-Orc (race "man") — never boosted, never makes company overt
const ASTERNAK = 'le-1' as CardDefinitionId;     // man, prowess 5, body 7

// Sites
const GOBLIN_GATE = 'tw-398' as CardDefinitionId; // shadow-hold, the required site
const DIMRILL_DALE = 'le-365' as CardDefinitionId; // a different (minion R&L) site

/** Build a creature attack against the resource company at the given strike prowess. */
function creatureCombat(state: GameState, strikeProwess: number): GameState {
  return makeCancelWindowCombat(state, { creatureRace: Race.Orc, strikesTotal: 1, strikeProwess });
}

describe('Great Lord of Goblin-gate (as-75)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 2: playable at Goblin-gate ──────────────────────────────────────

  test('IS playable at Goblin-gate', () => {
    const state = buildSitePhaseState({
      characters: [ORC_CAPTAIN],
      site: GOBLIN_GATE,
      hand: [GREAT_LORD],
    });
    const allyInst = state.players[0].hand[0].instanceId;
    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === allyInst);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a site other than Goblin-gate', () => {
    const state = buildSitePhaseState({
      characters: [ORC_CAPTAIN],
      site: DIMRILL_DALE,
      hand: [GREAT_LORD],
    });
    const allyInst = state.players[0].hand[0].instanceId;
    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === allyInst);
    expect(playActions).toHaveLength(0);
  });

  // ─── Rule 4: controlling character's company is overt ─────────────────────

  test('a Man-only company bearing the ally is OVERT', () => {
    // ASTERNAK (man) would make a company covert on its own.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [ASTERNAK] }], hand: [], siteDeck: [DIMRILL_DALE] },
        { id: PLAYER_2, companies: [{ site: DIMRILL_DALE, characters: [ASTERNAK] }], hand: [], siteDeck: [GOBLIN_GATE] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, GREAT_LORD);
    const company = withAlly.players[RESOURCE_PLAYER].companies[0];
    expect(isCovertCompany(company, withAlly.players[RESOURCE_PLAYER], withAlly)).toBe(false);
  });

  test('the same Man-only company WITHOUT the ally is covert (control)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [ASTERNAK] }], hand: [], siteDeck: [DIMRILL_DALE] },
        { id: PLAYER_2, companies: [{ site: DIMRILL_DALE, characters: [ASTERNAK] }], hand: [], siteDeck: [GOBLIN_GATE] },
      ],
    });
    const company = base.players[RESOURCE_PLAYER].companies[0];
    expect(isCovertCompany(company, base.players[RESOURCE_PLAYER], base)).toBe(true);
  });

  // ─── Rule 5: tap → +2 prowess to all Orcs (creature attack) ───────────────

  function buildMixedCombat(strikeProwess = 9): { state: GameState; allyInst: CardInstanceId } {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [GORBAG, ASTERNAK] }], hand: [], siteDeck: [DIMRILL_DALE] },
        { id: PLAYER_2, companies: [{ site: DIMRILL_DALE, characters: [ASTERNAK] }], hand: [], siteDeck: [GOBLIN_GATE] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, GORBAG, GREAT_LORD);
    const allyInst = getCharacter(withAlly, RESOURCE_PLAYER, GORBAG).allies[0].instanceId;
    return { state: creatureCombat(withAlly, strikeProwess), allyInst };
  }

  test('the tap-ally-combat-boost action is offered during combat', () => {
    const { state, allyInst } = buildMixedCombat();
    const actions = viableActions(state, PLAYER_1, 'tap-ally-combat-boost')
      .filter(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === allyInst);
    expect(actions).toHaveLength(1);
  });

  test('tapping the ally gives +2 prowess to the Orc but not the Man, and taps the ally', () => {
    const { state, allyInst } = buildMixedCombat();

    const gorbag = getCharacter(state, RESOURCE_PLAYER, GORBAG);
    const asternak = getCharacter(state, RESOURCE_PLAYER, ASTERNAK);
    const gorbagDef = state.cardPool[gorbag.definitionId] as CharacterCard;
    const asternakDef = state.cardPool[asternak.definitionId] as CharacterCard;

    // Before tapping: both at base prowess.
    expect(computeCombatProwess(state, gorbag, gorbagDef, Race.Orc)).toBe(gorbagDef.prowess);
    expect(computeCombatProwess(state, asternak, asternakDef, Race.Orc)).toBe(asternakDef.prowess);

    const after = dispatch(state, { type: 'tap-ally-combat-boost', player: PLAYER_1, cardInstanceId: allyInst });

    const gorbagAfter = getCharacter(after, RESOURCE_PLAYER, GORBAG);
    const asternakAfter = getCharacter(after, RESOURCE_PLAYER, ASTERNAK);
    // Orc gains +2; Man unchanged.
    expect(computeCombatProwess(after, gorbagAfter, gorbagDef, Race.Orc)).toBe(gorbagDef.prowess + 2);
    expect(computeCombatProwess(after, asternakAfter, asternakDef, Race.Orc)).toBe(asternakDef.prowess);

    // The ally itself is now tapped.
    const allyAfter = getCharacter(after, RESOURCE_PLAYER, GORBAG).allies.find(a => a.instanceId === allyInst);
    expect(allyAfter?.status).toBe(CardStatus.Tapped);

    // Exactly one attack-scoped character-stat-modifier constraint, on the Orc.
    const boosts = after.activeConstraints.filter(
      c => c.kind.type === 'character-stat-modifier' && c.scope.kind === 'attack',
    );
    expect(boosts).toHaveLength(1);
    expect(boosts[0].kind.type === 'character-stat-modifier' && boosts[0].kind.characterId).toBe(gorbag.instanceId);
  });

  test('the boost flips a real strike outcome: wounded without it, survives with it', () => {
    // Gorbag prowess 6; creature strike prowess 12; tap-to-fight (full prowess).
    // Roll 5: without boost 5+6=11 < 12 → wounded; with boost 5+8=13 > 12 → survives.

    // Control: no ally tap → Gorbag is wounded (body check roll 6 <= body 9 → survives wounded).
    {
      const { state } = buildMixedCombat(12);
      const finished = runCreatureCombat(state, GORBAG, 5, 6, /* tapToFight */ true);
      expect(finished.combat).toBeNull();
      expect(getCharacter(finished, RESOURCE_PLAYER, GORBAG).status).toBe(CardStatus.Inverted);
    }

    // With boost: tap ally first → Gorbag survives (tapped, not wounded).
    {
      const { state, allyInst } = buildMixedCombat(12);
      const boosted = dispatch(state, { type: 'tap-ally-combat-boost', player: PLAYER_1, cardInstanceId: allyInst });
      let finished = runCreatureCombat(boosted, GORBAG, 5, null, /* tapToFight */ true);
      // Defeating the creature offers the Orc a trophy; decline to finalize combat.
      if (finished.combat?.phase === 'trophy-offer') {
        finished = dispatch(finished, { type: 'pass', player: PLAYER_1 });
      }
      expect(finished.combat).toBeNull();
      expect(getCharacter(finished, RESOURCE_PLAYER, GORBAG).status).not.toBe(CardStatus.Inverted);
    }
  });

  test('the ally may only apply its boost once per attack', () => {
    const { state, allyInst } = buildMixedCombat();
    const after = dispatch(state, { type: 'tap-ally-combat-boost', player: PLAYER_1, cardInstanceId: allyInst });
    // Action no longer offered (ally tapped + boost already applied).
    const again = viableActions(after, PLAYER_1, 'tap-ally-combat-boost')
      .filter(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === allyInst);
    expect(again).toHaveLength(0);
  });

  test('the boost is cleared when the attack finalizes', () => {
    const { state, allyInst } = buildMixedCombat(12);
    const boosted = dispatch(state, { type: 'tap-ally-combat-boost', player: PLAYER_1, cardInstanceId: allyInst });
    expect(boosted.activeConstraints.some(c => c.scope.kind === 'attack')).toBe(true);

    let finished = runCreatureCombat(boosted, GORBAG, 5, null, true);
    if (finished.combat?.phase === 'trophy-offer') {
      finished = dispatch(finished, { type: 'pass', player: PLAYER_1 });
    }
    expect(finished.combat).toBeNull();
    // Attack-scoped boost swept at combat finalization.
    expect(finished.activeConstraints.some(c => c.scope.kind === 'attack')).toBe(false);
  });

  // ─── Rule 6: tap → +2 prowess to all Orcs (company vs company combat) ──────

  test('CvCC: tapping the ally boosts the Orc in the ally\'s (attacking) company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [GORBAG] }], hand: [], siteDeck: [DIMRILL_DALE] },
        { id: PLAYER_2, companies: [{ site: GOBLIN_GATE, characters: [ASTERNAK] }], hand: [], siteDeck: [DIMRILL_DALE] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, GORBAG, GREAT_LORD);
    const allyInst = getCharacter(withAlly, RESOURCE_PLAYER, GORBAG).allies[0].instanceId;

    // Raw CvCC: P1 (Gorbag) attacks P2's company. The ally is in the attacking company.
    const combat: CombatState = {
      attackSource: { type: 'company-attack', attackingCompanyId: companyIdAt(withAlly, RESOURCE_PLAYER) },
      companyId: companyIdAt(withAlly, HAZARD_PLAYER), // defending company (P2)
      defendingPlayerId: PLAYER_2,
      attackingPlayerId: PLAYER_1,
      strikesTotal: 1,
      strikeProwess: 0,
      creatureBody: null,
      strikeAssignments: [],
      currentStrikeIndex: 0,
      phase: 'assign-strikes',
      assignmentPhase: 'defender',
      bodyCheckTarget: null,
      detainment: false,
      isCvCC: true,
    };
    const cvcc: GameState = { ...withAlly, combat };

    const before = getCharacter(cvcc, RESOURCE_PLAYER, GORBAG).effectiveStats.prowess;

    // Offered to the attacking player (the ally's company is the attacking company).
    const offered = viableActions(cvcc, PLAYER_1, 'tap-ally-combat-boost')
      .filter(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === allyInst);
    expect(offered).toHaveLength(1);

    const after = dispatch(cvcc, { type: 'tap-ally-combat-boost', player: PLAYER_1, cardInstanceId: allyInst });
    const boostedProwess = getCharacter(after, RESOURCE_PLAYER, GORBAG).effectiveStats.prowess;
    expect(boostedProwess).toBe(before + 2);
  });
});
