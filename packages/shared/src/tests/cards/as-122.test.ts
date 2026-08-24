/**
 * @module as-122.test
 *
 * Card test: Ancient Black Axe (as-122)
 * Type: minion-resource-item (Special Item), alignment ringwraith, unique.
 * Marshalling points: 4 · Corruption: 4.
 *
 * Text: "Unique. Playable at any Under-deeps Shadow-hold [{S}]. Weapon. +2
 * direct influence. Warrior only: +3 prowess (to a maximum of 11); -1 to
 * strike's body; tap this item to make a character at the same site
 * automatically pass a corruption check. When this item becomes tapped,
 * bearer makes a corruption check."
 *
 * Effects:
 * | # | Effect Type                        | Status | Notes                                                       |
 * |---|-------------------------------------|--------|---------------------------------------------------------------|
 * | 1 | item-play-site (filter)             | OK     | site.keywords includes under-deeps AND site.siteType shadow-hold |
 * | 2 | stat-modifier direct-influence +2   | OK     | unconditional                                                  |
 * | 3 | stat-modifier prowess +3, max 11    | OK     | warrior only                                                    |
 * | 4 | enemy-modifier body subtract 1      | OK     | warrior only; CvCC — reduces defender's body-check target       |
 * | 5 | grant-action auto-pass-corruption-check | OK | tap item; targets a character at the same site (any company); sequence [add-constraint check-modifier autoPass, enqueue-corruption-check on bearer] |
 *
 * Playable: YES.
 *
 * Fixture alignment: minion-resource-item (ringwraith). Tests use minion
 * (LE/AS) characters and sites per project convention. Hero characters
 * (Aragorn) are used only as the CvCC combat *opponent*, matching how
 * Helm of Fear (as-126) tests CvCC interactions.
 *
 * Data fix landed alongside this certification: the six AS Under-deeps
 * sites (as-163..as-168) were missing `keywords: ["under-deeps"]` — without
 * it, Ancient Black Axe would have had no valid minion site to be played at.
 * Cross-checked against the master card database (AS-163..AS-168).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, Alignment,
  buildMinionSitePhaseState,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  CardStatus, CardDefinitionId, CardInstanceId,
  dispatch, viableActions, attachItemToChar,
  findCharInstanceId, findHandCardId, companyIdAt,
  getCharacter, recomputeDerived, enqueueCorruptionCheck,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { ActivateGrantedAction, CombatState, CorruptionCheckAction, GameState } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';

const ANCIENT_BLACK_AXE = 'as-122' as CardDefinitionId;

// Minion (ringwraith) characters.
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;    // warrior, non-unique, prowess 5, body 8
const LUITPRAND = 'le-23' as CardDefinitionId;      // scout only (non-warrior), prowess 3, body 7
// Highest-prowess non-avatar minion warrior in the pool (rule 9.20 / CRF
// 6.1.R2: an actual Ringwraith avatar — race "ringwraith", mind null — may
// bear but never use any item, so Khamul cannot be the bearer here).
const LIEUTENANT_OF_MORGUL = 'le-22' as CardDefinitionId; // warrior/ranger, prowess 8

// Minion Under-deeps sites (AS set).
const UNDER_GATES = 'as-165' as CardDefinitionId;    // shadow-hold, under-deeps — valid
const UNDER_GROTTOS = 'as-166' as CardDefinitionId;  // ruins-and-lairs, under-deeps — wrong site type
const GOBLIN_GATE = 'le-378' as CardDefinitionId;    // shadow-hold, NOT under-deeps — wrong keyword
const DOL_GULDUR = 'le-367' as CardDefinitionId;     // minion placeholder site (used by buildMinionSitePhaseState's P2)

// Hero character/site for CvCC combat.
const ARAGORN = 'tw-120' as CardDefinitionId;        // hero, body 9
const MINAS_TIRITH = 'tw-407' as CardDefinitionId;

/** Find the in-play instance of the Axe on a given character. */
function axeOnChar(state: GameState, playerIdx: number, charDefId: CardDefinitionId) {
  const charId = findCharInstanceId(state, playerIdx, charDefId);
  return state.players[playerIdx].characters[charId].items.find(
    i => i.definitionId === ANCIENT_BLACK_AXE,
  );
}

