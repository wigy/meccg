/**
 * @module tw-374.test
 *
 * Card test: Barad-dûr (tw-374)
 * Type: hero-site (dark-hold) in Gorgoroth
 * Nearest Haven: Lórien
 * Playable: Items (minor, major, greater)
 * Automatic-attacks (2): (1st) Orcs — 4 strikes with 7 prowess; (2nd) Trolls — 3 strikes with 9 prowess
 * Effects: 1 (site-rule hazard-limit-modifier +2)
 *
 * Text:
 *   "Nearest Haven: Lórien
 *    Playable: Items (minor, major, greater)
 *    Automatic-attacks (2): (1st) Orcs — 4 strikes with 7 prowess (2nd) Trolls — 3 strikes with 9 prowess
 *    Special: Any company moving to this site has its hazard limit increased by 2."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                              |
 * |---|-------------------|--------|--------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid                                                |
 * | 2 | sitePath          | OK     | [wilderness, border, free, wilderness, shadow, dark] from Lórien   |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                                |
 * | 4 | region            | OK     | "Gorgoroth" — valid region in card pool                            |
 * | 5 | playableResources | OK     | [minor, major, greater] — matches card text                        |
 * | 6 | automaticAttacks  | OK     | Orcs 4/7, Trolls 3/9 — matches card text                          |
 * | 7 | resourceDraws     | OK     | 3                                                                  |
 * | 8 | hazardDraws       | OK     | 6                                                                  |
 *
 * Engine Support:
 * | # | Feature                        | Status      | Notes                                                          |
 * |---|--------------------------------|-------------|----------------------------------------------------------------|
 * | 1 | Site phase flow                | IMPLEMENTED | select-company, enter-or-skip, play-resources                  |
 * | 2 | Item playability               | IMPLEMENTED | minor, major, greater via playableResources                    |
 * | 3 | Haven path movement            | IMPLEMENTED | Lórien → Barad-dûr via starter movement                        |
 * | 4 | Card draws                     | IMPLEMENTED | resourceDraws / hazardDraws thread through M/H phase           |
 * | 5 | Automatic attacks (data only)  | IMPLEMENTED | site-phase auto-attack initiates Orc and Troll combats         |
 * | 6 | Hazard-limit modifier (+2)     | IMPLEMENTED | site-rule applied during set-hazard-limit for moving companies |
 *
 * Playable: YES
 * Certified: 2026-05-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FARAMIR,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  DAGGER_OF_WESTERNESSE, GLAMDRING, SCROLL_OF_ISILDUR,
  resetMint, mint, pool,
  buildTestState, buildSitePhaseState, makeMHState,
  dispatch,
  viableActions,
  RESOURCE_PLAYER,
  CardStatus,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites, Phase,
} from '../../index.js';
import type { SiteCard, CardDefinitionId, MovementHazardPhaseState } from '../../index.js';

const BARAD_DUR = 'tw-374' as CardDefinitionId;
// Minas Morgul (tw-411) is another dark-hold without a hazard-limit-modifier rule
const MINAS_MORGUL_TW = 'tw-411' as CardDefinitionId;

describe('Barad-dûr (tw-374)', () => {
  beforeEach(() => resetMint());

  // ─── Site path: reachable from nearest haven Lórien ─────────────────────────

  test('Lórien starter movement reaches Barad-dûr', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (BARAD_DUR as string),
    );

    expect(entry).toBeDefined();
  });

  test('Rivendell starter movement does NOT reach Barad-dûr', () => {
    // Rivendell is the wrong haven; only Lórien can reach Barad-dûr via starter.
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (BARAD_DUR as string),
    );

    expect(entry).toBeUndefined();
  });

  // ─── Item playability: minor, major, greater ─────────────────────────────────
  // playableResources = [minor, major, greater]. The legal-action layer
  // consults this list when proposing play-hero-resource actions.

  test('minor item (Dagger of Westernesse) is offered at Barad-dûr', () => {
    const state = buildSitePhaseState({
      site: BARAD_DUR,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('major item (Glamdring) is offered at Barad-dûr', () => {
    const state = buildSitePhaseState({
      site: BARAD_DUR,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('greater item (Scroll of Isildur) is offered at Barad-dûr', () => {
    const state = buildSitePhaseState({
      site: BARAD_DUR,
      characters: [ARAGORN],
      hand: [SCROLL_OF_ISILDUR],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ─── Hazard-limit modifier: +2 for moving companies ─────────────────────────
  // The set-hazard-limit step's snapshotHazardLimit reads site-rule
  // hazard-limit-modifier from the company's destinationSite.

  test('single character moving to Barad-dûr: hazard limit is 2 + 2 = 4', () => {
    // Company of 1: base = max(1, 2) = 2; site-rule adds 2 → 4.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [FARAMIR] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const destInstId = mint();
    const company = {
      ...base.players[RESOURCE_PLAYER].companies[0],
      destinationSite: { instanceId: destInstId, definitionId: BARAD_DUR, status: CardStatus.Untapped },
    };
    const players = [
      { ...base.players[RESOURCE_PLAYER], companies: [company] },
      base.players[1],
    ] as typeof base.players;

    const state = { ...base, players, phaseState: makeMHState({ step: 'set-hazard-limit' }) };
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const result = next.phaseState as MovementHazardPhaseState;

    expect(result.step).toBe('draw-cards');
    expect(result.hazardLimitAtReveal).toBe(4); // 2 (base) + 2 (site-rule)
  });

  test('two characters moving to Barad-dûr: hazard limit is 2 + 2 = 4', () => {
    // Company of 2: base = max(2, 2) = 2; site-rule adds 2 → 4.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [FARAMIR] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const destInstId = mint();
    const company = {
      ...base.players[RESOURCE_PLAYER].companies[0],
      destinationSite: { instanceId: destInstId, definitionId: BARAD_DUR, status: CardStatus.Untapped },
    };
    const players = [
      { ...base.players[RESOURCE_PLAYER], companies: [company] },
      base.players[1],
    ] as typeof base.players;

    const state = { ...base, players, phaseState: makeMHState({ step: 'set-hazard-limit' }) };
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const result = next.phaseState as MovementHazardPhaseState;

    expect(result.hazardLimitAtReveal).toBe(4); // 2 (base for 2 chars) + 2 (site-rule)
  });

  test('three characters moving to Barad-dûr: hazard limit is 3 + 2 = 5', () => {
    // Company of 3: base = 3; site-rule adds 2 → 5.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN, LEGOLAS, GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [FARAMIR] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const destInstId = mint();
    const company = {
      ...base.players[RESOURCE_PLAYER].companies[0],
      destinationSite: { instanceId: destInstId, definitionId: BARAD_DUR, status: CardStatus.Untapped },
    };
    const players = [
      { ...base.players[RESOURCE_PLAYER], companies: [company] },
      base.players[1],
    ] as typeof base.players;

    const state = { ...base, players, phaseState: makeMHState({ step: 'set-hazard-limit' }) };
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const result = next.phaseState as MovementHazardPhaseState;

    expect(result.hazardLimitAtReveal).toBe(5); // 3 (base) + 2 (site-rule)
  });

  test('non-moving company at Barad-dûr: hazard limit is NOT increased', () => {
    // A company staying at Barad-dûr (destinationSite = null) does NOT get
    // the +2 bonus — only companies "moving to this site" are affected.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BARAD_DUR, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [FARAMIR] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const state = { ...base, phaseState: makeMHState({ step: 'set-hazard-limit' }) };
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const result = next.phaseState as MovementHazardPhaseState;

    // base = max(1, 2) = 2; no site-rule bonus for non-moving company
    expect(result.hazardLimitAtReveal).toBe(2);
  });

  test('moving to Minas Morgul (dark-hold, no site-rule): hazard limit is NOT increased', () => {
    // Regression guard: the +2 modifier is specific to Barad-dûr's site-rule.
    // Moving to another dark-hold without the rule must produce the base limit.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [FARAMIR] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const destInstId = mint();
    const company = {
      ...base.players[RESOURCE_PLAYER].companies[0],
      destinationSite: { instanceId: destInstId, definitionId: MINAS_MORGUL_TW, status: CardStatus.Untapped },
    };
    const players = [
      { ...base.players[RESOURCE_PLAYER], companies: [company] },
      base.players[1],
    ] as typeof base.players;

    const state = { ...base, players, phaseState: makeMHState({ step: 'set-hazard-limit' }) };
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const result = next.phaseState as MovementHazardPhaseState;

    expect(result.hazardLimitAtReveal).toBe(2); // base only, no site-rule bonus
  });
});
