/**
 * @module ba-82.test
 *
 * Card test: Whip of Many Thongs (ba-82)
 * Type: minion-resource-item (subtype "special"), keyword "balrog-specific".
 * Alignment: Ringwraith/Balrog. Unique. Marshalling points: 1 (item).
 *
 * Text:
 *   "Unique. Balrog specific. Playable at any tapped or untapped non-Darkhaven
 *    Under-deeps site. May only be borne by The Balrog. This item affects The
 *    Balrog. +1 prowess when tapping to face a strike. If The Balrog is in
 *    company vs. company combat, tap this item to cancel all effects of one
 *    weapon of your choice (even declared in the same chain of effects) in an
 *    opponent's company until the end of the combat. This does not discard the
 *    weapon."
 *
 * Engine support:
 * | # | Rule                                                          | Status      |
 * |---|--------------------------------------------------------------|-------------|
 * | 1 | Playable at a tapped or untapped non-Darkhaven Under-deeps    | IMPLEMENTED |
 * | 2 | May only be borne by The Balrog                              | IMPLEMENTED |
 * | 3 | +1 prowess when tapping to face a strike                     | IMPLEMENTED |
 * | 4 | CvCC: tap to cancel all effects of one opponent weapon        | IMPLEMENTED |
 *
 * Rules 1–3 are shared with Stabbing Tongue of Fire (ba-81): an `item-play-site`
 * (`allowTapped`, `filter` = under-deeps keyword AND siteType != haven), a
 * `play-target` character filter `{ target.name: "The Balrog" }`, and a
 * `stat-modifier` prowess +1 gated `when: { combat.strikeMode: "tap" }` (threaded
 * into `computeCombatProwess` so it applies only when The Balrog taps to face a
 * strike, never to his non-combat effective stats).
 *
 * Rule 4 is the new `combat-cancel-weapon` ability: during a company-vs-company
 * combat the controller of the Whip (borne by The Balrog, untapped) may tap it to
 * add one chosen `weapon`-keyword item in the opposing company to
 * `CombatState.suppressedWeaponInstanceIds`. While suppressed, that weapon
 * contributes no effects — `collectCharacterEffects` drops every effect it
 * sources (and the structural-modifier path skips it), so the bearer's CvCC
 * prowess (read from `effectiveStats.prowess`) loses the weapon's bonus for the
 * rest of the combat. The weapon is not discarded, and the suppression clears
 * when combat finalizes (it lives on the discarded combat state).
 *
 * Fixture alignment: Balrog-specific minion item → The Balrog (ba-3) plus
 * Balrog/minion sites (Under-galleries ba-99, The Under-gates ba-100 haven,
 * Barad-dûr ba-84 surface). The opposing CvCC company is a Wizard company whose
 * character (Beregond, prowess 4) bears the hero weapon Orcrist (+3 prowess).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase, CardStatus, Alignment,
  buildTestState, buildMinionSitePhaseState, resetMint,
  viableActionsForHandCard, viableActions,
  findCharInstanceId, getCharacter, getItemsOn,
  attachItemToChar, companyIdAt, makeShadowMHState, recomputeDerived,
  dispatch, executeAction,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CombatState, GameState } from '../../index.js';
import { Race } from '../../index.js';

// ── Local card-ID constants ───────────────────────────────────────────────────

/** Whip of Many Thongs — the card under test */
const WHIP = 'ba-82' as CardDefinitionId;
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
/** Beregond — a low-prowess (4) Wizard-side hero, the opposing CvCC character */
const BEREGOND = 'tw-127' as CardDefinitionId;
/** Orcrist — hero weapon, +3 prowess (unconditional base, max 9) */
const ORCRIST = 'tw-295' as CardDefinitionId;
/** A non-weapon hero item borne by the opponent (to prove only weapons are targets) */
const STAR_GLASS = 'tw-330' as CardDefinitionId;

