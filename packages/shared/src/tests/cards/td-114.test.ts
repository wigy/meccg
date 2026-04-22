/**
 * @module td-114.test
 *
 * Card test: Enruned Shield (td-114)
 * Type: hero-resource-item (greater, hoard)
 *
 * Printed text:
 *   "Unique. Hoard item. Shield. +3 to body to a maximum of 10. Warrior
 *    only: tap Enruned Shield to cause one strike against bearer to be
 *    ineffectual (i. e., it doesn't fail and it is not successful)."
 *
 * Rule coverage:
 *
 * | # | Rule                                                   | Status |
 * |---|--------------------------------------------------------|--------|
 * | 1 | Unique (at most 1 copy per deck)                       | data   |
 * | 2 | Hoard item — playable only at hoard sites              | effect |
 * | 3 | +3 body (max 10) — unconditional, applies to any bearer| effect |
 * | 4 | Warrior-only tap to cancel a strike against bearer     | effect |
 *
 * "Shield" is a thematic keyword with no additional engine behavior —
 * MECCG has no rules that reference the shield subtype separately from
 * the item's stat modifiers.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, FRODO, LEGOLAS, GIMLI,
  ORC_LIEUTENANT,
  MORIA, LORIEN, MINAS_TIRITH, RIVENDELL,
  pool,
  buildSitePhaseState, buildTestState, resetMint, makeMHState,
  findCharInstanceId, viableActions, getCharacter,
  handCardId, companyIdAt, dispatch, resolveChain,
  actionAs, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, SiteType, CardStatus } from '../../index.js';
import type { CardDefinitionId, CharacterCard, CancelStrikeAction } from '../../index.js';

const ENRUNED_SHIELD = 'td-114' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId;

describe('Enruned Shield (td-114)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 2: Hoard-item site restriction ─────────────────────────────────

  test('playable at a hoard site (Lonely Mountain)', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [GIMLI],
      hand: [ENRUNED_SHIELD],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a non-hoard site (Moria)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [GIMLI],
      hand: [ENRUNED_SHIELD],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at a haven (Lórien)', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [GIMLI],
      hand: [ENRUNED_SHIELD],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Rule 3: +3 body (max 10) to bearer ───────────────────────────────────

  test('warrior bearer body +3 is capped at 10 (Legolas 8 → 10)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId: LEGOLAS, items: [ENRUNED_SHIELD] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const baseDef = pool[LEGOLAS as string] as CharacterCard;
    expect(baseDef.body).toBe(8);
    expect(getCharacter(state, RESOURCE_PLAYER, LEGOLAS).effectiveStats.body).toBe(10);
  });

  test('warrior bearer body +3 capped at 10 (Aragorn 9 → 10)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId: ARAGORN, items: [ENRUNED_SHIELD] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(baseDef.body).toBe(9);
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.body).toBe(10);
  });

  test('non-warrior bearer also gets the +3 body (Frodo 9 → capped at 10)', () => {
    // The body bonus is unconditional; only the tap-to-cancel ability is
    // warrior-gated. Frodo (scout/diplomat) still gains the +3 body, subject
    // to the max-10 cap.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId: FRODO, items: [ENRUNED_SHIELD] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const baseDef = pool[FRODO as string] as CharacterCard;
    expect(baseDef.body).toBe(9);
    expect(getCharacter(state, RESOURCE_PLAYER, FRODO).effectiveStats.body).toBe(10);
  });

  test('without Enruned Shield bearer body is the base value', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const baseDef = pool[GIMLI as string] as CharacterCard;
    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.body).toBe(baseDef.body);
  });

  // ─── Rule 4: Warrior-only tap to cancel a strike against bearer ──────────

  test('warrior bearer: tapping Enruned Shield cancels a strike against the bearer', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: LONELY_MOUNTAIN,
            characters: [{ defId: GIMLI, items: [ENRUNED_SHIELD] }],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [ORC_LIEUTENANT],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'The Lonely Mountain',
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
    const afterChain = resolveChain(afterPlay);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);

    // Defender assigns the one strike to Gimli
    const gimliId = findCharInstanceId(afterChain, RESOURCE_PLAYER, GIMLI);
    const shieldId = getCharacter(afterChain, RESOURCE_PLAYER, GIMLI).items[0].instanceId;

    const r2 = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: gimliId,
      tapped: false,
    });
    // Sole combatant — 1 strike, assignment complete, proceed to resolve.
    // (With one character and one strike there is no choose-strike-order.)
    expect(r2.combat!.phase).toBe('resolve-strike');

    const defActions = computeLegalActions(r2, PLAYER_1);
    const cancelStrikeActions = defActions.filter(
      a => a.viable && a.action.type === 'cancel-strike',
    );
    expect(cancelStrikeActions.length).toBe(1);
    expect(actionAs<CancelStrikeAction>(cancelStrikeActions[0].action).cancellerInstanceId).toBe(shieldId);
    expect(actionAs<CancelStrikeAction>(cancelStrikeActions[0].action).targetCharacterId).toBe(gimliId);

    // Execute the cancel-strike
    const r3 = dispatch(r2, cancelStrikeActions[0].action);

    // Shield is tapped; Gimli is NOT tapped
    const gimliAfter = r3.players[0].characters[gimliId as string];
    const shieldAfter = gimliAfter.items.find(i => i.instanceId === shieldId)!;
    expect(shieldAfter.status).toBe(CardStatus.Tapped);
    expect(gimliAfter.status).toBe(CardStatus.Untapped);

    // The strike is resolved (canceled)
    const gimliStrike = r3.combat === null
      ? undefined
      : r3.combat.strikeAssignments.find(sa => sa.characterId === gimliId);
    // With a single strike, finalization may clear combat — either way the
    // strike was cancelled (no wound/body check occurred).
    if (gimliStrike) {
      expect(gimliStrike.resolved).toBe(true);
      expect(gimliStrike.result).toBe('canceled');
    } else {
      // combat finalized — Gimli was not wounded/eliminated
      expect(r3.combat).toBeNull();
      expect(gimliAfter.status).toBe(CardStatus.Untapped);
    }
  });

  test('non-warrior bearer: cancel-strike is NOT offered', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: LONELY_MOUNTAIN,
            // Frodo is a scout/diplomat, not a warrior.
            characters: [{ defId: FRODO, items: [ENRUNED_SHIELD] }],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [ORC_LIEUTENANT],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'The Lonely Mountain',
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
    const afterChain = resolveChain(afterPlay);
    expect(afterChain.combat).not.toBeNull();

    const frodoId = findCharInstanceId(afterChain, RESOURCE_PLAYER, FRODO);
    const r2 = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: frodoId,
      tapped: false,
    });
    expect(r2.combat!.phase).toBe('resolve-strike');

    const defActions = computeLegalActions(r2, PLAYER_1);
    const cancelStrikeActions = defActions.filter(
      a => a.viable && a.action.type === 'cancel-strike',
    );
    expect(cancelStrikeActions).toHaveLength(0);
  });

  test('tapped Enruned Shield cannot cancel a strike', () => {
    const baseState = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: LONELY_MOUNTAIN,
            characters: [{ defId: GIMLI, items: [ENRUNED_SHIELD] }],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [ORC_LIEUTENANT],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // Tap the shield.
    const gimliKey = Object.keys(baseState.players[0].characters)[0];
    const gimliChar = baseState.players[0].characters[gimliKey];
    const tappedShield = { ...gimliChar.items[0], status: CardStatus.Tapped };
    const state = {
      ...baseState,
      players: [
        {
          ...baseState.players[0],
          characters: {
            ...baseState.players[0].characters,
            [gimliKey]: { ...gimliChar, items: [tappedShield] },
          },
        },
        baseState.players[1],
      ] as typeof baseState.players,
    };

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'The Lonely Mountain',
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
    const afterChain = resolveChain(afterPlay);

    const gimliId = findCharInstanceId(afterChain, RESOURCE_PLAYER, GIMLI);
    const r2 = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: gimliId,
      tapped: false,
    });

    const defActions = computeLegalActions(r2, PLAYER_1);
    const cancelStrikeActions = defActions.filter(
      a => a.viable && a.action.type === 'cancel-strike',
    );
    expect(cancelStrikeActions).toHaveLength(0);
  });

  test('Enruned Shield does NOT cancel a strike against another character in the company', () => {
    // Gimli bears the shield; Legolas is also in the company. A strike
    // resolved against Legolas must not be cancelable by Gimli's shield
    // (the item only protects its bearer).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: LONELY_MOUNTAIN,
            characters: [
              { defId: GIMLI, items: [ENRUNED_SHIELD] },
              LEGOLAS,
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [ORC_LIEUTENANT],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'The Lonely Mountain',
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
    const afterChain = resolveChain(afterPlay);

    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);
    const r2 = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: legolasId,
      tapped: false,
    });
    expect(r2.combat!.phase).toBe('resolve-strike');

    const defActions = computeLegalActions(r2, PLAYER_1);
    const cancelStrikeActions = defActions.filter(
      a => a.viable && a.action.type === 'cancel-strike',
    );
    expect(cancelStrikeActions).toHaveLength(0);
  });
});
