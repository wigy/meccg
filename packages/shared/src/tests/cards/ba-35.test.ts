/**
 * @module ba-35.test
 *
 * Card test: Cave Troll (ba-35)
 * Type: minion-resource-ally, alignment ringwraith, non-unique.
 * Marshalling Points: 1 (ally). Prowess 4 / Body 8.
 *
 * Card text: "Playable at a tapped or untapped Under-deeps site with a Troll
 * automatic-attack. Its controlling character's company is overt. +1 to rolls
 * required for its controller's company to move to adjacent Under-deeps sites."
 *
 * Rule coverage:
 *
 * | # | Rule                                                          | Mechanism                                                        |
 * |---|---------------------------------------------------------------|------------------------------------------------------------------|
 * | 1 | Playable at an Under-deeps site with a Troll automatic-attack | playableAt `any` + `when` (site.keywords $includes under-deeps + site.autoAttack.race troll) |
 * | 1b| Playable whether that site is tapped or untapped              | play-flag `playable-at-tapped-site`                              |
 * | 2 | Controlling character's company is overt                     | `company-overt` effect (isCovertCompany reads ally defs)         |
 * | 3 | +1 to rolls required for its company's Under-deeps moves      | `under-deeps-roll-modifier` value:1 (collected from allies)      |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  Alignment, CardStatus,
  buildTestState, buildMinionSitePhaseState, resetMint, makeMHState,
  reduce, attachAllyToChar,
  findHandCardId,
  RESOURCE_PLAYER, PLAYER_1, PLAYER_2,
  Phase,
} from '../test-helpers.js';
import { MovementType } from '../../types/common.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState } from '../../index.js';
import { isCovertCompany } from '../../engine/reducer-utils.js';

const CAVE_TROLL = 'ba-35' as CardDefinitionId;
const LUITPRAND = 'le-23' as CardDefinitionId;      // minion character, race man → covert on its own

// Under-deeps sites (Balrog set).
const UNDER_GALLERIES = 'ba-99' as CardDefinitionId; // dark-hold, under-deeps, Trolls auto-attack
const SULFUR_DEEPS = 'ba-97' as CardDefinitionId;    // dark-hold, under-deeps, Troll auto-attack
const DROWNING_DEEPS = 'ba-89' as CardDefinitionId;  // ruins-and-lairs, under-deeps, Drake auto-attack (no Troll)
const UNDER_VAULTS = 'ba-103' as CardDefinitionId;   // ruins-and-lairs, under-deeps; adjacent to Drowning-deeps (roll 8)

// Non-Under-deeps site that nonetheless has a Troll automatic-attack.
const ETTENMOORS = 'le-373' as CardDefinitionId;     // ruins-and-lairs, Trolls+Wolves, NOT under-deeps

function cavePlays(state: ReturnType<typeof buildTestState>) {
  const troll = findHandCardId(state, RESOURCE_PLAYER, CAVE_TROLL);
  return computeLegalActions(state, PLAYER_1).filter(
    ea => ea.viable && ea.action.type === 'play-hero-resource'
      && (ea.action as { cardInstanceId?: string }).cardInstanceId === (troll as string),
  );
}

describe('Cave Troll (ba-35)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playability keying ───────────────────────────────────────────

  test('playable at an untapped Under-deeps site with a Troll automatic-attack (Under-galleries)', () => {
    const state = buildMinionSitePhaseState({
      site: UNDER_GALLERIES,
      characters: [LUITPRAND],
      hand: [CAVE_TROLL],
    });
    expect(cavePlays(state).length).toBeGreaterThanOrEqual(1);
  });

  test('playable at a second Under-deeps Troll site (Sulfur-deeps, single "Troll" auto-attack)', () => {
    const state = buildMinionSitePhaseState({
      site: SULFUR_DEEPS,
      characters: [LUITPRAND],
      hand: [CAVE_TROLL],
    });
    expect(cavePlays(state).length).toBeGreaterThanOrEqual(1);
  });

  test('playable at a TAPPED Under-deeps Troll site (playable-at-tapped-site)', () => {
    const state = buildMinionSitePhaseState({
      site: UNDER_GALLERIES,
      characters: [LUITPRAND],
      hand: [CAVE_TROLL],
      siteStatus: CardStatus.Tapped,
    });
    expect(cavePlays(state).length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at an Under-deeps site WITHOUT a Troll automatic-attack (Drowning-deeps, Drake)', () => {
    const state = buildMinionSitePhaseState({
      site: DROWNING_DEEPS,
      characters: [LUITPRAND],
      hand: [CAVE_TROLL],
    });
    expect(cavePlays(state)).toHaveLength(0);
  });

  test('NOT playable at a non-Under-deeps site that has a Troll automatic-attack (Ettenmoors)', () => {
    const state = buildMinionSitePhaseState({
      site: ETTENMOORS,
      characters: [LUITPRAND],
      hand: [CAVE_TROLL],
    });
    expect(cavePlays(state)).toHaveLength(0);
  });

  // ─── Rule 2: controlling character's company is overt ─────────────────────

  test('a Man-only company bearing the Cave Troll ally is OVERT', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_GALLERIES, characters: [LUITPRAND] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, LUITPRAND, CAVE_TROLL);
    const company = withAlly.players[RESOURCE_PLAYER].companies[0];
    expect(isCovertCompany(company, withAlly.players[RESOURCE_PLAYER], withAlly)).toBe(false);
  });

  test('the same Man-only company WITHOUT the ally is covert (control)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_GALLERIES, characters: [LUITPRAND] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const company = base.players[RESOURCE_PLAYER].companies[0];
    expect(isCovertCompany(company, base.players[RESOURCE_PLAYER], base)).toBe(true);
  });

  // ─── Rule 3: +1 to the Under-deeps movement roll ──────────────────────────

  function underDeepsRollRequired(state: ReturnType<typeof buildTestState>): number {
    const withState = { ...state, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };
    const result = reduce(withState, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.UnderDeeps });
    expect(result.error).toBeUndefined();
    const mhState = result.state.phaseState as MovementHazardPhaseState;
    expect(mhState.step).toBe('under-deeps-roll');
    return mhState.underDeepsRollRequired ?? -1;
  }

  test('bearing the Cave Troll reduces the required Under-deeps roll by 1 (8 → 7)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DROWNING_DEEPS, characters: [LUITPRAND], destinationSite: UNDER_VAULTS }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, LUITPRAND, CAVE_TROLL);
    expect(underDeepsRollRequired(withAlly)).toBe(7);
  });

  test('negative control: without the ally the required Under-deeps roll is unmodified (8)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DROWNING_DEEPS, characters: [LUITPRAND], destinationSite: UNDER_VAULTS }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    expect(underDeepsRollRequired(base)).toBe(8);
  });
});
