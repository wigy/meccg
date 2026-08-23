/**
 * @module tw-7.test
 *
 * Card test: Arouse Minions (tw-7)
 * Type: hazard-event (short), non-unique, Neutral
 *
 * Card text:
 *   "Playable on a Shadow-hold [{S}] or Dark-hold [{D}]. This turn, the prowess
 *    of one automatic-attack (your choice) at target site is increased by 3.
 *    Cannot be duplicated at a given site."
 *
 * Effects (data):
 *   - auto-attack-boost (siteTypes shadow-hold/dark-hold, prowessBonus 3,
 *       uncancelable false): a hazard short-event played in M/H on a company
 *       moving to a Shadow-hold/Dark-hold. On resolution it installs a
 *       single-use `auto-attack-boost` constraint against the moving company
 *       (scope company-site-phase, keyed to the destination site). The first
 *       automatic-attack the company faces at the site gets +3 prowess — the
 *       same "one automatic-attack (your choice) = the first faced" modelling
 *       as Choking Shadows (tw-21) and Arouse Defenders (le-101).
 *   - duplication-limit scope:site max:1 ("Cannot be duplicated at a given site")
 *
 * Engine support:
 * | # | Rule                                                           | Status |
 * |---|----------------------------------------------------------------|--------|
 * | 1 | Playable on a company moving to a Shadow-hold                  | OK     |
 * | 2 | Playable on a company moving to a Dark-hold                    | OK     |
 * | 3 | NOT playable moving to another site type (free-hold)           | OK     |
 * | 4 | NOT playable on a stationary company                           | OK     |
 * | 5 | Resolution installs the auto-attack-boost constraint           | OK     |
 * | 6 | One automatic-attack at the site gains +3 prowess              | OK     |
 * | 7 | Only ONE attack is boosted (constraint consumed once)          | OK     |
 * | 8 | Cannot be duplicated at a given site                           | OK     |
 * | 9 | A copy IS still playable against a different site              | OK     |
 *
 * Player-index convention: the moving (resource) company is P1 / RESOURCE_PLAYER;
 * the Neutral hazard short-event sits in the hazard player's (P2 / HAZARD_PLAYER)
 * hand.
 *
 * Playable: YES. Certified: 2026-08-22.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  MINAS_TIRITH, MORIA,
  buildHazardMovingState, buildSitePhaseState, setupAutoAttackStep,
  viableActions, playHazardAndResolve, dispatch, makeMHState,
} from '../test-helpers.js';
import { addConstraint } from '../../engine/pending.js';
import type { CardDefinitionId, GameState, CardInstanceId } from '../../index.js';

const AROUSE_MINIONS = 'tw-7' as CardDefinitionId;
const CARN_DUM = 'tw-380' as CardDefinitionId;  // dark-hold — Orcs 4 strikes / 7 prowess
const BARAD_DUR = 'tw-374' as CardDefinitionId; // dark-hold — Orcs 4/7, then Trolls 3/9

/** The Arouse Minions play-hazard actions in PLAYER_2's hand. */
function arouseActions(state: GameState) {
  return viableActions(state, PLAYER_2, 'play-hazard').filter(a => {
    const card = state.players[1].hand.find(h => h.instanceId === (a.action as { cardInstanceId?: unknown }).cardInstanceId);
    return card?.definitionId === AROUSE_MINIONS;
  });
}

/** Install the auto-attack-boost constraint exactly as M/H resolution does. */
function withBoost(state: GameState, siteDefId: CardDefinitionId): GameState {
  const company = state.players[0].companies[0];
  return addConstraint(state, {
    source: 'tw7-src' as CardInstanceId,
    sourceDefinitionId: AROUSE_MINIONS,
    scope: { kind: 'company-site-phase', companyId: company.id },
    target: { kind: 'company', companyId: company.id },
    kind: { type: 'auto-attack-boost', prowessBonus: 3, uncancelable: false, siteDefinitionId: siteDefId },
  });
}

