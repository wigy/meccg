/**
 * @module as-127.test
 *
 * Card test: Iron Shield of Old (as-127)
 * Type: minion-resource-item (Special Item), alignment ringwraith, non-unique.
 * Marshalling Points: 2. Corruption Points: 3.
 *
 * Card text: "Shield. Playable at any Under-deeps Shadow-hold [{S}] or Ruins
 * & Lairs [{R}]. +2 to all rolls required for bearer's company to move to
 * adjacent Under-deeps sites. Warrior only: tap this item to make one strike
 * against its bearer ineffectual (i. e., the strike neither succeeds nor
 * fails)."
 *
 * Rule coverage:
 *
 * | # | Rule                                                        | Mechanism                                              |
 * |---|--------------------------------------------------------------|---------------------------------------------------------|
 * | 1 | Playable at any Under-deeps Shadow-hold or Ruins & Lairs      | item-play-site filter on site.keywords + site.siteType   |
 * | 2 | +2 to rolls required for bearer's company's Under-deeps moves | under-deeps-roll-modifier value:2                        |
 * | 3 | Warrior only: tap to make one strike ineffectual              | cancel-strike cost { tap: "self" }, when bearer.skills   |
 *
 * "Shield" is a thematic/slot keyword (rule 9.15 item-slot exclusivity) with
 * no additional bespoke engine behavior beyond that.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  Alignment, CardStatus,
  buildTestState, buildMinionSitePhaseState, resetMint, makeMHState,
  reduce, dispatch, resolveChain,
  findCharInstanceId, findHandCardId, getCharacter,
  handCardId, companyIdAt, actionAs,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase,
} from '../test-helpers.js';
import { MovementType } from '../../types/common.js';
import { SiteType, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState, CancelStrikeAction } from '../../index.js';

const IRON_SHIELD = 'as-127' as CardDefinitionId;
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;    // minion warrior, non-unique
const LUITPRAND = 'le-23' as CardDefinitionId;      // minion scout (non-warrior), unique
const ORC_LIEUTENANT = 'tw-073' as CardDefinitionId; // hazard creature, 1 strike, 7 prowess

// Under-deeps sites (designated Balrog sites also usable structurally as
// pure movement/keying fixtures here — deck legality is not under test).
const DROWNING_DEEPS = 'ba-89' as CardDefinitionId;  // ruins-and-lairs, under-deeps
const UNDER_VAULTS = 'ba-103' as CardDefinitionId;   // ruins-and-lairs, under-deeps; adjacent to Drowning-deeps (roll 8)
const UNDER_LEAS = 'ba-102' as CardDefinitionId;     // shadow-hold, under-deeps
const UNDER_GALLERIES = 'ba-99' as CardDefinitionId; // dark-hold, under-deeps (wrong site type)

// Ordinary (non-Under-deeps) minion Ruins & Lairs, for negative controls / combat.
const ETTENMOORS = 'le-373' as CardDefinitionId;

describe('Iron Shield of Old (as-127)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playable at Under-deeps Shadow-hold [{S}] or Ruins & Lairs [{R}] ───

  test('playable at an Under-deeps Ruins & Lairs (The Drowning-deeps)', () => {
    const state = buildMinionSitePhaseState({
      site: DROWNING_DEEPS,
      characters: [ORC_CAPTAIN],
      hand: [IRON_SHIELD],
    });
    const shieldId = findHandCardId(state, RESOURCE_PLAYER, IRON_SHIELD);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (shieldId as string),
    );
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('playable at an Under-deeps Shadow-hold (The Under-leas)', () => {
    const state = buildMinionSitePhaseState({
      site: UNDER_LEAS,
      characters: [ORC_CAPTAIN],
      hand: [IRON_SHIELD],
    });
    const shieldId = findHandCardId(state, RESOURCE_PLAYER, IRON_SHIELD);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (shieldId as string),
    );
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a non-Under-deeps minion Ruins & Lairs (Ettenmoors)', () => {
    const state = buildMinionSitePhaseState({
      site: ETTENMOORS,
      characters: [ORC_CAPTAIN],
      hand: [IRON_SHIELD],
    });
    const shieldId = findHandCardId(state, RESOURCE_PLAYER, IRON_SHIELD);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (shieldId as string),
    );
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at an Under-deeps site of the wrong site type (dark-hold, The Under-galleries)', () => {
    const state = buildMinionSitePhaseState({
      site: UNDER_GALLERIES,
      characters: [ORC_CAPTAIN],
      hand: [IRON_SHIELD],
    });
    const shieldId = findHandCardId(state, RESOURCE_PLAYER, IRON_SHIELD);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (shieldId as string),
    );
    expect(plays).toHaveLength(0);
  });

  // ─── Rule 2: +2 to rolls required to move to adjacent Under-deeps sites ────

  test('bearing the Iron Shield of Old reduces the required Under-deeps roll by 2 (8 → 6)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DROWNING_DEEPS, characters: [{ defId: ORC_CAPTAIN, items: [IRON_SHIELD] }], destinationSite: UNDER_VAULTS }],
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
    expect(mhState.underDeepsRollRequired).toBe(6);
  });

  test('negative control: without the shield the required roll is unmodified (8)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DROWNING_DEEPS, characters: [ORC_CAPTAIN], destinationSite: UNDER_VAULTS }],
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
    expect(mhState.underDeepsRollRequired).toBe(8);
  });

  // ─── Rule 3: Warrior only — tap to make one strike against bearer ineffectual ───

  function playHazardAgainstCompany(state: ReturnType<typeof buildTestState>) {
    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Ettenmoors',
    });
    const gameState = { ...state, phaseState: mhState };
    const ltId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: ltId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'ruins-and-lairs' },
    });
    return resolveChain(afterPlay);
  }

  test('warrior bearer: tapping Iron Shield of Old makes a strike against the bearer ineffectual', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: ETTENMOORS, characters: [{ defId: ORC_CAPTAIN, items: [IRON_SHIELD] }] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [ORC_LIEUTENANT], siteDeck: [] },
      ],
    });

    const afterChain = playHazardAgainstCompany(state);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);

    const orcId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ORC_CAPTAIN);
    const shieldId = getCharacter(afterChain, RESOURCE_PLAYER, ORC_CAPTAIN).items[0].instanceId;

    const r2 = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: orcId,
      tapped: false,
    });
    expect(r2.combat!.phase).toBe('resolve-strike');

    const defActions = computeLegalActions(r2, PLAYER_1);
    const cancelStrikeActions = defActions.filter(a => a.viable && a.action.type === 'cancel-strike');
    expect(cancelStrikeActions.length).toBe(1);
    expect(actionAs<CancelStrikeAction>(cancelStrikeActions[0].action).cancellerInstanceId).toBe(shieldId);
    expect(actionAs<CancelStrikeAction>(cancelStrikeActions[0].action).targetCharacterId).toBe(orcId);

    const r3 = dispatch(r2, cancelStrikeActions[0].action);

    // Shield is tapped; Orc Captain is NOT tapped.
    const orcAfter = r3.players[0].characters[orcId];
    const shieldAfter = orcAfter.items.find(i => i.instanceId === shieldId)!;
    expect(shieldAfter.status).toBe(CardStatus.Tapped);
    expect(orcAfter.status).toBe(CardStatus.Untapped);

    const orcStrike = r3.combat === null
      ? undefined
      : r3.combat.strikeAssignments.find(sa => sa.characterId === orcId);
    if (orcStrike) {
      expect(orcStrike.resolved).toBe(true);
      expect(orcStrike.result).toBe('canceled');
    } else {
      expect(r3.combat).toBeNull();
      expect(orcAfter.status).toBe(CardStatus.Untapped);
    }
  });

  test('non-warrior bearer: cancel-strike is NOT offered (Luitprand)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: ETTENMOORS, characters: [{ defId: LUITPRAND, items: [IRON_SHIELD] }] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [ORC_LIEUTENANT], siteDeck: [] },
      ],
    });

    const afterChain = playHazardAgainstCompany(state);
    expect(afterChain.combat).not.toBeNull();

    const luitprandId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LUITPRAND);
    const r2 = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: luitprandId,
      tapped: false,
    });
    expect(r2.combat!.phase).toBe('resolve-strike');

    const defActions = computeLegalActions(r2, PLAYER_1);
    const cancelStrikeActions = defActions.filter(a => a.viable && a.action.type === 'cancel-strike');
    expect(cancelStrikeActions).toHaveLength(0);
  });

  test('a tapped Iron Shield of Old cannot make a strike ineffectual', () => {
    const baseState = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: ETTENMOORS, characters: [{ defId: ORC_CAPTAIN, items: [IRON_SHIELD] }] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [ORC_LIEUTENANT], siteDeck: [] },
      ],
    });

    const orcKey = findCharInstanceId(baseState, RESOURCE_PLAYER, ORC_CAPTAIN);
    const orcChar = baseState.players[0].characters[orcKey];
    const tappedShield = { ...orcChar.items[0], status: CardStatus.Tapped };
    const state = {
      ...baseState,
      players: [
        {
          ...baseState.players[0],
          characters: {
            ...baseState.players[0].characters,
            [orcKey]: { ...orcChar, items: [tappedShield] },
          },
        },
        baseState.players[1],
      ] as typeof baseState.players,
    };

    const afterChain = playHazardAgainstCompany(state);
    const orcId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ORC_CAPTAIN);
    const r2 = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: orcId,
      tapped: false,
    });

    const defActions = computeLegalActions(r2, PLAYER_1);
    const cancelStrikeActions = defActions.filter(a => a.viable && a.action.type === 'cancel-strike');
    expect(cancelStrikeActions).toHaveLength(0);
  });

  test('Iron Shield of Old does NOT make a strike ineffectual against another character in the company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [{ defId: ORC_CAPTAIN, items: [IRON_SHIELD] }, LUITPRAND] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [ORC_LIEUTENANT], siteDeck: [] },
      ],
    });

    const afterChain = playHazardAgainstCompany(state);
    const luitprandId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LUITPRAND);
    const r2 = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: luitprandId,
      tapped: false,
    });
    expect(r2.combat!.phase).toBe('resolve-strike');

    const defActions = computeLegalActions(r2, PLAYER_1);
    const cancelStrikeActions = defActions.filter(a => a.viable && a.action.type === 'cancel-strike');
    expect(cancelStrikeActions).toHaveLength(0);
  });
});
