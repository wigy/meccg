/**
 * @module td-49.test
 *
 * Card test: Morgul-rats (td-49)
 * Type: hazard-creature (Animal)
 *
 * Text:
 *   "Animals. 15 strikes. Only playable at a Shadow-hold [{S}] or at a
 *    Dark-hold [{D}], and only if a character in target company is wounded
 *    or Doors of Night is in play."
 *
 * Base stats: strikes 15, prowess 2, body 5, kill MP 1, race Animal,
 * non-unique. No `attributes.playable` token on record for this card in
 * data/cards.json — the {S}/{D} keying cost is text-only.
 *
 * keyedTo: a single `siteTypes: ["shadow-hold", "dark-hold"]` entry (either
 * site type satisfies the base cost).
 *
 * Effects: one `play-condition` `requires: "target-company"` gate —
 * `{ "$or": [{ "company.hasWoundedCharacter": true }, { "inPlay": "Doors of
 * Night" }] }` — evaluated via `buildTargetCompanyConditionContext` (le-78
 * Horse-lords precedent), extended here with the new `company.
 * hasWoundedCharacter` field (true when any character in the target company
 * has status Inverted) and top-level `inPlay` (names of cards in play).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint, setCharStatus,
  makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  computeLegalActions, Phase, SiteType, CardStatus,
} from '../../index.js';
import type { CardDefinitionId, CardInPlay, GameState } from '../../index.js';

const MORGUL_RATS = 'td-49' as CardDefinitionId;

const SITE_TYPE_KEYING = (siteType: SiteType) => ({ method: 'site-type' as const, value: siteType });

function shadowHoldMHState() {
  return makeMHState({
    resolvedSitePath: [],
    resolvedSitePathNames: [],
    destinationSiteType: SiteType.ShadowHold,
    destinationSiteName: 'Minas Morgul',
  });
}

function darkHoldMHState() {
  return makeMHState({
    resolvedSitePath: [],
    resolvedSitePathNames: [],
    destinationSiteType: SiteType.DarkHold,
    destinationSiteName: 'Dol Guldur',
  });
}

function freeHoldMHState() {
  return makeMHState({
    resolvedSitePath: [],
    resolvedSitePathNames: [],
    destinationSiteType: SiteType.FreeHold,
    destinationSiteName: "Eagles' Eyrie",
  });
}

function donInPlay(): CardInPlay {
  return {
    instanceId: 'don-1' as import('../../index.js').CardInstanceId,
    definitionId: DOORS_OF_NIGHT,
    status: CardStatus.Untapped,
  };
}

function baseState(cardsInPlay?: CardInPlay[]) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [MORGUL_RATS],
        siteDeck: [RIVENDELL],
        cardsInPlay: cardsInPlay ?? [],
      },
    ],
  });
}

describe('Morgul-rats (td-49)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats ─────────────────────────────────────────────────────────

  test('attack uses 15 strikes at prowess 2 with body 5, animal race', () => {
    const wounded = setCharStatus(baseState(), RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
    const ready: GameState = { ...wounded, phaseState: shadowHoldMHState() };
    const ratsId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, ratsId, companyId, SITE_TYPE_KEYING(SiteType.ShadowHold),
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(15);
    expect(after.combat!.strikeProwess).toBe(2);
    expect(after.combat!.creatureRace).toBe('animal');
    expect(after.combat!.creatureBody).toBe(5);
  });

  // ─── Keying: Shadow-hold or Dark-hold only ─────────────────────────────

  test('playable at a Shadow-hold when a character in target company is wounded', () => {
    const wounded = setCharStatus(baseState(), RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
    const ready: GameState = { ...wounded, phaseState: shadowHoldMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-type' && a.keyedBy?.value === SiteType.ShadowHold;
    })).toBe(true);
  });

  test('playable at a Dark-hold when a character in target company is wounded', () => {
    const wounded = setCharStatus(baseState(), RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
    const ready: GameState = { ...wounded, phaseState: darkHoldMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-type' && a.keyedBy?.value === SiteType.DarkHold;
    })).toBe(true);
  });

  test('NOT playable at a Free-hold even with a wounded company member', () => {
    const wounded = setCharStatus(baseState(), RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
    const ready: GameState = { ...wounded, phaseState: freeHoldMHState() };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/not keyable/i);
  });

  // ─── Play-condition: wounded character or Doors of Night ──────────────

  test('NOT playable at a Shadow-hold with no wounded character and no Doors of Night', () => {
    const ready: GameState = { ...baseState(), phaseState: shadowHoldMHState() };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/cannot be played against this company/i);
  });

  test('playable at a Shadow-hold with no wounded character when Doors of Night is in play', () => {
    const ready: GameState = { ...baseState([donInPlay()]), phaseState: shadowHoldMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-type' && a.keyedBy?.value === SiteType.ShadowHold;
    })).toBe(true);
  });

  test('NOT playable at a Dark-hold with no wounded character and no Doors of Night', () => {
    const ready: GameState = { ...baseState(), phaseState: darkHoldMHState() };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('combat still resolves at 15 strikes / prowess 2 when keyed via Doors of Night', () => {
    const ready: GameState = { ...baseState([donInPlay()]), phaseState: shadowHoldMHState() };
    const ratsId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, ratsId, companyId, SITE_TYPE_KEYING(SiteType.ShadowHold),
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(15);
    expect(after.combat!.strikeProwess).toBe(2);
  });
});