describe('Whip of Many Thongs (ba-82)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Playable at a tapped or untapped non-Darkhaven Under-deeps site ──

  test('playable at an untapped non-Darkhaven Under-deeps site, attached to The Balrog', () => {
    const state = buildMinionSitePhaseState({
      site: UNDER_GALLERIES, characters: [THE_BALROG], hand: [WHIP],
    });
    const actions = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, WHIP);
    expect(actions.length).toBe(1);
    expect((actions[0].action as { attachToCharacterId?: unknown }).attachToCharacterId)
      .toBe(findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG));
  });

  test('playable at a TAPPED non-Darkhaven Under-deeps site (allowTapped)', () => {
    const state = buildMinionSitePhaseState({
      site: UNDER_GALLERIES, characters: [THE_BALROG], hand: [WHIP],
      siteStatus: CardStatus.Tapped,
    });
    expect(
      viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, WHIP).length,
    ).toBe(1);
  });

  test('NOT playable at the Darkhaven (haven-type) Under-deeps site The Under-gates', () => {
    const state = buildMinionSitePhaseState({
      site: UNDER_GATES, characters: [THE_BALROG], hand: [WHIP],
    });
    expect(
      viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, WHIP),
    ).toHaveLength(0);
  });

  test('NOT playable at a surface (non-Under-deeps) site', () => {
    const state = buildMinionSitePhaseState({
      site: BARAD_DUR_BA, characters: [THE_BALROG], hand: [WHIP],
    });
    expect(
      viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, WHIP),
    ).toHaveLength(0);
  });

  // ── Rule 2: May only be borne by The Balrog ─────────────────────────────────

  test('NOT playable when the company has no Balrog to bear it', () => {
    const state = buildMinionSitePhaseState({
      site: UNDER_GALLERIES, characters: [CROOK_LEGGED_ORC], hand: [WHIP],
    });
    expect(
      viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, WHIP),
    ).toHaveLength(0);
  });

  test('offered only on The Balrog when both a Balrog and a non-Balrog are present', () => {
    const state = buildMinionSitePhaseState({
      site: UNDER_GALLERIES, characters: [THE_BALROG, CROOK_LEGGED_ORC], hand: [WHIP],
    });
    const actions = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, WHIP);
    expect(actions.length).toBe(1);
    expect((actions[0].action as { attachToCharacterId?: unknown }).attachToCharacterId)
      .toBe(findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG));
  });

  // ── Rule 3: +1 prowess when tapping to face a strike ────────────────────────

  describe('+1 prowess when The Balrog taps to face a strike', () => {
    // A lone Balrog faces a single 15-prowess strike (no creature body, so a
    // parry/tie finalizes the combat). Base Balrog prowess 8; the stay-untapped
    // penalty is -1 (his own card). The Whip adds +1 only in `tap` mode.
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
      if (withItem) state = attachItemToChar(state, RESOURCE_PLAYER, THE_BALROG, WHIP);
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
      const afterWith = executeAction(facingState(true).state, PLAYER_1, 'resolve-strike', 6, true);
      expect(getCharacter(afterWith, RESOURCE_PLAYER, THE_BALROG).status).toBe(CardStatus.Tapped);

      // Without item, tap: 6 + 8 = 14 < 15 → wounded (inverted).
      const afterNo = executeAction(facingState(false).state, PLAYER_1, 'resolve-strike', 6, true);
      expect(getCharacter(afterNo, RESOURCE_PLAYER, THE_BALROG).status).toBe(CardStatus.Inverted);
    });

    test('the +1 does NOT apply when The Balrog stays untapped (roll 7)', () => {
      const withItem = facingState(true).state;
      // Tapping: 7 + (8 + 1) = 16 > 15 → success (tapped).
      expect(getCharacter(executeAction(withItem, PLAYER_1, 'resolve-strike', 7, true), RESOURCE_PLAYER, THE_BALROG).status)
        .toBe(CardStatus.Tapped);
      // Staying untapped: 7 + (8 - 1, no item bonus) = 14 < 15 → wounded (inverted).
      expect(getCharacter(executeAction(withItem, PLAYER_1, 'resolve-strike', 7, false), RESOURCE_PLAYER, THE_BALROG).status)
        .toBe(CardStatus.Inverted);
    });

    test('the +1 does not leak into The Balrog\'s non-combat effective prowess', () => {
      const { state } = facingState(true);
      const basePool = state.cardPool[THE_BALROG] as { prowess: number };
      expect(getCharacter(state, RESOURCE_PLAYER, THE_BALROG).effectiveStats.prowess).toBe(basePool.prowess);
    });
  });

  // ── Rule 4: CvCC — tap to cancel all effects of one opponent weapon ──────────

  describe('CvCC: tap the Whip to cancel an opponent weapon\'s effects', () => {
    // P1 (Balrog) defends; The Balrog bears the Whip. P2 (Wizard) attacks with
    // Beregond (prowess 4) bearing Orcrist (+3 → effective prowess 7).
    function cvccState(opts: { whipTapped?: boolean; cvcc?: boolean; extraOppItem?: boolean } = {}): GameState {
      let state = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        recompute: true,
        players: [
          { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: BARAD_DUR_BA, characters: [THE_BALROG] }], hand: [], siteDeck: [] },
          {
            id: PLAYER_2, alignment: Alignment.Wizard,
            companies: [{
              site: BARAD_DUR_BA,
              characters: [{ defId: BEREGOND, items: opts.extraOppItem ? [ORCRIST, STAR_GLASS] : [ORCRIST] }],
            }],
            hand: [], siteDeck: [],
          },
        ],
      });
      state = attachItemToChar(state, RESOURCE_PLAYER, THE_BALROG, WHIP);
      if (opts.whipTapped) {
        const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
        const bal = state.players[RESOURCE_PLAYER].characters[balrogId];
        const items = bal.items.map(i => ({ ...i, status: CardStatus.Tapped }));
        const chars = { ...state.players[RESOURCE_PLAYER].characters, [balrogId as string]: { ...bal, items } };
        const p0 = { ...state.players[RESOURCE_PLAYER], characters: chars };
        state = { ...state, players: [p0, state.players[HAZARD_PLAYER]] as typeof state.players };
      }
      state = recomputeDerived(state);
      const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
      const beregondId = findCharInstanceId(state, HAZARD_PLAYER, BEREGOND);
      const combat: CombatState = {
        attackSource: (opts.cvcc === false)
          ? { type: 'creature', instanceId: 'fake-orc' as CardInstanceId }
          : { type: 'company-attack', attackingCompanyId: companyIdAt(state, HAZARD_PLAYER) },
        companyId: companyIdAt(state, RESOURCE_PLAYER),
        defendingPlayerId: PLAYER_1,
        attackingPlayerId: PLAYER_2,
        strikesTotal: 1,
        strikeProwess: 8,
        creatureBody: null,
        ...(opts.cvcc === false ? { creatureRace: Race.Orc } : { isCvCC: true }),
        strikeAssignments: [{ characterId: balrogId, attackingCharacterId: beregondId, excessStrikes: 0, resolved: false }],
        currentStrikeIndex: 0,
        phase: 'assign-strikes',
        assignmentPhase: 'defender',
        bodyCheckTarget: null,
        detainment: false,
      };
      return { ...state, phaseState: makeShadowMHState(), combat };
    }

    test('the Whip offers one cancel-weapon action per opponent weapon (Orcrist)', () => {
      const state = cvccState();
      const actions = viableActions(state, PLAYER_1, 'cancel-weapon-effects');
      expect(actions).toHaveLength(1);
      const orcristId = getItemsOn(state, HAZARD_PLAYER, BEREGOND)[0].instanceId;
      expect((actions[0].action as { weaponInstanceId: CardInstanceId }).weaponInstanceId).toBe(orcristId);
    });

    test('only weapons are targets — a non-weapon opponent item (Star-glass) is not offered', () => {
      const state = cvccState({ extraOppItem: true });
      const actions = viableActions(state, PLAYER_1, 'cancel-weapon-effects');
      // Two items on Beregond, but only Orcrist carries the `weapon` keyword.
      expect(actions).toHaveLength(1);
      const orcristId = getItemsOn(state, HAZARD_PLAYER, BEREGOND).find(i => i.definitionId === ORCRIST)!.instanceId;
      expect((actions[0].action as { weaponInstanceId: CardInstanceId }).weaponInstanceId).toBe(orcristId);
    });

    test('NOT offered outside company-vs-company combat', () => {
      const state = cvccState({ cvcc: false });
      expect(viableActions(state, PLAYER_1, 'cancel-weapon-effects')).toHaveLength(0);
    });

    test('NOT offered when the Whip is already tapped', () => {
      const state = cvccState({ whipTapped: true });
      expect(viableActions(state, PLAYER_1, 'cancel-weapon-effects')).toHaveLength(0);
    });

    test('NOT offered to the opposing (non-Balrog) player', () => {
      const state = cvccState();
      expect(viableActions(state, PLAYER_2, 'cancel-weapon-effects')).toHaveLength(0);
    });

    test('tapping the Whip cancels the weapon\'s effects: opponent prowess drops, weapon kept', () => {
      const state = cvccState();
      // Before: Beregond 4 + Orcrist 3 = 7.
      expect(getCharacter(state, HAZARD_PLAYER, BEREGOND).effectiveStats.prowess).toBe(7);
      const orcristId = getItemsOn(state, HAZARD_PLAYER, BEREGOND)[0].instanceId;

      const action = viableActions(state, PLAYER_1, 'cancel-weapon-effects')[0].action;
      const after = dispatch(state, action);

      // Weapon effects gone: Beregond back to base prowess 4.
      expect(getCharacter(after, HAZARD_PLAYER, BEREGOND).effectiveStats.prowess).toBe(4);
      // The weapon is recorded as suppressed for this combat.
      expect(after.combat!.suppressedWeaponInstanceIds).toContain(orcristId);
      // The Whip is now tapped (its tap paid the cost).
      const whip = getItemsOn(after, RESOURCE_PLAYER, THE_BALROG).find(i => i.definitionId === WHIP)!;
      expect(whip.status).toBe(CardStatus.Tapped);
      // The weapon is NOT discarded — still borne by Beregond, unchanged status.
      const orcrist = getItemsOn(after, HAZARD_PLAYER, BEREGOND).find(i => i.instanceId === orcristId);
      expect(orcrist).toBeDefined();
      expect(orcrist!.status).toBe(CardStatus.Untapped);
      expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === orcristId)).toBe(false);
    });

    test('the cancel is no longer offered after the weapon is already suppressed', () => {
      const state = cvccState();
      const action = viableActions(state, PLAYER_1, 'cancel-weapon-effects')[0].action;
      const after = dispatch(state, action);
      // Whip is tapped and the only weapon is suppressed → no further actions.
      expect(viableActions(after, PLAYER_1, 'cancel-weapon-effects')).toHaveLength(0);
    });

    test('the suppression clears when the combat ends (weapon effective again)', () => {
      const state = cvccState();
      const action = viableActions(state, PLAYER_1, 'cancel-weapon-effects')[0].action;
      const after = dispatch(state, action);
      expect(getCharacter(after, HAZARD_PLAYER, BEREGOND).effectiveStats.prowess).toBe(4);
      // End of combat discards the combat state (and its suppression list).
      const ended = recomputeDerived({ ...after, combat: null });
      expect(getCharacter(ended, HAZARD_PLAYER, BEREGOND).effectiveStats.prowess).toBe(7);
    });
  });
});
