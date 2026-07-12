/**
 * @module le-57.test
 *
 * Card test: Ûvatha the Ringwraith (le-57)
 * Type: minion-character (ringwraith avatar), alignment ringwraith.
 * Stats: prowess 9, body 9, direct influence 5, mind null.
 *
 * Card text (authoritative — data/cards.json LE-57):
 *   "Unique. Manifestation of Ûvatha the Horseman. Can use spirit-magic.
 *    -3 direct influence in Heralded Lord mode. -1 prowess in Fell Rider mode.
 *    He may join another Ringwraith's company during your organization phase and
 *    requires no influence to control. As your Ringwraith, if at a Darkhaven
 *    [{DH}], he may tap during your organization phase to move one resource
 *    event card from your discard pile to your play deck and reshuffle."
 *
 * Effects tested:
 * 1. stat-modifier: -3 direct influence in Heralded Lord mode.
 * 2. stat-modifier: -1 prowess in Fell Rider mode.
 * 3. ringwraith-self-follower: Ûvatha may be played from hand as a follower of
 *    the player's revealed Ringwraith with no influence, EVEN when that revealed
 *    Ringwraith has no `ringwraith-follower-slots` ability (he grants his own
 *    slot). Enters at a Darkhaven / his home site, controlled by the avatar.
 * 4. grant-action recall-to-deck: as the revealed Ringwraith at a Darkhaven, tap
 *    during the organization phase to move one resource *event* card from the
 *    discard pile to the play deck (reshuffle). Not offered off a Darkhaven,
 *    when tapped, or when Ûvatha is a follower (not the revealed avatar).
 *
 * Fixture alignment: minion (ringwraith) — minion sites (LE) and minion cards.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  getCharacter, companyIdAt, addCardInPlay, recomputeDerived,
  viablePlayCharacterActions, nonViablePlayCharacterActions,
  viableActions, findCharInstanceId, handCardId, dispatch,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Alignment, computeLegalActions } from '../../index.js';
import type { ActivateGrantedAction, CardDefinitionId, GameState } from '../../index.js';

const UVATHA = 'le-57' as CardDefinitionId;

// Other Ringwraith avatars.
const ADUNAPHEL = 'le-50' as CardDefinitionId;      // no follower-slots ability
const THE_WITCH_KING = 'le-58' as CardDefinitionId; // 2 follower slots
const DWAR = 'le-52' as CardDefinitionId;           // plain follower, no self-grant
const KHAMUL = 'le-55' as CardDefinitionId;         // homesite: Dol Guldur

// Ringwraith mode cards that establish the company's mode.
const HERALDED_LORD = 'le-190' as CardDefinitionId;
const FELL_RIDER = 'le-183' as CardDefinitionId;

// Minion sites.
const DOL_GULDUR = 'le-367' as CardDefinitionId;      // Darkhaven (siteType haven)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;    // Darkhaven (siteType haven)
const MOUNT_DOOM_MINION = 'le-393' as CardDefinitionId; // shadow-hold, NOT a Darkhaven
// Hero site so the opposing player has a legal position.
const MINAS_TIRITH = 'tw-407' as CardDefinitionId;

// Minion cards for the fetch-filter test.
const ORC_QUARRELS = 'le-216' as CardDefinitionId;   // minion-resource-event
const BLACK_MACE = 'le-299' as CardDefinitionId;     // minion-resource-item
const OSTISEN = 'le-36' as CardDefinitionId;         // minion-character

describe('Ûvatha the Ringwraith (le-57)', () => {
  beforeEach(() => resetMint());

  // ─── Per-mode stat changes ─────────────────────────────────────────────────

  test('base stats with no mode card: prowess 9, direct influence 5', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [UVATHA] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const u = getCharacter(state, RESOURCE_PLAYER, UVATHA);
    expect(u.effectiveStats.prowess).toBe(9);
    expect(u.effectiveStats.directInfluence).toBe(5);
  });

  test('-3 direct influence in Heralded Lord mode (prowess unchanged)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [UVATHA] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    state = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, HERALDED_LORD, companyIdAt(state, RESOURCE_PLAYER)));
    const u = getCharacter(state, RESOURCE_PLAYER, UVATHA);
    expect(u.effectiveStats.directInfluence).toBe(2); // 5 - 3
    expect(u.effectiveStats.prowess).toBe(9); // Fell Rider bonus does not apply
  });

  test('-1 prowess in Fell Rider mode (direct influence unchanged)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [UVATHA] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    state = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, FELL_RIDER, companyIdAt(state, RESOURCE_PLAYER)));
    const u = getCharacter(state, RESOURCE_PLAYER, UVATHA);
    expect(u.effectiveStats.prowess).toBe(8); // 9 - 1
    expect(u.effectiveStats.directInfluence).toBe(5); // Heralded Lord bonus does not apply
  });

  // ─── ringwraith-self-follower: "may join another Ringwraith's company" ─────

  test('Ûvatha may join a revealed Ringwraith that has no follower ability of its own', () => {
    // Adûnaphel (revealed avatar) has no ringwraith-follower-slots effect. A
    // plain second Ringwraith could not be played (rule 2.II.2.1.1), but
    // Ûvatha's self-granted follower ability lets him join her company.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ADUNAPHEL] }], hand: [UVATHA], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const adunId = findCharInstanceId(state, RESOURCE_PLAYER, ADUNAPHEL);
    const siteId = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].characterInstanceId).toBe(handCardId(state, RESOURCE_PLAYER));
    expect(viable[0].controlledBy).toBe(adunId);
    expect(viable[0].atSite).toBe(siteId);
  });

  test('a plain Ringwraith (no self-grant) still cannot join a slot-less avatar', () => {
    // Contrast with Ûvatha: Dwar has no self-follower ability, so with a
    // slot-less avatar (Adûnaphel) revealed he cannot be played at all.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ADUNAPHEL] }], hand: [DWAR], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
    expect(nonViablePlayCharacterActions(state, PLAYER_1)).toHaveLength(1);
  });

  test('playing Ûvatha as a follower consumes no influence and joins the company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ADUNAPHEL] }], hand: [UVATHA], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const [followerPlay] = viablePlayCharacterActions(state, PLAYER_1);
    const after = dispatch(state, followerPlay);

    const adun = getCharacter(after, RESOURCE_PLAYER, ADUNAPHEL);
    const uvatha = getCharacter(after, RESOURCE_PLAYER, UVATHA);
    expect(uvatha.controlledBy).toBe(adun.instanceId);
    expect(adun.followers).toContain(uvatha.instanceId);
    expect(after.players[RESOURCE_PLAYER].companies[0].characters).toContain(uvatha.instanceId);
    // A null-mind follower deducts no influence.
    expect(after.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(0);
  });

  test('Ûvatha may join even when the host avatar has no remaining follower slots', () => {
    // The Witch-king's two slots are both used (Khamûl + Dwar). A third plain
    // Ringwraith would be blocked, but Ûvatha grants his own slot and is
    // therefore still playable.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: DOL_GULDUR,
            characters: [THE_WITCH_KING, { defId: KHAMUL, followerOf: 0 }, { defId: DWAR, followerOf: 0 }],
          }],
          hand: [UVATHA],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const wkId = findCharInstanceId(state, RESOURCE_PLAYER, THE_WITCH_KING);

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].characterInstanceId).toBe(handCardId(state, RESOURCE_PLAYER));
    expect(viable[0].controlledBy).toBe(wkId);
  });

  test('Ûvatha cannot join when the host is at neither a Darkhaven nor his home site', () => {
    // Adûnaphel's company is at Mount Doom (shadow-hold in Gorgoroth). Ûvatha's
    // home is "Any site in Khand", so this is neither a Darkhaven nor his home
    // site — he may not join here (CoE 2.II.2.1.R4).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MOUNT_DOOM_MINION, characters: [ADUNAPHEL] }], hand: [UVATHA], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
    expect(nonViablePlayCharacterActions(state, PLAYER_1)).toHaveLength(1);
  });

  // ─── grant-action recall-to-deck (resource event, at a Darkhaven) ──────────

  test('recall-to-deck is offered as the revealed Ringwraith at a Darkhaven, untapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [UVATHA] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          discardPile: [ORC_QUARRELS],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'recall-to-deck');
    expect(actions).toHaveLength(1);
  });

  test('recall-to-deck is NOT offered off a Darkhaven', () => {
    // At Mount Doom (shadow-hold), the Darkhaven gate (bearer.atHaven) fails.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MOUNT_DOOM_MINION, characters: [UVATHA] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          discardPile: [ORC_QUARRELS],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'recall-to-deck');
    expect(actions).toHaveLength(0);
  });

  test('recall-to-deck is NOT offered when Ûvatha is tapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: UVATHA, status: CardStatus.Tapped }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          discardPile: [ORC_QUARRELS],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'recall-to-deck');
    expect(actions).toHaveLength(0);
  });

  test('recall-to-deck is NOT offered when Ûvatha is a follower (not the revealed avatar)', () => {
    // Ûvatha follows the Witch-king at a Darkhaven. The `bearer.isRevealedAvatar`
    // gate is false for a follower, so his ability is not available.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_WITCH_KING, { defId: UVATHA, followerOf: 0 }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          discardPile: [ORC_QUARRELS],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'recall-to-deck');
    expect(actions).toHaveLength(0);
  });

  test('fetch offers only resource events — not items or characters in the discard pile', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [UVATHA] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          playDeck: [MINAS_MORGUL],
          discardPile: [ORC_QUARRELS, BLACK_MACE, OSTISEN],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const activate = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'recall-to-deck')!;
    const after = dispatch(state, activate.action);

    // Tapping Ûvatha to activate.
    const uId = findCharInstanceId(after, RESOURCE_PLAYER, UVATHA);
    expect(after.players[RESOURCE_PLAYER].characters[uId].status).toBe(CardStatus.Tapped);

    const fetchActions = computeLegalActions(after, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');

    const eventInst = after.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === ORC_QUARRELS)!;
    const itemInst = after.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === BLACK_MACE)!;
    const charInst = after.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === OSTISEN)!;

    const fetchedIds = fetchActions.map(ea => (ea.action as { cardInstanceId: string }).cardInstanceId);
    expect(fetchedIds).toContain(eventInst.instanceId as unknown as string);
    expect(fetchedIds).not.toContain(itemInst.instanceId as unknown as string);
    expect(fetchedIds).not.toContain(charInst.instanceId as unknown as string);
  });

  test('fetch moves the chosen resource event from discard to the play deck', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [UVATHA] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          playDeck: [MINAS_MORGUL],
          discardPile: [ORC_QUARRELS],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const activate = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'recall-to-deck')!;
    const after = dispatch(state, activate.action);

    const fetchActions = computeLegalActions(after, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    expect(fetchActions).toHaveLength(1);

    const playDeckBefore = after.players[0].playDeck.length;
    const discardBefore = after.players[0].discardPile.length;

    const afterFetch: GameState = dispatch(after, fetchActions[0].action);
    expect(afterFetch.players[0].discardPile).toHaveLength(discardBefore - 1);
    expect(afterFetch.players[0].playDeck).toHaveLength(playDeckBefore + 1);
    expect(afterFetch.players[0].playDeck.some(c => c.definitionId === ORC_QUARRELS)).toBe(true);
    expect(afterFetch.players[0].discardPile.some(c => c.definitionId === ORC_QUARRELS)).toBe(false);
    expect(afterFetch.pendingEffects).toHaveLength(0);
  });
});
