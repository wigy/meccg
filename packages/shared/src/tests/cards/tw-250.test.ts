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
 * | 3 | Warrior-only tap to dodge a strike against bearer       | effect |
 *
 * "Shield" is a thematic keyword with no additional engine behaviour —
 * MECCG has no rules that reference the shield subtype separately from
 * the item's stat modifiers.
 *
 * Rule 3 is a `strike-modifier` dodge effect (`cost: { tap: "self" }`), not a
 * `cancel-strike` effect: tapping the shield does NOT cancel the strike or
 * skip its roll. The struck bearer resolves the strike normally at full
 * prowess; he simply doesn't tap on a non-wounding outcome. "(unless the
 * bearer is wounded by the strike)" is the operative clause — if the strike
 * wounds him, he is inverted exactly as if he had no shield.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardInstanceId } from '../../index.js';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, FRODO, LEGOLAS, GIMLI,
  MORIA, LORIEN, MINAS_TIRITH, RIVENDELL,
  pool,
  buildSitePhaseState, buildTestState, resetMint, makeMHState,
  findCharInstanceId, viableActions, getCharacter,
  handCardId, companyIdAt, dispatch, resolveChain,
  actionAs, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, SiteType, CardStatus } from '../../index.js';
import type { CardDefinitionId, CharacterCard, DodgeStrikeAction } from '../../index.js';

