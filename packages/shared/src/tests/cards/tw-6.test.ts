/**
 * @module tw-6.test
 *
 * Card test: Arouse Denizens (tw-6)
 * Type: hazard-event (short), non-unique, Neutral
 *
 * Card text:
 *   "Playable on a Ruins & Lairs [{R}]. This turn, the prowess of one
 *    automatic-attack (your choice) at target site is increased by 3.
 *    Cannot be duplicated on a given site."
 *
 * Effects (data):
 *   - auto-attack-boost (siteTypes ruins-and-lairs, prowessBonus 3,
 *       uncancelable false): a hazard short-event played in M/H on a company
 *       moving to a Ruins & Lairs. On resolution it installs a single-use
 *       `auto-attack-boost` constraint against the moving company (scope
 *       company-site-phase, keyed to the destination site). The first
 *       automatic-attack the company faces at the site gets +3 prowess —
 *       the same "one automatic-attack (your choice) = the first faced"
 *       modelling as Arouse Defenders (le-101) and Choking Shadows (tw-21).
 *       Unlike Arouse Defenders, this card does not make the attack
 *       uncancelable.
 *   - duplication-limit scope:site max:1 ("Cannot be duplicated on a given site")
 *
 * Engine support: identical machinery to Arouse Defenders (le-101), generalized
 * over `siteTypes` and `uncancelable`.
 * | # | Rule                                                           | Status |
 * |---|----------------------------------------------------------------|--------|
 * | 1 | Playable on a company moving to a Ruins & Lairs                | OK     |
 * | 2 | NOT playable moving to another site type (shadow-hold)         | OK     |
 * | 3 | NOT playable on a stationary company                           | OK     |
 * | 4 | Resolution installs the auto-attack-boost constraint           | OK     |
 * | 5 | One automatic-attack at the site gains +3 prowess              | OK     |
 * | 6 | That automatic-attack remains cancelable (no uncancelable)     | OK     |
 * | 7 | Only ONE attack is boosted (constraint consumed once)          | OK     |
 * | 8 | Cannot be duplicated on a given site                           | OK     |
 * | 9 | A copy IS still playable against a different site              | OK     |
 *
 * Player-index convention: the moving (resource) hero company is P1 /
 * RESOURCE_PLAYER; the Neutral hazard short-event sits in the hazard player's
 * (P2 / HAZARD_PLAYER) hand.
 *
 * Playable: YES. Certified: 2026-08-22.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  BANDIT_LAIR, MORIA,
  buildHazardMovingState, buildSitePhaseState, setupAutoAttackStep,
  viableActions, playHazardAndResolve, dispatch, makeMHState,
} from '../test-helpers.js';
import { addConstraint } from '../../engine/pending.js';
import type { CardDefinitionId, GameState, CardInstanceId } from '../../index.js';

const AROUSE_DENIZENS = 'tw-6' as CardDefinitionId;
const ETTENMOORS = 'le-373' as CardDefinitionId; // ruins-and-lairs — Trolls 1/9, then Wolves 2/8

/** The Arouse Denizens play-hazard actions in PLAYER_2's hand. */
function arouseActions(state: GameState) {
  return viableActions(state, PLAYER_2, 'play-hazard').filter(a => {
    const card = state.players[1].hand.find(h => h.instanceId === (a.action as { cardInstanceId?: unknown }).cardInstanceId);
    return card?.definitionId === AROUSE_DENIZENS;
  });
}

/** Install the auto-attack-boost constraint exactly as M/H resolution does. */
function withBoost(state: GameState, siteDefId: CardDefinitionId): GameState {
  const company = state.players[0].companies[0];
  return addConstraint(state, {
    source: 'tw6-src' as CardInstanceId,
    sourceDefinitionId: AROUSE_DENIZENS,
    scope: { kind: 'company-site-phase', companyId: company.id },
    target: { kind: 'company', companyId: company.id },
    kind: { type: 'auto-attack-boost', prowessBonus: 3, uncancelable: false, siteDefinitionId: siteDefId },
  });
}

