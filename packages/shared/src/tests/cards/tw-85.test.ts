/**
 * @module tw-85.test
 *
 * Card test: Rogrog (tw-85)
 * Type: hazard-creature
 * Unique. Race: Troll. Strikes: 1. Prowess 13. Body 8. Kill MPs: 2.
 * Keyed to: {d}{S}{D} — dark-domain region, OR shadow-hold/dark-hold site.
 *
 * "Unique. Troll. One strike."
 *
 * Rogrog is a vanilla hazard creature with no special effects beyond its
 * base stats and keying. The card text describes its uniqueness, race, and
 * strike count — all captured structurally (unique, race, strikes fields).
 * `keyedTo` carries the two independent keying alternatives from the
 * canonical `playable` string "{d}{S}{D}": a dark-domain region anywhere in
 * the site path, OR a shadow-hold/dark-hold destination site type — either
 * one alone is sufficient (OR semantics within a `keyedTo` entry).
 *
 * | # | Feature                                    | Status      | Notes                                    |
 * |---|---------------------------------------------|-------------|-------------------------------------------|
 * | 1 | Keyed via dark-domain region alone           | IMPLEMENTED | checkCreatureKeying regionTypes branch    |
 * | 2 | Keyed via shadow-hold/dark-hold site alone   | IMPLEMENTED | checkCreatureKeying siteTypes branch      |
 * | 3 | Rejected when neither region nor site match  | IMPLEMENTED | checkCreatureKeying returns error         |
 * | 4 | One strike, prowess 13 in combat             | IMPLEMENTED | combat initiation uses base stats         |
 *
 * Certified: 2026-08-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, makeWildernessMHState,
  resolveChain,
  handCardId, companyIdAt, dispatch, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, GameState } from '../../index.js';
import { computeLegalActions, Phase, reduce, RegionType, SiteType } from '../../index.js';

const ROGROG = 'tw-85' as CardDefinitionId;

/** Shared base state: P1's company at Lórien, P2 holding Rogrog. */
function baseState(): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: LORIEN, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: RIVENDELL, characters: [GIMLI] }],
        hand: [ROGROG],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
}

describe('Rogrog (tw-85)', () => {
  beforeEach(() => resetMint());

  test('can be played keyed by a dark-domain region alone (site type mismatched)', () => {
    const state = baseState();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Mordor'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const rogrogId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: rogrogId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type' as const, value: 'dark' },
    });
    const afterChain = resolveChain(afterPlay);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(13);
  });

  test('can be played keyed by a shadow-hold site alone (region mismatched)', () => {
    const state = baseState();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const rogrogId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: rogrogId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
    });
    expect(result.error).toBeUndefined();
  });

  test('can be played keyed by a dark-hold site alone (region mismatched)', () => {
    const state = baseState();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const rogrogId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: rogrogId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'dark-hold' },
    });
    expect(result.error).toBeUndefined();
  });

  test('is rejected when neither a dark-domain region nor a shadow/dark-hold site is present', () => {
    const state = baseState();
    const mhState = makeWildernessMHState();
    const gameState = { ...state, phaseState: mhState };

    const rogrogId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: rogrogId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type' as const, value: 'dark' },
    });
    expect(result.error).toContain('cannot be keyed');
  });

  test('is not offered as a legal play-hazard action against a mismatched company', () => {
    const state = baseState();
    const mhState = makeWildernessMHState();
    const gameState = { ...state, phaseState: mhState };

    const rogrogId = handCardId(gameState, HAZARD_PLAYER);
    const actions = computeLegalActions(gameState, PLAYER_2);
    const rogrogPlays = actions.filter(
      a => a.viable && a.action.type === 'play-hazard' && a.action.cardInstanceId === rogrogId,
    );
    expect(rogrogPlays).toHaveLength(0);
  });

  test('defender gets assign-strike actions against Rogrog, one strike only', () => {
    const state = baseState();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Mordor'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const rogrogId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: rogrogId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type' as const, value: 'dark' },
    });
    const afterChain = resolveChain(afterPlay);

    expect(afterChain.combat!.strikesTotal).toBe(1);

    const defenderActions = computeLegalActions(afterChain, PLAYER_1);
    const defenderAssignStrikes = defenderActions.filter(
      a => a.viable && a.action.type === 'assign-strike',
    );
    expect(defenderAssignStrikes.length).toBeGreaterThan(0);
  });
});
