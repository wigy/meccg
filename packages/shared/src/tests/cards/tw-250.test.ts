/**
 * @module tw-250.test
 *
 * Card test: Great-shield of Rohan (tw-250)
 * Type: hero-resource-item (major)
 *
 * Printed text:
 *   "Unique. Shield. +2 to body to a maximum of 9. Warrior only: tap Great
 *    Shield of Rohan to remain untapped against one strike (unless the bearer
 *    is wounded by the strike)."
 *
 * Rule coverage:
 *
 * | # | Rule                                                    | Status |
 * |---|--------------------------------------------------------------|--------|
 * | 1 | Unique (at most 1 copy per deck)                        | data   |
 * | 2 | +2 body (max 9) — unconditional, applies to any bearer  | effect |
 * | 3 | Warrior-only tap to cancel a strike against bearer      | effect |
 *
 * "Shield" is a thematic keyword with no additional engine behaviour —
 * MECCG has no rules that reference the shield subtype separately from
 * the item's stat modifiers.
 *
 * "(unless the bearer is wounded by the strike)" is a rules clarification
 * that if the bearer is wounded after using the shield (e.g. through another
 * mechanic), they still tap/wound. In engine terms, cancel-strike prevents
 * the strike entirely so the parenthetical has no separate implementation.
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

const GREAT_SHIELD = 'tw-250' as CardDefinitionId;

describe('Great-shield of Rohan (tw-250)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 2: +2 body (max 9) ─────────────────────────────────────────────

  test('warrior bearer body +2 is capped at 9 (Gimli 8 → 9)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: GIMLI, items: [GREAT_SHIELD] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const baseDef = pool[GIMLI as string] as CharacterCard;
    expect(baseDef.body).toBe(8);
    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.body).toBe(9);
  });

  test('bearer already at body 9 stays at 9 (Aragorn 9 → capped at 9)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GREAT_SHIELD] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(baseDef.body).toBe(9);
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.body).toBe(9);
  });

  test('non-warrior bearer also gets the +2 body (Frodo 9 → capped at 9)', () => {
    // Body bonus is unconditional; only the tap-to-cancel ability is
    // warrior-gated.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: FRODO, items: [GREAT_SHIELD] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const baseDef = pool[FRODO as string] as CharacterCard;
    expect(baseDef.body).toBe(9);
    expect(getCharacter(state, RESOURCE_PLAYER, FRODO).effectiveStats.body).toBe(9);
  });

  test('without Great-shield bearer body is the base value', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const baseDef = pool[GIMLI as string] as CharacterCard;
    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.body).toBe(baseDef.body);
  });

  // ─── Rule 2: playable at sites that allow major items ─────────────────────

  test('playable at Moria (major item site)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [GIMLI],
      hand: [GREAT_SHIELD],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Rule 3: Warrior-only tap to cancel a strike against bearer ──────────

  test('warrior bearer: tapping Great-shield cancels a strike against the bearer', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [{ defId: GIMLI, items: [GREAT_SHIELD] }],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ORC_LIEUTENANT],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
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

    const gimliId = findCharInstanceId(afterChain, RESOURCE_PLAYER, GIMLI);
    const shieldId = getCharacter(afterChain, RESOURCE_PLAYER, GIMLI).items[0].instanceId;

    const r2 = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: gimliId,
      tapped: false,
    });
    expect(r2.combat!.phase).toBe('resolve-strike');

    const defActions = computeLegalActions(r2, PLAYER_1);
    const cancelStrikeActions = defActions.filter(
      a => a.viable && a.action.type === 'cancel-strike',
    );
    expect(cancelStrikeActions.length).toBe(1);
    expect(actionAs<CancelStrikeAction>(cancelStrikeActions[0].action).cancellerInstanceId).toBe(shieldId);
    expect(actionAs<CancelStrikeAction>(cancelStrikeActions[0].action).targetCharacterId).toBe(gimliId);

    const r3 = dispatch(r2, cancelStrikeActions[0].action);

    // Shield is tapped; Gimli is NOT tapped
    const gimliAfter = r3.players[0].characters[gimliId as string];
    const shieldAfter = gimliAfter.items.find(i => i.instanceId === shieldId)!;
    expect(shieldAfter.status).toBe(CardStatus.Tapped);
    expect(gimliAfter.status).toBe(CardStatus.Untapped);

    // The strike is resolved as canceled (or combat finalized with Gimli untapped)
    const gimliStrike = r3.combat === null
      ? undefined
      : r3.combat.strikeAssignments.find(sa => sa.characterId === gimliId);
    if (gimliStrike) {
      expect(gimliStrike.resolved).toBe(true);
      expect(gimliStrike.result).toBe('canceled');
    } else {
      expect(r3.combat).toBeNull();
      expect(gimliAfter.status).toBe(CardStatus.Untapped);
    }
  });

  test('non-warrior bearer: cancel-strike is NOT offered (Frodo)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [{ defId: FRODO, items: [GREAT_SHIELD] }],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ORC_LIEUTENANT],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
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

  test('tapped Great-shield cannot cancel a strike', () => {
    const baseState = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [{ defId: GIMLI, items: [GREAT_SHIELD] }],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ORC_LIEUTENANT],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // Tap the shield manually.
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
      destinationSiteName: 'Moria',
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

  test('Great-shield does NOT cancel a strike against another character in the company', () => {
    // Gimli bears the shield; Legolas is also in the company. A strike
    // assigned to Legolas must not be cancelable by Gimli's shield.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [
              { defId: GIMLI, items: [GREAT_SHIELD] },
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
      destinationSiteName: 'Moria',
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