describe('Arouse Denizens (tw-6)', () => {
  beforeEach(() => resetMint());

  // ─── Playability gate (moving to a Ruins & Lairs) ───────────────────────

  test('offered against a company moving to a Ruins & Lairs', () => {
    const state = buildHazardMovingState(BANDIT_LAIR, 'Bandit Lair', [AROUSE_DENIZENS]); // ruins-and-lairs
    expect(arouseActions(state).length).toBeGreaterThan(0);
  });

  test('NOT offered against a company moving to a Shadow-hold (Moria)', () => {
    const state = buildHazardMovingState(MORIA, 'Moria', [AROUSE_DENIZENS]); // shadow-hold
    expect(arouseActions(state)).toHaveLength(0);
  });

  test('NOT offered against a stationary company at a Ruins & Lairs', () => {
    const state = {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          // No destinationSite → not moving.
          { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
          { id: PLAYER_2, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [AROUSE_DENIZENS], siteDeck: [BANDIT_LAIR] },
        ],
      }),
      phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4, destinationSiteName: 'Bandit Lair' }),
    };
    expect(arouseActions(state)).toHaveLength(0);
  });

  // ─── Resolution installs the boost constraint ──────────────────────────

  test('playing it installs a company-site-phase auto-attack-boost (+3 prowess, cancelable) keyed to the destination', () => {
    const state = buildHazardMovingState(BANDIT_LAIR, 'Bandit Lair', [AROUSE_DENIZENS]);
    const card = state.players[1].hand.find(c => c.definitionId === AROUSE_DENIZENS)!;
    const company = state.players[0].companies[0];
    const after = playHazardAndResolve(state, PLAYER_2, card.instanceId, company.id);

    const boost = after.activeConstraints.find(c => c.kind.type === 'auto-attack-boost');
    expect(boost).toBeDefined();
    if (boost?.kind.type !== 'auto-attack-boost') throw new Error('unreachable');
    expect(boost.kind.prowessBonus).toBe(3);
    expect(boost.kind.uncancelable).toBe(false);
    expect(boost.kind.siteDefinitionId).toBe(BANDIT_LAIR);
    expect(boost.scope.kind).toBe('company-site-phase');
    // Card discarded to the hazard player's pile.
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === AROUSE_DENIZENS)).toBe(true);
  });

  // ─── Site phase: the boosted automatic-attack ──────────────────────────

  test('baseline: Bandit Lair\'s Men automatic-attack is 6 prowess and cancelable (control)', () => {
    const base = dispatch(setupAutoAttackStep(buildSitePhaseState({ site: BANDIT_LAIR })), { type: 'pass', player: PLAYER_1 });
    expect(base.combat).not.toBeNull();
    expect(base.combat!.strikeProwess).toBe(6);
    expect(base.combat!.uncancelable ?? false).toBe(false);
  });

  test('the boosted automatic-attack has +3 prowess (6 → 9) and remains cancelable', () => {
    const boosted = dispatch(
      setupAutoAttackStep(withBoost(buildSitePhaseState({ site: BANDIT_LAIR }), BANDIT_LAIR)),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(boosted.combat).not.toBeNull();
    expect(boosted.combat!.strikeProwess).toBe(9);      // 6 + 3
    expect(boosted.combat!.strikesTotal).toBe(3);       // strikes untouched
    expect(boosted.combat!.creatureRace).toBe('man');
    expect(boosted.combat!.uncancelable ?? false).toBe(false);
  });

  test('only ONE automatic-attack is boosted — the first faced consumes the constraint', () => {
    // Ettenmoors has two auto-attacks: Trolls (1/9) then Wolves (2/8).
    const boosted = dispatch(
      setupAutoAttackStep(withBoost(buildSitePhaseState({ site: ETTENMOORS }), ETTENMOORS)),
      { type: 'pass', player: PLAYER_1 },
    );
    // First attack (Trolls) is the one boosted: 9 → 12.
    expect(boosted.combat!.creatureRace).toBe('troll');
    expect(boosted.combat!.strikeProwess).toBe(12);
    // The single-use constraint is consumed after the first attack initiates —
    // the second attack (Wolves) will be unaffected.
    expect(boosted.activeConstraints.some(c => c.kind.type === 'auto-attack-boost')).toBe(false);
  });

  // ─── "Cannot be duplicated on a given site" ────────────────────────────

  test('a second copy is NOT offered against a company already boosted at the same site', () => {
    const state = buildHazardMovingState(BANDIT_LAIR, 'Bandit Lair', [AROUSE_DENIZENS]);
    // Before: offered.
    expect(arouseActions(state)).toHaveLength(1);
    // With a boost already bound to Bandit Lair: the per-site limit blocks a duplicate.
    expect(arouseActions(withBoost(state, BANDIT_LAIR))).toHaveLength(0);
  });

  test('a copy IS still offered when the existing boost is bound to a different site', () => {
    const state = buildHazardMovingState(BANDIT_LAIR, 'Bandit Lair', [AROUSE_DENIZENS]);
    // A boost bound to a different site (Ettenmoors) does not block a play against Bandit Lair.
    expect(arouseActions(withBoost(state, ETTENMOORS))).toHaveLength(1);
  });
});
