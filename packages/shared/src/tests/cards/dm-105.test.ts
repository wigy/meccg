/**
 * @module dm-105.test
 *
 * Card test: Bûthrakaur the Green (dm-105)
 * Type: hazard-creature (Troll), unique. Strikes 1, prowess 15, body 6, kill MP 2.
 *
 * Card text:
 *   "Unique. Troll. One strike. Also playable at Moria and The Under-gates.
 *    If Doors of Night is in play, playable at any Under-deeps site. Any
 *    non-unique Orc or Troll hazard creature can be played (not counting
 *    against the hazard limit) on a company that has faced Bûthrakaur that
 *    turn."
 *
 * Canonical playable cost (data/cards.json DM-105): {S} — base keying to a
 * Shadow-hold.
 *
 * keyedTo:
 * | # | Entry                                                     | Clause                        |
 * |---|------------------------------------------------------------|--------------------------------|
 * | 1 | siteTypes: shadow-hold                                     | base {S}                       |
 * | 2 | siteNames: ["Moria", "The Under-gates"]                     | "Also playable at Moria and…"  |
 * | 3 | siteKeywords: ["under-deeps"], when inPlay Doors of Night   | "…playable at any Under-deeps…"|
 *
 * Effects:
 * | # | Effect Type            | Notes                                                              |
 * |---|-------------------------|---------------------------------------------------------------------|
 * | 1 | hazard-limit-race-grant | race: orc, source: faced-this-turn, nonUniqueOnly: true              |
 * | 2 | hazard-limit-race-grant | race: troll, source: faced-this-turn, nonUniqueOnly: true            |
 *
 * Playable: YES
 * Certified: 2026-09-18
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, ORC_GUARD, BARROW_WIGHT, BERT_BURAT,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, addCardInPlay,
  companyIdAt, phaseStateAs, findCharInstanceId,
  findHandCardId, handCardId, viableActions, viableActionsForHandCard,
  playCreatureHazardAndResolve,
  dispatch, executeAction,
} from '../test-helpers.js';
import type { PlayerSetup } from '../test-helpers.js';
import { Phase, RegionType, SiteType, Race } from '../../index.js';
import type {
  CardDefinitionId, GameState, MovementHazardPhaseState,
} from '../../index.js';

const BUTHRAKAUR = 'dm-105' as CardDefinitionId;
const BUTHRAKAUR_NAME = 'Bûthrakaur the Green';
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId;
/** Half-trolls of Far Harad — non-unique Troll hazard creature, keyed to Shadow/Dark region or Shadow-hold/Darkhold. */
const HALF_TROLLS = 'tw-43' as CardDefinitionId;

const SITE_TYPE_KEYING = { method: 'site-type' as const, value: SiteType.ShadowHold };
const SITE_NAME_KEYING = (value: string) => ({ method: 'site-name' as const, value });
const UNDER_DEEPS_KEYING = { method: 'site-keyword' as const, value: 'under-deeps' };

/** Build a Movement/Hazard state: P1 (moving) vs P2 (hazard, holding `hand`). */
function setup(opts: {
  destinationSiteName: string;
  destinationSiteType: SiteType;
  hand?: CardDefinitionId[];
  doorsOfNight?: boolean;
}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: opts.hand ?? [BUTHRAKAUR], siteDeck: [] },
    ],
  });
  const withDon = opts.doorsOfNight ? addCardInPlay(base, HAZARD_PLAYER, DOORS_OF_NIGHT) : base;
  return {
    ...withDon,
    phaseState: makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: opts.destinationSiteType,
      destinationSiteName: opts.destinationSiteName,
    }),
  };
}

