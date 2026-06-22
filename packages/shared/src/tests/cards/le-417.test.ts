/**
 * @module le-417.test
 *
 * Card test: Zarak Dûm (le-417)
 * Type: minion-site (ruins-and-lairs) in Angmar
 * Nearest Darkhaven: Carn Dûm
 * Playable: Items (minor, major)
 * Automatic-attacks: Dragon — 1 strike with 11 prowess
 * Effects: none — the card text is entirely structural site data.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" ({R}) — valid                    |
 * | 2 | sitePath          | OK     | [shadow] ({s}) — valid region type                 |
 * | 3 | nearestHaven      | OK     | "Carn Dûm" — valid minion haven (le-359, Angmar)   |
 * | 4 | region            | OK     | "Angmar" — valid region in card pool               |
 * | 5 | playableResources | OK     | [minor, major] — matches card text                 |
 * | 6 | automaticAttacks  | OK     | Dragon — 1 strike, 11 prowess — matches card text  |
 * | 7 | resourceDraws     | OK     | 1                                                  |
 * | 8 | hazardDraws       | OK     | 1                                                  |
 *
 * Engine Support:
 * | # | Feature                        | Status      | Notes                                            |
 * |---|--------------------------------|-------------|--------------------------------------------------|
 * | 1 | Site phase flow                | IMPLEMENTED | select-company, enter-or-skip, play-resources    |
 * | 2 | Item playability (minor/major) | IMPLEMENTED | subtype gated by playableResources               |
 * | 3 | Haven path movement            | IMPLEMENTED | Carn Dûm → Zarak Dûm via starter movement         |
 * | 4 | Automatic attack               | IMPLEMENTED | site-phase auto-attack initiates Dragon (1/11)   |
 *
 * Playable: YES
 * Certified: 2026-06-22
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LORIEN, MINAS_TIRITH, RIVENDELL,
  resetMint, pool,
  buildTestState, makeSitePhase, setupAutoAttackStep,
  viableActions, dispatch,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
  Phase, Alignment,
} from '../../index.js';
import type { SiteCard, CardDefinitionId, GameState } from '../../index.js';

const ZARAK_DUM = 'le-417' as CardDefinitionId;          // minion ruins-and-lairs
const CARN_DUM = 'le-359' as CardDefinitionId;           // nearest Darkhaven (haven, Angmar)
const GORBAG = 'le-11' as CardDefinitionId;              // orc, prowess 6, body 9
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;    // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId;       // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId;  // greater minion item

/**
 * Minion company (GORBAG) parked at Zarak Dûm in the site phase, advanced to
 * the automatic-attacks step so a `pass` triggers the site's Dragon attack.
 */
function autoAttackReady(): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: ZARAK_DUM, characters: [GORBAG] }], hand: [], siteDeck: [CARN_DUM] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return setupAutoAttackStep({ ...base, phaseState: makeSitePhase() });
}

/** Minion company at Zarak Dûm with `hand` for the Ringwraith player. */
function siteWithHand(hand: CardDefinitionId[]): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: ZARAK_DUM, characters: [GORBAG] }], hand, siteDeck: [CARN_DUM] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...base, phaseState: makeSitePhase() };
}

describe('Zarak Dûm (le-417)', () => {
  beforeEach(() => resetMint());

  // ─── Nearest Darkhaven / movement ──────────────────────────────────────────

  test('starter movement from Carn Dûm reaches Zarak Dûm (le-417)', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const reachable = getReachableSites(buildMovementMap(pool), carnDum, allSites);

    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (ZARAK_DUM as string),
    );
    expect(entry).toBeDefined();
  });

  test('starter movement from a hero haven does NOT reach Zarak Dûm (le-417)', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const reachable = getReachableSites(buildMovementMap(pool), rivendell, allSites);

    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (ZARAK_DUM as string),
    );
    expect(entry).toBeUndefined();
  });

  // ─── Automatic attack: Dragon, 1 strike, 11 prowess ─────────────────────────

  test('Dragon automatic attack triggers with 1 strike and 11 prowess', () => {
    const next = dispatch(autoAttackReady(), { type: 'pass', player: PLAYER_1 });

    expect(next.combat).toBeDefined();
    expect(next.combat!.strikesTotal).toBe(1);
    expect(next.combat!.strikeProwess).toBe(11);
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
    expect(next.combat!.creatureRace).toBe('dragon');
  });

  // ─── Playable: Items (minor, major) ─────────────────────────────────────────

  test('minor and major items are playable at Zarak Dûm', () => {
    expect(viableActions(siteWithHand([STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource')).toHaveLength(1);
    expect(viableActions(siteWithHand([SABLE_SHIELD]), PLAYER_1, 'play-hero-resource')).toHaveLength(1);
  });

  test('a greater item is NOT playable at Zarak Dûm', () => {
    expect(viableActions(siteWithHand([SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });
});
