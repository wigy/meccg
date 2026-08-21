/**
 * @module ba-62.test
 *
 * Card test: Great Shadow (ba-62)
 * Type: minion-resource-event (permanent), keyword "Demon fána"
 * Alignment: Balrog specific
 *
 * Text:
 *   "Balrog specific. Demon fána. Playable during your organization phase on
 *    The Balrog. Return this card to your hand: when you play another Demon
 *    fána card, or, if you choose, during your organization phase. +6 general
 *    influence; -2 prowess; -1 body. The Balrog gains scout skill and may have
 *    followers. During your end-of-turn phase, you may take one non-short-event
 *    resource or character from your discard pile (show it to your opponent)
 *    and shuffle it into your play deck. The Balrog may tap to cancel an attack
 *    against his company."
 *
 * Engine support:
 * | # | Rule                                                        | Status      |
 * |---|--------------------------------------------------------------|-------------|
 * | 1 | Playable only on The Balrog, during organization phase       | IMPLEMENTED |
 * | 2 | On-play: bounce another Demon fána card on the Balrog to hand| IMPLEMENTED |
 * | 3 | Return-to-hand grant-action, free, during organization phase | IMPLEMENTED |
 * | 4 | +6 general influence                                         | IMPLEMENTED |
 * | 5 | -2 prowess, -1 body                                          | IMPLEMENTED |
 * | 6 | The Balrog gains scout skill                                 | IMPLEMENTED |
 * | 7 | The Balrog may have followers (overrides ba-3's restriction)| IMPLEMENTED |
 * | 8 | End-of-turn: fetch one non-short-event resource/character    | IMPLEMENTED |
 * |   | from discard pile, shuffle into play deck (tap bearer)       |             |
 * | 9 | The Balrog may tap to cancel an attack against his company   | IMPLEMENTED |
 *
 * The "show it to your opponent" clause (rule 8) is a reveal instruction with
 * no mechanical consequence on legal actions or state — not separately tested.
 *
 * Fixture alignment: Balrog-specific minion card, so tests use Balrog-alignment
 * fixtures (The Balrog ba-3, Crook-legged Orc ba-6, ba-84 dark-hold site) plus
 * generic minion resource/character/hazard cards for the discard-pile fetch.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  Phase, CardStatus, Alignment,
  buildTestState, resetMint, recomputeDerived,
  viableActions, dispatch,
  findCharInstanceId, findHandCardId, getCharacter,
  attachItemToChar, playPermanentEventAndResolve, addCardToDiscardPile,
  grantedActionsFor, viablePlayCharacterActions,
  makeCancelWindowCombat, expectCharStatus,
} from '../test-helpers.js';
import { getItemGrantedSkills } from '../../engine/effects/index.js';
import { computeLegalActions, Race } from '../../index.js';
import type { ActivateGrantedAction, CardDefinitionId } from '../../index.js';

// ── Local card-ID constants ───────────────────────────────────────────────────

/** Great Shadow — the card under test */
const GREAT_SHADOW = 'ba-62' as CardDefinitionId;
/** The Balrog — Balrog avatar, mind null */
const THE_BALROG = 'ba-3' as CardDefinitionId;
/** Crook-legged Orc — Balrog-specific, non-unique, mind 2, no Leader keyword */
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;
/** Barad-dûr (BA) — dark-hold, surface (non-under-deeps) */
const BARAD_DUR_BA = 'ba-84' as CardDefinitionId;
/** The Under-gates (BA) — haven, under-deeps; Crook-legged Orc's homesite region */
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId;
/** Black Mace — minion-resource-item, valid discard-pile fetch target */
const BLACK_MACE = 'le-299' as CardDefinitionId;
/** Orc Quarrels — minion-resource-event (short), excluded by "non-short-event" */
const ORC_QUARRELS = 'le-216' as CardDefinitionId;
/** Barrow-wight — minion hazard creature, excluded (wrong cardType) */
const BARROW_WIGHT = 'le-61' as CardDefinitionId;

// ── State builders ────────────────────────────────────────────────────────────

function orgState(opts: {
  companyChars?: CardDefinitionId[];
  hand?: CardDefinitionId[];
  site?: CardDefinitionId;
}) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Balrog,
        companies: [{ site: opts.site ?? BARAD_DUR_BA, characters: opts.companyChars ?? [THE_BALROG] }],
        hand: opts.hand ?? [GREAT_SHADOW],
        siteDeck: [],
      },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
    ],
  });
}

