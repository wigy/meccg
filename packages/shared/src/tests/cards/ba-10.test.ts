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
 * | 5 | Alternatively playable as a short-event vs a     | OK              | creature-alt-event (mode short-event, target a      |
 * |   | moving hero company → return to site of origin  |                 | moving hero company) + company-return-to-origin     |
 *
 * Playable: YES. The creature mode (keying + minion-company restriction +
 * combat) and the short-event mode are both implemented. The short-event uses
 * the generic dual-mode primitive: a `creature-alt-event` (mode `short-event`,
 * `requiresMovingCompany`, `targetCompany` hero) makes the card playable as a
 * short-event against a *moving hero* company, and a `company-return-to-origin`
 * effect (with the `unless` Beorn / untapped-warrior-prowess>4 exception)
 * forces that company back to its site of origin via the shared rule-2.IV.4
 * mechanism (`returnedToOrigin` + a `site-phase-do-nothing` constraint). The
 * `play-flag: playable-as-event` is retained only for the deck-construction
 * ½-creature weighting.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FRODO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions, dispatch, resolveChain,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType, CardStatus,
  computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const BEORN = 'tw-126' as CardDefinitionId; // hero warrior, prowess 7

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

  // ─── Short-event mode: vs a MOVING HERO company → return to origin ──────────

  test('offered as a short-event against a moving hero company (not as a creature)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [FRODO], destinationSite: MINAS_TIRITH }],
          hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [BEORNING_SKINCHANGERS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready: GameState = { ...state, phaseState: makeMHState({ destinationSiteName: 'Minas Tirith' }) };
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    // The short-event mode is offered; the creature mode is not (hero company).
    expect(plays.some(p => (p.action as { altEventMode?: string }).altEventMode === 'short-event')).toBe(true);
    expect(plays.some(p => (p.action as { keyedBy?: unknown }).keyedBy)).toBe(false);
  });

  test('short-event forces a plain hero company back to its site of origin', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [FRODO], destinationSite: MINAS_TIRITH }],
          hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [BEORNING_SKINCHANGERS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready: GameState = { ...state, phaseState: makeMHState({ destinationSiteName: 'Minas Tirith' }) };
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterPlay = dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: cardId,
      targetCompanyId: companyId, altEventMode: 'short-event',
    });
    const afterChain = resolveChain(afterPlay);
    // Frodo is a scout/diplomat (prowess 1), not a warrior, and not Beorn →
    // the company must return to its site of origin.
    expect((afterChain.phaseState as { returnedToOrigin?: boolean }).returnedToOrigin).toBe(true);
  });

  test('does NOT return when the company has an untapped warrior with prowess > 4', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard,
          // Aragorn II is an untapped warrior with prowess 6 (> 4).
          companies: [{ site: MORIA, characters: [FRODO, ARAGORN], destinationSite: MINAS_TIRITH }],
          hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [BEORNING_SKINCHANGERS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready: GameState = { ...state, phaseState: makeMHState({ destinationSiteName: 'Minas Tirith' }) };
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: cardId,
      targetCompanyId: companyId, altEventMode: 'short-event',
    }));
    expect((afterChain.phaseState as { returnedToOrigin?: boolean }).returnedToOrigin).toBeFalsy();
  });

  test('does NOT return when the company contains Beorn (even tapped, isolating the name clause)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard,
          // Beorn is tapped, so the "untapped warrior prowess > 4" clause does
          // NOT fire — only the "contains Beorn" name clause can prevent return.
          companies: [{ site: MORIA, characters: [FRODO, { defId: BEORN, status: CardStatus.Tapped }], destinationSite: MINAS_TIRITH }],
          hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [BEORNING_SKINCHANGERS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready: GameState = { ...state, phaseState: makeMHState({ destinationSiteName: 'Minas Tirith' }) };
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: cardId,
      targetCompanyId: companyId, altEventMode: 'short-event',
    }));
    expect((afterChain.phaseState as { returnedToOrigin?: boolean }).returnedToOrigin).toBeFalsy();
  });
});
