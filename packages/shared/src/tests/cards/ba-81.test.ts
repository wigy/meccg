/**
 * @module ba-81.test
 *
 * Card test: Stabbing Tongue of Fire (ba-81)
 * Type: minion-resource-item (subtype "special"), keyword "balrog-specific".
 * Alignment: Ringwraith/Balrog. Unique. Marshalling points: 1 (item).
 *
 * Text:
 *   "Unique. Balrog specific. Playable at any tapped or untapped non-Darkhaven
 *    Under-deeps site. May only be borne by The Balrog. This item affects The
 *    Balrog. +1 prowess when tapping to face a strike. +1 to all body checks
 *    resulting from failed strikes against The Balrog. If The Balrog attacks
 *    successfully in company vs. company combat, +1 to the defending character's
 *    body check."
 *
 * Engine support:
 * | # | Rule                                                          | Status      |
 * |---|--------------------------------------------------------------|-------------|
 * | 1 | Playable at a tapped or untapped non-Darkhaven Under-deeps    | IMPLEMENTED |
 * | 2 | May only be borne by The Balrog                              | IMPLEMENTED |
 * | 3 | +1 prowess when tapping to face a strike                     | IMPLEMENTED |
 * | 4 | +1 to body checks from failed strikes against The Balrog     | IMPLEMENTED |
 * | 5 | CvCC: Balrog attacks successfully → +1 defender body check    | IMPLEMENTED |
 *
 * Rule 1 is an `item-play-site` effect (`allowTapped: true`, `filter` = under-deeps
 * keyword AND siteType != haven). "Darkhaven" Under-deeps sites are the haven-type
 * ones (The Under-gates ba-100); every other Under-deeps site (dark-hold,
 * ruins-and-lairs, shadow-hold) qualifies, tapped or untapped.
 *
 * Rule 2 is a `play-target` character filter `{ target.name: "The Balrog" }`.
 *
 * Rule 3 is a `stat-modifier` (`prowess +1`) gated `when: { combat.strikeMode: "tap" }`.
 * `combat.strikeMode` is threaded into `computeCombatProwess` from the strike
 * resolution mode, so the bonus applies only when The Balrog taps to face a
 * strike — not when he stays untapped, and not to his non-combat effective stats.
 *
 * Rules 4 & 5 are `body-check-modifier` `scope: "bearer-combat"` effects, identical
 * in shape to Flame of Udûn (ba-58): the relevant bearer is the parrying defender
 * for a `creature` body check (a failed strike against The Balrog) and the
 * successful CvCC attacker for a `character` body check.
 *
 * Fixture alignment: Balrog-specific minion item → The Balrog (ba-3) plus
 * Balrog/minion sites (Under-galleries ba-99, The Under-gates ba-100 haven,
 * Barad-dûr ba-84 surface). Gimli is the hero CvCC body-check target.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase, CardStatus, Alignment,
  GIMLI,
  buildTestState, buildMinionSitePhaseState, resetMint,
  viableActionsForHandCard, executeAction,
  findCharInstanceId, getCharacter,
  attachItemToChar, companyIdAt, makeBodyCheckCombat, makeShadowMHState,
  addP2CardsInPlay, findInPile,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay, CombatState, GameState } from '../../index.js';
import { Race } from '../../index.js';

// ── Local card-ID constants ───────────────────────────────────────────────────

/** Stabbing Tongue of Fire — the card under test */
const STABBING_TONGUE = 'ba-81' as CardDefinitionId;
/** The Balrog — Balrog avatar (prowess 8, body 11, mind null) */
const THE_BALROG = 'ba-3' as CardDefinitionId;
/** Crook-legged Orc — a non-Balrog minion character (fails the bearer filter) */
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;
/** The Under-galleries (BA) — dark-hold, Under-deeps (a valid non-Darkhaven site) */
const UNDER_GALLERIES = 'ba-99' as CardDefinitionId;
/** The Under-gates (BA) — haven (Darkhaven), Under-deeps (the excluded site) */
const UNDER_GATES = 'ba-100' as CardDefinitionId;
/** Barad-dûr (BA) — dark-hold, surface (NOT an Under-deeps site) */
const BARAD_DUR_BA = 'ba-84' as CardDefinitionId;
/** An Orc hazard creature card (only needs to exist for combat finalize routing) */
const ORC_CREATURE = 'tw-074' as CardDefinitionId;

