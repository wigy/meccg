/**
 * @module le-59.test
 *
 * Card test: Ambusher (le-59)
 * Type: hazard-creature (Men)
 *
 * Text:
 *   "Men. Two strikes. Attacker chooses defending characters."
 *
 * Base stats: strikes 2, prowess 10, body —, kill MP 1.
 *
 * keyedTo:
 * | # | Entry                            | When   | Notes            |
 * |---|----------------------------------|--------|------------------|
 * | 1 | regionTypes: [border, free]      | always | base cost {f}{b} |
 *
 * Distinct region types inside a single `keyedTo` entry are alternatives
 * (OR'd): Ambusher keys when the resolved site path contains at least one
 * border-land OR at least one free-domain.
 *
 * Effects:
 * | # | Effect Type                       | Status | Notes                            |
 * |---|-----------------------------------|--------|----------------------------------|
 * | 1 | combat-attacker-chooses-defenders | OK     | Cancel-window before assignment  |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, makeShadowMHState, makeWildernessMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType, computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const AMBUSHER = 'le-59' as CardDefinitionId;

const BORDER_KEYING = { method: 'region-type' as const, value: RegionType.Border };
const FREE_KEYING = { method: 'region-type' as const, value: RegionType.Free };

function makeBorderMHState() {
  return makeMHState({
    resolvedSitePath: [RegionType.Border],
    resolvedSitePathNames: ['Cardolan'],
    destinationSiteType: SiteType.BorderHold,
    destinationSiteName: 'Bree',
  });
}

function makeFreeMHState() {
  return makeMHState({
    resolvedSitePath: [RegionType.Free],
    resolvedSitePathNames: ['Anorien'],
    destinationSiteType: SiteType.FreeHold,
    destinationSiteName: 'Minas Tirith',
  });
}

function baseStateWithHazardInHand() {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [GIMLI] }],
        hand: [AMBUSHER],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe('Ambusher (le-59)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats: two strikes at prowess 10, race Men, body — ──────────────

  test('attack uses 2 strikes at prowess 10 via border keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeBorderMHState() };
    const ambusherId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, ambusherId, companyId, BORDER_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(10);
    expect(after.combat!.creatureRace).toBe('men');
    expect(after.combat!.creatureBody).toBeNull();
  });

  test('attack uses 2 strikes at prowess 10 via free-domain keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeFreeMHState() };
    const ambusherId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, ambusherId, companyId, FREE_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(10);
  });

  // ─── Keying: playable on a pure-border path ─────────────────────────────

  test('playable on a pure-border path via border keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeBorderMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { cardInstanceId: CardInstanceId; keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Border;
    })).toBe(true);
  });

  // ─── Keying: playable on a pure-free path ───────────────────────────────

  test('playable on a pure-free-domain path via free-domain keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeFreeMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { cardInstanceId: CardInstanceId; keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Free;
    })).toBe(true);
  });

  // ─── Keying: distinct types in one entry are OR'd ───────────────────────

  test('playable on a border+free path via either keying option', () => {
    const state = baseStateWithHazardInHand();
    const mixedMH = makeMHState({
      resolvedSitePath: [RegionType.Border, RegionType.Free],
      resolvedSitePathNames: ['Cardolan', 'Anorien'],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Minas Tirith',
    });
    const ready: GameState = { ...state, phaseState: mixedMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    const offered = new Set(plays.map(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.value;
    }));
    expect(offered.has(RegionType.Border)).toBe(true);
    expect(offered.has(RegionType.Free)).toBe(true);
  });

  // ─── Keying: NOT playable on paths that lack both region types ──────────

  test('NOT playable on a pure-wilderness path', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  test('NOT playable on a pure-shadow path', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeShadowMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable on a pure-dark-domain path', () => {
    const state = baseStateWithHazardInHand();
    const darkMH = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Moria',
    });
    const ready: GameState = { ...state, phaseState: darkMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  // ─── Attacker-chooses-defenders: cancel-window precedes attacker assign ──

  test('combat opens in cancel-window (attacker-chooses-defenders)', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeBorderMHState() };
    const ambusherId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, ambusherId, companyId, BORDER_KEYING,
    );

    expect(afterChain.combat!.phase).toBe('assign-strikes');
    expect(afterChain.combat!.assignmentPhase).toBe('cancel-window');
  });

  test('defender has no assign-strike during cancel-window; attacker assigns after pass', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeBorderMHState() };
    const ambusherId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, ambusherId, companyId, BORDER_KEYING,
    );

    // Defender gets no assign-strike actions while attacker chooses.
    expect(viableActions(afterChain, PLAYER_1, 'assign-strike')).toHaveLength(0);

    // After defender passes the cancel-window, attacker (P2) assigns strikes.
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat!.assignmentPhase).toBe('attacker');
    const attackerAssigns = viableActions(afterPass, PLAYER_2, 'assign-strike');
    // Two characters (Aragorn, Legolas) are eligible defenders.
    expect(attackerAssigns).toHaveLength(2);
  });
});
