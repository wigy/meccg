/**
 * @module dm-176.test
 *
 * Card test: Phial of Galadriel (dm-176)
 * Type: hero-resource-item (special item), alignment wizard
 * Unique. Printed: 1 item marshalling point, 0 corruption points.
 *
 * Card text:
 *   "Unique. Playable on a non-Wizard, non-Dwarf bearer of Star-glass at a
 *   Haven [{H}] in the same company as an untapped Galadriel. Tap Galadriel,
 *   replace Star-glass with Phial of Galadriel, and remove Star-glass from
 *   play. Tap Phial to cancel any Undead attack against the bearer's
 *   company. Tap Phial to modify the prowess of any hazard creature attack
 *   against the bearer's company keyed to a Dark-domain [{d}], Shadow-land
 *   [{s}], Dark-hold [{D}], or Shadow-hold [{S}] by -2 — you choose targets
 *   of such an attack's strikes (regardless of tapped status, wounded
 *   status, and the normal abilities of the attack). Tap Phial to give +2
 *   to any corruption check by its bearer. Cannot be transferred."
 *
 * Effects:
 *   1. play-target character — non-Wizard, non-Dwarf bearer of Star-glass
 *      (`target.itemNames $includes "Star-glass"`, race excludes wizard/dwarf).
 *   2. item-play-site — Haven only (`site.siteType: "haven"`), since the
 *      "special" subtype is not on any site's printed `playableResources`.
 *   3. replace-item-on-play — taps an untapped, same-company Galadriel as
 *      part of the play cost, removes Star-glass from the bearer entirely
 *      (out-of-play pile, `removedFromGame`) once Phial attaches.
 *   4. cancel-attack — cost tap self; cancels an Undead attack.
 *   5. modify-attack — cost tap self; -2 prowess to an attack keyed to
 *      Dark-domain/Shadow-land (region) or Dark-hold/Shadow-hold (site);
 *      grantsDefenderFreeStrikeAssignment lets the defender assign strikes
 *      regardless of status for this attack.
 *   6. corruption-check-boost — cost tap self; +2 to a corruption check by
 *      the bearer (mid-game pending window and Free Council support window).
 *   7. play-flag: no-transfer — "Cannot be transferred."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  viableActions, dispatch,
  findCharInstanceId,
  attachItemToChar,
  makeCancelWindowCombat,
  buildSitePhaseState,
  expectCharStatus,
  enqueueCorruptionCheck,
  recomputeDerived,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS, GALADRIEL, GANDALF, BALIN,
  BARROW_WIGHT,
  RIVENDELL, LORIEN, MINAS_TIRITH, MORIA,
} from '../test-helpers.js';
import { CardStatus, Race, RegionType, SiteType } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, FreeCouncilPhaseState, GameState,
  CancelAttackAction, ModifyAttackAction, PlayHeroResourceAction,
  SupportCorruptionCheckAction, CorruptionCheckAction, TransferItemAction,
} from '../../index.js';

const PHIAL = 'dm-176' as CardDefinitionId;
const STAR_GLASS = 'tw-330' as CardDefinitionId;

/** Build a Haven site-phase state with Aragorn (bearing Star-glass) and Galadriel in the company, Phial in hand. */
function buildSwapState(opts?: {
  site?: CardDefinitionId;
  bearer?: CardDefinitionId;
  companion?: CardDefinitionId;
  companionStatus?: CardStatus;
  omitStarGlass?: boolean;
}) {
  const bearer = opts?.bearer ?? ARAGORN;
  const companion = opts?.companion ?? GALADRIEL;
  let state: GameState = buildSitePhaseState({
    site: opts?.site ?? RIVENDELL,
    characters: [bearer, companion],
    hand: [PHIAL],
  });
  if (!opts?.omitStarGlass) {
    state = attachItemToChar(state, RESOURCE_PLAYER, bearer, STAR_GLASS);
  }
  if (opts?.companionStatus) {
    const companionId = findCharInstanceId(state, RESOURCE_PLAYER, companion);
    state = {
      ...state,
      players: [
        {
          ...state.players[RESOURCE_PLAYER],
          characters: {
            ...state.players[RESOURCE_PLAYER].characters,
            [companionId]: { ...state.players[RESOURCE_PLAYER].characters[companionId], status: opts.companionStatus },
          },
        },
        state.players[1],
      ] as typeof state.players,
    };
  }
  return recomputeDerived(state);
}

