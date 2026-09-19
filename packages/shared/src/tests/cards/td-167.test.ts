/**
 * @module td-167.test
 *
 * Card test: Wielded Twice (td-167)
 * Type: hero-resource-event (short, ritual, sage-only)
 * Effects: 2 (play-target sage with tap cost, item-untap)
 *
 * "Sage only. Ritual. Tap a sage to untap an item in his company. Sage makes
 *  a corruption check."
 *
 * The company-scoped sibling of Look More Closely Later (td-128,
 * `site-untap`): instead of scanning every company on the map for a matching
 * tapped site, this scans only the characters of the tapping sage's OWN
 * company for a `Tapped` item (borne by any company member, not just the
 * sage himself) and offers it as a target. Playing the card is an action, so
 * it rides the chain of effects (CoE 9.4/9.5): the tap is paid at
 * declaration and the item actually untaps only once both players pass
 * priority.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ELROND, ARAGORN, LEGOLAS, SARUMAN, GLORFINDEL_II,
  TREEBEARD,
  RIVENDELL, LORIEN,
  attachAllyToChar, findAllyInstanceId,
  attachItemToChar, setItemStatus, findItemInstanceId,
  buildTestState, resetMint,
  viableActions, viableFor, makeSitePhase,
  handCardId, dispatch, setCharStatus, expectCharStatus,
  makeMHState, resolveChain,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, PlayShortEventAction } from '../../index.js';
import { computeLegalActions, Phase, CardStatus, WEATHERTOP_HERO } from '../../index.js';
import type { SupportCorruptionCheckAction } from '../../types/actions-universal.js';

const WIELDED_TWICE = 'td-167' as CardDefinitionId;
const ANNUMINAS = 'tw-297' as CardDefinitionId; // generic hero item (Palantír)

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Wielded Twice (td-167)', () => {
  beforeEach(() => resetMint());

  test('not playable when no sage in play (Legolas has no sage skill)', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [WIELDED_TWICE], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const withItem = setItemStatus(attachItemToChar(state, RESOURCE_PLAYER, LEGOLAS, ANNUMINAS), RESOURCE_PLAYER, LEGOLAS, ANNUMINAS, CardStatus.Tapped);

    const playActions = viableActions(withItem, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('not playable when the only sage is tapped', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [WIELDED_TWICE], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const withItem = setItemStatus(attachItemToChar(state, RESOURCE_PLAYER, ELROND, ANNUMINAS), RESOURCE_PLAYER, ELROND, ANNUMINAS, CardStatus.Tapped);
    const tappedState = setCharStatus(withItem, RESOURCE_PLAYER, ELROND, CardStatus.Tapped);

    const playActions = viableActions(tappedState, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('not playable when no item in the sage\'s company is tapped', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [WIELDED_TWICE], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    // Elrond bears no items at all — nothing to untap.
    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('not playable when the sage bears an item that is already untapped', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [WIELDED_TWICE], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const withItem = attachItemToChar(state, RESOURCE_PLAYER, ELROND, ANNUMINAS); // stays Untapped
    const playActions = viableActions(withItem, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('a tapped item in a DIFFERENT company (same player) is not offered — "his company" is company-scoped', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ELROND] },
            { site: LORIEN, characters: [ARAGORN] },
          ],
          hand: [WIELDED_TWICE],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    // The tapped item sits on Aragorn, in a company Elrond (the only sage) does not belong to.
    const withItem = setItemStatus(attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, ANNUMINAS), RESOURCE_PLAYER, ARAGORN, ANNUMINAS, CardStatus.Tapped);

    const playActions = viableActions(withItem, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('an opponent\'s tapped item is never offered, even if it were somehow reachable', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [WIELDED_TWICE], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const withItem = setItemStatus(attachItemToChar(state, 1, ARAGORN, ANNUMINAS), 1, ARAGORN, ANNUMINAS, CardStatus.Tapped);

    const playActions = viableActions(withItem, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('offers one action per tapped item currently in the sage\'s own company, borne by any member', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND, ARAGORN] }], hand: [WIELDED_TWICE], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    // One item on the sage himself, one on his non-sage company-mate — both tapped.
    const step1 = setItemStatus(attachItemToChar(state, RESOURCE_PLAYER, ELROND, ANNUMINAS), RESOURCE_PLAYER, ELROND, ANNUMINAS, CardStatus.Tapped);
    const withItems = setItemStatus(attachItemToChar(step1, RESOURCE_PLAYER, ARAGORN, ANNUMINAS), RESOURCE_PLAYER, ARAGORN, ANNUMINAS, CardStatus.Tapped);

    const elrondItemId = findItemInstanceId(withItems, RESOURCE_PLAYER, ANNUMINAS);
    const aragornItemId = withItems.players[0].characters[
      (Object.keys(withItems.players[0].characters) as CardInstanceId[]).find(
        k => withItems.players[0].characters[k].definitionId === ARAGORN,
      )!
    ].items[0].instanceId;

    const playActions = viableActions(withItems, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    expect(playActions.some(a => a.targetItemInstanceId === elrondItemId)).toBe(true);
    expect(playActions.some(a => a.targetItemInstanceId === aragornItemId)).toBe(true);
    // Every action carries the sage as the tap target.
    expect(playActions.every(a => a.targetScoutInstanceId !== undefined)).toBe(true);
  });

  test('playing untaps the chosen item: resolves in one step (tap sage, untap item, discard card)', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND, ARAGORN] }], hand: [WIELDED_TWICE], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const withItem = setItemStatus(attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, ANNUMINAS), RESOURCE_PLAYER, ARAGORN, ANNUMINAS, CardStatus.Tapped);
    const itemInstanceId = findItemInstanceId(withItem, RESOURCE_PLAYER, ANNUMINAS);

    const cardId = handCardId(withItem, RESOURCE_PLAYER);
    const elrondId = (Object.keys(withItem.players[0].characters) as CardInstanceId[]).find(
      k => withItem.players[0].characters[k].definitionId === ELROND,
    )!;

    const playActions = viableActions(withItem, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.targetItemInstanceId === itemInstanceId);
    expect(playActions).toHaveLength(1);

    const next = resolveChain(dispatch(withItem, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: elrondId,
      targetItemInstanceId: itemInstanceId,
    }));

    // Sage is tapped
    expectCharStatus(next, RESOURCE_PLAYER, ELROND, CardStatus.Tapped);

    // Aragorn's item untapped
    const aragornAfter = next.players[0].characters[
      (Object.keys(next.players[0].characters) as CardInstanceId[]).find(
        k => next.players[0].characters[k].definitionId === ARAGORN,
      )!
    ];
    expect(aragornAfter.items.find(i => i.instanceId === itemInstanceId)!.status).toBe(CardStatus.Untapped);

    // Wielded Twice moved from P1 hand straight to P1 discard
    expect(next.players[0].hand).toHaveLength(0);
    expect(next.players[0].cardsInPlay.map(c => c.instanceId)).not.toContain(cardId);
    expect(next.players[0].discardPile.map(c => c.instanceId)).toContain(cardId);

    // No lingering pendingEffects sub-flow
    expect(next.pendingEffects).toHaveLength(0);
  });

  test('untapping one item leaves an unrelated tapped item on a company-mate untouched', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND, ARAGORN, LEGOLAS] }], hand: [WIELDED_TWICE], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [GLORFINDEL_II] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const step1 = setItemStatus(attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, ANNUMINAS), RESOURCE_PLAYER, ARAGORN, ANNUMINAS, CardStatus.Tapped);
    const withItems = setItemStatus(attachItemToChar(step1, RESOURCE_PLAYER, LEGOLAS, ANNUMINAS), RESOURCE_PLAYER, LEGOLAS, ANNUMINAS, CardStatus.Tapped);

    const chars = withItems.players[0].characters;
    const aragornKey = (Object.keys(chars) as CardInstanceId[]).find(k => chars[k].definitionId === ARAGORN)!;
    const legolasKey = (Object.keys(chars) as CardInstanceId[]).find(k => chars[k].definitionId === LEGOLAS)!;
    const elrondKey = (Object.keys(chars) as CardInstanceId[]).find(k => chars[k].definitionId === ELROND)!;
    const aragornItemId = chars[aragornKey].items[0].instanceId;
    const legolasItemId = chars[legolasKey].items[0].instanceId;

    const cardId = handCardId(withItems, RESOURCE_PLAYER);
    const next = resolveChain(dispatch(withItems, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: elrondKey,
      targetItemInstanceId: aragornItemId,
    }));

    expect(next.players[0].characters[aragornKey].items.find(i => i.instanceId === aragornItemId)!.status).toBe(CardStatus.Untapped);
    // Legolas's item (untargeted) remains tapped.
    expect(next.players[0].characters[legolasKey].items.find(i => i.instanceId === legolasItemId)!.status).toBe(CardStatus.Tapped);
  });

  test('sage makes an unmodified corruption check after resolution', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [WIELDED_TWICE], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const withItem = setItemStatus(attachItemToChar(state, RESOURCE_PLAYER, ELROND, ANNUMINAS), RESOURCE_PLAYER, ELROND, ANNUMINAS, CardStatus.Tapped);
    const itemInstanceId = findItemInstanceId(withItem, RESOURCE_PLAYER, ANNUMINAS);
    const cardId = handCardId(withItem, RESOURCE_PLAYER);
    const elrondId = Object.keys(withItem.players[0].characters)[0] as unknown as CardInstanceId;

    const next = resolveChain(dispatch(withItem, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: elrondId,
      targetItemInstanceId: itemInstanceId,
    }));

    expect(next.pendingResolutions).toHaveLength(1);
    const resolution = next.pendingResolutions[0];
    expect(resolution.kind.type).toBe('corruption-check');
    if (resolution.kind.type === 'corruption-check') {
      expect(resolution.kind.characterId).toBe(elrondId);
      expect(resolution.kind.modifier).toBe(0);
      expect(resolution.kind.reason).toBe('Wielded Twice');
    }
    expect(resolution.actor).toBe(PLAYER_1);
  });

  test('CoE 7.1.1: an untapped company mate may tap in support of the sage\'s corruption check', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND, ARAGORN] }], hand: [WIELDED_TWICE], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const withItem = setItemStatus(attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, ANNUMINAS), RESOURCE_PLAYER, ARAGORN, ANNUMINAS, CardStatus.Tapped);
    const itemInstanceId = findItemInstanceId(withItem, RESOURCE_PLAYER, ANNUMINAS);
    const cardId = handCardId(withItem, RESOURCE_PLAYER);
    const chars = withItem.players[0].characters;
    const elrondId = (Object.keys(chars) as CardInstanceId[]).find(k => chars[k].definitionId === ELROND)!;
    const aragornId = (Object.keys(chars) as CardInstanceId[]).find(k => chars[k].definitionId === ARAGORN)!;

    const next = resolveChain(dispatch(withItem, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: elrondId,
      targetItemInstanceId: itemInstanceId,
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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [WIELDED_TWICE], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const withItem = setItemStatus(attachItemToChar(state, RESOURCE_PLAYER, LEGOLAS, ANNUMINAS), RESOURCE_PLAYER, LEGOLAS, ANNUMINAS, CardStatus.Tapped);
    const itemInstanceId = findItemInstanceId(withItem, RESOURCE_PLAYER, ANNUMINAS);
    const withTreebeard = attachAllyToChar(withItem, RESOURCE_PLAYER, LEGOLAS, TREEBEARD);
    const treebeardId = findAllyInstanceId(withTreebeard, RESOURCE_PLAYER, LEGOLAS, TREEBEARD)!;
    const cardId = handCardId(withTreebeard, RESOURCE_PLAYER);

    const playActions = viableActions(withTreebeard, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.targetItemInstanceId === itemInstanceId);
    expect(playActions.length).toBeGreaterThan(0);
    expect(playActions.every(a => a.targetScoutInstanceId === treebeardId)).toBe(true);

    const next = resolveChain(dispatch(withTreebeard, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: treebeardId,
      targetItemInstanceId: itemInstanceId,
    }));

    const legolasAfter = next.players[0].characters[
      (Object.keys(next.players[0].characters) as CardInstanceId[]).find(
        k => next.players[0].characters[k].definitionId === LEGOLAS,
      )!
    ];
    const treebeardAfter = legolasAfter.allies.find(a => a.instanceId === treebeardId)!;
    expect(treebeardAfter.status).toBe(CardStatus.Tapped);

    // The item untapped despite the ally paying the cost.
    expect(legolasAfter.items.find(i => i.instanceId === itemInstanceId)!.status).toBe(CardStatus.Untapped);

    // Rule 7.4: allies never make corruption checks.
    expect(next.pendingResolutions).toHaveLength(0);
  });

  test('opponent has no actions while the sage resolves the corruption check', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [WIELDED_TWICE], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const withItem = setItemStatus(attachItemToChar(state, RESOURCE_PLAYER, ELROND, ANNUMINAS), RESOURCE_PLAYER, ELROND, ANNUMINAS, CardStatus.Tapped);
    const itemInstanceId = findItemInstanceId(withItem, RESOURCE_PLAYER, ANNUMINAS);
    const cardId = handCardId(withItem, RESOURCE_PLAYER);
    const elrondId = Object.keys(withItem.players[0].characters)[0] as unknown as CardInstanceId;

    const next = resolveChain(dispatch(withItem, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: elrondId,
      targetItemInstanceId: itemInstanceId,
    }));

    const opponentActions = computeLegalActions(next, PLAYER_2);
    expect(opponentActions).toHaveLength(0);
  });

  test('playable during organization phase (CoE 2.1.1)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [WIELDED_TWICE], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const withItem = setItemStatus(attachItemToChar(state, RESOURCE_PLAYER, ELROND, ANNUMINAS), RESOURCE_PLAYER, ELROND, ANNUMINAS, CardStatus.Tapped);
    const playActions = viableActions(withItem, PLAYER_1, 'play-short-event');
    expect(playActions.length).toBeGreaterThan(0);
  });

  test('playable during site phase select-company step (CoE 2.1.1)', () => {
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [WIELDED_TWICE], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const withItem = setItemStatus(attachItemToChar(base, RESOURCE_PLAYER, ELROND, ANNUMINAS), RESOURCE_PLAYER, ELROND, ANNUMINAS, CardStatus.Tapped);
    const state = { ...withItem, phaseState: makeSitePhase({ step: 'select-company', siteEntered: false }) };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions.length).toBeGreaterThan(0);
  });

  test('playable during movement-hazard phase (CoE 2.1.1)', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [WIELDED_TWICE], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const withItem = setItemStatus(attachItemToChar(base, RESOURCE_PLAYER, ELROND, ANNUMINAS), RESOURCE_PLAYER, ELROND, ANNUMINAS, CardStatus.Tapped);
    const state = { ...withItem, phaseState: makeMHState() };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions.length).toBeGreaterThan(0);
  });

  test('playable during end-of-turn discard step (CoE 2.1.1)', () => {
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [WIELDED_TWICE], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const withItem = setItemStatus(attachItemToChar(state, RESOURCE_PLAYER, ELROND, ANNUMINAS), RESOURCE_PLAYER, ELROND, ANNUMINAS, CardStatus.Tapped);
    const playActions = viableActions(withItem, PLAYER_1, 'play-short-event');
    expect(playActions.length).toBeGreaterThan(0);
  });

  test('not offered to non-active player during end-of-turn discard step', () => {
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [SARUMAN] }], hand: [WIELDED_TWICE], siteDeck: [LORIEN] },
      ],
    });
    const withItem = setItemStatus(attachItemToChar(state, 1, SARUMAN, ANNUMINAS), 1, SARUMAN, ANNUMINAS, CardStatus.Tapped);
    const playActions = viableActions(withItem, PLAYER_2, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('a tapped sage ally is not offered as a tap target', () => {
    const base = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [WIELDED_TWICE], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const withItem = setItemStatus(attachItemToChar(base, RESOURCE_PLAYER, LEGOLAS, ANNUMINAS), RESOURCE_PLAYER, LEGOLAS, ANNUMINAS, CardStatus.Tapped);
    const withTreebeard = attachAllyToChar(withItem, RESOURCE_PLAYER, LEGOLAS, TREEBEARD);
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

  test('multiple sages emit distinct actions carrying the same item target', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [SARUMAN, GLORFINDEL_II] }], hand: [WIELDED_TWICE], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const withItem = setItemStatus(attachItemToChar(state, RESOURCE_PLAYER, SARUMAN, ANNUMINAS), RESOURCE_PLAYER, SARUMAN, ANNUMINAS, CardStatus.Tapped);
    const itemInstanceId = findItemInstanceId(withItem, RESOURCE_PLAYER, ANNUMINAS);

    const playActions = viableActions(withItem, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.targetItemInstanceId === itemInstanceId);
    expect(playActions).toHaveLength(2);
    const sages = new Set(playActions.map(a => a.targetScoutInstanceId));
    expect(sages.size).toBe(2);
  });
});
