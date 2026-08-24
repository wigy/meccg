/**
 * @module td-143.test
 *
 * Card test: Not at Home (td-143)
 * Type: hero-resource-event (short)
 * Effects:
 *   1. cancel-attack — cancel one Dragon, Drake, or Troll attack that is
 *      an automatic-attack OR a site-keyed creature (no regional keying);
 *      no tap cost required.
 *   2. halve-strikes (subtract op) — if Gates of Morning is in play,
 *      reduce strikes of any automatic-attack by 2 (minimum 1).
 *
 * "Cancel one Dragon, Drake, or Troll attack. This attack must be either
 * an automatic-attack or keyed to a site. Alternatively, if Gates of
 * Morning is in play, reduce the number of strikes of any automatic-attack
 * by 2 (to a minimum of 1)."
 *
 * Engine support:
 * | # | Feature                                              | Status      | Notes                                    |
 * |---|------------------------------------------------------|-------------|------------------------------------------|
 * | 1 | cancel-attack with enemy.race filter                  | IMPLEMENTED | combat legal actions + reducer           |
 * | 2 | cancel-attack gated on attack.source (auto-attack)   | IMPLEMENTED | attack.source in cancel-attack context   |
 * | 3 | cancel-attack gated on attack.siteKeyed               | IMPLEMENTED | attack.siteKeyed added to context        |
 * | 4 | halve-strikes subtract mode (op: subtract, value: 2) | IMPLEMENTED | handleHalveStrikes extended              |
 * | 5 | halve-strikes gated on attack.source in when context | IMPLEMENTED | attack.source added to halveStrikes ctx  |
 * | 6 | Card discarded after use                              | IMPLEMENTED | reducer moves card to discard            |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  CAVE_DRAKE, ORC_PATROL, GATES_OF_MORNING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions,
  makeMHState,
  playCreatureHazardAndResolve,
  buildSitePhaseState, setupAutoAttackStep, addP1CardsInPlay, addCardInPlay,
  CardStatus,
  handCardId, companyIdAt, dispatch, expectInDiscardPile,
  resolveChain, reduce, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CancelAttackAction } from '../../index.js';
import { RegionType, SiteType, ETTENMOORS_HERO, DOORS_OF_NIGHT } from '../../index.js';
import type { CardInPlay, CardDefinitionId, CardInstanceId } from '../../index.js';

const NOT_AT_HOME = 'td-143' as CardDefinitionId;
const BAIRANAX = 'td-3' as CardDefinitionId;     // Dragon, keyed to Ovir Hollow by site-name only
const OVIR_HOLLOW = 'td-179' as CardDefinitionId; // ruins-and-lairs, Dragon auto-attack, nearestHaven=Lórien
const DANCING_SPIRE = 'tw-383' as CardDefinitionId; // ruins-and-lairs, Dragon auto-attack (2 strikes, 11 prowess)

describe('Not at Home (td-143)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: cancel-attack ──────────────────────────────────────────────

  test('cancel-attack available against Dragon automatic-attack (no tap cost)', () => {
    // Dancing Spire has a Dragon auto-attack: 2 strikes, 11 prowess
    const state = setupAutoAttackStep(buildSitePhaseState({ site: DANCING_SPIRE, hand: [NOT_AT_HOME] }));
    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.creatureRace).toBe('dragon');

    const cancelActions = viableActions(result.state, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);
    const cancelAction = cancelActions[0].action as CancelAttackAction;
    expect(cancelAction.scoutInstanceId).toBeUndefined();
  });

  test('cancel-attack available against Troll automatic-attack', () => {
    // Ettenmoors has a Trolls auto-attack: 1 strike, 9 prowess
    const state = setupAutoAttackStep(buildSitePhaseState({ site: ETTENMOORS_HERO, hand: [NOT_AT_HOME] }));
    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();

    const cancelActions = viableActions(result.state, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);
    const cancelAction = cancelActions[0].action as CancelAttackAction;
    expect(cancelAction.scoutInstanceId).toBeUndefined();
  });

  test('cancel-attack available against site-keyed Dragon creature (Bairanax)', () => {
    // Bairanax (td-3) is keyed to Ovir Hollow by site-name with no region types.
    // → attackKeying is empty → attack.siteKeyed = true → cancel-attack is legal.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [NOT_AT_HOME], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BAIRANAX], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhûn'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Ovir Hollow',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const bairanaxId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, bairanaxId, targetCompanyId,
      { method: 'site-name', value: 'Ovir Hollow' },
    );

    expect(combatState.combat).toBeDefined();
    // Bairanax has no regional keying → attackKeying is undefined
    expect(combatState.combat!.attackKeying).toBeUndefined();

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);
    const cancelAction = cancelActions[0].action as CancelAttackAction;
    expect(cancelAction.scoutInstanceId).toBeUndefined();
  });

  test('cancel-attack NOT available against a roaming Dragon keyed by region name (Smaug)', () => {
    // Smaug (tw-90) roaming: with Doors of Night in play he may be keyed by
    // region NAME (Withered Heath), not to a site. → attackKeyingRegionNames
    // is populated → attack.siteKeyed = false → NOT eligible ("this attack
    // must be either an automatic-attack or keyed to a site"). Regression:
    // the cancel-attack context ignored region-name keying and offered the
    // cancel.
    const SMAUG = 'tw-90' as CardDefinitionId;
    const base = addCardInPlay(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [NOT_AT_HOME], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SMAUG], siteDeck: [RIVENDELL] },
      ],
    }), HAZARD_PLAYER, DOORS_OF_NIGHT);

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Withered Heath'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const smaugId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, smaugId, targetCompanyId,
      { method: 'region-name', value: 'Withered Heath' },
    );

    expect(combatState.combat).toBeDefined();
    expect(combatState.combat!.creatureRace).toBe('dragon');
    expect(combatState.combat!.attackKeyingRegionNames).toEqual(['Withered Heath']);

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('cancel-attack NOT available against region-keyed Drake (Cave-drake)', () => {
    // Cave-drake is keyed to 2×wilderness + ruins-and-lairs → has regional keying.
    // → attack.siteKeyed = false, attack.source = "creature" → NOT eligible.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [NOT_AT_HOME], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir', 'Rhûn'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const caveDrakeId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, caveDrakeId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat).toBeDefined();
    // Cave-drake has regional keying → siteKeyed = false → cancel-attack not available
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('cancel-attack NOT available against non-Dragon/Drake/Troll creature', () => {
    // Orc-patrol (race: orc) → enemy.race not in [dragon, drake, troll] → NOT eligible.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [NOT_AT_HOME], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat).toBeDefined();

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('executing cancel-attack against Dragon auto-attack cancels combat and discards card', () => {
    const state = setupAutoAttackStep(buildSitePhaseState({ site: DANCING_SPIRE, hand: [NOT_AT_HOME] }));
    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.state.combat).toBeDefined();

    const cancelActions = viableActions(result.state, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);

    const declared = dispatch(result.state, cancelActions[0].action);
    expect(declared.chain).not.toBeNull();
    expect(declared.combat).not.toBeNull();
    expect(declared.players[0].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, NOT_AT_HOME);

    const after = resolveChain(declared);
    expect(after.combat).toBeNull();
  });

  // ── Effect 2: halve-strikes subtract mode (GoM + automatic-attack only) ────

  test('halve-strikes (subtract) available against Dragon auto-attack with Gates of Morning', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };
    const base = setupAutoAttackStep(buildSitePhaseState({ site: DANCING_SPIRE, hand: [NOT_AT_HOME] }));
    const state = addP1CardsInPlay(base, [gomInPlay]);

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();

    const halveActions = viableActions(result.state, PLAYER_1, 'halve-strikes');
    expect(halveActions).toHaveLength(1);
  });

  test('halve-strikes NOT available without Gates of Morning', () => {
    const state = setupAutoAttackStep(buildSitePhaseState({ site: DANCING_SPIRE, hand: [NOT_AT_HOME] }));
    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.state.combat).toBeDefined();

    const halveActions = viableActions(result.state, PLAYER_1, 'halve-strikes');
    expect(halveActions).toHaveLength(0);
  });

  test('halve-strikes NOT available against creature hazard even with GoM (not an automatic-attack)', () => {
    // Cave-drake is a creature hazard (attack.source = "creature") → when condition fails.
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [NOT_AT_HOME], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir', 'Rhûn'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const caveDrakeId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, caveDrakeId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat).toBeDefined();

    // Not at Home's halve-strikes requires automatic-attack — creature attack is not eligible
    const halveActions = viableActions(combatState, PLAYER_1, 'halve-strikes');
    expect(halveActions).toHaveLength(0);
  });

  test('executing halve-strikes reduces Dragon auto-attack strikes by 2 (minimum 1)', () => {
    // Dancing Spire: Dragon — 2 strikes, 11 prowess. After subtract-2: max(1, 2-2)=1 strike.
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };
    const base = setupAutoAttackStep(buildSitePhaseState({ site: DANCING_SPIRE, hand: [NOT_AT_HOME] }));
    const state = addP1CardsInPlay(base, [gomInPlay]);

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.state.combat!.strikesTotal).toBe(2);

    const halveActions = viableActions(result.state, PLAYER_1, 'halve-strikes');
    expect(halveActions).toHaveLength(1);

    const after = dispatch(result.state, halveActions[0].action);
    // 2 strikes − 2 = 0 → min 1 → 1 strike
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.players[0].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, NOT_AT_HOME);
    expect(after.combat!.phase).toBe('assign-strikes');
  });

  test('halve-strikes minimum floor: 1-strike auto-attack stays at 1 after subtract', () => {
    // Ovir Hollow: Dragon — 1 strike, 12 prowess. After subtract-2: max(1, 1-2)=1 strike.
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };
    const base = setupAutoAttackStep(buildSitePhaseState({ site: OVIR_HOLLOW, hand: [NOT_AT_HOME] }));
    const state = addP1CardsInPlay(base, [gomInPlay]);

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.state.combat!.strikesTotal).toBe(1);

    const halveActions = viableActions(result.state, PLAYER_1, 'halve-strikes');
    expect(halveActions).toHaveLength(1);

    const after = dispatch(result.state, halveActions[0].action);
    // 1 strike − 2 = −1 → min 1 → still 1 strike
    expect(after.combat!.strikesTotal).toBe(1);
    expectInDiscardPile(after, RESOURCE_PLAYER, NOT_AT_HOME);
  });
});
