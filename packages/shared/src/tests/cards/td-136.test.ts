/**
 * @module td-136.test
 *
 * Card test: Master of Wood, Water, or Hill (td-136)
 * Type: hero-resource-event (short, ritual, sage-only)
 * Effects: 2 (play-target sage with tap cost, region-transform)
 *
 * "Sage only. Ritual. Tap a sage to change one Wilderness [{w}] to a
 *  Border-land [{b}] or Shadow-land [{s}] or one Shadow-land [{s}] to a
 *  Wilderness [{w}] or one Border-land [{b}] to a Wilderness [{w}]. Sage
 *  makes a corruption check."
 *
 * Unlike Deeper Shadow (le-179), which changes a region tied to a moving
 * company's destination for the rest of the turn, this card lets the player
 * pick ANY named region on the map whose current effective type matches,
 * and the retype is permanent (an `until-cleared` `region.type` `override`
 * constraint — nothing ever removes it). Playing the card is an action, so
 * it rides the chain of effects (CoE 9.4/9.5): the tap is paid at
 * declaration and the region actually changes only once both players pass
 * priority (mirroring Marvels Told's td-134 discard-in-play mode).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ELROND, ARAGORN, LEGOLAS, SARUMAN, GLORFINDEL_II,
  TREEBEARD,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  attachAllyToChar, findAllyInstanceId,
  buildTestState, resetMint, mint,
  viableActions, viableFor, makeSitePhase,
  handCardId, dispatch, setCharStatus, expectCharStatus,
  makeMHState, resolveChain,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, PlayShortEventAction } from '../../index.js';
import { computeLegalActions, Phase, CardStatus, RegionType } from '../../index.js';
import type { SupportCorruptionCheckAction } from '../../types/actions-universal.js';

const MASTER_OF_WOOD_WATER_OR_HILL = 'td-136' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Master of Wood, Water, or Hill (td-136)', () => {
  beforeEach(() => resetMint());

  test('not playable when no sage in play (Legolas has no sage skill)', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [MASTER_OF_WOOD_WATER_OR_HILL], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('not playable when the only sage is tapped', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MASTER_OF_WOOD_WATER_OR_HILL], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const tappedState = setCharStatus(state, RESOURCE_PLAYER, ELROND, CardStatus.Tapped);

    const playActions = viableActions(tappedState, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('offers one action per (region, destination type) pair currently on the map', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MASTER_OF_WOOD_WATER_OR_HILL], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    // Rhudaur is a printed Wilderness: both w→b and w→s must be offered.
    expect(playActions.some(a => a.targetRegionName === 'Rhudaur' && a.newRegionType === 'border')).toBe(true);
    expect(playActions.some(a => a.targetRegionName === 'Rhudaur' && a.newRegionType === 'shadow')).toBe(true);
    // Angmar is a printed Shadow-land: only s→w is offered.
    expect(playActions.some(a => a.targetRegionName === 'Angmar' && a.newRegionType === 'wilderness')).toBe(true);
    expect(playActions.filter(a => a.targetRegionName === 'Angmar')).toHaveLength(1);
    // Rohan is a printed Border-land: only b→w is offered.
    expect(playActions.some(a => a.targetRegionName === 'Rohan' && a.newRegionType === 'wilderness')).toBe(true);
    expect(playActions.filter(a => a.targetRegionName === 'Rohan')).toHaveLength(1);
    // A Free-domain (The Shire) never qualifies for any option.
    expect(playActions.some(a => a.targetRegionName === 'The Shire')).toBe(false);

    // Every action carries the sage as the tap target.
    expect(playActions.every(a => a.targetScoutInstanceId !== undefined)).toBe(true);
  });

  test('playing w→b resolves in one step: tap sage, install permanent region override, discard card', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MASTER_OF_WOOD_WATER_OR_HILL], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const cardId = handCardId(state, RESOURCE_PLAYER);
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const playActions = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.targetRegionName === 'Rhudaur' && a.newRegionType === 'border');
    expect(playActions).toHaveLength(1);

    const next = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: elrondId,
      targetRegionName: 'Rhudaur',
      newRegionType: RegionType.Border,
    }));

    // Sage is tapped
    expectCharStatus(next, RESOURCE_PLAYER, ELROND, CardStatus.Tapped);

    // Permanent region override installed
    const override = next.activeConstraints.find(
      c => c.kind.type === 'attribute-modifier'
        && (c.kind as { attribute?: string }).attribute === 'region.type',
    );
    expect(override).toBeDefined();
    expect((override!.kind as { value?: string }).value).toBe('border');
    expect(((override!.kind as { filter?: Record<string, unknown> }).filter ?? {})['region.name']).toBe('Rhudaur');
    expect(override!.scope.kind).toBe('until-cleared');

    // Master of Wood, Water, or Hill moved from P1 hand straight to P1 discard
    expect(next.players[0].hand).toHaveLength(0);
    expect(next.players[0].cardsInPlay.map(c => c.instanceId)).not.toContain(cardId);
    expect(next.players[0].discardPile.map(c => c.instanceId)).toContain(cardId);

    // No lingering pendingEffects sub-flow
    expect(next.pendingEffects).toHaveLength(0);
  });

  test('the region override is permanent: a second casting sees the already-transformed type', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MASTER_OF_WOOD_WATER_OR_HILL], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = handCardId(state, RESOURCE_PLAYER);
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const afterFirst = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: elrondId,
      targetRegionName: 'Rhudaur',
      newRegionType: RegionType.Border,
    }));

    // Resolve the pending corruption check from the first cast before recasting.
    const ccAction = viableActions(afterFirst, PLAYER_1, 'corruption-check');
    expect(ccAction).toHaveLength(1);
    const afterCC = dispatch(afterFirst, ccAction[0].action);

    // Untap Elrond and give a fresh copy in hand to recast against the now-Border Rhudaur.
    const untapped = setCharStatus(afterCC, RESOURCE_PLAYER, ELROND, CardStatus.Untapped);
    const withNewCopy = {
      ...untapped,
      players: [
        { ...untapped.players[0], hand: [...untapped.players[0].hand, { instanceId: mint(), definitionId: MASTER_OF_WOOD_WATER_OR_HILL }] },
        untapped.players[1],
      ] as typeof untapped.players,
    };

    const playActions = viableActions(withNewCopy, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    // Rhudaur no longer qualifies as a Wilderness source...
    expect(playActions.some(a => a.targetRegionName === 'Rhudaur' && (a.newRegionType === 'border' || a.newRegionType === 'shadow'))).toBe(false);
    // ...but now qualifies as a Border-land source (b→w), proving the effective
    // (not printed) type is what's consulted.
    expect(playActions.some(a => a.targetRegionName === 'Rhudaur' && a.newRegionType === 'wilderness')).toBe(true);
  });

  test('sage makes an unmodified corruption check after resolution', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MASTER_OF_WOOD_WATER_OR_HILL], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = handCardId(state, RESOURCE_PLAYER);
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const next = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: elrondId,
      targetRegionName: 'Angmar',
      newRegionType: RegionType.Wilderness,
    }));

    expect(next.pendingResolutions).toHaveLength(1);
    const resolution = next.pendingResolutions[0];
    expect(resolution.kind.type).toBe('corruption-check');
    if (resolution.kind.type === 'corruption-check') {
      expect(resolution.kind.characterId).toBe(elrondId);
      expect(resolution.kind.modifier).toBe(0);
      expect(resolution.kind.reason).toBe('Master of Wood, Water, or Hill');
    }
    expect(resolution.actor).toBe(PLAYER_1);
  });

  test('CoE 7.1.1: an untapped company mate may tap in support of the sage\'s corruption check', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND, ARAGORN] }], hand: [MASTER_OF_WOOD_WATER_OR_HILL], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = handCardId(state, RESOURCE_PLAYER);
    const chars = state.players[0].characters;
    const elrondId = (Object.keys(chars) as CardInstanceId[]).find(k => chars[k].definitionId === ELROND)!;
    const aragornId = (Object.keys(chars) as CardInstanceId[]).find(k => chars[k].definitionId === ARAGORN)!;

    const next = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: elrondId,
      targetRegionName: 'Rohan',
      newRegionType: RegionType.Wilderness,
    }));

    const supports = viableFor(next, PLAYER_1)
      .filter(a => a.action.type === 'support-corruption-check') as { action: SupportCorruptionCheckAction }[];
    expect(supports.some(a =>
      a.action.supportingCharacterId === aragornId &&
      a.action.targetCharacterId === elrondId,
    )).toBe(true);
  });

  test('a sage ally (Treebeard) can tap to play it, and makes no corruption check (rule 7.4)', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [MASTER_OF_WOOD_WATER_OR_HILL], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withTreebeard = attachAllyToChar(state, RESOURCE_PLAYER, LEGOLAS, TREEBEARD);
    const treebeardId = findAllyInstanceId(withTreebeard, RESOURCE_PLAYER, LEGOLAS, TREEBEARD)!;
    const cardId = handCardId(withTreebeard, RESOURCE_PLAYER);

    const playActions = viableActions(withTreebeard, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.targetRegionName === 'Angmar');
    expect(playActions.length).toBeGreaterThan(0);
    expect(playActions.every(a => a.targetScoutInstanceId === treebeardId)).toBe(true);

    const next = resolveChain(dispatch(withTreebeard, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: treebeardId,
      targetRegionName: 'Angmar',
      newRegionType: RegionType.Wilderness,
    }));

    const legolasAfter = next.players[0].characters[
      (Object.keys(next.players[0].characters) as CardInstanceId[]).find(
        k => next.players[0].characters[k].definitionId === LEGOLAS,
      )!
    ];
    const treebeardAfter = legolasAfter.allies.find(a => a.instanceId === treebeardId)!;
    expect(treebeardAfter.status).toBe(CardStatus.Tapped);

    const override = next.activeConstraints.find(
      c => c.kind.type === 'attribute-modifier'
        && (c.kind as { attribute?: string }).attribute === 'region.type',
    );
    expect(override).toBeDefined();

    // Rule 7.4: allies never make corruption checks.
    expect(next.pendingResolutions).toHaveLength(0);
  });

  test('opponent has no actions while the sage resolves the corruption check', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MASTER_OF_WOOD_WATER_OR_HILL], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = handCardId(state, RESOURCE_PLAYER);
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const next = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: elrondId,
      targetRegionName: 'Rhudaur',
      newRegionType: RegionType.Shadow,
    }));

    const opponentActions = computeLegalActions(next, PLAYER_2);
    expect(opponentActions).toHaveLength(0);
  });

  test('playable during organization phase (CoE 2.1.1)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MASTER_OF_WOOD_WATER_OR_HILL], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions.length).toBeGreaterThan(0);
  });

  test('playable during site phase select-company step (CoE 2.1.1)', () => {
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MASTER_OF_WOOD_WATER_OR_HILL], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase({ step: 'select-company', siteEntered: false }) };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions.length).toBeGreaterThan(0);
  });

  test('playable during movement-hazard phase (CoE 2.1.1)', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MASTER_OF_WOOD_WATER_OR_HILL], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeMHState() };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions.length).toBeGreaterThan(0);
  });

  test('playable during end-of-turn discard step (CoE 2.1.1)', () => {
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MASTER_OF_WOOD_WATER_OR_HILL], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions.length).toBeGreaterThan(0);
  });

  test('not offered to non-active player during end-of-turn discard step', () => {
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [SARUMAN] }], hand: [MASTER_OF_WOOD_WATER_OR_HILL], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const playActions = viableActions(state, PLAYER_2, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('a tapped sage ally is not offered as a tap target', () => {
    const base = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [MASTER_OF_WOOD_WATER_OR_HILL], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withTreebeard = attachAllyToChar(base, RESOURCE_PLAYER, LEGOLAS, TREEBEARD);
    const treebeardId = findAllyInstanceId(withTreebeard, RESOURCE_PLAYER, LEGOLAS, TREEBEARD)!;
    const legolasKey = (Object.keys(withTreebeard.players[0].characters) as CardInstanceId[]).find(
      k => withTreebeard.players[0].characters[k].definitionId === LEGOLAS,
    )!;
    const legolas = withTreebeard.players[0].characters[legolasKey];
    const tappedTreebeard = {
      ...withTreebeard,
      players: [
        {
          ...withTreebeard.players[0],
          characters: {
            ...withTreebeard.players[0].characters,
            [legolasKey]: {
              ...legolas,
              allies: legolas.allies.map(a => a.instanceId === treebeardId ? { ...a, status: CardStatus.Tapped } : a),
            },
          },
        },
        withTreebeard.players[1],
      ] as typeof withTreebeard.players,
    };

    const playActions = viableActions(tappedTreebeard, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('multiple sages emit distinct actions carrying the same region target', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [SARUMAN, GLORFINDEL_II] }], hand: [MASTER_OF_WOOD_WATER_OR_HILL], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.targetRegionName === 'Angmar' && a.newRegionType === 'wilderness');
    expect(playActions).toHaveLength(2);
    const sages = new Set(playActions.map(a => a.targetScoutInstanceId));
    expect(sages.size).toBe(2);
  });
});