describe('Bûthrakaur the Green (dm-105)', () => {
  beforeEach(() => resetMint());

  // ─── keyedTo entry 1: base {S} — Shadow-hold ───────────────────────────────

  test('playable at a Shadow-hold via the base {S} keying', () => {
    const state = setup({ destinationSiteName: 'Dol Guldur', destinationSiteType: SiteType.ShadowHold });
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);

    const creatureId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(state, PLAYER_2, creatureId, companyId, SITE_TYPE_KEYING);
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('troll');
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(15);
  });

  test('NOT playable at a non-Shadow-hold site with none of the alternate clauses satisfied', () => {
    const state = setup({ destinationSiteName: 'Bree', destinationSiteType: SiteType.BorderHold });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── keyedTo entry 2: "Also playable at Moria and The Under-gates." ───────

  test('also playable at Moria (named-site alt, independent of the destination\'s own type)', () => {
    // destinationSiteType deliberately NOT shadow-hold, isolating the
    // siteNames branch from the base {S} keying.
    const state = setup({ destinationSiteName: 'Moria', destinationSiteType: SiteType.RuinsAndLairs });
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);

    const creatureId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(state, PLAYER_2, creatureId, companyId, SITE_NAME_KEYING('Moria'));
    expect(after.combat).not.toBeNull();
  });

  test('also playable at The Under-gates (named-site alt)', () => {
    const state = setup({ destinationSiteName: 'The Under-gates', destinationSiteType: SiteType.RuinsAndLairs });
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);

    const creatureId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(state, PLAYER_2, creatureId, companyId, SITE_NAME_KEYING('The Under-gates'));
    expect(after.combat).not.toBeNull();
  });

  test('NOT playable at an unrelated named site of the same (non-{S}) type', () => {
    const state = setup({ destinationSiteName: 'Bree', destinationSiteType: SiteType.RuinsAndLairs });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── keyedTo entry 3: "If Doors of Night is in play, playable at any Under-deeps site." ───

  test('with Doors of Night in play, playable at The Under-vaults (any Under-deeps site)', () => {
    const state = setup({
      destinationSiteName: 'The Under-vaults', destinationSiteType: SiteType.RuinsAndLairs, doorsOfNight: true,
    });
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);

    const creatureId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(state, PLAYER_2, creatureId, companyId, UNDER_DEEPS_KEYING);
    expect(after.combat).not.toBeNull();
  });

  test('without Doors of Night, The Under-vaults stays unkeyable', () => {
    const state = setup({
      destinationSiteName: 'The Under-vaults', destinationSiteType: SiteType.RuinsAndLairs, doorsOfNight: false,
    });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── "Any non-unique Orc or Troll hazard creature can be played (not
  //     counting against the hazard limit) on a company that has faced
  //     Bûthrakaur that turn." ────────────────────────────────────────────────

  const GRANT_PLAYERS = (extra: CardDefinitionId[]): [PlayerSetup, PlayerSetup] => [
    { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [] },
    { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: extra, siteDeck: [] },
  ];

  describe('hazard-limit-race-grant (faced-this-turn): non-unique Orc/Troll bypasses the hazard limit', () => {
    test('a non-unique Orc creature is exempt once the company has faced Bûthrakaur', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: GRANT_PLAYERS([ORC_GUARD]),
      });
      const gameState: GameState = {
        ...base,
        phaseState: makeMHState({
          hazardsPlayedThisCompany: 1,
          hazardLimitAtReveal: 1,
          resolvedSitePath: [RegionType.Shadow],
          hazardsEncountered: [BUTHRAKAUR_NAME],
        }),
      };
      const actions = viableActionsForHandCard(gameState, PLAYER_2, 'play-hazard', HAZARD_PLAYER, ORC_GUARD);
      expect(actions.length).toBeGreaterThan(0);
    });

    test('a non-unique Troll creature (Half-trolls of Far Harad) is exempt once the company has faced Bûthrakaur', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: GRANT_PLAYERS([HALF_TROLLS]),
      });
      const gameState: GameState = {
        ...base,
        phaseState: makeMHState({
          hazardsPlayedThisCompany: 1,
          hazardLimitAtReveal: 1,
          resolvedSitePath: [RegionType.Shadow],
          hazardsEncountered: [BUTHRAKAUR_NAME],
        }),
      };
      const actions = viableActionsForHandCard(gameState, PLAYER_2, 'play-hazard', HAZARD_PLAYER, HALF_TROLLS);
      expect(actions.length).toBeGreaterThan(0);
    });

    test('a UNIQUE Troll creature (Bert Burat) is NOT exempt — nonUniqueOnly excludes it', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: GRANT_PLAYERS([BERT_BURAT]),
      });
      const gameState: GameState = {
        ...base,
        phaseState: makeMHState({
          hazardsPlayedThisCompany: 1,
          hazardLimitAtReveal: 1,
          resolvedSitePath: [RegionType.Shadow],
          hazardsEncountered: [BUTHRAKAUR_NAME],
        }),
      };
      const actions = viableActionsForHandCard(gameState, PLAYER_2, 'play-hazard', HAZARD_PLAYER, BERT_BURAT);
      expect(actions).toHaveLength(0);
    });

    test('a non-Orc/Troll creature (Barrow-wight, Undead) is NOT exempt', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: GRANT_PLAYERS([BARROW_WIGHT]),
      });
      const gameState: GameState = {
        ...base,
        phaseState: makeMHState({
          hazardsPlayedThisCompany: 1,
          hazardLimitAtReveal: 1,
          resolvedSitePath: [RegionType.Shadow],
          hazardsEncountered: [BUTHRAKAUR_NAME],
        }),
      };
      const actions = viableActionsForHandCard(gameState, PLAYER_2, 'play-hazard', HAZARD_PLAYER, BARROW_WIGHT);
      expect(actions).toHaveLength(0);
    });

    test('without having faced Bûthrakaur, a non-unique Orc creature is blocked normally at the hazard limit', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: GRANT_PLAYERS([ORC_GUARD]),
      });
      const gameState: GameState = {
        ...base,
        phaseState: makeMHState({
          hazardsPlayedThisCompany: 1,
          hazardLimitAtReveal: 1,
          resolvedSitePath: [RegionType.Shadow],
          // hazardsEncountered left empty — company has not faced Bûthrakaur.
        }),
      };
      const actions = viableActionsForHandCard(gameState, PLAYER_2, 'play-hazard', HAZARD_PLAYER, ORC_GUARD);
      expect(actions).toHaveLength(0);
    });

    test('only ONE Orc creature per company is exempt — a second Orc is blocked once that race\'s grant is used, but the Troll grant is still separately available', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: GRANT_PLAYERS([ORC_GUARD, HALF_TROLLS]),
      });
      const gameState: GameState = {
        ...base,
        phaseState: makeMHState({
          hazardsPlayedThisCompany: 1,
          hazardLimitAtReveal: 1,
          hazardLimitRaceGrantsUsed: [Race.Orc], // this company's Orc grant already spent
          resolvedSitePath: [RegionType.Shadow],
          hazardsEncountered: [BUTHRAKAUR_NAME],
        }),
      };
      expect(viableActionsForHandCard(gameState, PLAYER_2, 'play-hazard', HAZARD_PLAYER, ORC_GUARD)).toHaveLength(0);
      expect(viableActionsForHandCard(gameState, PLAYER_2, 'play-hazard', HAZARD_PLAYER, HALF_TROLLS).length).toBeGreaterThan(0);
    });

    test('playing the exempt Orc creature does not increment hazardsPlayedThisCompany, and records the grant as used for its race', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: GRANT_PLAYERS([ORC_GUARD]),
      });
      const gameState: GameState = {
        ...base,
        phaseState: makeMHState({
          hazardsPlayedThisCompany: 1,
          hazardLimitAtReveal: 1,
          resolvedSitePath: [RegionType.Shadow],
          hazardsEncountered: [BUTHRAKAUR_NAME],
        }),
      };
      const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
      const orcGuardId = findHandCardId(gameState, HAZARD_PLAYER, ORC_GUARD);
      const result = dispatch(gameState, {
        type: 'play-hazard',
        player: PLAYER_2,
        cardInstanceId: orcGuardId,
        targetCompanyId: companyId,
        keyedBy: { method: 'region-type', value: RegionType.Shadow },
      });
      const ps = phaseStateAs<MovementHazardPhaseState>(result);
      expect(ps.hazardsPlayedThisCompany).toBe(1); // unchanged — the exempt Orc-guard did not count
      expect(ps.hazardLimitRaceGrantsUsed).toEqual([Race.Orc]);
    });

    test('end to end: after Bûthrakaur attacks and combat resolves, an Orc creature becomes exempt at the same hazard limit', () => {
      const state = setup({
        destinationSiteName: 'Dol Guldur',
        destinationSiteType: SiteType.ShadowHold,
        hand: [BUTHRAKAUR, ORC_GUARD],
      });
      const ready: GameState = {
        ...state,
        phaseState: { ...state.phaseState, hazardLimitAtReveal: 1 } as MovementHazardPhaseState,
      };

      const buthrakaurId = findHandCardId(ready, HAZARD_PLAYER, BUTHRAKAUR);
      const companyId = companyIdAt(ready, RESOURCE_PLAYER);

      const afterPlay = playCreatureHazardAndResolve(ready, PLAYER_2, buthrakaurId, companyId, SITE_TYPE_KEYING);
      expect(afterPlay.combat).not.toBeNull();

      // Aragorn (prowess 6) + roll 12 = 18, comfortably beats Bûthrakaur's
      // prowess 15 — the strike is defeated outright, no body check, and the
      // single-strike combat finalizes immediately.
      const aragornId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, ARAGORN);
      const assigned = dispatch(afterPlay, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
      const afterCombat = executeAction(assigned, PLAYER_1, 'resolve-strike', 12);
      expect(afterCombat.combat).toBeNull();

      const mh = phaseStateAs<MovementHazardPhaseState>(afterCombat);
      expect(mh.hazardsEncountered).toContain(BUTHRAKAUR_NAME);
      expect(mh.hazardsPlayedThisCompany).toBe(1); // Bûthrakaur itself counted normally

      // The company has now faced Bûthrakaur — the Orc-guard is exempt from
      // the (already-reached) hazard limit.
      const afterActions = viableActionsForHandCard(afterCombat, PLAYER_2, 'play-hazard', HAZARD_PLAYER, ORC_GUARD);
      expect(afterActions.length).toBeGreaterThan(0);
    });
  });
});
