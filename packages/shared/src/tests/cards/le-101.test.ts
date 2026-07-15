/**
 * @module le-101.test
 *
 * Card test: Arouse Defenders (le-101)
 * Type: hazard-event (short), non-unique, Neutral
 *
 * Card text:
 *   "Playable on a Free-hold [{F}] or Border-hold [{B}]. This turn, the prowess
 *    of one automatic-attack (your choice) at target site is increased by 2 and
 *    cannot be canceled. Cannot be duplicated on a given site."
 *
 * Effects (data):
 *   - auto-attack-boost (siteTypes free-hold/border-hold, prowessBonus 2,
 *       uncancelable true): a hazard short-event played in M/H on a company
 *       moving to a Free-hold/Border-hold. On resolution it installs a single-use
 *       `auto-attack-boost` constraint against the moving company (scope
 *       company-site-phase, keyed to the destination site). The first
 *       automatic-attack the company faces at the site gets +2 prowess and is
 *       marked uncancelable — the same "one automatic-attack (your choice) = the
 *       first faced" modelling as Choking Shadows (tw-21).
 *   - duplication-limit scope:site max:1 ("Cannot be duplicated on a given site")
 *
 * Engine support:
 * | # | Rule                                                           | Status |
 * |---|----------------------------------------------------------------|--------|
 * | 1 | Playable on a company moving to a Free-hold                     | OK     |
 * | 2 | Playable on a company moving to a Border-hold                   | OK     |
 * | 3 | NOT playable moving to another site type (shadow-hold)         | OK     |
 * | 4 | NOT playable on a stationary company                           | OK     |
 * | 5 | Resolution installs the auto-attack-boost constraint           | OK     |
 * | 6 | One automatic-attack at the site gains +2 prowess              | OK     |
 * | 7 | That automatic-attack cannot be canceled                       | OK     |
 * | 8 | Only ONE attack is boosted (constraint consumed once)          | OK     |
 * | 9 | Cannot be duplicated on a given site                           | OK     |
 * | 10| A copy IS still playable against a different site              | OK     |
 *
 * Player-index convention: the moving (resource) hero company is P1 /
 * RESOURCE_PLAYER; the Neutral hazard short-event sits in the hazard player's
 * (P2 / HAZARD_PLAYER) hand.
 *
 * Playable: YES. Certified: 2026-07-15.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  MINAS_TIRITH, BREE, MORIA,
  buildHazardMovingState, buildSitePhaseState, setupAutoAttackStep,
  viableActions, playHazardAndResolve, dispatch, makeMHState,
} from '../test-helpers.js';
import { addConstraint } from '../../engine/pending.js';
import type { CardDefinitionId, GameState, CardInstanceId } from '../../index.js';

const AROUSE_DEFENDERS = 'le-101' as CardDefinitionId;
const DALE = 'le-363' as CardDefinitionId;    // border-hold — Men 1 strike / 5 prowess
const BAG_END = 'le-350' as CardDefinitionId;  // free-hold — Hobbits 5/5, then Dúnedain 3/11

/** The Arouse Defenders play-hazard actions in PLAYER_2's hand. */
function arouseActions(state: GameState) {
  return viableActions(state, PLAYER_2, 'play-hazard').filter(a => {
    const card = state.players[1].hand.find(h => h.instanceId === (a.action as { cardInstanceId?: unknown }).cardInstanceId);
    return card?.definitionId === AROUSE_DEFENDERS;
  });
}

/** Install the auto-attack-boost constraint exactly as M/H resolution does. */
function withBoost(state: GameState, siteDefId: CardDefinitionId): GameState {
  const company = state.players[0].companies[0];
  return addConstraint(state, {
    source: 'le101-src' as CardInstanceId,
    sourceDefinitionId: AROUSE_DEFENDERS,
    scope: { kind: 'company-site-phase', companyId: company.id },
    target: { kind: 'company', companyId: company.id },
    kind: { type: 'auto-attack-boost', prowessBonus: 2, uncancelable: true, siteDefinitionId: siteDefId },
  });
}