describe('Ancient Black Axe (as-122)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: item-play-site — Under-deeps Shadow-hold only ──────────────

  test('playable at an Under-deeps Shadow-hold (The Under-gates)', () => {
    const state = buildMinionSitePhaseState({
      site: UNDER_GATES,
      characters: [ORC_CAPTAIN],
      hand: [ANCIENT_BLACK_AXE],
    });
    const axeId = findHandCardId(state, RESOURCE_PLAYER, ANCIENT_BLACK_AXE);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (axeId as string),
    );
    expect(plays.length).toBeGreaterThan(0);
  });

  test('NOT playable at a Shadow-hold that is not Under-deeps (Goblin-gate)', () => {
    const state = buildMinionSitePhaseState({
      site: GOBLIN_GATE,
      characters: [ORC_CAPTAIN],
      hand: [ANCIENT_BLACK_AXE],
    });
    const axeId = findHandCardId(state, RESOURCE_PLAYER, ANCIENT_BLACK_AXE);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (axeId as string),
    );
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at an Under-deeps site that is not a Shadow-hold (The Under-grottos)', () => {
    const state = buildMinionSitePhaseState({
      site: UNDER_GROTTOS,
      characters: [ORC_CAPTAIN],
      hand: [ANCIENT_BLACK_AXE],
    });
    const axeId = findHandCardId(state, RESOURCE_PLAYER, ANCIENT_BLACK_AXE);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (axeId as string),
    );
    expect(plays).toHaveLength(0);
  });

  // ── Effect 2: +2 direct influence (unconditional) ─────────────────────────

  test('+2 direct influence applies even to a non-warrior bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [LUITPRAND] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, LUITPRAND, ANCIENT_BLACK_AXE));
    expect(getCharacter(state, RESOURCE_PLAYER, LUITPRAND).effectiveStats.directInfluence).toBe(2); // base 0 + 2
  });

  // ── Effect 3: warrior-only +3 prowess (max 11) ────────────────────────────

  test('warrior bearer gains +3 prowess', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ORC_CAPTAIN, ANCIENT_BLACK_AXE));
    expect(getCharacter(state, RESOURCE_PLAYER, ORC_CAPTAIN).effectiveStats.prowess).toBe(8); // base 5 + 3
  });

  test('+3 prowess reaches the maximum of 11 (Lieutenant of Morgul base 8)', () => {
    // No non-avatar minion warrior in the pool prints prowess above 8, so
    // this can't demonstrate clamping strictly above 11 — but it does prove
    // the configured maximum is exactly 11 (8 + 3 = 11, landing precisely on
    // the card's stated cap).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [LIEUTENANT_OF_MORGUL] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL, ANCIENT_BLACK_AXE));
    expect(getCharacter(state, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL).effectiveStats.prowess).toBe(11);
  });

  test('+3 prowess does NOT apply to a non-warrior bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [LUITPRAND] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, LUITPRAND, ANCIENT_BLACK_AXE));
    expect(getCharacter(state, RESOURCE_PLAYER, LUITPRAND).effectiveStats.prowess).toBe(3); // unchanged
  });

  // ── Effect 4: warrior-only -1 to strike's body (CvCC) ─────────────────────

  function cvccBase(bearerDefId: CardDefinitionId): GameState {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [bearerDefId] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      ],
    });
  }

  /** Build a CvCC body-check combat where `attackerDefId` (PLAYER_1) strikes Aragorn (PLAYER_2). */
  function cvccBodyCheckCombat(state: GameState, attackerDefId: CardDefinitionId): CombatState {
    const attackerId = findCharInstanceId(state, RESOURCE_PLAYER, attackerDefId);
    const aragornId = findCharInstanceId(state, HAZARD_PLAYER, ARAGORN);
    return {
      attackSource: { type: 'company-attack', attackingCompanyId: companyIdAt(state, RESOURCE_PLAYER) },
      companyId: companyIdAt(state, HAZARD_PLAYER),
      defendingPlayerId: state.players[HAZARD_PLAYER].id,
      attackingPlayerId: state.players[RESOURCE_PLAYER].id,
      strikesTotal: 1,
      strikeProwess: 10,
      creatureBody: null,
      creatureRace: undefined,
      strikeAssignments: [
        {
          characterId: aragornId,
          attackingCharacterId: attackerId,
          excessStrikes: 0,
          resolved: true,
          result: 'wounded',
          wasAlreadyWounded: false,
        },
      ],
      currentStrikeIndex: 0,
      phase: 'body-check',
      assignmentPhase: 'done',
      bodyCheckTarget: 'character',
      isCvCC: true,
      detainment: false,
    };
  }

  test('without the Axe, a body-check roll of 9 leaves the body-9 Aragorn alive', () => {
    const base = cvccBase(ORC_CAPTAIN);
    const combat = cvccBodyCheckCombat(base, ORC_CAPTAIN);
    const ready = { ...base, combat, cheatRollTotal: 9 };
    const [bodyCheck] = viableActions(ready, PLAYER_1, 'body-check-roll');
    const after = dispatch(ready, bodyCheck.action);
    const aragornId = findCharInstanceId(base, HAZARD_PLAYER, ARAGORN);
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === aragornId)).toBe(false);
    expect(after.players[HAZARD_PLAYER].outOfPlayPile.some(c => c.instanceId === aragornId)).toBe(false);
  });

  test("with the Axe on a warrior bearer (-1), the same roll of 9 eliminates Aragorn (effective body 8)", () => {
    const withItem = attachItemToChar(cvccBase(ORC_CAPTAIN), RESOURCE_PLAYER, ORC_CAPTAIN, ANCIENT_BLACK_AXE);
    const combat = cvccBodyCheckCombat(withItem, ORC_CAPTAIN);
    const ready = { ...withItem, combat, cheatRollTotal: 9 };
    const [bodyCheck] = viableActions(ready, PLAYER_1, 'body-check-roll');
    const after = dispatch(ready, bodyCheck.action);
    const aragornId = findCharInstanceId(withItem, HAZARD_PLAYER, ARAGORN);
    // CoE 3.v: the eliminated CvCC defender counts as kill MPs for the
    // attacking player, so it goes to the attacker's kill pile.
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === aragornId)).toBe(true);
    expect(after.players[HAZARD_PLAYER].outOfPlayPile.some(c => c.instanceId === aragornId)).toBe(false);
  });

  test('with the Axe on a NON-warrior bearer, the same roll of 9 leaves Aragorn alive (no body reduction)', () => {
    const withItem = attachItemToChar(cvccBase(LUITPRAND), RESOURCE_PLAYER, LUITPRAND, ANCIENT_BLACK_AXE);
    const combat = cvccBodyCheckCombat(withItem, LUITPRAND);
    const ready = { ...withItem, combat, cheatRollTotal: 9 };
    const [bodyCheck] = viableActions(ready, PLAYER_1, 'body-check-roll');
    const after = dispatch(ready, bodyCheck.action);
    const aragornId = findCharInstanceId(withItem, HAZARD_PLAYER, ARAGORN);
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === aragornId)).toBe(false);
    expect(after.players[HAZARD_PLAYER].outOfPlayPile.some(c => c.instanceId === aragornId)).toBe(false);
  });

  // ── Effect 5: grant-action auto-pass-corruption-check ─────────────────────

  function twoCompanySameSiteState(): GameState {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: UNDER_GATES, characters: [{ defId: ORC_CAPTAIN, items: [ANCIENT_BLACK_AXE] }] },
            { site: UNDER_GATES, characters: [LUITPRAND] },
          ],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
  }

  test('offered targeting another character at the same site (different company)', () => {
    const state = twoCompanySameSiteState();
    const luitprandId = findCharInstanceId(state, RESOURCE_PLAYER, LUITPRAND);

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'auto-pass-corruption-check');

    expect(actions).toHaveLength(1);
    expect(actions[0].targetCardId).toBe(luitprandId);
  });

  test('offered targeting an opponent character at the same location (alignment-specific site versions)', () => {
    // Regression: "the same site" was matched by site definition id, but each
    // location exists as alignment-specific site cards — the minion company
    // stands at Moria (le-392) while the hero company stands at Moria
    // (tw-413). Same location, different definition ids: the opponent's
    // character was never offered as a target.
    const MORIA_MINION = 'le-392' as CardDefinitionId;
    const MORIA_HERO = 'tw-413' as CardDefinitionId;
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA_MINION, characters: [{ defId: ORC_CAPTAIN, items: [ANCIENT_BLACK_AXE] }] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MORIA_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      ],
    });
    const aragornId = findCharInstanceId(state, HAZARD_PLAYER, ARAGORN);

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'auto-pass-corruption-check');

    expect(actions).toHaveLength(1);
    expect(actions[0].targetCardId).toBe(aragornId);
  });

  test('NOT offered targeting the bearer itself, and not offered when alone at the site', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: UNDER_GATES, characters: [{ defId: ORC_CAPTAIN, items: [ANCIENT_BLACK_AXE] }] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const actions = viableActions(base, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'auto-pass-corruption-check');
    expect(actions).toHaveLength(0);
  });

  test('activating taps the Axe (not the bearer), adds an auto-pass constraint on the target, and enqueues a corruption check on the bearer', () => {
    const state = twoCompanySameSiteState();
    const orcCaptainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const luitprandId = findCharInstanceId(state, RESOURCE_PLAYER, LUITPRAND);

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .find(a => a.actionId === 'auto-pass-corruption-check')!;
    const after = dispatch(state, action);

    // The Axe (item) is tapped; the bearer stays untapped (cost is "self").
    expect(axeOnChar(after, RESOURCE_PLAYER, ORC_CAPTAIN)!.status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].characters[orcCaptainId].status).toBe(CardStatus.Untapped);

    // A check-modifier constraint with autoPass targets Luitprand.
    const constraints = after.activeConstraints.filter(c => c.kind.type === 'check-modifier' && c.kind.check === 'corruption');
    expect(constraints).toHaveLength(1);
    const constraint = constraints[0];
    if (constraint.kind.type === 'check-modifier') {
      expect(constraint.kind.autoPass).toBe(true);
    }
    expect(constraint.target.kind).toBe('character');
    if (constraint.target.kind === 'character') {
      expect(constraint.target.characterId).toBe(luitprandId);
    }

    // A corruption check is enqueued on the bearer (Orc Captain), not Luitprand.
    expect(after.pendingResolutions).toHaveLength(1);
    expect(after.pendingResolutions[0].kind.type).toBe('corruption-check');
    if (after.pendingResolutions[0].kind.type === 'corruption-check') {
      expect(after.pendingResolutions[0].kind.characterId).toBe(orcCaptainId);
    }
  });

  test('autoPass forces a normally-failing corruption check to succeed unconditionally', () => {
    // Give Luitprand a real corruption-point total via an attached item so a
    // low roll would otherwise fail badly (eliminated).
    const base = recomputeDerived(attachItemToChar(twoCompanySameSiteState(), RESOURCE_PLAYER, LUITPRAND, ANCIENT_BLACK_AXE));
    const luitprandId = findCharInstanceId(base, RESOURCE_PLAYER, LUITPRAND);
    const cp = getCharacter(base, RESOURCE_PLAYER, LUITPRAND).effectiveStats.corruptionPoints;
    expect(cp).toBeGreaterThan(0);

    const withCheck = enqueueCorruptionCheck(base, PLAYER_1, luitprandId);

    // Baseline: without autoPass, a very low roll (total 2) fails badly — eliminated.
    const lowRoll = { ...withCheck, cheatRollTotal: 2 };
    const rollAction = computeLegalActions(lowRoll, PLAYER_1)
      .find(ea => ea.viable && ea.action.type === 'corruption-check')!.action as CorruptionCheckAction;
    const failedOutcome = dispatch(lowRoll, rollAction);
    expect(failedOutcome.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === luitprandId)
      || failedOutcome.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === luitprandId)).toBe(true);

    // With an autoPass constraint on Luitprand, the same low roll succeeds —
    // Luitprand is untouched and stays in his company.
    const withAutoPass = addConstraint(withCheck, {
      source: 'axe-1' as CardInstanceId,
      sourceDefinitionId: ANCIENT_BLACK_AXE,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: luitprandId },
      kind: { type: 'check-modifier', check: 'corruption', value: 0, autoPass: true },
    });
    const lowRoll2 = { ...withAutoPass, cheatRollTotal: 2 };
    const rollAction2 = computeLegalActions(lowRoll2, PLAYER_1)
      .find(ea => ea.viable && ea.action.type === 'corruption-check')!.action as CorruptionCheckAction;
    const passedOutcome = dispatch(lowRoll2, rollAction2);

    expect(passedOutcome.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === luitprandId)).toBe(false);
    expect(passedOutcome.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === luitprandId)).toBe(false);
    const company = passedOutcome.players[RESOURCE_PLAYER].companies.find(co => co.characters.includes(luitprandId));
    expect(company).toBeDefined();

    // The autoPass constraint is consumed.
    expect(passedOutcome.activeConstraints.some(c => c.kind.type === 'check-modifier' && c.kind.check === 'corruption')).toBe(false);
  });
});
