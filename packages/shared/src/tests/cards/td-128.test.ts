/**
 * @module td-128.test
 *
 * Card test: Look More Closely Later (td-128)
 * Type: hero-resource-event (short, ritual, sage-only)
 * Effects: 2 (play-target sage with tap cost, site-untap)
 *
 * "Sage only. Ritual. Tap a sage to untap a site at which Information is
 *  playable. Sage makes a corruption check."
 *
 * The sibling of Master of Wood, Water, or Hill (td-136, `region-transform`)
 * for a one-shot **site-state** change rather than a permanent region
 * retype: the player picks ANY currently-tapped site in play (either
 * player's) at which Information is playable, and it untaps immediately.
 * Playing the card is an action, so it rides the chain of effects (CoE
 * 9.4/9.5): the tap is paid at declaration and the site actually untaps
 * only once both players pass priority.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ELROND, ARAGORN, LEGOLAS, SARUMAN, GLORFINDEL_II,
  TREEBEARD,
  RIVENDELL, LORIEN,
  attachAllyToChar, findAllyInstanceId,
  buildTestState, resetMint,
  viableActions, viableFor, makeSitePhase,
  handCardId, dispatch, setCharStatus, expectCharStatus,
  makeMHState, resolveChain, setCompanySiteStatus,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, PlayShortEventAction } from '../../index.js';
import { computeLegalActions, Phase, CardStatus, WEATHERTOP_HERO } from '../../index.js';
import type { SupportCorruptionCheckAction } from '../../types/actions-universal.js';

const LOOK_MORE_CLOSELY_LATER = 'td-128' as CardDefinitionId;
const DIMRILL_DALE = 'tw-385' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Look More Closely Later (td-128)', () => {
  beforeEach(() => resetMint());

  test('not playable when no sage in play (Legolas has no sage skill)', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [LOOK_MORE_CLOSELY_LATER], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const tappedWeathertop = setCompanySiteStatus(state, 1, 0, CardStatus.Tapped);

    const playActions = viableActions(tappedWeathertop, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('not playable when the only sage is tapped', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [LOOK_MORE_CLOSELY_LATER], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const tappedWeathertop = setCompanySiteStatus(state, 1, 0, CardStatus.Tapped);
    const tappedState = setCharStatus(tappedWeathertop, RESOURCE_PLAYER, ELROND, CardStatus.Tapped);

    const playActions = viableActions(tappedState, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('not playable when no site is currently tapped', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [LOOK_MORE_CLOSELY_LATER], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    // Weathertop (Information-playable) is untapped by default — nothing to untap.
    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('not playable when the only tapped site has no Information playable', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [LOOK_MORE_CLOSELY_LATER], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    // Rivendell (a Haven) has no printed playableResources — tapping it does
    // not make it a legal target even though it's tapped.
    const tappedRivendell = setCompanySiteStatus(state, 0, 0, CardStatus.Tapped);

    const playActions = viableActions(tappedRivendell, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('offers one action per tapped Information-playable site currently on the map', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: WEATHERTOP_HERO, characters: [ELROND] }], hand: [LOOK_MORE_CLOSELY_LATER], siteDeck: [DIMRILL_DALE] },
        { id: PLAYER_2, companies: [{ site: DIMRILL_DALE, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const bothTapped = setCompanySiteStatus(setCompanySiteStatus(state, 0, 0, CardStatus.Tapped), 1, 0, CardStatus.Tapped);

    const weathertopInstanceId = bothTapped.players[0].companies[0].currentSite!.instanceId;
    const dimrillDaleInstanceId = bothTapped.players[1].companies[0].currentSite!.instanceId;

    const playActions = viableActions(bothTapped, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    // Both tapped sites qualify — the player's own AND the opponent's.
    expect(playActions.some(a => a.targetSiteInstanceId === weathertopInstanceId)).toBe(true);
    expect(playActions.some(a => a.targetSiteInstanceId === dimrillDaleInstanceId)).toBe(true);

    // Every action carries the sage as the tap target.
    expect(playActions.every(a => a.targetScoutInstanceId !== undefined)).toBe(true);
  });

  test('playing untaps the chosen site: resolves in one step (tap sage, untap site, discard card)', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [LOOK_MORE_CLOSELY_LATER], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const tapped = setCompanySiteStatus(state, 1, 0, CardStatus.Tapped);
    const weathertopInstanceId = tapped.players[1].companies[0].currentSite!.instanceId;

    const cardId = handCardId(tapped, RESOURCE_PLAYER);
    const elrondId = Object.keys(tapped.players[0].characters)[0] as unknown as CardInstanceId;

    const playActions = viableActions(tapped, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.targetSiteInstanceId === weathertopInstanceId);
    expect(playActions).toHaveLength(1);

    const next = resolveChain(dispatch(tapped, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: elrondId,
      targetSiteInstanceId: weathertopInstanceId,
    }));

    // Sage is tapped
    expectCharStatus(next, RESOURCE_PLAYER, ELROND, CardStatus.Tapped);

    // Weathertop untapped
    expect(next.players[1].companies[0].currentSite!.status).toBe(CardStatus.Untapped);

    // Look More Closely Later moved from P1 hand straight to P1 discard
    expect(next.players[0].hand).toHaveLength(0);
    expect(next.players[0].cardsInPlay.map(c => c.instanceId)).not.toContain(cardId);
    expect(next.players[0].discardPile.map(c => c.instanceId)).toContain(cardId);

    // No lingering pendingEffects sub-flow
    expect(next.pendingEffects).toHaveLength(0);
  });

  test('untapping one site leaves an unrelated tapped site untouched', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: WEATHERTOP_HERO, characters: [ELROND] }], hand: [LOOK_MORE_CLOSELY_LATER], siteDeck: [DIMRILL_DALE] },
        { id: PLAYER_2, companies: [{ site: DIMRILL_DALE, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const bothTapped = setCompanySiteStatus(setCompanySiteStatus(state, 0, 0, CardStatus.Tapped), 1, 0, CardStatus.Tapped);
    const weathertopInstanceId = bothTapped.players[0].companies[0].currentSite!.instanceId;
    const dimrillDaleInstanceId = bothTapped.players[1].companies[0].currentSite!.instanceId;

    const cardId = handCardId(bothTapped, RESOURCE_PLAYER);
    const elrondId = Object.keys(bothTapped.players[0].characters)[0] as unknown as CardInstanceId;

    const next = resolveChain(dispatch(bothTapped, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: elrondId,
      targetSiteInstanceId: weathertopInstanceId,
    }));

    expect(next.players[0].companies[0].currentSite!.instanceId).toBe(weathertopInstanceId);
    expect(next.players[0].companies[0].currentSite!.status).toBe(CardStatus.Untapped);
    // Dimrill Dale (untargeted) remains tapped.
    expect(next.players[1].companies[0].currentSite!.instanceId).toBe(dimrillDaleInstanceId);
    expect(next.players[1].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
  });

  test('sage makes an unmodified corruption check after resolution', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [LOOK_MORE_CLOSELY_LATER], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const tapped = setCompanySiteStatus(state, 1, 0, CardStatus.Tapped);
    const weathertopInstanceId = tapped.players[1].companies[0].currentSite!.instanceId;
    const cardId = handCardId(tapped, RESOURCE_PLAYER);
    const elrondId = Object.keys(tapped.players[0].characters)[0] as unknown as CardInstanceId;

    const next = resolveChain(dispatch(tapped, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: elrondId,
      targetSiteInstanceId: weathertopInstanceId,
    }));

    expect(next.pendingResolutions).toHaveLength(1);
    const resolution = next.pendingResolutions[0];
    expect(resolution.kind.type).toBe('corruption-check');
    if (resolution.kind.type === 'corruption-check') {
      expect(resolution.kind.characterId).toBe(elrondId);
      expect(resolution.kind.modifier).toBe(0);
      expect(resolution.kind.reason).toBe('Look More Closely Later');
    }
    expect(resolution.actor).toBe(PLAYER_1);
  });

  test('CoE 7.1.1: an untapped company mate may tap in support of the sage\'s corruption check', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND, ARAGORN] }], hand: [LOOK_MORE_CLOSELY_LATER], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const tapped = setCompanySiteStatus(state, 1, 0, CardStatus.Tapped);
    const weathertopInstanceId = tapped.players[1].companies[0].currentSite!.instanceId;
    const cardId = handCardId(tapped, RESOURCE_PLAYER);
    const chars = tapped.players[0].characters;
    const elrondId = (Object.keys(chars) as CardInstanceId[]).find(k => chars[k].definitionId === ELROND)!;
    const aragornId = (Object.keys(chars) as CardInstanceId[]).find(k => chars[k].definitionId === ARAGORN)!;

    const next = resolveChain(dispatch(tapped, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: elrondId,
      targetSiteInstanceId: weathertopInstanceId,
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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [LOOK_MORE_CLOSELY_LATER], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const tapped = setCompanySiteStatus(state, 1, 0, CardStatus.Tapped);
    const weathertopInstanceId = tapped.players[1].companies[0].currentSite!.instanceId;
    const withTreebeard = attachAllyToChar(tapped, RESOURCE_PLAYER, LEGOLAS, TREEBEARD);
    const treebeardId = findAllyInstanceId(withTreebeard, RESOURCE_PLAYER, LEGOLAS, TREEBEARD)!;
    const cardId = handCardId(withTreebeard, RESOURCE_PLAYER);

    const playActions = viableActions(withTreebeard, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.targetSiteInstanceId === weathertopInstanceId);
    expect(playActions.length).toBeGreaterThan(0);
    expect(playActions.every(a => a.targetScoutInstanceId === treebeardId)).toBe(true);

    const next = resolveChain(dispatch(withTreebeard, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: treebeardId,
      targetSiteInstanceId: weathertopInstanceId,
    }));

    const legolasAfter = next.players[0].characters[
      (Object.keys(next.players[0].characters) as CardInstanceId[]).find(
        k => next.players[0].characters[k].definitionId === LEGOLAS,
      )!
    ];
    const treebeardAfter = legolasAfter.allies.find(a => a.instanceId === treebeardId)!;
    expect(treebeardAfter.status).toBe(CardStatus.Tapped);

    // Weathertop untapped despite the ally paying the cost.
    expect(next.players[1].companies[0].currentSite!.status).toBe(CardStatus.Untapped);

    // Rule 7.4: allies never make corruption checks.
    expect(next.pendingResolutions).toHaveLength(0);
  });

  test('opponent has no actions while the sage resolves the corruption check', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [LOOK_MORE_CLOSELY_LATER], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const tapped = setCompanySiteStatus(state, 1, 0, CardStatus.Tapped);
    const weathertopInstanceId = tapped.players[1].companies[0].currentSite!.instanceId;
    const cardId = handCardId(tapped, RESOURCE_PLAYER);
    const elrondId = Object.keys(tapped.players[0].characters)[0] as unknown as CardInstanceId;

    const next = resolveChain(dispatch(tapped, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: elrondId,
      targetSiteInstanceId: weathertopInstanceId,
    }));

    const opponentActions = computeLegalActions(next, PLAYER_2);
    expect(opponentActions).toHaveLength(0);
  });

  test('playable during organization phase (CoE 2.1.1)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [LOOK_MORE_CLOSELY_LATER], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const tapped = setCompanySiteStatus(state, 1, 0, CardStatus.Tapped);
    const playActions = viableActions(tapped, PLAYER_1, 'play-short-event');
    expect(playActions.length).toBeGreaterThan(0);
  });

  test('playable during site phase select-company step (CoE 2.1.1)', () => {
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [LOOK_MORE_CLOSELY_LATER], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const tapped = setCompanySiteStatus(base, 1, 0, CardStatus.Tapped);
    const state = { ...tapped, phaseState: makeSitePhase({ step: 'select-company', siteEntered: false }) };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions.length).toBeGreaterThan(0);
  });

  test('playable during movement-hazard phase (CoE 2.1.1)', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [LOOK_MORE_CLOSELY_LATER], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const tapped = setCompanySiteStatus(base, 1, 0, CardStatus.Tapped);
    const state = { ...tapped, phaseState: makeMHState() };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions.length).toBeGreaterThan(0);
  });

  test('playable during end-of-turn discard step (CoE 2.1.1)', () => {
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [LOOK_MORE_CLOSELY_LATER], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const tapped = setCompanySiteStatus(state, 1, 0, CardStatus.Tapped);
    const playActions = viableActions(tapped, PLAYER_1, 'play-short-event');
    expect(playActions.length).toBeGreaterThan(0);
  });

  test('not offered to non-active player during end-of-turn discard step', () => {
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [SARUMAN] }], hand: [LOOK_MORE_CLOSELY_LATER], siteDeck: [LORIEN] },
      ],
    });
    const tapped = setCompanySiteStatus(state, 1, 0, CardStatus.Tapped);
    const playActions = viableActions(tapped, PLAYER_2, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('a tapped sage ally is not offered as a tap target', () => {
    const base = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [LOOK_MORE_CLOSELY_LATER], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const tapped = setCompanySiteStatus(base, 1, 0, CardStatus.Tapped);
    const withTreebeard = attachAllyToChar(tapped, RESOURCE_PLAYER, LEGOLAS, TREEBEARD);
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

  test('multiple sages emit distinct actions carrying the same site target', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [SARUMAN, GLORFINDEL_II] }], hand: [LOOK_MORE_CLOSELY_LATER], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const tapped = setCompanySiteStatus(state, 1, 0, CardStatus.Tapped);
    const weathertopInstanceId = tapped.players[1].companies[0].currentSite!.instanceId;

    const playActions = viableActions(tapped, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.targetSiteInstanceId === weathertopInstanceId);
    expect(playActions).toHaveLength(2);
    const sages = new Set(playActions.map(a => a.targetScoutInstanceId));
    expect(sages.size).toBe(2);
  });
});
