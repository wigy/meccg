/**
 * @module wh-52.test
 *
 * Card test: Liquid Fire (wh-52)
 * Type: minion-resource-item (subtype: Special Item; keyword: Technology)
 * Corruption: 1 · Marshalling points: 1 (item)
 *
 * Card text:
 *   "Technology. Playable at a tapped or untapped Shadow-hold [{S}],
 *    Dark-hold [{D}], or a site with a Dwarf automatic-attack. Discard
 *    to cause all strikes from all attacks of a non-Dragon, non-Nazgûl,
 *    non-Balrog creature keyed to a site to fail (resulting body checks
 *    for the creature are modified by -2)."
 *
 * | # | Rule                                               | Status |
 * |---|----------------------------------------------------|--------|
 * | 1 | playable at tapped/untapped S/D/Dwarf-attack site  | OK     |
 * | 2 | discard to fail all strikes of a creature's attack | not implemented |
 *
 * Playable: PARTIAL — only the `item-play-site` playability restriction is
 * certified here; the discard ability is not yet implemented.
 *
 * Bug fix: the card data previously shipped with an empty `effects` array
 * and no `Technology` keyword (unlike its siblings Blasting Fire (wh-51)
 * and Vile Fumes (wh-54), which carry the identical "tapped or untapped
 * Shadow-hold/Dark-hold/Dwarf automatic-attack" playability text). This
 * made the engine apply the default untapped-site gate, rejecting the card
 * at any tapped site even though its own text explicitly allows it. See
 * bug report on game ms9pnnov-9w3tty, stateSeq 217: Liquid Fire rejected
 * as "site is already tapped" at The Under-courts (as-163, a dark-hold).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER, resetMint, buildMinionSitePhaseState, CardStatus,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const LIQUID_FIRE = 'wh-52' as CardDefinitionId;

// Minion sites
const MORIA = 'le-392' as CardDefinitionId;      // shadow-hold (Orcs auto-attack)
const BARAD_DUR = 'le-352' as CardDefinitionId;  // dark-hold (no auto-attack)
const DALE = 'le-363' as CardDefinitionId;       // border-hold (Men auto-attack, no Dwarf)

// Minion characters (orcs)
const GORBAG = 'le-11' as CardDefinitionId;

// Synthetic minion border-hold whose automatic-attack is by Dwarves — no
// real site in the pool has a Dwarf automatic-attack, so we inject one to
// exercise the `site.autoAttackRaces $includes "dwarf"` playability branch.
const DWARF_HOLD = 'test-dwarf-hold' as CardDefinitionId;
const DWARF_HOLD_DEF = {
  cardType: 'minion-site',
  alignment: 'ringwraith',
  id: DWARF_HOLD,
  name: 'Test Dwarf Hold',
  image: '',
  siteType: 'border-hold',
  sitePath: ['border'],
  nearestHaven: 'Carn Dûm',
  region: 'Test',
  playableResources: ['minor'],
  automaticAttacks: [{ creatureType: 'Dwarves', strikes: 2, prowess: 6 }],
  resourceDraws: 1,
  hazardDraws: 1,
};

describe('Liquid Fire (wh-52)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playability ────────────────────────────────────────────────────

  test('playable at an untapped Shadow-hold', () => {
    const state = buildMinionSitePhaseState({ site: MORIA, characters: [GORBAG], hand: [LIQUID_FIRE] });
    const id = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === LIQUID_FIRE)!.instanceId;
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-hero-resource'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(1);
  });

  test('playable at a Dark-hold', () => {
    const state = buildMinionSitePhaseState({ site: BARAD_DUR, characters: [GORBAG], hand: [LIQUID_FIRE] });
    const id = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === LIQUID_FIRE)!.instanceId;
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-hero-resource'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(1);
  });

  test('playable even when the Dark-hold is already tapped (bug: was rejected as "site is already tapped")', () => {
    const state = buildMinionSitePhaseState({
      site: BARAD_DUR, characters: [GORBAG], hand: [LIQUID_FIRE], siteStatus: CardStatus.Tapped,
    });
    const id = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === LIQUID_FIRE)!.instanceId;
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-hero-resource'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(1);
  });

  test('playable at a site with a Dwarf automatic-attack', () => {
    const built = buildMinionSitePhaseState({ site: DWARF_HOLD, characters: [GORBAG], hand: [LIQUID_FIRE] });
    // Inject the synthetic Dwarf-attack site definition into the pool.
    const state = { ...built, cardPool: { ...built.cardPool, [DWARF_HOLD as string]: DWARF_HOLD_DEF } } as GameState;
    const id = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === LIQUID_FIRE)!.instanceId;
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-hero-resource'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(1);
  });

  test('NOT playable at a plain Border-hold (no Dwarf automatic-attack)', () => {
    const state = buildMinionSitePhaseState({ site: DALE, characters: [GORBAG], hand: [LIQUID_FIRE] });
    const id = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === LIQUID_FIRE)!.instanceId;
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-hero-resource'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(0);
  });

  // ── Rule 2: discard ability ─────────────────────────────────────────────────

  test.todo('discard to fail all strikes of a non-Dragon/Nazgûl/Balrog creature keyed to a site (-2 body check)');
});
