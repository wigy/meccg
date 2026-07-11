/**
 * @module tw-43.test
 *
 * Card test: Half-trolls of Far Harad (tw-43)
 * Type: hazard-creature, race Trolls, non-unique
 * Stats: 2 strikes, prowess 10, no body (kill MP 1)
 * Keying (canonical `playable` "{s}{d}{S}{D}"): keyed to a Shadow-land {s} or
 *   Dark-domain {d} region, and playable at a Shadow-hold {S} or Dark-hold {D}
 *   site — a single `keyedTo` entry `regionTypes: [shadow, dark]`,
 *   `siteTypes: [shadow-hold, dark-hold]`.
 *
 * Card text: "Trolls. Two strikes." — a vanilla creature with no special
 * effects; the text merely restates the race and strike count already carried
 * in the card data (`race: trolls`, `strikes: 2`). The only engine behaviour to
 * exercise is (a) keying validity against a moving company's site path, and
 * (b) that resolving the creature initiates a two-strike, prowess-10 Trolls
 * combat.
 *
 * These tests drive the reducer / legal-action computation (never assert on the
 * card JSON directly): they build a movement/hazard state, offer/resolve the
 * `play-hazard`, and assert on the resulting legal actions and combat state.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint,
  viableActions, nonViableOfType,
  playCreatureHazardAndResolve,
  makeShadowMHState, makeWildernessMHState, makeMHState,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  handCardId, companyIdAt,
} from '../test-helpers.js';
import { computeLegalActions, Phase, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, PlayHazardAction } from '../../index.js';

const HALF_TROLLS = 'tw-43' as CardDefinitionId;

/** Build an M/H state describing arrival at a Dark-hold via a Dark-domain region. */
const makeDarkMHState = () =>
  makeMHState({
    resolvedSitePath: [RegionType.Dark],
    resolvedSitePathNames: ['Gorgoroth'],
    destinationSiteType: SiteType.DarkHold,
    destinationSiteName: 'Barad-dûr',
  });

/** Half-trolls in the hazard player's hand, poised over P1's company. */
const buildState = () =>
  buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [HALF_TROLLS], siteDeck: [RIVENDELL] },
    ],
  });

describe('Half-trolls of Far Harad (tw-43)', () => {
  beforeEach(() => resetMint());

  test('Keyed to a Shadow-land region / Shadow-hold site: viable, offering both keying options', () => {
    // makeShadowMHState: Shadow region path → Shadow-hold destination — matches
    // both a `{s}` region token and a `{S}` site token in the keying.
    const gameState = { ...buildState(), phaseState: makeShadowMHState() };
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);

    const plays = viableActions(gameState, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);

    // Every offered play targets P1's moving company.
    for (const ea of plays) {
      expect((ea.action as PlayHazardAction).targetCompanyId).toBe(companyId);
    }

    // Both the region-type and the site-type keying should be offered.
    const keyings = plays.map(ea => (ea.action as PlayHazardAction).keyedBy);
    expect(keyings).toContainEqual({ method: 'region-type', value: 'shadow' });
    expect(keyings).toContainEqual({ method: 'site-type', value: 'shadow-hold' });
  });

  test('Keyed to a Dark-domain region / Dark-hold site: viable, offering both keying options', () => {
    const gameState = { ...buildState(), phaseState: makeDarkMHState() };

    const plays = viableActions(gameState, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);

    const keyings = plays.map(ea => (ea.action as PlayHazardAction).keyedBy);
    expect(keyings).toContainEqual({ method: 'region-type', value: 'dark' });
    expect(keyings).toContainEqual({ method: 'site-type', value: 'dark-hold' });
  });

  test('Non-viable when the path keys to neither a Shadow/Dark region nor a Shadow-hold/Dark-hold site', () => {
    // Wilderness region → Ruins-and-Lairs destination: no keying token matches.
    const gameState = { ...buildState(), phaseState: makeWildernessMHState() };

    expect(viableActions(gameState, PLAYER_2, 'play-hazard')).toHaveLength(0);

    const nonViable = nonViableOfType(computeLegalActions(gameState, PLAYER_2), 'play-hazard');
    const halfTrollsId = gameState.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(nonViable.some(ea => (ea.action as PlayHazardAction).cardInstanceId === halfTrollsId)).toBe(true);
  });

  test('Resolving the creature initiates a two-strike, prowess-10 Trolls combat with no creature body', () => {
    const gameState = { ...buildState(), phaseState: makeShadowMHState() };
    const halfTrollsId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      gameState, PLAYER_2, halfTrollsId, companyId,
      { method: 'region-type', value: 'shadow' },
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.attackSource.type).toBe('creature');
    expect(after.combat!.companyId).toBe(companyId);
    // Stats read straight off the card definition by the combat initiator.
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(10);
    expect(after.combat!.creatureRace).toBe('troll');
    expect(after.combat!.creatureBody).toBeNull();
    // Two strikes → combat opens in the assign-strikes phase.
    expect(after.combat!.phase).toBe('assign-strikes');
  });
});
