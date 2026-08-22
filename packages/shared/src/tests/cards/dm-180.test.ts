/**
 * @module dm-180.test
 *
 * Card test: Folco Boffin (dm-180)
 * Type: hero-character (wizard alignment) — unique Hobbit Scout, prowess 0,
 * body 9, mind 3, 1 MP, homesite Bag End.
 *
 * "Unique. Unless he is one of the starting characters, he may only be brought
 *  into play at his home site. All of his corruption checks are modified by +2.
 *  You may discard Folco Boffin at a Haven to play any Hobbit from your hand
 *  with his company."
 *
 * Effects (3):
 *  1. check-modifier corruption +2 — every corruption check Folco makes is
 *     eased by 2 (identical to Merry tw-170 / Sam tw-180).
 *  2. play-flag home-site-only (gated `$not starting-character`) — from hand he
 *     may only be brought into play at Bag End, but remains a legal starting
 *     draft pick.
 *  3. discard-to-recruit (requireHaven, filter target.race = hobbit) — while at
 *     a Haven the controller may discard Folco to bring any Hobbit from hand
 *     into his company. Per CRF 22 (Folco Boffin) this replacement "can be done
 *     at any time that a normal resource could be played", so it is offered in
 *     the organization, movement/hazard, and site phases alike. The incoming
 *     hobbit enters untapped at Folco's position with every attachment and
 *     control relationship transferred; Folco's card goes to the discard pile.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId, GameConfig } from '../../index.js';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, BILBO, HALDIR, GIMLI, FARAMIR, DAGGER_OF_WESTERNESSE,
  GLAMDRING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM,
  Phase, Alignment, CardStatus,
  buildTestState, buildSitePhaseState, resetMint,
  createGame, makePlayDeck, pool, draftInstId,
  viableActions, dispatch, findCharInstanceId, getCharacter,
  viablePlayCharacterActions, enqueueTransferCorruptionCheck,
  assertEveryInstanceReachable, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, reduce, BAG_END } from '../../index.js';
import type { CorruptionCheckAction, DiscardToRecruitAction } from '../../index.js';

const FOLCO = 'dm-180' as CardDefinitionId;

const OPPONENT = { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] };

describe('Folco Boffin (dm-180)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: check-modifier (corruption +2) ────────────────────────────

  test('+2 corruption modifier lowers the need on a pending corruption check', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BAG_END, characters: [{ defId: FOLCO, items: [GLAMDRING] }, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        OPPONENT,
      ],
    });

    const folcoId = findCharInstanceId(state, RESOURCE_PLAYER, FOLCO);
    const glamdringInstId = getCharacter(state, RESOURCE_PLAYER, FOLCO).items[0].instanceId;
    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, folcoId, glamdringInstId);

    const ccActions = computeLegalActions(stateWithCheck, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions).toHaveLength(1);
    expect(ccActions[0].characterId).toBe(folcoId);
    expect(ccActions[0].corruptionModifier).toBe(2);
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - 2);
  });

  // ── Effect 2: play-flag home-site-only ──────────────────────────────────

  test('can be played from hand at homesite Bag End', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [FOLCO], siteDeck: [BAG_END, MORIA] },
        OPPONENT,
      ],
    });

    const folcoAtBagEnd = viablePlayCharacterActions(state, PLAYER_1).filter(a => {
      const siteDef = state.cardPool[
        state.players[0].siteDeck.find(c => c.instanceId === a.atSite)?.definitionId as CardDefinitionId
      ];
      return siteDef && 'name' in siteDef && siteDef.name === 'Bag End';
    });
    expect(folcoAtBagEnd.length).toBeGreaterThanOrEqual(1);
  });

  test('cannot be played from hand at a haven (home-site-only restriction)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [FOLCO], siteDeck: [RIVENDELL, MORIA] },
        OPPONENT,
      ],
    });
    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
  });

  test('remains a viable starting-character draft pick', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1, name: 'Alice', alignment: Alignment.Wizard,
          draftPool: [ARAGORN, BILBO, FOLCO],
          playDeck: makePlayDeck(), siteDeck: [RIVENDELL, MORIA, MINAS_TIRITH, MOUNT_DOOM], sideboard: [],
        },
        {
          id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [LEGOLAS, GIMLI, FARAMIR, DAGGER_OF_WESTERNESSE],
          playDeck: makePlayDeck(), siteDeck: [LORIEN, MORIA, MINAS_TIRITH], sideboard: [],
        },
      ],
      seed: 42,
    };
    const state = createGame(config, pool);
    const folcoInstanceId = draftInstId(state, 0, FOLCO);
    const folcoPick = computeLegalActions(state, PLAYER_1).find(
      ea => ea.action.type === 'draft-pick' && ea.action.characterInstanceId === folcoInstanceId,
    );
    expect(folcoPick).toBeDefined();
    expect(folcoPick!.viable).toBe(true);
  });

  // ── Effect 3: discard-to-recruit (at a Haven, any Hobbit from hand) ──────

  test('discard-to-recruit is offered at a Haven with a Hobbit in hand', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FOLCO] }], hand: [BILBO], siteDeck: [MORIA] },
        OPPONENT,
      ],
    });
    const recruits = viableActions(state, PLAYER_1, 'discard-to-recruit');
    expect(recruits).toHaveLength(1);
    const action = recruits[0].action as DiscardToRecruitAction;
    expect(action.characterId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, FOLCO));
  });

  test('discard-to-recruit is NOT offered away from a Haven', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [FOLCO] }], hand: [BILBO], siteDeck: [RIVENDELL] },
        OPPONENT,
      ],
    });
    expect(viableActions(state, PLAYER_1, 'discard-to-recruit')).toHaveLength(0);
  });

  test('discard-to-recruit is NOT offered for a non-Hobbit in hand', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FOLCO] }], hand: [LEGOLAS], siteDeck: [MORIA] },
        OPPONENT,
      ],
    });
    expect(viableActions(state, PLAYER_1, 'discard-to-recruit')).toHaveLength(0);
  });

  test('discard-to-recruit is also offered in the site phase (CRF: any normal-resource window)', () => {
    const state = buildSitePhaseState({ characters: [FOLCO], site: RIVENDELL, hand: [BILBO] });
    expect(viableActions(state, PLAYER_1, 'discard-to-recruit')).toHaveLength(1);
  });

  test('discard-to-recruit is NOT offered for a unique Hobbit already in play (uniqueness)', () => {
    // Regression: the recruit is still a character play, so a unique character
    // already in play cannot be brought in a second time — the sibling
    // recruit-via-event path enforces this. Here the opponent already has
    // Bilbo in play, so the controller may not recruit their own Bilbo.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FOLCO] }], hand: [BILBO], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'discard-to-recruit')).toHaveLength(0);
  });

  test('the reducer rejects a recruit of a unique Hobbit already in play (backstop)', () => {
    // Even if a client bypasses the emitter, the reducer must not put a second
    // copy of a unique character into play.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FOLCO] }], hand: [BILBO], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const folcoId = findCharInstanceId(state, RESOURCE_PLAYER, FOLCO);
    const bilboInHand = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const result = reduce(state, {
      type: 'discard-to-recruit', player: PLAYER_1, characterId: folcoId, cardInstanceId: bilboInHand,
    });
    // The illegal recruit is refused: Folco stays in play, Bilbo stays in hand.
    expect(result.error).toBeDefined();
    expect(result.state.players[RESOURCE_PLAYER].characters[folcoId]).toBeDefined();
    expect(result.state.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === bilboInHand)).toBe(true);
  });

  test('resolving the recruit discards Folco and brings the Hobbit into his company with all cards transferred', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              { defId: FOLCO, items: [GLAMDRING] },
              { defId: HALDIR, followerOf: 0 },
            ],
          }],
          hand: [BILBO],
          siteDeck: [MORIA],
        },
        OPPONENT,
      ],
    });

    const folcoId = findCharInstanceId(state, RESOURCE_PLAYER, FOLCO);
    const haldirId = findCharInstanceId(state, RESOURCE_PLAYER, HALDIR);
    const folcoItems = state.players[0].characters[folcoId].items;
    expect(folcoItems).toHaveLength(1); // Glamdring attached in the fixture

    const recruits = viableActions(state, PLAYER_1, 'discard-to-recruit');
    expect(recruits).toHaveLength(1);
    const next = dispatch(state, recruits[0].action);

    // Folco left play and landed in the discard pile (recyclable, not removed).
    expect(next.players[0].characters[folcoId]).toBeUndefined();
    expect(next.players[0].discardPile.some(c => c.instanceId === folcoId)).toBe(true);
    expect(next.players[0].outOfPlayPile.some(c => c.instanceId === folcoId)).toBe(false);

    // Bilbo is in play, untapped, at Folco's position in the company.
    const bilboId = findCharInstanceId(next, RESOURCE_PLAYER, BILBO);
    const bilbo = next.players[0].characters[bilboId];
    expect(bilbo.status).toBe(CardStatus.Untapped);
    expect(next.players[0].companies[0].characters[0]).toBe(bilboId);
    expect(next.players[0].companies[0].characters).toHaveLength(2);

    // All cards on Folco transferred: Glamdring rides along.
    expect(bilbo.items.map(i => i.instanceId)).toEqual(folcoItems.map(i => i.instanceId));

    // Control relationships transferred: Haldir now follows Bilbo.
    expect(next.players[0].characters[haldirId].controlledBy).toBe(bilboId);
    expect(bilbo.followers).toContain(haldirId);

    // Bilbo left the hand; no instance disappeared anywhere.
    expect(next.players[0].hand).toHaveLength(0);
    assertEveryInstanceReachable(next);
  });
});
