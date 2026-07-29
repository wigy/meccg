/**
 * @module le-54.test
 *
 * Card test: Indûr the Ringwraith (le-54)
 * Type: minion-character (ringwraith avatar), alignment ringwraith.
 * Stats: prowess 9, body 10, direct influence 5, mind null.
 * Skills: warrior, diplomat, sorcery, spirit-magic. Homesite: Any site in
 * Udûn or Imlad Morgul.
 *
 * Card text:
 *   "Unique. Manifestation of Indûr Dawndeath. Can use sorcery and
 *    spirit-magic. -1 direct influence in Heralded Lord mode. -3 prowess in
 *    Fell Rider mode. As your Ringwraith, at the beginning of each of his
 *    end-of-turn phases, he may tap to take a magic card from your discard
 *    pile to your hand."
 *
 * Engine support:
 * | # | Feature                                            | Status      | Notes                                                          |
 * |---|----------------------------------------------------|-------------|----------------------------------------------------------------|
 * | 1 | -1 DI in Heralded Lord mode                        | IMPLEMENTED | stat-modifier gated on bearer.ringwraithMode                   |
 * | 2 | -3 prowess in Fell Rider mode                      | IMPLEMENTED | stat-modifier gated on bearer.ringwraithMode                   |
 * | 3 | End-of-turn tap → fetch a magic card discard→hand  | IMPLEMENTED | grant-action `indur-fetch-magic` (move select=target from=discard to=hand) |
 * | 4 | "magic card" = any spell (spell/sorcery/spirit/shadow-magic) | IMPLEMENTED | $or keyword filter on the move apply                 |
 * | 5 | "As your Ringwraith" gate (only the revealed avatar) | IMPLEMENTED | when bearer.isRevealedAvatar — Ringwraith followers excluded |
 * | 6 | Unique / Can use sorcery & spirit-magic            | DATA        | unique flag + skills array consumed by the engine              |
 * | 7 | Manifestation of Indûr Dawndeath (tw-46)           | IMPLEMENTED | `manifestId` chain + on-event self-enters-play discard (rule 3.06) |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  viableActions, dispatch,
  getCharacter, findCharInstanceId, companyIdAt, addCardInPlay, recomputeDerived,
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Alignment, CardStatus } from '../../index.js';
import type { ActivateGrantedAction, CardDefinitionId } from '../../index.js';

const INDUR = 'le-54' as CardDefinitionId;
// A second Ringwraith avatar, used as the revealed avatar when Indûr is a follower.
const KHAMUL = 'le-55' as CardDefinitionId;

// Ringwraith mode cards that establish the company's mode.
const HERALDED_LORD = 'le-190' as CardDefinitionId;
const FELL_RIDER = 'le-183' as CardDefinitionId;

// Minion magic ("spell") cards (different magic skill types).
const DEEPER_SHADOW = 'le-179' as CardDefinitionId;       // shadow-magic
const POISONOUS_DESPAIR = 'le-219' as CardDefinitionId;   // spirit-magic
// A non-magic minion card (must NOT be fetchable).
const BLACK_MACE = 'le-299' as CardDefinitionId;          // weapon item

// Minion Darkhaven, plus a second site to pad the site deck.
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

// Hero sites so the opposing player has a legal starting position.
const MINAS_TIRITH = 'tw-407' as CardDefinitionId;
const RIVENDELL = 'tw-404' as CardDefinitionId;

const fetchActionId = 'indur-fetch-magic';

describe('Indûr the Ringwraith (le-54)', () => {
  beforeEach(() => resetMint());

  // ── Per-mode stat changes ───────────────────────────────────────────────

  test('-1 direct influence in Heralded Lord mode (prowess unchanged)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [INDUR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    state = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, HERALDED_LORD, companyIdAt(state, RESOURCE_PLAYER)));
    const indur = getCharacter(state, RESOURCE_PLAYER, INDUR);
    expect(indur.effectiveStats.directInfluence).toBe(4); // 5 - 1
    expect(indur.effectiveStats.prowess).toBe(9);          // Fell Rider penalty does not apply
  });

  test('-3 prowess in Fell Rider mode (direct influence unchanged)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [INDUR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    state = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, FELL_RIDER, companyIdAt(state, RESOURCE_PLAYER)));
    const indur = getCharacter(state, RESOURCE_PLAYER, INDUR);
    expect(indur.effectiveStats.prowess).toBe(6);          // 9 - 3
    expect(indur.effectiveStats.directInfluence).toBe(5);  // Heralded Lord penalty does not apply
  });

  // ── End-of-turn magic-card fetch ─────────────────────────────────────────

  test('fetch action offered once per magic card in discard during end-of-turn', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [INDUR] }],
          hand: [],
          discardPile: [DEEPER_SHADOW, POISONOUS_DESPAIR],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === fetchActionId);
    expect(actions.length).toBe(2); // shadow-magic + spirit-magic both count as magic cards
    expect((actions[0].action as ActivateGrantedAction).targetCardId).toBeDefined();
  });

  test('activating the fetch moves the magic card to hand and taps Indûr', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [INDUR] }],
          hand: [],
          discardPile: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === fetchActionId)!.action;
    const next = dispatch(state, action);

    // Magic card moved discard → hand.
    expect(next.players[RESOURCE_PLAYER].hand.length).toBe(1);
    expect(next.players[RESOURCE_PLAYER].hand[0].definitionId).toBe(DEEPER_SHADOW);
    expect(next.players[RESOURCE_PLAYER].discardPile.length).toBe(0);

    // Indûr taps to pay the cost.
    expect(getCharacter(next, RESOURCE_PLAYER, INDUR).status).toBe(CardStatus.Tapped);
  });

  test('non-magic cards in discard are not fetchable', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [INDUR] }],
          hand: [],
          discardPile: [BLACK_MACE],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === fetchActionId);
    expect(actions.length).toBe(0);
  });

  test('fetch not available when Indûr is tapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: INDUR, status: CardStatus.Tapped }] }],
          hand: [],
          discardPile: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === fetchActionId);
    expect(actions.length).toBe(0);
  });

  test('fetch not available for the opposing (hazard) player', () => {
    const state = buildTestState({
      activePlayer: PLAYER_2,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [INDUR] }],
          hand: [],
          discardPile: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === fetchActionId);
    expect(actions.length).toBe(0);
  });

  // ── "As your Ringwraith" gate ────────────────────────────────────────────

  test('fetch NOT offered when Indûr is a Ringwraith follower (not the revealed avatar)', () => {
    // Khamûl is the revealed avatar; Indûr rides as his Ringwraith follower.
    // "As your Ringwraith" therefore does not apply to Indûr.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [KHAMUL, { defId: INDUR, followerOf: 0 }] }],
          hand: [],
          discardPile: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    // Sanity: Indûr really is controlled by Khamûl (a follower).
    const indurId = findCharInstanceId(state, RESOURCE_PLAYER, INDUR);
    expect(state.players[RESOURCE_PLAYER].characters[indurId].controlledBy).not.toBe('general');

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === fetchActionId);
    expect(actions.length).toBe(0);
  });

  test('fetch IS offered when Indûr is the revealed avatar (control sanity check)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [INDUR] }],
          hand: [],
          discardPile: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const indurId = findCharInstanceId(state, RESOURCE_PLAYER, INDUR);
    expect(state.players[RESOURCE_PLAYER].characters[indurId].controlledBy).toBe('general');

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === fetchActionId);
    expect(actions.length).toBe(1);
  });
});
