/**
 * @module tw-363.test
 *
 * Card test: Wizard's Ring (tw-363)
 * Type: hero-resource-item (special, ring)
 *
 * Printed text:
 *   "Wizard only. Playable only at a Haven [{H}]. Cannot be stored, stolen,
 *    or transferred. Cannot be duplicated on a given Wizard. Bearer makes a
 *    corruption check when this item is played."
 *
 * Effects (data):
 *   1. item-play-site — playable only at a Haven (siteType filter)
 *   2. play-target (character) — bearer must be a Wizard
 *   3. duplication-limit (character, max 1) — cannot be duplicated on a
 *      given Wizard
 *   4. stat-modifier (direct-influence, +5) — per the authoritative card
 *      database's `directInfluence: "+5"` attribute, not stated in the
 *      printed text
 *
 * Regression: a Wizardhaven's `playableResources` list is printed empty
 * (Havens allow items only via each item's own site restriction), so
 * without an `item-play-site` effect the card was rejected everywhere,
 * including at a Haven with an untapped Wizard — reported for Lórien with
 * an untapped Gandalf.
 */

import { describe, test, expect } from 'vitest';
import {
  PLAYER_1,
  GANDALF, ARAGORN,
  LORIEN, MORIA,
  buildSitePhaseState,
  viableActions,
  charIdAt,
  getCharacter,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const WIZARDS_RING = 'tw-363' as CardDefinitionId;

describe('Wizard’s Ring (tw-363)', () => {
  // ─── Rule 1: Haven site restriction ─────────────────────────────────────

  test('playable at a Haven (Lórien) with an untapped Wizard', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [GANDALF],
      hand: [WIZARDS_RING],
    });

    const gandalfId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onGandalf = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === gandalfId,
    );
    expect(onGandalf).toBeDefined();
  });

  test('NOT playable at a non-Haven (Moria)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [GANDALF],
      hand: [WIZARDS_RING],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Rule 2: "Wizard only" bearer restriction ───────────────────────────

  test('NOT playable on a non-Wizard (Aragorn)', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [ARAGORN],
      hand: [WIZARDS_RING],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('mixed company: only offered on the Wizard, not the non-Wizard', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [GANDALF, ARAGORN],
      hand: [WIZARDS_RING],
    });
    const gandalfId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 1);

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const bearerIds = plays
      .filter(ea => ea.action.type === 'play-hero-resource')
      .map(ea => (ea.action as { attachToCharacterId: string }).attachToCharacterId);

    expect(bearerIds).toContain(gandalfId);
    expect(bearerIds).not.toContain(aragornId);
  });

  // ─── Rule 3: Duplication limit (one copy per Wizard) ────────────────────

  test('second copy NOT playable on the same Wizard already bearing one', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [{ defId: GANDALF, items: [WIZARDS_RING] }],
      hand: [WIZARDS_RING],
    });

    const gandalfId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onGandalf = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === gandalfId,
    );
    expect(onGandalf).toBeUndefined();
  });

  // ─── Rule 4: +5 direct influence ─────────────────────────────────────────

  test('bearer gets +5 direct influence', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [{ defId: GANDALF, items: [WIZARDS_RING] }],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, GANDALF).effectiveStats.directInfluence).toBe(15); // base 10 + 5
  });
});