describe('Phial of Galadriel (dm-176)', () => {
  beforeEach(() => resetMint());

  // ── Play-target: bearer of Star-glass, non-Wizard/non-Dwarf, at a Haven, with untapped Galadriel ──

  test('is offered on a non-Wizard, non-Dwarf bearer of Star-glass at a Haven with untapped Galadriel', () => {
    const state = buildSwapState();
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const galadrielId = findCharInstanceId(state, RESOURCE_PLAYER, GALADRIEL);
    expect(actions.length).toBe(1);
    expect(actions[0].attachToCharacterId).toBe(aragornId);
    expect(actions[0].companionCharacterId).toBe(galadrielId);
  });

  test('is NOT offered on a Wizard bearer (Gandalf) of Star-glass', () => {
    const state = buildSwapState({ bearer: GANDALF });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBe(0);
  });

  test('is NOT offered on a Dwarf bearer (Balin) of Star-glass', () => {
    const state = buildSwapState({ bearer: BALIN });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBe(0);
  });

  test('is NOT offered when the candidate bearer does not bear Star-glass', () => {
    const state = buildSwapState({ omitStarGlass: true });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBe(0);
  });

  test('is NOT offered when Galadriel is absent from the company', () => {
    const state = buildSwapState({ companion: LEGOLAS });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBe(0);
  });

  test('is NOT offered when Galadriel is tapped', () => {
    const state = buildSwapState({ companionStatus: CardStatus.Tapped });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBe(0);
  });

  test('is NOT offered at a non-Haven site (Moria)', () => {
    const state = buildSwapState({ site: MORIA });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBe(0);
  });

  // ── Effect execution: tap Galadriel, swap the item, remove Star-glass from the game ──

  test('playing Phial taps Galadriel and the bearer, attaches Phial, and removes Star-glass from the game', () => {
    const state = buildSwapState();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const galadrielId = findCharInstanceId(state, RESOURCE_PLAYER, GALADRIEL);
    const starGlassId = state.players[RESOURCE_PLAYER].characters[aragornId].items
      .find(i => i.definitionId === STAR_GLASS)!.instanceId;

    const action = viableActions(state, PLAYER_1, 'play-hero-resource')[0].action;
    const after = dispatch(state, action);

    // Galadriel tapped (the companion cost).
    expectCharStatus(after, RESOURCE_PLAYER, GALADRIEL, CardStatus.Tapped);
    // Aragorn tapped (ordinary item-play bearer tap).
    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    const bearer = after.players[RESOURCE_PLAYER].characters[aragornId];
    // Phial now attached.
    expect(bearer.items.some(i => i.definitionId === PHIAL)).toBe(true);
    // Star-glass no longer on the bearer.
    expect(bearer.items.some(i => i.definitionId === STAR_GLASS)).toBe(false);
    // Star-glass removed from the game entirely — not discarded.
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === starGlassId)).toBe(false);
    const outOfPlay = after.players[RESOURCE_PLAYER].outOfPlayPile.find(c => c.instanceId === starGlassId);
    expect(outOfPlay).toBeDefined();
    expect(outOfPlay!.removedFromGame).toBe(true);

    // Galadriel herself never gained Phial or Star-glass.
    const galadriel = after.players[RESOURCE_PLAYER].characters[galadrielId];
    expect(galadriel.items.length).toBe(0);
  });

  // ── Cannot be transferred ──

  test('is NOT offered by transfer-item, unlike an ordinary item on the same character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withStarGlass = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, STAR_GLASS);
    const state = attachItemToChar(withStarGlass, RESOURCE_PLAYER, ARAGORN, PHIAL);

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const starGlassId = state.players[RESOURCE_PLAYER].characters[aragornId].items
      .find(i => i.definitionId === STAR_GLASS)!.instanceId;
    const phialId = state.players[RESOURCE_PLAYER].characters[aragornId].items
      .find(i => i.definitionId === PHIAL)!.instanceId;

    const transfers = viableActions(state, PLAYER_1, 'transfer-item').map(ea => ea.action as TransferItemAction);
    expect(transfers.some(a => a.itemInstanceId === starGlassId)).toBe(true);
    expect(transfers.some(a => a.itemInstanceId === phialId)).toBe(false);
  });

  // ── Tap Phial to cancel an Undead attack ──

  test('cancel-attack is offered against an Undead attack when Phial is untapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PHIAL);
    const state = makeCancelWindowCombat(withItem, { creatureDefId: BARROW_WIGHT, creatureRace: Race.Undead });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack').map(ea => ea.action as CancelAttackAction);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('cancel-attack');
  });

  test('cancel-attack is NOT offered against a non-Undead attack (Orc)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PHIAL);
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Orc });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('activating cancel-attack cancels combat and taps Phial (not the bearer)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PHIAL);
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Undead });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    const after = dispatch(state, actions[0].action);

    expect(after.combat).toBeNull();
    // Item (Phial) itself taps — bearer stays untapped.
    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    const phial = after.players[RESOURCE_PLAYER].characters[aragornId].items.find(i => i.definitionId === PHIAL);
    expect(phial!.status).toBe(CardStatus.Tapped);
  });

  // ── Tap Phial to modify a Dark-domain/Shadow-land/Dark-hold/Shadow-hold attack by -2 ──

  test.each([
    ['Dark-domain region keying', { attackKeying: [RegionType.Dark] }],
    ['Shadow-land region keying', { attackKeying: [RegionType.Shadow] }],
    ['Dark-hold site keying', { attackSiteKeyingTypes: [SiteType.DarkHold] }],
    ['Shadow-hold site keying', { attackSiteKeyingTypes: [SiteType.ShadowHold] }],
  ])('modify-attack is offered against an attack keyed via %s', (_label, keying) => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PHIAL);
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Orc, ...keying });
    const actions = viableActions(state, PLAYER_1, 'modify-attack').map(ea => ea.action as ModifyAttackAction);
    expect(actions).toHaveLength(1);
  });

  test('modify-attack is NOT offered against an attack with no dark/shadow keying', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PHIAL);
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Orc, attackKeying: [RegionType.Wilderness] });
    expect(viableActions(state, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });

  test('activating modify-attack reduces prowess by 2, taps Phial, and grants free strike assignment', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, status: CardStatus.Tapped }, LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PHIAL);
    const state = makeCancelWindowCombat(withItem, {
      creatureRace: Race.Orc,
      attackKeying: [RegionType.Dark],
      strikeProwess: 9,
    });

    const actions = viableActions(state, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(1);
    const after = dispatch(state, actions[0].action);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(7);
    expect(after.combat!.defenderFreeStrikeAssignment).toBe(true);

    // Item itself taps — Aragorn (the bearer) stays tapped as he was, unaffected.
    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    const phial = after.players[RESOURCE_PLAYER].characters[aragornId].items.find(i => i.definitionId === PHIAL);
    expect(phial!.status).toBe(CardStatus.Tapped);

    // Free strike assignment lets the defender assign a strike to Aragorn even
    // though he is tapped — bypassing the normal untapped-only gate.
    const assignActions = viableActions(after, PLAYER_1, 'assign-strike') as { action: { characterId?: CardInstanceId } }[];
    expect(assignActions.some(ea => ea.action.characterId === aragornId)).toBe(true);
  });

  test('modify-attack is NOT offered when Phial is already tapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    let withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PHIAL);
    const aragornId = findCharInstanceId(withItem, RESOURCE_PLAYER, ARAGORN);
    withItem = {
      ...withItem,
      players: [
        {
          ...withItem.players[RESOURCE_PLAYER],
          characters: {
            ...withItem.players[RESOURCE_PLAYER].characters,
            [aragornId]: {
              ...withItem.players[RESOURCE_PLAYER].characters[aragornId],
              items: withItem.players[RESOURCE_PLAYER].characters[aragornId].items.map(
                i => i.definitionId === PHIAL ? { ...i, status: CardStatus.Tapped } : i,
              ),
            },
          },
        },
        withItem.players[1],
      ] as typeof withItem.players,
    };
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Orc, attackKeying: [RegionType.Dark] });
    expect(viableActions(state, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });

  // ── Tap Phial to give +2 to a corruption check by its bearer ──

  test('the +2 boost is offered while the bearer is making a corruption check', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    let state = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PHIAL);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    state = enqueueCorruptionCheck(state, PLAYER_1, aragornId);

    const boosts = viableActions(state, PLAYER_1, 'support-corruption-check')
      .map(ea => ea.action as SupportCorruptionCheckAction)
      .filter(a => a.supportingItemInstanceId !== undefined);
    expect(boosts).toHaveLength(1);
  });

  test('activating the boost taps Phial, adds +2, and the re-offered roll shows the modifier', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    let state = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PHIAL);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    state = enqueueCorruptionCheck(state, PLAYER_1, aragornId);

    const boost = viableActions(state, PLAYER_1, 'support-corruption-check')
      .map(ea => ea.action as SupportCorruptionCheckAction)
      .find(a => a.supportingItemInstanceId !== undefined)!;
    const after = dispatch(state, boost);

    const phial = after.players[RESOURCE_PLAYER].characters[aragornId].items.find(i => i.definitionId === PHIAL);
    expect(phial!.status).toBe(CardStatus.Tapped);
    expect(after.activeConstraints.some(c =>
      c.kind.type === 'check-modifier' && c.kind.check === 'corruption' && c.kind.value === 2
      && c.target.kind === 'character' && c.target.characterId === aragornId)).toBe(true);

    const roll = viableActions(after, PLAYER_1, 'corruption-check')
      .map(ea => ea.action as CorruptionCheckAction)
      .find(a => a.characterId === aragornId)!;
    expect(roll.corruptionModifier).toBe(2);
  });

  test('the +2 boost is offered in the Free Council support window', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PHIAL);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: {
        characterId: aragornId,
        corruptionPoints: 8,
        corruptionModifier: 0,
        possessions: [],
        need: 9,
        explanation: 'test',
        supportCount: 0,
      },
    };
    const withFc = { ...state, phaseState: fcState };

    const boosts = viableActions(withFc, PLAYER_1, 'support-corruption-check')
      .map(ea => ea.action as SupportCorruptionCheckAction)
      .filter(a => a.supportingItemInstanceId !== undefined);
    expect(boosts).toHaveLength(1);

    const after = dispatch(withFc, boosts[0]);
    const phial = after.players[RESOURCE_PLAYER].characters[aragornId].items.find(i => i.definitionId === PHIAL);
    expect(phial!.status).toBe(CardStatus.Tapped);
    expect(after.activeConstraints.some(c =>
      c.kind.type === 'check-modifier' && c.kind.check === 'corruption' && c.kind.value === 2
      && c.target.kind === 'character' && c.target.characterId === aragornId)).toBe(true);
  });

  test('the +2 boost is NOT offered when Phial is already tapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    let state = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PHIAL);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    state = {
      ...state,
      players: [
        {
          ...state.players[RESOURCE_PLAYER],
          characters: {
            ...state.players[RESOURCE_PLAYER].characters,
            [aragornId]: {
              ...state.players[RESOURCE_PLAYER].characters[aragornId],
              items: state.players[RESOURCE_PLAYER].characters[aragornId].items.map(
                i => i.definitionId === PHIAL ? { ...i, status: CardStatus.Tapped } : i,
              ),
            },
          },
        },
        state.players[1],
      ] as typeof state.players,
    };
    state = enqueueCorruptionCheck(state, PLAYER_1, aragornId);

    const boosts = viableActions(state, PLAYER_1, 'support-corruption-check')
      .map(ea => ea.action as SupportCorruptionCheckAction)
      .filter(a => a.supportingItemInstanceId !== undefined);
    expect(boosts).toHaveLength(0);
  });
});
