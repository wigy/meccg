/**
 * @module rule-5.20-creature-keying-equivalence
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.20: Creature Keying Equivalence
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A creature "played on" a site is the same as being "keyed to" the site. A creature "played at a site in" a region is the same as being "keyed to" the site by name.
 * Attacks or strikes keyed to a region's/site's name are not affected by effects that only refer to attacks keyed to a region's/site's type, and vice versa.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeMHState, viableActions, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN,
} from '../../test-helpers.js';
import { SiteType } from '../../../types/common.js';
import type { CardDefinitionId } from '../../test-helpers.js';
import type { PlayHazardAction } from '../../../index.js';

// Watcher in the Water (tw-110): text says "May also be played at Moria" —
// modeled with a `siteNames: ['Moria']` keying entry (plus unrelated
// region-type entries not exercised below). This is the concrete evidence
// that "played on a site" and "keyed to" a site by name are the same
// mechanism: one data field drives both phrasings.
const WATCHER_IN_THE_WATER = 'tw-110' as CardDefinitionId;
// Bûthrakaur the Green (dm-105): keyed only to siteTypes: ['shadow-hold'] —
// no site-name entry at all.
const BUTHRAKAUR = 'dm-105' as CardDefinitionId;

describe('Rule 5.20 — Creature Keying Equivalence', () => {
  beforeEach(() => resetMint());

  test('A creature keyed to a site name is playable there ("played at Moria" = "keyed to" Moria by name)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WATCHER_IN_THE_WATER], siteDeck: [] },
      ],
    });
    // No region path at all — only the siteNames:['Moria'] key can match.
    const gameState = { ...state, phaseState: makeMHState({ resolvedSitePath: [], resolvedSitePathNames: [], destinationSiteType: SiteType.ShadowHold, destinationSiteName: 'Moria' }) };

    expect(viableActions(gameState, PLAYER_2, 'play-hazard').length).toBeGreaterThan(0);
  });

  test('Site-name keying and site-type keying are independent: name-keyed creature fails at a same-type site with a different name, but type-keyed creature still succeeds', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WATCHER_IN_THE_WATER, BUTHRAKAUR], siteDeck: [] },
      ],
    });
    // Goblin-gate is also a shadow-hold (same type as Moria) but is not named
    // "Moria" — and there is still no region path.
    const gameState = {
      ...state,
      phaseState: makeMHState({ resolvedSitePath: [], resolvedSitePathNames: [], destinationSiteType: SiteType.ShadowHold, destinationSiteName: 'Goblin-gate' }),
    };

    const watcherInstId = gameState.players[1].hand.find(c => c.definitionId === WATCHER_IN_THE_WATER)!.instanceId;
    const buthrakaurInstId = gameState.players[1].hand.find(c => c.definitionId === BUTHRAKAUR)!.instanceId;
    const plays = viableActions(gameState, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];

    // Watcher (siteNames: ['Moria']) no longer matches — the name changed.
    expect(plays.some(a => a.action.cardInstanceId === watcherInstId)).toBe(false);
    // Bûthrakaur (siteTypes: ['shadow-hold']) still matches — the type didn't change.
    expect(plays.some(a => a.action.cardInstanceId === buthrakaurInstId)).toBe(true);
  });
});
