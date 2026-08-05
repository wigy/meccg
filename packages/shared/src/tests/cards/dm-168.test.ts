/**
 * @module dm-168.test
 *
 * Card test: Dwarven Light-stone (dm-168)
 * Type: hero-resource-item (Special Item), alignment wizard, non-unique.
 * Marshalling Points: 2. Corruption Points: 1.
 *
 * Card text: "Playable at any Under-deeps site. +2 to all rolls required for
 * bearer's company to move to an adjacent site in the Under-deeps. Tap Dwarven
 * Light-stone: to modify by -2 the prowess of one Orc or Troll attack or to
 * modify by -2 the prowess of one attack for which 'weapons do not modify the
 * target's prowess' (e. g., Trap, Lava Flow, etc.)."
 *
 * Rule coverage:
 *
 * | # | Rule                                                          | Mechanism                                               |
 * |---|--------------------------------------------------------------|---------------------------------------------------------|
 * | 1 | Playable at any Under-deeps site (any site type)             | item-play-site filter on site.keywords $includes under-deeps |
 * | 2 | +2 to rolls required for bearer's Under-deeps moves          | under-deeps-roll-modifier value:2                       |
 * | 3 | Tap: -2 prowess of one Orc/Troll attack                      | modify-attack cost { tap: self }, when enemy.race $in    |
 * | 4 | Tap: -2 prowess of a "weapons don't modify prowess" attack   | modify-attack when attack.weaponsIneffective            |
 *
 * The "weapons do not modify the target's prowess" clause is modeled by the
 * `weapons-ineffective` automatic-attack combat rule, which sets
 * `CombatState.weaponsIneffective` and is exposed to the modify-attack `when`
 * gate as `attack.weaponsIneffective`.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  Alignment, CardStatus,
  buildTestState, buildSitePhaseState, buildFallenWizardSitePhaseState, resetMint, makeMHState,
  reduce, dispatch,
  findHandCardId, findCharInstanceId,
  attachItemToChar, makeCancelWindowCombat, viableActions,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, GIMLI, MORIA, MINAS_TIRITH,
  Phase,
} from '../test-helpers.js';
import { MovementType, Race } from '../../types/common.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState, ModifyAttackAction } from '../../index.js';

const LIGHT_STONE = 'dm-168' as CardDefinitionId;
const DEEP_MINES = 'wh-55' as CardDefinitionId;   // Fallen-wizard Ruins & Lairs, Under-deeps analog
const SARUMAN_FW = 'wh-9' as CardDefinitionId;    // Fallen-wizard avatar (company character)

// DM Under-deeps sites (canonical hero-map versions), one per site type, to
// prove the "any Under-deeps site" playability.
const UNDER_VAULTS = 'dm-41' as CardDefinitionId;  // ruins-and-lairs, under-deeps
const UNDER_LEAS = 'dm-40' as CardDefinitionId;    // shadow-hold, under-deeps
const UNDER_GALLERIES = 'dm-37' as CardDefinitionId; // dark-hold, under-deeps
const IRON_DEEPS = 'dm-33' as CardDefinitionId;    // dark-hold, under-deeps; adjacent to Under-vaults

describe('Dwarven Light-stone (dm-168)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playable at any Under-deeps site ─────────────────────────────

  function lightStonePlays(state: ReturnType<typeof buildSitePhaseState>) {
    const stoneId = findHandCardId(state, RESOURCE_PLAYER, LIGHT_STONE);
    return computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (stoneId as string),
    );
  }

  test('playable at an Under-deeps Ruins & Lairs (The Under-vaults)', () => {
    const state = buildSitePhaseState({ site: UNDER_VAULTS, characters: [ARAGORN], hand: [LIGHT_STONE] });
    expect(lightStonePlays(state).length).toBeGreaterThanOrEqual(1);
  });

  test('playable at an Under-deeps Shadow-hold (The Under-leas)', () => {
    const state = buildSitePhaseState({ site: UNDER_LEAS, characters: [ARAGORN], hand: [LIGHT_STONE] });
    expect(lightStonePlays(state).length).toBeGreaterThanOrEqual(1);
  });

  test('playable at an Under-deeps Dark-hold (The Under-galleries) — any site type', () => {
    const state = buildSitePhaseState({ site: UNDER_GALLERIES, characters: [ARAGORN], hand: [LIGHT_STONE] });
    expect(lightStonePlays(state).length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a non-Under-deeps site (Moria)', () => {
    const state = buildSitePhaseState({ site: MORIA, characters: [ARAGORN], hand: [LIGHT_STONE] });
    expect(lightStonePlays(state)).toHaveLength(0);
  });

  test('playable at Deep Mines (wh-55) — an Under-deeps site without the printed keyword', () => {
    // Deep Mines carries no printed `under-deeps` keyword (its adjacency is a
    // bespoke roll-0 link to a protected Wizardhaven, not the generic
    // `adjacentSites` map), but CoE g.sur.F1 calls it an Under-deeps site
    // outright — "a Wizardhaven is not considered to be a surface site to an
    // Under-deeps site unless Deep Mines has been played on it". Under-deeps
    // item-play-site filters must still match it.
    const state = buildFallenWizardSitePhaseState({ site: DEEP_MINES, characters: [SARUMAN_FW], hand: [LIGHT_STONE] });
    const stoneId = findHandCardId(state, RESOURCE_PLAYER, LIGHT_STONE);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (stoneId as string),
    );
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Rule 2: +2 to rolls required to move to adjacent Under-deeps sites ────

  function underDeepsRoll(withStone: boolean): number {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{
            site: UNDER_VAULTS,
            characters: [withStone ? { defId: GIMLI, items: [LIGHT_STONE] } : GIMLI],
            destinationSite: IRON_DEEPS,
          }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };
    const result = reduce(state, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.UnderDeeps });
    expect(result.error).toBeUndefined();
    const mhState = result.state.phaseState as MovementHazardPhaseState;
    expect(mhState.step).toBe('under-deeps-roll');
    return mhState.underDeepsRollRequired!;
  }

  test('bearing the Light-stone lowers the required Under-deeps roll by 2', () => {
    const withStone = underDeepsRoll(true);
    const withoutStone = underDeepsRoll(false);
    expect(withStone).toBe(withoutStone - 2);
  });

  // ─── Rule 3: Tap to modify by -2 the prowess of one Orc or Troll attack ───

  function combatVs(race: Race, opts: { weaponsIneffective?: boolean; source?: 'creature' | 'automatic-attack' } = {}) {
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    base = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, LIGHT_STONE);
    const combatState = makeCancelWindowCombat(base, {
      creatureRace: race,
      attackSourceType: opts.source ?? 'creature',
      strikesTotal: 2,
      strikeProwess: 8,
    });
    if (opts.weaponsIneffective) {
      return { ...combatState, combat: { ...combatState.combat!, weaponsIneffective: true } };
    }
    return combatState;
  }

  test('modify-attack IS available against an Orc attack', () => {
    const state = combatVs(Race.Orc);
    const acts = viableActions(state, PLAYER_1, 'modify-attack');
    expect(acts).toHaveLength(1);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    expect((acts[0].action as ModifyAttackAction).characterInstanceId).toBe(aragornId);
  });

  test('modify-attack IS available against a Troll attack', () => {
    const state = combatVs(Race.Troll);
    expect(viableActions(state, PLAYER_1, 'modify-attack')).toHaveLength(1);
  });

  test('executing modify-attack against an Orc attack lowers prowess by 2 and taps the stone', () => {
    const state = combatVs(Race.Orc);
    const acts = viableActions(state, PLAYER_1, 'modify-attack');
    expect(acts).toHaveLength(1);

    const after = dispatch(state, acts[0].action);
    // Combat continues (modified, not canceled); prowess 8 → 6.
    expect(after.combat).not.toBeNull();
    expect(after.combat!.phase).toBe('assign-strikes');
    expect(after.combat!.strikeProwess).toBe(6);

    // Stone is tapped, still on Aragorn, NOT discarded.
    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    const stone = after.players[RESOURCE_PLAYER].characters[aragornId].items.find(i => i.definitionId === LIGHT_STONE)!;
    expect(stone.status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === LIGHT_STONE)).toBeUndefined();
  });

  // ─── Rule 4: Tap against a "weapons do not modify prowess" attack ──────────

  test('modify-attack IS available against a non-Orc/Troll attack when weapons do not modify prowess', () => {
    // A Lava-Flow-style attack (race not Orc/Troll) that carries the
    // weapons-ineffective flag — the second OR branch of the gate.
    const state = combatVs(Race.Undead, { weaponsIneffective: true, source: 'automatic-attack' });
    const acts = viableActions(state, PLAYER_1, 'modify-attack');
    expect(acts).toHaveLength(1);

    const after = dispatch(state, acts[0].action);
    expect(after.combat!.strikeProwess).toBe(6);
  });

  // ─── Negative: neither Orc/Troll nor weapons-ineffective ──────────────────

  test('modify-attack is NOT available against an ordinary non-Orc/Troll attack (Wolves)', () => {
    const state = combatVs(Race.Wolf);
    expect(viableActions(state, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });

  test('modify-attack is NOT available against a non-Orc/Troll attack that does not carry the weapons-ineffective flag', () => {
    // Same race as the weapons-ineffective case, but without the flag → the
    // gate must reject it (proves the flag is what enables branch 4).
    const state = combatVs(Race.Undead, { source: 'automatic-attack' });
    expect(viableActions(state, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });

  test('modify-attack is NOT available when the Light-stone is already tapped', () => {
    const state = combatVs(Race.Orc);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const char = state.players[RESOURCE_PLAYER].characters[aragornId];
    const tapped = {
      ...state,
      players: [
        {
          ...state.players[RESOURCE_PLAYER],
          characters: {
            ...state.players[RESOURCE_PLAYER].characters,
            [aragornId as string]: {
              ...char,
              items: char.items.map(it => it.definitionId === LIGHT_STONE ? { ...it, status: CardStatus.Tapped } : it),
            },
          },
        },
        state.players[1],
      ] as unknown as typeof state.players,
    };
    expect(viableActions(tapped, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });
});
