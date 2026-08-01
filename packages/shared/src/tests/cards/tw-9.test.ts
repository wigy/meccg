/**
 * @module tw-9.test
 *
 * Card test: Awaken Denizens (tw-9)
 * Type: hazard-event (long), non-unique, Neutral
 *
 * Text:
 *   "The number of strikes for each automatic-attack at a Ruins & Lairs [{R}]
 *    site is doubled. Cannot be duplicated."
 *
 * Effects (data):
 *   - stat-modifier strikes, op:multiply value:2, target:all-automatic-attacks,
 *       when site.siteType $in [ruins-and-lairs]
 *   - duplication-limit scope:game max:1  ("Cannot be duplicated")
 *
 * Engine support:
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | Doubles automatic-attack strikes at a Ruins & Lairs site      | OK     |
 * | 2 | Does NOT affect automatic-attacks at other site types (S&D)   | OK     |
 * | 3 | Only strikes are doubled — prowess/body are untouched         | OK     |
 * | 4 | Cannot be duplicated (one copy in play blocks a second)       | OK     |
 *
 * Implementation: identical mechanism to Awaken Minions (tw-10) — the
 * doubling rides the existing `all-automatic-attacks` `stat-modifier`
 * machinery, gated by `site.siteType` (threaded into the resolver context
 * from `reducer-site.ts`) matching `ruins-and-lairs` instead of
 * shadow-hold/dark-hold.
 *
 * Player-index convention: the moving (resource) company is a hero company
 * (P1 / RESOURCE_PLAYER) facing the site's automatic-attack; the Neutral
 * long-event sits in the hazard player's (P2 / HAZARD_PLAYER) cardsInPlay.
 *
 * Playable: YES. Certified: 2026-08-01.
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

const AWAKEN_DENIZENS = 'tw-9' as CardDefinitionId;

// Sites with a single, plain first automatic-attack.
const BANDIT_LAIR = 'tw-373' as CardDefinitionId;    // ruins-and-lairs — Men 3 strikes / 6 prowess
const MORIA = 'tw-413' as CardDefinitionId;           // shadow-hold — Orcs 4 strikes / 7 prowess
const MINAS_TIRITH = 'tw-412' as CardDefinitionId;    // free-hold (site-deck filler)

const ARAGORN = 'tw-120' as CardDefinitionId;         // hero character
const MIONID = 'as-3' as CardDefinitionId;            // minion character (hazard placeholder)

describe('Awaken Denizens (tw-9)', () => {
  beforeEach(() => resetMint());

  // ─── Doubling at Ruins & Lairs sites ────────────────────────────────────────

  test('doubles strikes of a Ruins & Lairs automatic-attack (Bandit Lair Men 3 → 6)', () => {
    // Baseline: without Awaken Denizens the Men attack has its printed 3 strikes.
    const base = dispatch(
      setupAutoAttackStep(buildSitePhaseState({ site: BANDIT_LAIR })),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(base.combat).not.toBeNull();
    expect(base.combat!.strikesTotal).toBe(3);

    // With Awaken Denizens in the hazard player's cardsInPlay: 3 → 6.
    const doubled = dispatch(
      addCardInPlay(setupAutoAttackStep(buildSitePhaseState({ site: BANDIT_LAIR })), HAZARD_PLAYER, AWAKEN_DENIZENS),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(doubled.combat).not.toBeNull();
    expect(doubled.combat!.strikesTotal).toBe(6);
  });

  test('only strikes are doubled — prowess and creature race are untouched', () => {
    const doubled = dispatch(
      addCardInPlay(setupAutoAttackStep(buildSitePhaseState({ site: BANDIT_LAIR })), HAZARD_PLAYER, AWAKEN_DENIZENS),
      { type: 'pass', player: PLAYER_1 },
    );
    // Bandit Lair's Men attack: 3 strikes → 6, prowess stays 6.
    expect(doubled.combat!.strikesTotal).toBe(6);
    expect(doubled.combat!.strikeProwess).toBe(6);
    expect(doubled.combat!.creatureRace).toBe('man');
  });

  // ─── No effect at other site types ──────────────────────────────────────────

  test('does NOT double automatic-attack strikes at a Shadow-hold site', () => {
    const base = dispatch(
      setupAutoAttackStep(buildSitePhaseState({ site: MORIA })),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(base.combat!.strikesTotal).toBe(4);

    // Moria is shadow-hold — the site-type gate does not match, so the Orc
    // attack stays at 4 strikes even with Awaken Denizens in play.
    const withAwaken = dispatch(
      addCardInPlay(setupAutoAttackStep(buildSitePhaseState({ site: MORIA })), HAZARD_PLAYER, AWAKEN_DENIZENS),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(withAwaken.combat!.strikesTotal).toBe(4);
  });

  // ─── "Cannot be duplicated" (duplication-limit, scope game) ─────────────────

  test('playable as a hazard long-event when no copy is in play', () => {
    const s = {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        recompute: true,
        players: [
          { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN], destinationSite: BANDIT_LAIR }], hand: [], siteDeck: [MINAS_TIRITH] },
          { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: BANDIT_LAIR, characters: [MIONID] }], hand: [AWAKEN_DENIZENS], siteDeck: [MINAS_TIRITH] },
        ],
      }),
      phaseState: makeMHState({ destinationSiteName: 'x' }),
    };
    expect(viableActions(s, PLAYER_2, 'play-hazard')).toHaveLength(1);
  });

  test('NOT playable when a copy of Awaken Denizens is already in play', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN], destinationSite: BANDIT_LAIR }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: BANDIT_LAIR, characters: [MIONID] }], hand: [AWAKEN_DENIZENS], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const s = {
      ...addCardInPlay(built, HAZARD_PLAYER, AWAKEN_DENIZENS),
      phaseState: makeMHState({ destinationSiteName: 'x' }),
    };
    expect(viableActions(s, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });
});