describe('Stabbing Tongue of Fire (ba-81)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Playable at a tapped or untapped non-Darkhaven Under-deeps site ──

  test('playable at an untapped non-Darkhaven Under-deeps site, attached to The Balrog', () => {
    const state = buildMinionSitePhaseState({
      site: UNDER_GALLERIES, characters: [THE_BALROG], hand: [STABBING_TONGUE],
    });
    const actions = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, STABBING_TONGUE);
    expect(actions.length).toBe(1);
    const attach = (actions[0].action as { attachToCharacterId?: unknown }).attachToCharacterId;
    expect(attach).toBe(findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG));
  });

  test('playable at a TAPPED non-Darkhaven Under-deeps site (allowTapped)', () => {
    const state = buildMinionSitePhaseState({
      site: UNDER_GALLERIES, characters: [THE_BALROG], hand: [STABBING_TONGUE],
      siteStatus: CardStatus.Tapped,
    });
    expect(
      viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, STABBING_TONGUE).length,
    ).toBe(1);
  });

  test('NOT playable at the Darkhaven (haven-type) Under-deeps site The Under-gates', () => {
    const state = buildMinionSitePhaseState({
      site: UNDER_GATES, characters: [THE_BALROG], hand: [STABBING_TONGUE],
    });
    expect(
      viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, STABBING_TONGUE),
    ).toHaveLength(0);
  });

  test('NOT playable at a surface (non-Under-deeps) site', () => {
    const state = buildMinionSitePhaseState({
      site: BARAD_DUR_BA, characters: [THE_BALROG], hand: [STABBING_TONGUE],
    });
    expect(
      viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, STABBING_TONGUE),
    ).toHaveLength(0);
  });

  // ── Rule 2: May only be borne by The Balrog ─────────────────────────────────

  test('NOT playable when the company has no Balrog to bear it', () => {
    const state = buildMinionSitePhaseState({
      site: UNDER_GALLERIES, characters: [CROOK_LEGGED_ORC], hand: [STABBING_TONGUE],
    });
    expect(
      viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, STABBING_TONGUE),
    ).toHaveLength(0);
  });

  test('offered only on The Balrog when both a Balrog and a non-Balrog are present', () => {
    const state = buildMinionSitePhaseState({
      site: UNDER_GALLERIES, characters: [THE_BALROG, CROOK_LEGGED_ORC], hand: [STABBING_TONGUE],
    });
    const actions = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, STABBING_TONGUE);
    expect(actions.length).toBe(1);
    expect((actions[0].action as { attachToCharacterId?: unknown }).attachToCharacterId)
      .toBe(findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG));
  });

  // ── Rule 3: +1 prowess when tapping to face a strike ────────────────────────

  describe('+1 prowess when The Balrog taps to face a strike', () => {
    // A lone Balrog faces a single 15-prowess Orc strike (no creature body, so a
    // parry/tie finalizes the combat). Base Balrog prowess 8; the stay-untapped
    // penalty is -1 (his own card). The item adds +1 only in `tap` mode.
    function facingState(withItem: boolean): { state: GameState; balrogId: CardInstanceId } {
      let state = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        recompute: true,
        players: [
          { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: BARAD_DUR_BA, characters: [THE_BALROG] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
        ],
      });
      if (withItem) state = attachItemToChar(state, RESOURCE_PLAYER, THE_BALROG, STABBING_TONGUE);
      const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
      const combat: CombatState = {
        attackSource: { type: 'creature', instanceId: 'fake-orc' as CardInstanceId },
        companyId: companyIdAt(state, RESOURCE_PLAYER),
        defendingPlayerId: PLAYER_1,
        attackingPlayerId: PLAYER_2,
        strikesTotal: 1,
        strikeProwess: 15,
        creatureBody: null,
        creatureRace: Race.Orc,
        strikeAssignments: [{ characterId: balrogId, excessStrikes: 0, resolved: false }],
        currentStrikeIndex: 0,
        phase: 'resolve-strike',
        assignmentPhase: 'done',
        bodyCheckTarget: null,
        detainment: false,
      };
      return { state: { ...state, phaseState: makeShadowMHState(), combat }, balrogId };
    }

    test('tapping WITH the item survives a strike that wounds WITHOUT it (roll 6)', () => {
      // With item, tap: 6 + (8 + 1) = 15 ties the 15-prowess strike → no wound (tapped).
      const withItem = facingState(true);
      const afterWith = executeAction(withItem.state, PLAYER_1, 'resolve-strike', 6, true);
      expect(getCharacter(afterWith, RESOURCE_PLAYER, THE_BALROG).status).toBe(CardStatus.Tapped);

      // Without item, tap: 6 + 8 = 14 < 15 → wounded (inverted).
      const noItem = facingState(false);
      const afterNo = executeAction(noItem.state, PLAYER_1, 'resolve-strike', 6, true);
      expect(getCharacter(afterNo, RESOURCE_PLAYER, THE_BALROG).status).toBe(CardStatus.Inverted);
    });

    test('the +1 does NOT apply when The Balrog stays untapped (roll 7)', () => {
      const withItem = facingState(true);
      // Tapping: 7 + (8 + 1) = 16 > 15 → success (tapped).
      const afterTap = executeAction(withItem.state, PLAYER_1, 'resolve-strike', 7, true);
      expect(getCharacter(afterTap, RESOURCE_PLAYER, THE_BALROG).status).toBe(CardStatus.Tapped);

      // Staying untapped: 7 + (8 - 1, no item bonus) = 14 < 15 → wounded (inverted).
      // Had the +1 applied it would total 15 (a tie) and survive, so the wound
      // proves the modifier is suppressed when not tapping.
      const afterUntap = executeAction(withItem.state, PLAYER_1, 'resolve-strike', 7, false);
      expect(getCharacter(afterUntap, RESOURCE_PLAYER, THE_BALROG).status).toBe(CardStatus.Inverted);
    });

    test('the +1 does not leak into The Balrog\'s non-combat effective prowess', () => {
      const { state } = facingState(true);
      const basePool = state.cardPool[THE_BALROG] as { prowess: number };
      expect(getCharacter(state, RESOURCE_PLAYER, THE_BALROG).effectiveStats.prowess).toBe(basePool.prowess);
    });
  });

  // ── Rule 4: +1 to body checks from failed strikes against The Balrog ─────────

  describe('failed strike against The Balrog raises the creature body check (+1)', () => {
    function creatureBodyCheckState(withItem: boolean): { state: GameState; creatureId: CardInstanceId } {
      let state = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: BARAD_DUR_BA, characters: [THE_BALROG] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
        ],
      });
      if (withItem) state = attachItemToChar(state, RESOURCE_PLAYER, THE_BALROG, STABBING_TONGUE);
      const creatureId = 'orc-creature-1' as CardInstanceId;
      const creature: CardInPlay = { instanceId: creatureId, definitionId: ORC_CREATURE, status: CardStatus.Untapped };
      state = addP2CardsInPlay(state, [creature]);
      const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
      const combat = makeBodyCheckCombat({
        companyId: companyIdAt(state, RESOURCE_PLAYER),
        characterId: balrogId,
        attackingPlayerId: PLAYER_2,
        defendingPlayerId: PLAYER_1,
        bodyCheckTarget: 'creature',
        result: 'success', // the Balrog parried this strike
        creatureBody: 8,
        creatureRace: Race.Orc,
        attackSource: { type: 'creature', instanceId: creatureId },
      });
      return { state: { ...state, phaseState: makeShadowMHState(), combat }, creatureId };
    }

    test('with the item, a body-check roll equal to the creature body defeats it (+1)', () => {
      const { state, creatureId } = creatureBodyCheckState(true);
      // Roll 8 + 1 (item) = 9 > creature body 8 → strike defeated, creature killed.
      // A Balrog defender's non-starred kill is routed out of play (rule 8.22).
      const after = executeAction(state, PLAYER_2, 'body-check-roll', 8);
      expect(after.combat).toBeNull();
      expect(findInPile(after, RESOURCE_PLAYER, 'outOfPlayPile', creatureId)).toBeDefined();
      expect(findInPile(after, HAZARD_PLAYER, 'discardPile', creatureId)).toBeUndefined();
    });

    test('without the item, the same roll leaves the creature alive (control)', () => {
      const { state, creatureId } = creatureBodyCheckState(false);
      // Roll 8 = creature body 8 (no +1) → not > body → creature survives, discarded.
      const after = executeAction(state, PLAYER_2, 'body-check-roll', 8);
      expect(after.combat).toBeNull();
      expect(findInPile(after, HAZARD_PLAYER, 'discardPile', creatureId)).toBeDefined();
    });
  });

  // ── Rule 5: CvCC — Balrog attacks successfully → +1 defender body check ──────

  describe('CvCC: Balrog attacking successfully raises the defending character body check (+1)', () => {
    function cvccState(withItem: boolean): { state: GameState; gimliId: CardInstanceId } {
      let state = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: BARAD_DUR_BA, characters: [THE_BALROG] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARAD_DUR_BA, characters: [GIMLI] }], hand: [], siteDeck: [] },
        ],
      });
      if (withItem) state = attachItemToChar(state, RESOURCE_PLAYER, THE_BALROG, STABBING_TONGUE);
      const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
      const gimliId = findCharInstanceId(state, HAZARD_PLAYER, GIMLI);
      const combat = makeBodyCheckCombat({
        companyId: companyIdAt(state, HAZARD_PLAYER),
        characterId: gimliId,             // the wounded defending character
        attackingPlayerId: PLAYER_1,      // the Balrog attacks
        defendingPlayerId: PLAYER_2,
        bodyCheckTarget: 'character',
        isCvCC: true,
        attackingCharacterId: balrogId,
        attackSource: { type: 'company-attack', attackingCompanyId: companyIdAt(state, RESOURCE_PLAYER) },
      });
      return { state: { ...state, phaseState: makeShadowMHState(), combat }, gimliId };
    }

    test('with the item, a body-check roll equal to the defender body eliminates him (+1)', () => {
      const { state, gimliId } = cvccState(true);
      // Gimli body 8; roll 8 + 1 (item) = 9 > 8 → eliminated.
      const after = executeAction(state, PLAYER_1, 'body-check-roll', 8);
      expect(after.players[HAZARD_PLAYER].characters[gimliId]).toBeUndefined();
    });

    test('without the item, the same roll leaves the defender in play (control)', () => {
      const { state, gimliId } = cvccState(false);
      // Roll 8 = body 8 (no +1) → not > body → Gimli survives the body check.
      const after = executeAction(state, PLAYER_1, 'body-check-roll', 8);
      expect(after.players[HAZARD_PLAYER].characters[gimliId]).toBeDefined();
    });
  });
});
