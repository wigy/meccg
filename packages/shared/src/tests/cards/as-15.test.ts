/**
 * @module as-15.test
 *
 * Card test: Lord of the Haven (as-15)
 * Type: hazard-creature (dual creature/short-event). Unique. Elf.
 * Manifestation of Círdan (tw-137, via `manifestId`).
 * Base creature stats: one strike, prowess 13, body 9, kill MP 3*.
 *
 * Card text:
 *   "Unique. Elf. Manifestation of Círdan. One strike. Detainment against
 *    hero companies. As a creature, may be played keyed to Lindon or any
 *    Coastal Sea [{c}] region; or at sites in these regions. As a
 *    short-event, tap up to two target characters in one company at a site
 *    in, or moving through, a Coastal Sea [{c}] region."
 *
 * Canonical cost (`data/cards.json` AS-15): no `playable` string — keying is
 * entirely the text clause.
 *
 * Rule coverage:
 * | # | Rule                                                        | Status      |
 * |---|-------------------------------------------------------------|-------------|
 * | 1 | One strike / prowess 13 / body 9 creature combat            | IMPLEMENTED |
 * | 2 | Detainment against hero companies (not minion)              | IMPLEMENTED |
 * | 3 | Keyed to Lindon (region name) or any Coastal Sea (type)     | IMPLEMENTED |
 * | 4 | … or at sites in these regions (stationary company)         | IMPLEMENTED |
 * | 5 | Short-event: tap 1–2 untapped characters in one company     | IMPLEMENTED |
 * | 6 | Short-event only vs a company at / moving through {c}       | IMPLEMENTED |
 * | 7 | Manifestation of Círdan — barred while Círdan is in play    | IMPLEMENTED |
 *
 * Effects: play-flag playable-as-event (½-creature deck weight),
 * creature-alt-event short-event gated on `company.regionTypes` including
 * coastal, tap-character `maxTargets: 2`, combat-detainment (hero / covert
 * fallen-wizard defenders). Keying: `regionNames` Lindon, `regionTypes`
 * coastal, `siteInRegionNames` Lindon + every Coastal Sea region.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_2,
  ARAGORN, GIMLI, FRODO,
  RIVENDELL, MINAS_TIRITH, EDHELLOND, TOLFALAS,
  resetMint, makeMHState,
  buildHazardCompanyMHState, viableHazardKeyings, viableAltShortEventPlays, hazardTargetCharacters,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, findCharInstanceId,
  viableActions, dispatch, resolveChain,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment, RegionType, SiteType, CardStatus, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState } from '../../index.js';

const LORD_OF_THE_HAVEN = 'as-15' as CardDefinitionId;
const CIRDAN = 'tw-137' as CardDefinitionId;
const MIONID = 'as-3' as CardDefinitionId;      // minion-character
const DOL_GULDUR = 'le-367' as CardDefinitionId; // minion haven
const HAND = [LORD_OF_THE_HAVEN];

/** Moving Edhellond → Tolfalas across the Bay of Belfalas (coastal). */
const COASTAL_PATH = makeMHState({
  resolvedSitePath: [RegionType.Coastal, RegionType.Coastal],
  resolvedSitePathNames: ['Bay of Belfalas', 'Mouths of the Anduin'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Tolfalas',
});

/** A wilderness path through Lindon (not a Coastal Sea). */
const LINDON_PATH = makeMHState({
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['Lindon'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Some Lair',
});

/** A wilderness path touching neither Lindon nor any Coastal Sea. */
const INLAND_PATH = makeMHState({
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['High Pass'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Goblin-gate',
});

/** A company staying put at Tolfalas (Mouths of the Anduin, a Coastal Sea). */
const AT_TOLFALAS = makeMHState({
  resolvedSitePath: [],
  resolvedSitePathNames: [],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Tolfalas',
});

describe('Lord of the Haven (as-15)', () => {
  beforeEach(() => resetMint());

  // ─── #3/#4: creature keying ───────────────────────────────────────────────

  test('keyable to Lindon by region name', () => {
    const ready = buildHazardCompanyMHState({
      site: RIVENDELL, destination: MINAS_TIRITH, characters: [ARAGORN], hazardHand: HAND, phaseState: LINDON_PATH,
    });
    expect(viableHazardKeyings(ready, PLAYER_2)).toContainEqual({ method: 'region-name', value: 'Lindon' });
  });

  test('keyable to any Coastal Sea region by region type', () => {
    const ready = buildHazardCompanyMHState({
      site: EDHELLOND, destination: TOLFALAS, characters: [ARAGORN], hazardHand: HAND, phaseState: COASTAL_PATH,
    });
    expect(viableHazardKeyings(ready, PLAYER_2)).toContainEqual({ method: 'region-type', value: RegionType.Coastal });
  });

  test('keyable at a site in a Coastal Sea region for a company that does not move', () => {
    const ready = buildHazardCompanyMHState({
      site: TOLFALAS, characters: [ARAGORN], hazardHand: HAND, phaseState: AT_TOLFALAS,
    });
    expect(viableHazardKeyings(ready, PLAYER_2)).toContainEqual({ method: 'site-in-region', value: 'Mouths of the Anduin' });
  });

  test('not keyable as a creature on a path away from Lindon and the coast', () => {
    const ready = buildHazardCompanyMHState({
      site: RIVENDELL, destination: MINAS_TIRITH, characters: [ARAGORN], hazardHand: HAND, phaseState: INLAND_PATH,
    });
    expect(viableHazardKeyings(ready, PLAYER_2)).toHaveLength(0);
  });

  // ─── #1/#2: combat, detainment vs hero only ───────────────────────────────

  test('attack on a hero company: 1 strike at prowess 13, body 9, detainment', () => {
    const ready = buildHazardCompanyMHState({
      site: EDHELLOND, destination: TOLFALAS, characters: [ARAGORN], hazardHand: HAND, phaseState: COASTAL_PATH,
    });
    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER),
      { method: 'region-type', value: RegionType.Coastal },
    );
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(13);
    expect(after.combat!.creatureBody).toBe(9);
    expect(after.combat!.detainment).toBe(true);
  });

  test('attack on a minion company: normal attack (no detainment)', () => {
    const ready = buildHazardCompanyMHState({
      alignment: Alignment.Ringwraith,
      site: DOL_GULDUR, destination: TOLFALAS, characters: [MIONID], hazardHand: HAND, phaseState: COASTAL_PATH,
    });
    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER),
      { method: 'region-type', value: RegionType.Coastal },
    );
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(13);
    expect(after.combat!.detainment).toBe(false);
  });

  // ─── #5/#6: short-event — tap up to two characters ────────────────────────

  test('short-event offers every set of one or two untapped characters in the company', () => {
    const ready = buildHazardCompanyMHState({
      site: EDHELLOND, destination: TOLFALAS, characters: [ARAGORN, GIMLI, FRODO], hazardHand: HAND, phaseState: COASTAL_PATH,
    });
    const plays = viableAltShortEventPlays(ready, PLAYER_2);
    // 3 singles + 3 pairs, never three.
    expect(plays).toHaveLength(6);
    expect(plays.filter(a => hazardTargetCharacters(a).length === 1)).toHaveLength(3);
    expect(plays.filter(a => hazardTargetCharacters(a).length === 2)).toHaveLength(3);
  });

  test('playing it as a short-event taps the two chosen characters only', () => {
    const ready = buildHazardCompanyMHState({
      site: EDHELLOND, destination: TOLFALAS, characters: [ARAGORN, GIMLI, FRODO], hazardHand: HAND, phaseState: COASTAL_PATH,
    });
    const aragorn = findCharInstanceId(ready, RESOURCE_PLAYER, ARAGORN);
    const gimli = findCharInstanceId(ready, RESOURCE_PLAYER, GIMLI);
    const frodo = findCharInstanceId(ready, RESOURCE_PLAYER, FRODO);
    const lordId = handCardId(ready, HAZARD_PLAYER);
    const play = viableAltShortEventPlays(ready, PLAYER_2).find(a => {
      const t = hazardTargetCharacters(a);
      return t.length === 2 && t.includes(aragorn) && t.includes(gimli);
    });
    expect(play).toBeDefined();

    const after = resolveChain(dispatch(ready, play!));
    expect(after.players[RESOURCE_PLAYER].characters[aragorn].status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].characters[gimli].status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].characters[frodo].status).toBe(CardStatus.Untapped);
    // Short-event: discarded, no combat, counts against the hazard limit.
    expect(after.combat).toBeNull();
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === lordId)).toBe(true);
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(1);
  });

  test('a single target may be chosen ("up to two")', () => {
    const ready = buildHazardCompanyMHState({
      site: EDHELLOND, destination: TOLFALAS, characters: [ARAGORN, GIMLI], hazardHand: HAND, phaseState: COASTAL_PATH,
    });
    const gimli = findCharInstanceId(ready, RESOURCE_PLAYER, GIMLI);
    const aragorn = findCharInstanceId(ready, RESOURCE_PLAYER, ARAGORN);
    const play = viableAltShortEventPlays(ready, PLAYER_2).find(a => {
      const t = hazardTargetCharacters(a);
      return t.length === 1 && t[0] === gimli;
    });
    expect(play).toBeDefined();
    const after = resolveChain(dispatch(ready, play!));
    expect(after.players[RESOURCE_PLAYER].characters[gimli].status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].characters[aragorn].status).toBe(CardStatus.Untapped);
  });

  test('already-tapped characters are not targets', () => {
    const ready = buildHazardCompanyMHState({
      site: EDHELLOND, destination: TOLFALAS, hazardHand: HAND, phaseState: COASTAL_PATH,
      characters: [ARAGORN, { defId: GIMLI, status: CardStatus.Tapped }],
    });
    const gimli = findCharInstanceId(ready, RESOURCE_PLAYER, GIMLI);
    const plays = viableAltShortEventPlays(ready, PLAYER_2);
    expect(plays).toHaveLength(1);
    expect(hazardTargetCharacters(plays[0])).not.toContain(gimli);
  });

  test('short-event not offered when every character in the company is tapped', () => {
    const ready = buildHazardCompanyMHState({
      site: EDHELLOND, destination: TOLFALAS, hazardHand: HAND, phaseState: COASTAL_PATH,
      characters: [{ defId: ARAGORN, status: CardStatus.Tapped }],
    });
    expect(viableAltShortEventPlays(ready, PLAYER_2)).toHaveLength(0);
  });

  test('short-event not offered against a company away from any Coastal Sea', () => {
    // Lindon is a valid creature keying but not a Coastal Sea for the short-event.
    const ready = buildHazardCompanyMHState({
      site: RIVENDELL, destination: MINAS_TIRITH, characters: [ARAGORN, GIMLI], hazardHand: HAND, phaseState: LINDON_PATH,
    });
    expect(viableAltShortEventPlays(ready, PLAYER_2)).toHaveLength(0);
    expect(viableHazardKeyings(ready, PLAYER_2).length).toBeGreaterThan(0);
  });

  test('short-event offered against a non-moving company at a site in a Coastal Sea region', () => {
    const ready = buildHazardCompanyMHState({
      site: TOLFALAS, characters: [ARAGORN, GIMLI], hazardHand: HAND, phaseState: AT_TOLFALAS,
    });
    expect(viableAltShortEventPlays(ready, PLAYER_2)).toHaveLength(3);
  });

  // ─── #7: Manifestation of Círdan ──────────────────────────────────────────

  test('cannot be played in either mode while Círdan is in play', () => {
    const ready = buildHazardCompanyMHState({
      site: EDHELLOND, destination: TOLFALAS, characters: [CIRDAN, ARAGORN], hazardHand: HAND, phaseState: COASTAL_PATH,
    });
    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const blocked = computeLegalActions(ready, PLAYER_2)
      .filter(ea => ea.action.type === 'play-hazard' && !ea.viable);
    expect(blocked.some(ea => /manifestation/i.test(ea.reason ?? ''))).toBe(true);
  });
});
