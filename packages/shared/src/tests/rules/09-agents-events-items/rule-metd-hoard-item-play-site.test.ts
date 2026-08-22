/**
 * @module rule-metd-hoard-item-play-site
 *
 * METD §3 — Hoard items may only be played at a site that contains a
 * hoard. Every Dragon's lair contains a hoard. Enforcement comes from
 * the generic `item-play-site` effect's `filter` form
 * (`{ "filter": { "site.hoard": true } }`), evaluated against the
 * current site definition.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId, NotPlayableAction } from '../../../index.js';
import { computeLegalActions } from '../../../index.js';
import {
  actionAs,
  buildSitePhaseState,
  resetMint,
  viableActions,
  PLAYER_1, RESOURCE_PLAYER,
  BILBO,
  MORIA,
  handCardId,
} from '../../test-helpers.js';

const ADAMANT_HELMET = 'td-96' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId; // Smaug's lair, hoard=true
const ENRUNED_SHIELD = 'td-114' as CardDefinitionId; // greater, hoard
const OVIR_HOLLOW = 'td-179' as CardDefinitionId; // hoard site; playableResources: minor, major only

describe('METD §3 — Hoard item play-site gating', () => {
  beforeEach(() => resetMint());

  test('hoard item is NOT playable at a non-hoard site', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [BILBO],
      hand: [ADAMANT_HELMET],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
    const handInst = handCardId(state, RESOURCE_PLAYER);
    const tooltip = computeLegalActions(state, PLAYER_1).find(
      ea => !ea.viable
        && ea.action.type === 'not-playable'
        && actionAs<NotPlayableAction>(ea.action).cardInstanceId === handInst,
    );
    expect(tooltip).toBeDefined();
  });

  test('hoard item IS playable at a site with hoard=true', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [BILBO],
      hand: [ADAMANT_HELMET],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('greater hoard item is NOT playable at a hoard site whose playableResources excludes greater', () => {
    // Ovir Hollow contains a hoard (Dragon automatic-attack) but its printed
    // playableResources is only minor/major — the "hoard" keyword adds the
    // hoard-site requirement, it doesn't waive the site's own tier gate.
    const state = buildSitePhaseState({
      site: OVIR_HOLLOW,
      characters: [BILBO],
      hand: [ENRUNED_SHIELD],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
    const handInst = handCardId(state, RESOURCE_PLAYER);
    const tooltip = computeLegalActions(state, PLAYER_1).find(
      ea => !ea.viable
        && ea.action.type === 'not-playable'
        && actionAs<NotPlayableAction>(ea.action).cardInstanceId === handInst,
    );
    expect(tooltip).toBeDefined();
  });

  test('greater hoard item IS playable at a hoard site whose playableResources includes greater', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN, // playableResources: minor, major, greater, gold-ring
      characters: [BILBO],
      hand: [ENRUNED_SHIELD],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });
});
