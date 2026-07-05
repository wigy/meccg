/**
 * @module ba-10.test
 *
 * Card test: Beorning Skin-changers (ba-10)
 * Type: hazard-creature (Animals / Men / Bears), non-unique
 *
 * Text:
 *   "Animals. Men. Bears. Two strikes. As a creature, playable only against
 *    minion companies. May also be keyed to Anduin Vales, Western Mirkwood,
 *    Wold & Foothills; and to sites in these regions. Alternatively, playable
 *    as a short-event against a moving hero company. Unless the company
 *    contains Beorn or an untapped warrior with prowess greater than 4, it
 *    must return to its site of origin."
 *
 * Canonical cost (`data/cards.json` BA-10 attributes.playable): {w}{w} — TWO
 * wildernesses in the path. Base stats: strikes 2, prowess 10, body — (no body
 * check), kill MP 1*.
 *
 * Effects / keying:
 * | # | Rule                                            | Status          | Encoding                                            |
 * |---|-------------------------------------------------|-----------------|-----------------------------------------------------|
 * | 1 | Two strikes at prowess 10, no body              | OK              | base stats — combat                                 |
 * | 2 | As a creature, playable only vs minion companies| OK              | play-condition target-company company.alignment=rw  |
 * | 3 | Keyed to {w}{w} (two wildernesses)              | OK              | keyedTo regionTypes [wilderness, wilderness]        |
 * | 4 | Also keyed to Anduin Vales / W. Mirkwood /       | OK              | keyedTo regionNames (also matches sites in-region)  |
 * |   | Wold & Foothills; and to sites in these regions |                 |                                                     |
 * | 5 | Alternatively playable as a short-event vs a     | NOT IMPLEMENTED | play-flag playable-as-event is purely declarative;  |
 * |   | moving hero company → return to site of origin  |                 | no legal-action / reducer path for the event mode   |
 *
 * Playable: PARTIALLY — the creature mode (keying + minion-company restriction
 * + combat) is fully implemented and exercised below. The alternative
 * short-event mode (rule 5) is unimplemented engine-wide: `playable-as-event`
 * is consumed only by deck-validation's ½-creature weighting; there is no legal
 * action to play a dual-mode creature as a short-event, no reducer path, and no
 * "force the moving hero company back to its site of origin" event effect. This
 * card is therefore NOT CERTIFIED. When the short-event subsystem lands, add
 * coverage for the event mode and the Beorn / untapped-warrior-prowess>4 escape
 * clause, then certify.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType,
  computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const BEORNING_SKINCHANGERS = 'ba-10' as CardDefinitionId;
const MIONID = 'as-3' as CardDefinitionId; // minion-character (Man)

const NAMED_REGIONS = ['Anduin Vales', 'Western Mirkwood', 'Wold & Foothills'] as const;

describe('Beorning Skin-changers (ba-10)', () => {
  beforeEach(() => resetMint());

  // ─── Creature combat: 2 strikes at prowess 10, no body, vs a minion company ─

  test('combat initiates with 2 strikes at prowess 10, no body, keyed via {w}{w}', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA, characters: [MIONID] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [BEORNING_SKINCHANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
        resolvedSitePathNames: ['Heart of Mirkwood', 'Anórien'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Some Lair',
      }),
    };

    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, creatureId, companyId,
      { method: 'region-type' as const, value: RegionType.Wilderness },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(10);
    expect(afterChain.combat!.creatureBody).toBe(null);
  });

  // ─── Keying: {w}{w} needs TWO wildernesses ────────────────────────────────

  test('keyable vs a minion company when the path has two wildernesses', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA, characters: [MIONID] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [BEORNING_SKINCHANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
        resolvedSitePathNames: ['Heart of Mirkwood', 'Anórien'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Some Lair',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Wilderness;
    })).toBe(true);
  });

  test('NOT keyable when the path has only one wilderness ({w}{w} unmet)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA, characters: [MIONID] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [BEORNING_SKINCHANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Border],
        resolvedSitePathNames: ['Heart of Mirkwood', 'Anduin Vales'],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Some Hold',
      }),
    };

    // Region-type keying fails (need two wildernesses); "Anduin Vales" IS a
    // named-region key, so isolate the {w}{w} failure by not using a named region.
    const readyNoNamed: GameState = {
      ...ready,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Border],
        resolvedSitePathNames: ['Heart of Mirkwood', 'Enedhwaith'],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Some Hold',
      }),
    };

    expect(viableActions(readyNoNamed, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const all = computeLegalActions(readyNoNamed, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  // ─── Keying: named regions (also covers "sites in these regions") ─────────

  test.each(NAMED_REGIONS)('keyable vs a minion company when the path is in %s', (region) => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA, characters: [MIONID] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [BEORNING_SKINCHANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    // Single border region carrying the named region — isolates region-name
    // keying from the {w}{w} region-type key.
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: [region],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Some Hold',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === region;
    })).toBe(true);
  });

  // ─── "Playable only against minion companies" — rejected vs a hero company ─

  test('NOT playable against a hero (Wizard) company even when keyed', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN, GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [BEORNING_SKINCHANGERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    // Two-wilderness path: keying succeeds, so only the target-company
    // (minion-only) restriction can make the play non-viable.
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
        resolvedSitePathNames: ['Heart of Mirkwood', 'Anórien'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Some Lair',
      }),
    };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all.some(ea => /Cannot be played against this company/.test(ea.reason ?? ''))).toBe(true);
  });
});
