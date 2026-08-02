/**
 * @module td-30.test
 *
 * Card test: Hobgoblins (td-30)
 * Type: hazard-creature, non-unique, Orc
 *
 * Text: "Orcs. Two strikes." Base stats: 2 strikes, prowess 10, no body,
 * kill MP 1. No restriction on which company it may be played against.
 *
 * Canonical cost (`data/cards.json` TD-30 attributes.playable): {w}{w} — TWO
 * wildernesses in the path (region-type keying, no named regions or site
 * types).
 *
 * | # | Rule                                  | Status | Encoding                                     |
 * |---|----------------------------------------|--------|-----------------------------------------------|
 * | 1 | Two strikes at prowess 10, no body     | OK     | base stats — combat                           |
 * | 2 | Keyed to {w}{w} (two wildernesses)      | OK     | keyedTo regionTypes [wilderness, wilderness]  |
 *
 * Playable: YES. Pure composition of the shared region-type keying
 * primitive (ba-10 precedent) with plain creature combat — no new engine
 * work needed.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, MORIA, MINAS_TIRITH, RIVENDELL,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType, computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const HOBGOBLINS = 'td-30' as CardDefinitionId;
const MIONID = 'as-3' as CardDefinitionId; // minion-character (Man)

function readyState(phaseState: GameState['phaseState']): GameState {
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
        hand: [HOBGOBLINS],
        siteDeck: [RIVENDELL],
      },
    ],
  });
  return { ...state, phaseState };
}

describe('Hobgoblins (td-30)', () => {
  beforeEach(() => resetMint());

  // ─── Creature combat: 2 strikes at prowess 10, no body ────────────────────

  test('combat initiates with 2 strikes at prowess 10, no body, keyed via {w}{w}', () => {
    const ready = readyState(makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Heart of Mirkwood', 'Anórien'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Some Lair',
    }));

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

  test('keyable when the path has two wildernesses', () => {
    const ready = readyState(makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Heart of Mirkwood', 'Anórien'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Some Lair',
    }));

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Wilderness;
    })).toBe(true);
  });

  test('NOT keyable when the path has only one wilderness ({w}{w} unmet)', () => {
    const ready = readyState(makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Border],
      resolvedSitePathNames: ['Heart of Mirkwood', 'Enedhwaith'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Some Hold',
    }));

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  // ─── No target-company restriction: playable against a hero company too ───

  test('also playable against a hero (Wizard) company when keyed', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [HOBGOBLINS],
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

    expect(viableActions(ready, PLAYER_2, 'play-hazard').length).toBeGreaterThan(0);
  });
});
