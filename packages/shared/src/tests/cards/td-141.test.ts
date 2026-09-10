/**
 * @module td-141.test
 *
 * Card test: Necklace of Silver and Pearls (td-141)
 * Type: hero-resource-item (minor, hoard)
 *
 * Printed text:
 *   "Hoard item. Discard this card to give +3 direct influence and +5 mind
 *    to bearer until the end of the turn. The bearer's additional mind does
 *    not use any controlling influence. This item may also be so discarded
 *    during opponent's site phase."
 *
 * Effects (data):
 *   1. item-play-site — playable only at sites whose keywords include "hoard"
 *   2. grant-action — necklace-mind-boost (cost: discard self), with phase
 *      flags anyPhase, opposingSitePhase. Apply: a `sequence` of
 *      - a turn-scoped `character-stat-modifier` (direct-influence +3) on the bearer
 *      - a turn-scoped `character-stat-modifier` (mind +5) on the bearer
 *      - a turn-scoped `control-cost-override` on the bearer, freezing the
 *        bearer's influence-to-control cost at his printed mind so the +5
 *        mind bonus does not inflate the general/direct influence a
 *        controller must spend to hold him.
 *
 * Engine support added by this certification:
 *   - `character-stat-modifier`'s `stat` union gained `"mind"` (previously
 *     `prowess`/`body`/`direct-influence` only), so a discard-triggered
 *     grant-action can grant a turn-scoped mind bonus the same way an
 *     on-event `self-enters-play` effect (Vilya, Heart of Dark Fire) grants
 *     prowess/body/direct-influence.
 *   - `grant-action-apply.ts`'s `buildPayloadConstraintKind` gained a
 *     `character-stat-modifier` branch (previously only reachable via the
 *     on-event path) and a new `control-cost-override` constraint kind,
 *     consumed by `control-cost.ts`'s `controlCostOf` exactly like an
 *     attached `control-restriction`'s `cost` field.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GANDALF, LEGOLAS,
  MORIA, LORIEN, MINAS_TIRITH,
  Phase, Alignment,
  resetMint,
  buildTestState,
  buildSitePhaseState,
  viableActions,
  attachItemToChar,
  dispatch,
  getCharacter,
  expectCharItemCount,
  expectInDiscardPile,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type {
  CardDefinitionId,
  ActivateGrantedAction,
  SitePhaseState,
} from '../../index.js';

const NECKLACE = 'td-141' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId; // Smaug's lair, hoard site

describe('Necklace of Silver and Pearls (td-141)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: Hoard-item site restriction ───────────────────────────────────

  test('playable at a hoard site (Lonely Mountain)', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [ARAGORN],
      hand: [NECKLACE],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a non-hoard site (Moria)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN],
      hand: [NECKLACE],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at a haven (Lórien)', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [ARAGORN],
      hand: [NECKLACE],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Grant-action emission windows ───────────────────────────────────────

  test('grant-action is available during bearer\'s organization phase (anyPhase)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withNecklace = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, NECKLACE);

    const actions = viableActions(withNecklace, PLAYER_1, 'activate-granted-action');
    const boostActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'necklace-mind-boost',
    );
    expect(boostActions).toHaveLength(1);
  });

  test('grant-action is available during bearer\'s site phase', () => {
    const base = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [ARAGORN],
    });
    const withNecklace = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, NECKLACE);

    const actions = viableActions(withNecklace, PLAYER_1, 'activate-granted-action');
    const boostActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'necklace-mind-boost',
    );
    expect(boostActions).toHaveLength(1);
  });

  test('grant-action is available during OPPONENT\'S site phase (opposingSitePhase flag)', () => {
    // P1 is the active (resource) player playing resources at Lonely
    // Mountain; P2 is the hazard player who owns the Necklace. P2 should be
    // able to discard it during P1's site phase.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GANDALF] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const sitePhaseState: SitePhaseState = {
      phase: Phase.Site,
      step: 'play-resources',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      siteEntered: true,
      resourcePlayed: false,
      minorItemAvailable: false,
      hoardBountyAvailable: false,
      thoroughSearchAvailable: false,
      declaredAgentAttack: null,
      automaticAttacksResolved: 0,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };
    const withNecklace = attachItemToChar(
      { ...state, phaseState: sitePhaseState },
      HAZARD_PLAYER, GANDALF, NECKLACE,
    );

    const actions = viableActions(withNecklace, PLAYER_2, 'activate-granted-action');
    const boostActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'necklace-mind-boost',
    );
    expect(boostActions).toHaveLength(1);
  });

  // ─── Activation effect ────────────────────────────────────────────────────

  function stateWithNecklace() {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: LONELY_MOUNTAIN, characters: [GANDALF, { defId: ARAGORN, items: [NECKLACE] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
  }

  function boostAction(state: ReturnType<typeof stateWithNecklace>) {
    return viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'necklace-mind-boost')!.action;
  }

  test('activating discards the Necklace', () => {
    const state = stateWithNecklace();
    const next = dispatch(state, boostAction(state));

    expectCharItemCount(next, RESOURCE_PLAYER, ARAGORN, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, NECKLACE);
  });

  test('adds turn-scoped character-stat-modifier constraints (+3 direct-influence, +5 mind) on the bearer', () => {
    const state = stateWithNecklace();
    const next = dispatch(state, boostAction(state));

    const statModifiers = next.activeConstraints.filter(c => c.kind.type === 'character-stat-modifier');
    expect(statModifiers).toHaveLength(2);

    const diConstraint = statModifiers.find(c => c.kind.type === 'character-stat-modifier' && c.kind.stat === 'direct-influence');
    const mindConstraint = statModifiers.find(c => c.kind.type === 'character-stat-modifier' && c.kind.stat === 'mind');
    expect(diConstraint).toBeDefined();
    expect(mindConstraint).toBeDefined();

    if (diConstraint?.kind.type === 'character-stat-modifier') expect(diConstraint.kind.value).toBe(3);
    if (mindConstraint?.kind.type === 'character-stat-modifier') expect(mindConstraint.kind.value).toBe(5);

    for (const c of statModifiers) {
      expect(c.scope.kind).toBe('turn');
      expect(c.target.kind).toBe('character');
    }
  });

  test('after activation, the bearer\'s effective direct influence and mind rise by 3 and 5', () => {
    const state = stateWithNecklace();
    // Aragorn's printed direct influence is 3, printed mind 9. `effectiveStats.mind`
    // is only populated once a mind-modifying effect is active, so the baseline
    // check here is against the printed mind, not `effectiveStats`.
    const before = getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats;
    expect(before.directInfluence).toBe(3);
    expect(before.mind).toBeUndefined();

    const next = dispatch(state, boostAction(state));
    const after = getCharacter(next, RESOURCE_PLAYER, ARAGORN).effectiveStats;
    expect(after.directInfluence).toBe(6);
    expect(after.mind).toBe(14);
  });

  test('the bonus does not leak to other characters in the company', () => {
    const state = stateWithNecklace();
    const next = dispatch(state, boostAction(state));

    // Gandalf is an avatar (mind === null); confirm only Aragorn's stats moved.
    expect(getCharacter(next, RESOURCE_PLAYER, ARAGORN).effectiveStats.mind).toBe(14);
    expect(getCharacter(next, RESOURCE_PLAYER, GANDALF).effectiveStats.mind).toBeUndefined();
  });

  // ─── "Does not use any controlling influence" ────────────────────────────

  test('adds a turn-scoped control-cost-override constraint pinning cost at printed mind (9)', () => {
    const state = stateWithNecklace();
    const next = dispatch(state, boostAction(state));

    const override = next.activeConstraints.find(c => c.kind.type === 'control-cost-override');
    expect(override).toBeDefined();
    if (override?.kind.type === 'control-cost-override') {
      expect(override.kind.cost).toBe(9);
    }
    expect(override!.scope.kind).toBe('turn');
  });

  test('the +5 mind bonus does not raise the general influence spent to control the bearer', () => {
    // Aragorn is controlled by general influence (the default), consuming GI
    // equal to his control cost. Before the Necklace resolves, that is his
    // printed mind (9). Gandalf is the wizard avatar and does not count
    // (mind === null).
    const state = stateWithNecklace();
    expect(state.players[0].generalInfluenceUsed).toBe(9);

    const next = dispatch(state, boostAction(state));

    // Effective mind rose to 14, but the control-cost-override freezes the
    // GI cost at the printed mind (9) — it must NOT rise to 14.
    expect(getCharacter(next, RESOURCE_PLAYER, ARAGORN).effectiveStats.mind).toBe(14);
    expect(next.players[0].generalInfluenceUsed).toBe(9);
  });
});