describe('Great Shadow (ba-62)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Playable only on The Balrog ──────────────────────────────────

  test('playable on The Balrog', () => {
    const state = orgState({});
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const target = (actions[0].action as { targetCharacterId?: unknown }).targetCharacterId;
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    expect(target).toBe(balrogId);
  });

  test('NOT playable on a non-Balrog character', () => {
    const state = orgState({ companyChars: [CROOK_LEGGED_ORC] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('generates exactly one action when the Balrog shares a company with another character', () => {
    const state = orgState({ companyChars: [THE_BALROG, CROOK_LEGGED_ORC] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
  });

  test('NOT playable outside the organization phase, e.g. during end-of-turn', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: BARAD_DUR_BA, characters: [THE_BALROG] }],
          hand: [GREAT_SHADOW],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Rule 2: On-play bounce of another Demon fána card ────────────────────

  test('entering play does not bounce anything when the Balrog has no other Demon fána card', () => {
    const base = orgState({});
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, GREAT_SHADOW);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, balrogId);
    expect(getCharacter(after, RESOURCE_PLAYER, THE_BALROG).items).toHaveLength(1);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
  });

  test('bounces an existing Demon fána card on the Balrog back to hand when a new one is played', () => {
    const base = orgState({ hand: [GREAT_SHADOW, GREAT_SHADOW] });
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    // Attach first copy directly to simulate a pre-existing Demon fána card
    const withFirstAttached = attachItemToChar(base, RESOURCE_PLAYER, THE_BALROG, GREAT_SHADOW);
    expect(getCharacter(withFirstAttached, RESOURCE_PLAYER, THE_BALROG).items).toHaveLength(1);
    // Play second copy from hand
    const secondCardId = findHandCardId(withFirstAttached, RESOURCE_PLAYER, GREAT_SHADOW);
    const after = playPermanentEventAndResolve(withFirstAttached, PLAYER_1, secondCardId, balrogId);
    // The first copy should be bounced, leaving only the newly played copy
    expect(getCharacter(after, RESOURCE_PLAYER, THE_BALROG).items).toHaveLength(1);
    const handDefIds = after.players[RESOURCE_PLAYER].hand.map(c => c.definitionId as string);
    expect(handDefIds).toContain(GREAT_SHADOW as string);
  });

  // ── Rule 3: Return-to-hand grant-action ──────────────────────────────────

  test('return-self-to-hand grant-action is available during organization phase', () => {
    const base = orgState({});
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, GREAT_SHADOW);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, cardId, balrogId);
    const returnActions = grantedActionsFor(attached, balrogId, 'return-self-to-hand', PLAYER_1);
    expect(returnActions.length).toBe(1);
  });

  test('return-self-to-hand moves the card from Balrog items back to hand', () => {
    const base = orgState({});
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, GREAT_SHADOW);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, cardId, balrogId);
    expect(getCharacter(attached, RESOURCE_PLAYER, THE_BALROG).items).toHaveLength(1);
    expect(attached.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    const returnActions = grantedActionsFor(attached, balrogId, 'return-self-to-hand', PLAYER_1);
    const after = dispatch(attached, returnActions[0]);
    expect(getCharacter(after, RESOURCE_PLAYER, THE_BALROG).items).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(1);
    expect(after.players[RESOURCE_PLAYER].hand[0].definitionId).toBe(GREAT_SHADOW);
  });

  // ── Rule 4 & 5: +6 general influence; -2 prowess; -1 body ────────────────

  test('+6 general influence while attached', () => {
    const base = orgState({});
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, GREAT_SHADOW);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, balrogId);
    expect(after.players[RESOURCE_PLAYER].generalInfluenceBonus).toBe(6);
  });

  test('general influence bonus returns to 0 when the card leaves play', () => {
    const base = orgState({});
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, GREAT_SHADOW);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, cardId, balrogId);
    expect(attached.players[RESOURCE_PLAYER].generalInfluenceBonus).toBe(6);
    const returnActions = grantedActionsFor(attached, balrogId, 'return-self-to-hand', PLAYER_1);
    const after = dispatch(attached, returnActions[0]);
    expect(after.players[RESOURCE_PLAYER].generalInfluenceBonus).toBe(0);
  });

  test('-2 prowess and -1 body applied to the Balrog while attached', () => {
    const base = orgState({});
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, GREAT_SHADOW);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, balrogId);
    const basePool = base.cardPool[THE_BALROG] as { prowess: number; body: number };
    const balrog = getCharacter(after, RESOURCE_PLAYER, THE_BALROG);
    expect(balrog.effectiveStats.prowess).toBe(basePool.prowess - 2);
    expect(balrog.effectiveStats.body).toBe(basePool.body - 1);
  });

  // ── Rule 6: Grants scout skill ────────────────────────────────────────────

  test('grants the Balrog scout skill while attached', () => {
    const base = orgState({});
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    expect(getItemGrantedSkills(base, base.players[RESOURCE_PLAYER].characters[balrogId]))
      .not.toContain('scout');

    const withFana = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, THE_BALROG, GREAT_SHADOW));
    expect(getItemGrantedSkills(withFana, withFana.players[RESOURCE_PLAYER].characters[balrogId]))
      .toContain('scout');
  });

  // ── Rule 7: May have followers ────────────────────────────────────────────

  describe('may have followers', () => {
    test('negative control: without Great Shadow, the Balrog is never offered as a DI controller', () => {
      const state = orgState({ hand: [CROOK_LEGGED_ORC], site: THE_UNDER_GATES_BA });
      const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
      const actions = viablePlayCharacterActions(state, PLAYER_1);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.some(a => a.controlledBy === balrogId)).toBe(false);
    });

    test('with Great Shadow attached, the Balrog IS offered as a DI controller', () => {
      const base = orgState({ hand: [CROOK_LEGGED_ORC], site: THE_UNDER_GATES_BA });
      const withFana = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, THE_BALROG, GREAT_SHADOW));
      const balrogId = findCharInstanceId(withFana, RESOURCE_PLAYER, THE_BALROG);
      const actions = viablePlayCharacterActions(withFana, PLAYER_1);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.some(a => a.controlledBy === balrogId)).toBe(true);
    });
  });

  // ── Rule 8: End-of-turn discard-pile-to-deck reshuffle ───────────────────

  describe('end-of-turn discard-pile fetch', () => {
    function eotState(discardPile: CardDefinitionId[], opts: { tapped?: boolean; playDeck?: CardDefinitionId[] } = {}) {
      return buildTestState({
        phase: Phase.EndOfTurn,
        activePlayer: PLAYER_1,
        recompute: true,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Balrog,
            companies: [{
              site: BARAD_DUR_BA,
              characters: [{ defId: THE_BALROG, status: opts.tapped ? CardStatus.Tapped : CardStatus.Untapped, items: [GREAT_SHADOW] }],
            }],
            hand: [],
            discardPile,
            playDeck: opts.playDeck ?? [],
            siteDeck: [],
          },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
        ],
      });
    }

    test('recall-to-deck grant-action is offered during end-of-turn discard step when untapped', () => {
      const state = eotState([BLACK_MACE]);
      const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
      const recallActions = actions.filter(
        ea => (ea.action as ActivateGrantedAction).actionId === 'recall-to-deck',
      );
      expect(recallActions).toHaveLength(1);
    });

    test('recall-to-deck is NOT offered when the Balrog is tapped', () => {
      const state = eotState([BLACK_MACE], { tapped: true });
      const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
      const recallActions = actions.filter(
        ea => (ea.action as ActivateGrantedAction).actionId === 'recall-to-deck',
      );
      expect(recallActions).toHaveLength(0);
    });

    test('recall-to-deck is NOT offered during the organization phase', () => {
      const state = orgState({});
      const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
      const withFana = attachItemToChar(state, RESOURCE_PLAYER, THE_BALROG, GREAT_SHADOW);
      const withDiscard = recomputeDerived(addCardToDiscardPile(withFana, RESOURCE_PLAYER, BLACK_MACE));
      const actions = viableActions(withDiscard, PLAYER_1, 'activate-granted-action');
      const recallActions = actions.filter(ea => {
        const action = ea.action as ActivateGrantedAction;
        return action.actionId === 'recall-to-deck' && action.characterId === balrogId;
      });
      expect(recallActions).toHaveLength(0);
    });

    test('activating recall-to-deck taps the Balrog and enqueues a fetch-to-deck pending effect', () => {
      const state = eotState([BLACK_MACE]);
      const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
      const recallAction = actions.find(
        ea => (ea.action as ActivateGrantedAction).actionId === 'recall-to-deck',
      )!;
      const next = dispatch(state, recallAction.action);

      expectCharStatus(next, RESOURCE_PLAYER, THE_BALROG, CardStatus.Tapped);

      expect(next.pendingEffects).toHaveLength(1);
      expect(next.pendingEffects[0].type).toBe('card-effect');
      const effect = (next.pendingEffects[0] as { effect: { type: string; source: readonly string[] } }).effect;
      expect(effect.type).toBe('fetch-to-deck');
      expect(effect.source).toEqual(['discard-pile']);
    });

    test('offers minion characters/items but excludes short-events and hazards', () => {
      const state = eotState([BLACK_MACE, ORC_QUARRELS, BARROW_WIGHT]);
      const activateActions = viableActions(state, PLAYER_1, 'activate-granted-action');
      const recallAction = activateActions.find(
        ea => (ea.action as ActivateGrantedAction).actionId === 'recall-to-deck',
      )!;
      const afterActivation = dispatch(state, recallAction.action);

      const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
        .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');

      const maceInstance = afterActivation.players[0].discardPile.find(c => c.definitionId === BLACK_MACE)!;
      const quarrelsInstance = afterActivation.players[0].discardPile.find(c => c.definitionId === ORC_QUARRELS)!;
      const wightInstance = afterActivation.players[0].discardPile.find(c => c.definitionId === BARROW_WIGHT)!;

      const fetchedIds = fetchActions.map(ea => (ea.action as { cardInstanceId: string }).cardInstanceId);
      expect(fetchedIds).toContain(maceInstance.instanceId as unknown as string);
      expect(fetchedIds).not.toContain(quarrelsInstance.instanceId as unknown as string);
      expect(fetchedIds).not.toContain(wightInstance.instanceId as unknown as string);
    });

    test('fetch moves the chosen card from discard to play deck (reshuffle)', () => {
      const state = eotState([BLACK_MACE]);
      const activateActions = viableActions(state, PLAYER_1, 'activate-granted-action');
      const recallAction = activateActions.find(
        ea => (ea.action as ActivateGrantedAction).actionId === 'recall-to-deck',
      )!;
      const afterActivation = dispatch(state, recallAction.action);

      const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
        .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
      expect(fetchActions).toHaveLength(1);

      const afterFetch = dispatch(afterActivation, fetchActions[0].action);
      expect(afterFetch.players[0].discardPile).toHaveLength(0);
      expect(afterFetch.players[0].playDeck.some(c => c.definitionId === BLACK_MACE)).toBe(true);
      expect(afterFetch.pendingEffects).toHaveLength(0);
    });
  });

  // ── Rule 9: Cancel an attack against his company ─────────────────────────

  describe('cancel-attack (tap the Balrog)', () => {
    function combatState(opts: { tapped?: boolean } = {}) {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Balrog,
            companies: [{
              site: BARAD_DUR_BA,
              characters: [{ defId: THE_BALROG, status: opts.tapped ? CardStatus.Tapped : CardStatus.Untapped }],
            }],
            hand: [],
            siteDeck: [],
          },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
        ],
      });
      const withFana = attachItemToChar(base, RESOURCE_PLAYER, THE_BALROG, GREAT_SHADOW);
      return makeCancelWindowCombat(withFana, { creatureRace: Race.Orc });
    }

    test('cancel-attack is offered against any attack (no race restriction) when untapped', () => {
      const state = combatState();
      const actions = viableActions(state, PLAYER_1, 'cancel-attack');
      expect(actions).toHaveLength(1);
      expect(actions[0].action.type).toBe('cancel-attack');
    });

    test('cancel-attack is NOT offered when the Balrog is already tapped', () => {
      const state = combatState({ tapped: true });
      const actions = viableActions(state, PLAYER_1, 'cancel-attack');
      expect(actions).toHaveLength(0);
    });

    test('activating cancel-attack cancels combat immediately and taps the Balrog', () => {
      const state = combatState();
      const actions = viableActions(state, PLAYER_1, 'cancel-attack');
      const after = dispatch(state, actions[0].action);

      expect(after.combat).toBeNull();
      expect(after.chain).toBeNull();
      expectCharStatus(after, RESOURCE_PLAYER, THE_BALROG, CardStatus.Tapped);
    });
  });
});