describe('Arouse Minions (tw-7)', () => {
  beforeEach(() => resetMint());

  // ─── Playability gate (moving to a Shadow-hold / Dark-hold) ────────────────

  test('offered against a company moving to a Shadow-hold (Moria)', () => {
    const state = buildHazardMovingState(MORIA, 'Moria', [AROUSE_MINIONS]); // shadow-hold
    expect(arouseActions(state).length).toBeGreaterThan(0);
  });

  test('offered against a company moving to a Dark-hold (Carn Dûm)', () => {
    const state = buildHazardMovingState(CARN_DUM, 'Carn Dûm', [AROUSE_MINIONS]); // dark-hold
    expect(arouseActions(state).length).toBeGreaterThan(0);
  });

  test('NOT offered against a company moving to a Free-hold (Minas Tirith)', () => {
    const state = buildHazardMovingState(MINAS_TIRITH, 'Minas Tirith', [AROUSE_MINIONS]); // free-hold
    expect(arouseActions(state)).toHaveLength(0);
  });

  test('NOT offered against a stationary company at a Shadow-hold', () => {
    const state = {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          // No destinationSite → not moving.
          { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [CARN_DUM] },
          { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LEGOLAS] }], hand: [AROUSE_MINIONS], siteDeck: [MINAS_TIRITH] },
        ],
      }),
      phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4, destinationSiteName: 'Moria' }),
    };
    expect(arouseActions(state)).toHaveLength(0);
  });

  // ─── Resolution installs the boost constraint ──────────────────────────────

  test('playing it installs a company-site-phase auto-attack-boost (+3 prowess, cancelable) keyed to the destination', () => {
    const state = buildHazardMovingState(CARN_DUM, 'Carn Dûm', [AROUSE_MINIONS]); // dark-hold with an Orc attack
    const card = state.players[1].hand.find(c => c.definitionId === AROUSE_MINIONS)!;
    const company = state.players[0].companies[0];
    const after = playHazardAndResolve(state, PLAYER_2, card.instanceId, company.id);

    const boost = after.activeConstraints.find(c => c.kind.type === 'auto-attack-boost');
    expect(boost).toBeDefined();
    if (boost?.kind.type !== 'auto-attack-boost') throw new Error('unreachable');
    expect(boost.kind.prowessBonus).toBe(3);
    expect(boost.kind.uncancelable).toBe(false);
    expect(boost.kind.siteDefinitionId).toBe(CARN_DUM);
    expect(boost.scope.kind).toBe('company-site-phase');
    // Card discarded to the hazard player's pile.
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === AROUSE_MINIONS)).toBe(true);
  });

  // ─── Site phase: the boosted automatic-attack ──────────────────────────────

  test('baseline: Carn Dûm\'s Orc automatic-attack is 7 prowess and cancelable (control)', () => {
    const base = dispatch(setupAutoAttackStep(buildSitePhaseState({ site: CARN_DUM })), { type: 'pass', player: PLAYER_1 });
    expect(base.combat).not.toBeNull();
    expect(base.combat!.strikeProwess).toBe(7);
    expect(base.combat!.uncancelable ?? false).toBe(false);
  });

  test('the boosted automatic-attack has +3 prowess (7 → 10) and remains cancelable', () => {
    const boosted = dispatch(
      setupAutoAttackStep(withBoost(buildSitePhaseState({ site: CARN_DUM }), CARN_DUM)),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(boosted.combat).not.toBeNull();
    expect(boosted.combat!.strikeProwess).toBe(10);     // 7 + 3
    expect(boosted.combat!.strikesTotal).toBe(4);        // strikes untouched
    expect(boosted.combat!.creatureRace).toBe('orc');
    expect(boosted.combat!.uncancelable ?? false).toBe(false);
  });

  test('only ONE automatic-attack is boosted — the first faced consumes the constraint', () => {
    // Barad-dûr has two auto-attacks: Orcs (4/7) then Trolls (3/9).
    const boosted = dispatch(
      setupAutoAttackStep(withBoost(buildSitePhaseState({ site: BARAD_DUR }), BARAD_DUR)),
      { type: 'pass', player: PLAYER_1 },
    );
    // First attack (Orcs) is the one boosted: 7 → 10.
    expect(boosted.combat!.creatureRace).toBe('orc');
    expect(boosted.combat!.strikeProwess).toBe(10);
    // The single-use constraint is consumed after the first attack initiates —
    // the second attack (Trolls) will be unaffected.
    expect(boosted.activeConstraints.some(c => c.kind.type === 'auto-attack-boost')).toBe(false);
  });

  // ─── "Cannot be duplicated at a given site" ────────────────────────────────

  test('a second copy is NOT offered against a company already boosted at the same site', () => {
    const state = buildHazardMovingState(CARN_DUM, 'Carn Dûm', [AROUSE_MINIONS]);
    // Before: offered.
    expect(arouseActions(state)).toHaveLength(1);
    // With a boost already bound to Carn Dûm: the per-site limit blocks a duplicate.
    expect(arouseActions(withBoost(state, CARN_DUM))).toHaveLength(0);
  });

  test('a copy IS still offered when the existing boost is bound to a different site', () => {
    const state = buildHazardMovingState(CARN_DUM, 'Carn Dûm', [AROUSE_MINIONS]);
    // A boost bound to a different site (Moria) does not block a play against Carn Dûm.
    expect(arouseActions(withBoost(state, MORIA))).toHaveLength(1);
  });
});
