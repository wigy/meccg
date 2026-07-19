/**
 * @module tw-10.test
 *
 * Card test: Awaken Minions (tw-10)
 * Type: hazard-event (long), non-unique, Neutral
 *
 * Text:
 *   "The number of strikes for each automatic-attack at a Shadow-hold [{S}] site
 *    or at a Dark-hold [{D}] site is doubled. Cannot be duplicated."
 *
 * Effects (data):
 *   - stat-modifier strikes, op:multiply value:2, target:all-automatic-attacks,
 *       when site.siteType $in [shadow-hold, dark-hold]
 *   - duplication-limit scope:game max:1  ("Cannot be duplicated")
 *
 * Engine support:
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | Doubles automatic-attack strikes at a Shadow-hold site        | OK     |
 * | 2 | Doubles automatic-attack strikes at a Dark-hold site          | OK     |
 * | 3 | Does NOT affect automatic-attacks at other site types (R&L)   | OK     |
 * | 4 | Only strikes are doubled — prowess/body are untouched         | OK     |
 * | 5 | Cannot be duplicated (one copy in play blocks a second)       | OK     |
 *
 * Implementation: the doubling rides the existing `all-automatic-attacks`
 * `stat-modifier` machinery (same as Redoubled Force / Plague of Wights). The
 * site auto-attack strike resolution in `reducer-site.ts` now threads the site's
 * *effective* type into the resolver context as `site.siteType`, so the `when`
 * gate fires only at Shadow-hold / Dark-hold sites. `op: "multiply"` runs after
 * every additive modifier, so it doubles the already-modified total.
 *
 * Player-index convention: the moving (resource) company is a hero company
 * (P1 / RESOURCE_PLAYER) facing the site's automatic-attack; the Neutral
 * long-event sits in the hazard player's (P2 / HAZARD_PLAYER) cardsInPlay.
 *
 * Playable: YES. Certified: 2026-07-15.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  HAZARD_PLAYER,
  buildTestState, resetMint, makeMHState,
  buildSitePhaseState, setupAutoAttackStep, addCardInPlay,
  viableActions, dispatch,
} from '../test-helpers.js';
import { Phase, Alignment } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const AWAKEN_MINIONS = 'tw-10' as CardDefinitionId;

// Sites with a single, plain first automatic-attack.
const MORIA = 'tw-413' as CardDefinitionId;          // shadow-hold — Orcs 4 strikes / 7 prowess
const THE_UNDER_COURTS = 'dm-36' as CardDefinitionId; // dark-hold  — Trolls 3 strikes / 10 prowess
const BANDIT_LAIR = 'tw-373' as CardDefinitionId;     // ruins-and-lairs — Men 3 strikes / 6 prowess
const MINAS_TIRITH = 'tw-412' as CardDefinitionId;    // free-hold (site-deck filler)

const ARAGORN = 'tw-120' as CardDefinitionId;         // hero character
const MIONID = 'as-3' as CardDefinitionId;            // minion character (hazard placeholder)

describe('Awaken Minions (tw-10)', () => {
  beforeEach(() => resetMint());

  // ─── Doubling at Shadow-hold / Dark-hold sites ──────────────────────────────

  test('doubles strikes of a Shadow-hold automatic-attack (Moria Orcs 4 → 8)', () => {
    // Baseline: without Awaken Minions the Orc attack has its printed 4 strikes.
    const base = dispatch(
      setupAutoAttackStep(buildSitePhaseState({ site: MORIA })),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(base.combat).not.toBeNull();
    expect(base.combat!.strikesTotal).toBe(4);

    // With Awaken Minions in the hazard player's cardsInPlay: 4 → 8.
    const doubled = dispatch(
      addCardInPlay(setupAutoAttackStep(buildSitePhaseState({ site: MORIA })), HAZARD_PLAYER, AWAKEN_MINIONS),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(doubled.combat).not.toBeNull();
    expect(doubled.combat!.strikesTotal).toBe(8);
  });

  test('doubles strikes of a Dark-hold automatic-attack (Under-courts Trolls 3 → 6)', () => {
    const base = dispatch(
      setupAutoAttackStep(buildSitePhaseState({ site: THE_UNDER_COURTS })),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(base.combat!.strikesTotal).toBe(3);

    const doubled = dispatch(
      addCardInPlay(setupAutoAttackStep(buildSitePhaseState({ site: THE_UNDER_COURTS })), HAZARD_PLAYER, AWAKEN_MINIONS),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(doubled.combat!.strikesTotal).toBe(6);
  });

  test('only strikes are doubled — prowess and creature race are untouched', () => {
    const doubled = dispatch(
      addCardInPlay(setupAutoAttackStep(buildSitePhaseState({ site: MORIA })), HAZARD_PLAYER, AWAKEN_MINIONS),
      { type: 'pass', player: PLAYER_1 },
    );
    // Moria's Orc attack: 4 strikes → 8, prowess stays 7.
    expect(doubled.combat!.strikesTotal).toBe(8);
    expect(doubled.combat!.strikeProwess).toBe(7);
    expect(doubled.combat!.creatureRace).toBe('orc');
  });

  // ─── No effect at other site types ──────────────────────────────────────────

  test('does NOT double automatic-attack strikes at a Ruins & Lairs site', () => {
    const base = dispatch(
      setupAutoAttackStep(buildSitePhaseState({ site: BANDIT_LAIR })),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(base.combat!.strikesTotal).toBe(3);

    // Bandit Lair is ruins-and-lairs — the site-type gate does not match, so the
    // Men attack stays at 3 strikes even with Awaken Minions in play.
    const withAwaken = dispatch(
      addCardInPlay(setupAutoAttackStep(buildSitePhaseState({ site: BANDIT_LAIR })), HAZARD_PLAYER, AWAKEN_MINIONS),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(withAwaken.combat!.strikesTotal).toBe(3);
  });

  // ─── "Cannot be duplicated" (duplication-limit, scope game) ─────────────────

  test('playable as a hazard long-event when no copy is in play', () => {
    const s = {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        recompute: true,
        players: [
          { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [MINAS_TIRITH] },
          { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [MIONID] }], hand: [AWAKEN_MINIONS], siteDeck: [MINAS_TIRITH] },
        ],
      }),
      phaseState: makeMHState({ destinationSiteName: 'x' }),
    };
    expect(viableActions(s, PLAYER_2, 'play-hazard')).toHaveLength(1);
  });

  test('NOT playable when a copy of Awaken Minions is already in play', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [MIONID] }], hand: [AWAKEN_MINIONS], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const s = {
      ...addCardInPlay(built, HAZARD_PLAYER, AWAKEN_MINIONS),
      phaseState: makeMHState({ destinationSiteName: 'x' }),
    };
    expect(viableActions(s, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });
});
