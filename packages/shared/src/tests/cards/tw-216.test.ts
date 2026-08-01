/**
 * @module tw-216.test
 *
 * Card test: Dwarven Ring of Durin's Tribe (tw-216)
 * Type: hero-resource-item (special), unique
 *
 * "Unique. Dwarven Ring. Playable only with a gold ring and after a test
 *  indicates a Dwarven Ring. Values in parentheses and brackets apply to a
 *  Dwarf bearer. Tap a Dwarf bearer to untap the site he is currently at.
 *  Bearer makes a corruption check modified by +2."
 *
 * Printed attributes (data/cards.json TW-216): corruption 3(5), marshalling
 * points 4(6), prowess +2(4), direct influence +2(7) — the bracketed value
 * applying to a Dwarf bearer, matching the same "values in parentheses apply
 * to a Dwarf bearer" pattern already certified on Durin's Axe (tw-212).
 *
 * Engine Support:
 * | # | Rule                                              | Status      | Notes                                            |
 * |---|----------------------------------------------------|-------------|---------------------------------------------------|
 * | 1 | +2 prowess (Dwarf bearer +4)                       | IMPLEMENTED | stat-modifier, id/overrides, when bearer.race dwarf |
 * | 2 | +2 direct influence (Dwarf bearer +7)               | IMPLEMENTED | stat-modifier, id/overrides, when bearer.race dwarf |
 * | 3 | 3 corruption points (Dwarf bearer 5)                | IMPLEMENTED | stat-modifier corruption-points +2 when dwarf      |
 * | 4 | 4 marshalling points (Dwarf bearer 6)                | IMPLEMENTED | mp-modifier +2 when bearer.race dwarf              |
 * | 5 | Tap a Dwarf bearer to untap his company's site       | IMPLEMENTED | grant-action untap-site, cost tap:bearer           |
 * | 6 | Bearer then makes a corruption check modified by +2 | IMPLEMENTED | sequence [untap-site, enqueue-corruption-check +2] |
 *
 * Characters used:
 *   GIMLI   (tw-159): dwarf,   prowess 5, body 8
 *   ARAGORN (tw-120): dunadan, prowess 6, body 9
 *
 * Site used: MORIA (hero site) — home dark-hold used elsewhere for hero item tests.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, GIMLI, LEGOLAS,
  MORIA, LORIEN, MINAS_TIRITH,
  pool,
  getCharacter, findCharInstanceId,
  attachItemToChar, viableActions, dispatch, grantedActionsFor,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type { CardDefinitionId, CharacterCard } from '../../index.js';
import type { ActivateGrantedAction } from '../../types/actions-organization.js';

const DWARVEN_RING = 'tw-216' as CardDefinitionId;

/** Build an organization-phase state with `bearer` holding the ring at Moria. */
function stateWithRing(bearer: CardDefinitionId) {
  return recomputeDerived(buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: bearer, items: [DWARVEN_RING] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  }));
}

describe("Dwarven Ring of Durin's Tribe (tw-216)", () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Prowess +2 base, +4 for a Dwarf bearer ─────────────────────────

  test('non-dwarf bearer gets +2 prowess', () => {
    const aragornDef = pool[ARAGORN as string] as CharacterCard;
    expect(aragornDef.race).not.toBe('dwarf');
    const state = stateWithRing(ARAGORN);
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(aragornDef.prowess + 2);
  });

  test('dwarf bearer gets +4 prowess', () => {
    const gimliDef = pool[GIMLI as string] as CharacterCard;
    expect(gimliDef.race).toBe('dwarf');
    const state = stateWithRing(GIMLI);
    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.prowess).toBe(gimliDef.prowess + 4);
  });

  // ── Rule 2: Direct influence +2 base, +7 for a Dwarf bearer ────────────────

  test('non-dwarf bearer gets +2 direct influence', () => {
    const aragornDef = pool[ARAGORN as string] as CharacterCard;
    const state = stateWithRing(ARAGORN);
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.directInfluence).toBe(aragornDef.directInfluence + 2);
  });

  test('dwarf bearer gets +7 direct influence', () => {
    const gimliDef = pool[GIMLI as string] as CharacterCard;
    const state = stateWithRing(GIMLI);
    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.directInfluence).toBe(gimliDef.directInfluence + 7);
  });

  // ── Rule 3: Corruption points 3 base, 5 for a Dwarf bearer ─────────────────

  test('non-dwarf bearer has 3 corruption points from the ring', () => {
    const state = stateWithRing(ARAGORN);
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints).toBe(3);
  });

  test('dwarf bearer has 5 corruption points from the ring', () => {
    const state = stateWithRing(GIMLI);
    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.corruptionPoints).toBe(5);
  });

  // ── Rule 4: Marshalling points 4 base, 6 for a Dwarf bearer ────────────────

  test('non-dwarf bearer: item counts for 4 marshalling points', () => {
    const state = stateWithRing(ARAGORN);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(4);
  });

  test('dwarf bearer: item counts for 6 marshalling points', () => {
    const state = stateWithRing(GIMLI);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(6);
  });

  // ── Rules 5 & 6: Tap a Dwarf bearer to untap his site + corruption check ──

  function orgStateWith(bearer: CardDefinitionId) {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [bearer] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, bearer, DWARVEN_RING);
    (withRing.players[RESOURCE_PLAYER].companies[0].currentSite as { status: CardStatus }).status = CardStatus.Tapped;
    return withRing;
  }

  test('untap-site is NOT offered when bearer is not a Dwarf', () => {
    const state = orgStateWith(ARAGORN);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    expect(grantedActionsFor(state, aragornId, 'untap-site', PLAYER_1)).toHaveLength(0);
  });

  test('untap-site is NOT offered when the site is untapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GIMLI, DWARVEN_RING);
    const gimliId = findCharInstanceId(withRing, RESOURCE_PLAYER, GIMLI);
    expect(grantedActionsFor(withRing, gimliId, 'untap-site', PLAYER_1)).toHaveLength(0);
  });

  test('untap-site IS offered for a Dwarf bearer at a tapped site', () => {
    const state = orgStateWith(GIMLI);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    expect(grantedActionsFor(state, gimliId, 'untap-site', PLAYER_1)).toHaveLength(1);
  });

  test('activating untap-site taps the bearer, untaps the site, and enqueues a +2 corruption check', () => {
    const state = orgStateWith(GIMLI);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const action = grantedActionsFor(state, gimliId, 'untap-site', PLAYER_1)[0];
    expect(action).toBeDefined();

    const after = dispatch(state, action as ActivateGrantedAction);

    // Bearer is tapped (the cost).
    expect(getCharacter(after, RESOURCE_PLAYER, GIMLI).status).toBe(CardStatus.Tapped);
    // The company's site is untapped.
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
    // A +2 corruption check is pending for the bearer.
    const cc = after.pendingResolutions.find(r => r.kind.type === 'corruption-check');
    expect(cc).toBeDefined();
    if (cc && cc.kind.type === 'corruption-check') {
      expect(cc.kind.characterId).toBe(gimliId);
      expect(cc.kind.modifier).toBe(2);
    }
  });

  // ── Playability ─────────────────────────────────────────────────────────

  test('cannot be played as an ordinary item at a site (special subtype, gold-ring only)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [GIMLI],
      hand: [DWARVEN_RING],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.filter(a => (a.action as { cardInstanceId?: string }).cardInstanceId
      === state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === DWARVEN_RING)?.instanceId)).toHaveLength(0);
  });
});