const GREAT_SHIELD = 'tw-250' as CardDefinitionId;
// Single-use fixture (not shared outside this file, per card-ids.ts policy):
// Drake, one strike, prowess 8, no printed effects — keeps the strike math
// simple (Gimli has no racial prowess bonus vs drakes) so a low cheat roll
// produces a genuine wound rather than a tie.
const LAND_DRAKE = 'le-80' as CardDefinitionId;

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
    // Body bonus is unconditional; only the tap-to-dodge ability is
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

  // ─── Rule 3: Warrior-only tap to dodge a strike against bearer ───────────

  function buildDrakeAttackOnGimli() {
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
          hand: [LAND_DRAKE],
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
    return resolveChain(afterPlay);
  }

  test('warrior bearer: dodge-strike is offered (not cancel-strike) once the strike is assigned', () => {
    const afterChain = buildDrakeAttackOnGimli();
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

    // The old (buggy) implementation offered `cancel-strike`, which skips the
    // roll entirely — Great-shield of Rohan's text has no such ability.
    const cancelStrikeActions = defActions.filter(a => a.viable && a.action.type === 'cancel-strike');
    expect(cancelStrikeActions).toHaveLength(0);

    const dodgeActions = defActions.filter(a => a.viable && a.action.type === 'dodge-strike');
    expect(dodgeActions).toHaveLength(1);
    expect(actionAs<DodgeStrikeAction>(dodgeActions[0].action).cardInstanceId).toBe(shieldId);
    expect(actionAs<DodgeStrikeAction>(dodgeActions[0].action).characterInstanceId).toBe(gimliId);

    // Dodge uses full (tap) prowess, same as tap-to-fight.
    const tapAction = defActions.find(
      a => a.viable && a.action.type === 'resolve-strike' && (a.action as { tapToFight?: boolean }).tapToFight === true,
    )!;
    expect(actionAs<DodgeStrikeAction>(dodgeActions[0].action).need).toBe((tapAction.action as { need: number }).need);
  });

  test('successful dodge: shield taps, bearer stays untapped, strike still rolled (not outright canceled)', () => {
    const afterChain = buildDrakeAttackOnGimli();
    const gimliId = findCharInstanceId(afterChain, RESOURCE_PLAYER, GIMLI);
    const shieldId = getCharacter(afterChain, RESOURCE_PLAYER, GIMLI).items[0].instanceId;

    const r2 = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: gimliId,
      tapped: false,
    });

    const dodgeAction = computeLegalActions(r2, PLAYER_1)
      .find(a => a.viable && a.action.type === 'dodge-strike')!;

    // Gimli prowess 5 vs Land-drake prowess 8: cheat roll high (12) → 5 + 12 = 17 > 8, success.
    const r3 = dispatch({ ...r2, cheatRollTotal: 12 }, dodgeAction.action);

    const gimliAfter = r3.players[0].characters[gimliId];
    const shieldAfter = gimliAfter.items.find(i => i.instanceId === shieldId)!;
    expect(shieldAfter.status).toBe(CardStatus.Tapped);
    expect(gimliAfter.status).toBe(CardStatus.Untapped);

    // The strike was actually resolved via a roll (dodge mode), not
    // outright canceled without a roll.
    const gimliStrike = r3.combat === null
      ? undefined
      : r3.combat.strikeAssignments.find(sa => sa.characterId === gimliId);
    if (gimliStrike) {
      expect(gimliStrike.resolved).toBe(true);
      expect(gimliStrike.result).not.toBe('canceled');
      expect(gimliStrike.dodged).toBe(true);
    } else {
      expect(r3.combat).toBeNull();
      expect(gimliAfter.status).toBe(CardStatus.Untapped);
    }
  });

  test('bearer wounded despite tapping the shield: strike is not canceled, no immunity to wounding', () => {
    // This is the exact scenario from the bug report: the AI opponent tapped
    // Great-shield of Rohan to try to dodge a strike, but the strike still
    // wounds the bearer normally — the shield only protects against tapping,
    // never against being wounded.
    const afterChain = buildDrakeAttackOnGimli();
    const gimliId = findCharInstanceId(afterChain, RESOURCE_PLAYER, GIMLI);
    const shieldId = getCharacter(afterChain, RESOURCE_PLAYER, GIMLI).items[0].instanceId;

    const r2 = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: gimliId,
      tapped: false,
    });

    const dodgeAction = computeLegalActions(r2, PLAYER_1)
      .find(a => a.viable && a.action.type === 'dodge-strike')!;

    // Gimli prowess 5 vs Land-drake prowess 8: cheat roll low (2) → 5 + 2 = 7 < 8, wounded.
    const r3 = dispatch({ ...r2, cheatRollTotal: 2 }, dodgeAction.action);

    // The shield still taps (cost was paid) but Gimli is wounded (inverted)
    // regardless — the ability does not cancel the strike or block the wound.
    const gimliAfter = r3.players[0].characters[gimliId];
    const shieldAfter = gimliAfter.items.find(i => i.instanceId === shieldId)!;
    expect(shieldAfter.status).toBe(CardStatus.Tapped);
    expect(gimliAfter.status).toBe(CardStatus.Inverted);

    const gimliStrike = r3.combat!.strikeAssignments.find(sa => sa.characterId === gimliId)!;
    expect(gimliStrike.result).toBe('wounded');
    expect(gimliStrike.dodged).toBe(true);
  });

  test('non-warrior bearer: dodge-strike is NOT offered (Frodo)', () => {
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
          hand: [LAND_DRAKE],
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
    const dodgeActions = defActions.filter(a => a.viable && a.action.type === 'dodge-strike');
    expect(dodgeActions).toHaveLength(0);
  });

  test('tapped Great-shield cannot offer dodge-strike', () => {
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
          hand: [LAND_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // Tap the shield manually.
    const gimliKey = (Object.keys(baseState.players[0].characters) as CardInstanceId[])[0];
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
    const dodgeActions = defActions.filter(a => a.viable && a.action.type === 'dodge-strike');
    expect(dodgeActions).toHaveLength(0);
  });

  test('Great-shield in hand is not offered as a play-strike-event (it is an item, not a short-event)', () => {
    // Bug report: the engine let Great-shield of Rohan be played from hand
    // like the Dodge short-event while it sat unattached in hand. Its
    // strike-modifier ability may only be used once it is attached to a
    // character as an item (see the `dodge-strike` tests above).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [GIMLI] }],
          hand: [GREAT_SHIELD],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [LAND_DRAKE],
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

    const gimliId = findCharInstanceId(afterChain, RESOURCE_PLAYER, GIMLI);
    const r2 = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: gimliId,
      tapped: false,
    });
    expect(r2.combat!.phase).toBe('resolve-strike');

    const defActions = computeLegalActions(r2, PLAYER_1);
    const strikeEventActions = defActions.filter(a => a.viable && a.action.type === 'play-strike-event');
    expect(strikeEventActions).toHaveLength(0);
  });

  test('Great-shield does NOT offer dodge-strike for another character in the company', () => {
    // Gimli bears the shield; Legolas is also in the company. A strike
    // assigned to Legolas must not be dodgeable via Gimli's shield.
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
          hand: [LAND_DRAKE],
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
    const dodgeActions = defActions.filter(a => a.viable && a.action.type === 'dodge-strike');
    expect(dodgeActions).toHaveLength(0);
  });
});