describe('Arouse Defenders (le-101)', () => {
  beforeEach(() => resetMint());

  // ─── Playability gate (moving to a Free-hold / Border-hold) ────────────────

  test('offered against a company moving to a Free-hold', () => {
    const state = buildHazardMovingState(MINAS_TIRITH, 'Minas Tirith', [AROUSE_DEFENDERS]); // free-hold
    expect(arouseActions(state).length).toBeGreaterThan(0);
  });

  test('offered against a company moving to a Border-hold', () => {
    const state = buildHazardMovingState(BREE, 'Bree', [AROUSE_DEFENDERS]); // border-hold
    expect(arouseActions(state).length).toBeGreaterThan(0);
  });

  test('NOT offered against a company moving to a Shadow-hold (Moria)', () => {
    const state = buildHazardMovingState(MORIA, 'Moria', [AROUSE_DEFENDERS]); // shadow-hold
    expect(arouseActions(state)).toHaveLength(0);
  });

  test('NOT offered against a stationary company at a Free-hold', () => {
    const state = {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          // No destinationSite → not moving.
          { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
          { id: PLAYER_2, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [AROUSE_DEFENDERS], siteDeck: [BREE] },
        ],
      }),
      phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4, destinationSiteName: 'Minas Tirith' }),
    };
    expect(arouseActions(state)).toHaveLength(0);
  });

  // ─── Resolution installs the boost constraint ──────────────────────────────

  test('playing it installs a company-site-phase auto-attack-boost (+2 prowess, uncancelable) keyed to the destination', () => {
    const state = buildHazardMovingState(DALE, 'Dale', [AROUSE_DEFENDERS]); // border-hold with a Men attack
    const card = state.players[1].hand.find(c => c.definitionId === AROUSE_DEFENDERS)!;
    const company = state.players[0].companies[0];
    const after = playHazardAndResolve(state, PLAYER_2, card.instanceId, company.id);

    const boost = after.activeConstraints.find(c => c.kind.type === 'auto-attack-boost');
    expect(boost).toBeDefined();
    if (boost?.kind.type !== 'auto-attack-boost') throw new Error('unreachable');
    expect(boost.kind.prowessBonus).toBe(2);
    expect(boost.kind.uncancelable).toBe(true);
    expect(boost.kind.siteDefinitionId).toBe(DALE);
    expect(boost.scope.kind).toBe('company-site-phase');
    // Card discarded to the hazard player's pile.
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === AROUSE_DEFENDERS)).toBe(true);
  });

  // ─── Site phase: the boosted automatic-attack ──────────────────────────────

  test('baseline: Dale\'s Men automatic-attack is 5 prowess and cancelable (control)', () => {
    const base = dispatch(setupAutoAttackStep(buildSitePhaseState({ site: DALE })), { type: 'pass', player: PLAYER_1 });
    expect(base.combat).not.toBeNull();
    expect(base.combat!.strikeProwess).toBe(5);
    expect(base.combat!.uncancelable ?? false).toBe(false);
  });

  test('the boosted automatic-attack has +2 prowess (5 → 7) and cannot be canceled', () => {
    const boosted = dispatch(
      setupAutoAttackStep(withBoost(buildSitePhaseState({ site: DALE }), DALE)),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(boosted.combat).not.toBeNull();
    expect(boosted.combat!.strikeProwess).toBe(7);      // 5 + 2
    expect(boosted.combat!.strikesTotal).toBe(1);       // strikes untouched
    expect(boosted.combat!.creatureRace).toBe('man');
    expect(boosted.combat!.uncancelable).toBe(true);
  });

  test('only ONE automatic-attack is boosted — the first faced consumes the constraint', () => {
    // Bag End has two auto-attacks: Hobbits (5/5) then Dúnedain (3/11).
    const boosted = dispatch(
      setupAutoAttackStep(withBoost(buildSitePhaseState({ site: BAG_END }), BAG_END)),
      { type: 'pass', player: PLAYER_1 },
    );
    // First attack (Hobbits) is the one boosted: 5 → 7, uncancelable.
    expect(boosted.combat!.creatureRace).toBe('hobbit');
    expect(boosted.combat!.strikeProwess).toBe(7);
    expect(boosted.combat!.uncancelable).toBe(true);
    // The single-use constraint is consumed after the first attack initiates —
    // the second attack (Dúnedain) will be unaffected.
    expect(boosted.activeConstraints.some(c => c.kind.type === 'auto-attack-boost')).toBe(false);
  });

  // ─── "Cannot be duplicated on a given site" ────────────────────────────────

  test('a second copy is NOT offered against a company already boosted at the same site', () => {
    const state = buildHazardMovingState(DALE, 'Dale', [AROUSE_DEFENDERS]);
    // Before: offered.
    expect(arouseActions(state)).toHaveLength(1);
    // With a boost already bound to Dale: the per-site limit blocks a duplicate.
    expect(arouseActions(withBoost(state, DALE))).toHaveLength(0);
  });

  test('a copy IS still offered when the existing boost is bound to a different site', () => {
    const state = buildHazardMovingState(DALE, 'Dale', [AROUSE_DEFENDERS]);
    // A boost bound to a different site (Bree) does not block a play against Dale.
    expect(arouseActions(withBoost(state, BREE))).toHaveLength(1);
  });
});
