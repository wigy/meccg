/**
 * @module as-56.test
 *
 * Card test: The Sun Unveiled (as-56)
 * Type: hero-resource-event (short)
 * Text: "Playable on a character at a Free-hold [{F}] if Gates of Morning is
 *  in play. Remove all hazard permanent-events on the character and, if
 *  tapped, untap him. Cannot be included in a Fallen-wizard's deck."
 *
 * Effects:
 *   1. play-target character — filter { company.siteType: free-hold,
 *      inPlay: "Gates of Morning" } (gates playability to a character at a
 *      Free-hold while Gates of Morning is in play).
 *   2. move { select: filter-all, from: hazards-on-target, to: discard,
 *      toOwner: source-owner, filter: permanent hazard-event } — removes every
 *      hazard permanent-event on the target character to its owner's discard.
 *   3. on-event self-enters-play → set-character-status untapped — untaps the
 *      target character (idempotent, so "if tapped, untap him").
 *
 * Engine Support:
 * | # | Feature                                              | Status      | Notes                                    |
 * |---|------------------------------------------------------|-------------|------------------------------------------|
 * | 1 | Free-hold + Gates-of-Morning play gate (DSL filter)  | IMPLEMENTED | play-target filter company.siteType/inPlay |
 * | 2 | Remove all hazard permanent-events on the character  | IMPLEMENTED | move from hazards-on-target (new MoveZone) |
 * | 3 | Untap the target character                           | IMPLEMENTED | set-character-status untapped              |
 * | 4 | Card discarded after play                            | IMPLEMENTED | reducer discards short event               |
 * | 5 | Cannot be included in a Fallen-wizard's deck         | IMPLEMENTED | deck-validation FALLEN_WIZARD_BANNED list  |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF,
  FOOLISH_WORDS, LURE_OF_THE_SENSES, GATES_OF_MORNING,
  PELARGIR, EDORAS, HENNETH_ANNUN, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, addCardInPlay, attachHazardToChar, setCharStatus,
  dispatch, expectInDiscardPile, getHazardsOn, getCharacter,
  findCharInstanceId, RESOURCE_PLAYER, HAZARD_PLAYER, pool,
} from '../test-helpers.js';
import { validateDeck } from '../../index.js';
import type { PlayShortEventAction, CardDefinitionId, DeckList } from '../../index.js';

const THE_SUN_UNVEILED = 'as-56' as CardDefinitionId;

/** Build an org-phase state with the hero at a Free-hold and Gates of Morning
 *  optionally in play; the hazard opponent sits at a haven. */
function baseState(opts: { site?: CardDefinitionId; gates?: boolean; chars?: CardDefinitionId[] } = {}) {
  const site = opts.site ?? PELARGIR;
  const chars = opts.chars ?? [GANDALF, ARAGORN];
  let state = buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    players: [
      { id: PLAYER_1, companies: [{ site, characters: chars }], hand: [THE_SUN_UNVEILED], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  if (opts.gates ?? true) state = addCardInPlay(state, RESOURCE_PLAYER, GATES_OF_MORNING);
  return state;
}

describe('The Sun Unveiled (as-56)', () => {
  beforeEach(() => resetMint());

  test('playable on a character at a Free-hold when Gates of Morning is in play', () => {
    const state = baseState({ site: PELARGIR, gates: true });
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    // One action per eligible character in the Free-hold company.
    expect(actions.length).toBeGreaterThanOrEqual(1);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const targeted = actions.map(a => (a.action as PlayShortEventAction).targetCharacterId);
    expect(targeted).toContain(gandalfId);
  });

  test('NOT playable at a Free-hold when Gates of Morning is not in play', () => {
    const state = baseState({ site: PELARGIR, gates: false });
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  test('NOT playable at a non-Free-hold even with Gates of Morning in play', () => {
    // Henneth Annûn is a Border-hold — the play-target filter must reject it.
    const state = baseState({ site: HENNETH_ANNUN, gates: true });
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  test('removes all hazard permanent-events on the target character', () => {
    let state = baseState({ site: EDORAS, gates: true });
    state = attachHazardToChar(state, RESOURCE_PLAYER, GANDALF, FOOLISH_WORDS, HAZARD_PLAYER);
    state = attachHazardToChar(state, RESOURCE_PLAYER, GANDALF, LURE_OF_THE_SENSES, HAZARD_PLAYER);
    expect(getHazardsOn(state, RESOURCE_PLAYER, GANDALF)).toHaveLength(2);

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const action = viableActions(state, PLAYER_1, 'play-short-event')
      .find(a => (a.action as PlayShortEventAction).targetCharacterId === gandalfId);
    expect(action).toBeDefined();

    const after = dispatch(state, action!.action);

    // Both hazards removed from the character...
    expect(getHazardsOn(after, RESOURCE_PLAYER, GANDALF)).toHaveLength(0);
    // ...and discarded to their owner's (the hazard player's) discard pile.
    const oppDiscard = after.players[HAZARD_PLAYER].discardPile.map(c => c.definitionId);
    expect(oppDiscard).toContain(FOOLISH_WORDS);
    expect(oppDiscard).toContain(LURE_OF_THE_SENSES);
  });

  test('untaps the target character', () => {
    let state = baseState({ site: PELARGIR, gates: true });
    state = setCharStatus(state, RESOURCE_PLAYER, GANDALF, CardStatus.Tapped);
    expect(getCharacter(state, RESOURCE_PLAYER, GANDALF).status).toBe(CardStatus.Tapped);

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const action = viableActions(state, PLAYER_1, 'play-short-event')
      .find(a => (a.action as PlayShortEventAction).targetCharacterId === gandalfId);
    expect(action).toBeDefined();

    const after = dispatch(state, action!.action);
    expect(getCharacter(after, RESOURCE_PLAYER, GANDALF).status).toBe(CardStatus.Untapped);
  });

  test('only affects the targeted character, leaving other characters untouched', () => {
    let state = baseState({ site: EDORAS, gates: true, chars: [GANDALF, ARAGORN] });
    state = attachHazardToChar(state, RESOURCE_PLAYER, GANDALF, FOOLISH_WORDS, HAZARD_PLAYER);
    state = attachHazardToChar(state, RESOURCE_PLAYER, ARAGORN, LURE_OF_THE_SENSES, HAZARD_PLAYER);
    state = setCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const action = viableActions(state, PLAYER_1, 'play-short-event')
      .find(a => (a.action as PlayShortEventAction).targetCharacterId === gandalfId);
    expect(action).toBeDefined();

    const after = dispatch(state, action!.action);

    // Gandalf (target) cleared; Aragorn (not targeted) keeps his hazard and stays tapped.
    expect(getHazardsOn(after, RESOURCE_PLAYER, GANDALF)).toHaveLength(0);
    expect(getHazardsOn(after, RESOURCE_PLAYER, ARAGORN)).toHaveLength(1);
    expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).status).toBe(CardStatus.Tapped);
  });

  test('card is discarded after play', () => {
    const state = baseState({ site: PELARGIR, gates: true });
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const action = viableActions(state, PLAYER_1, 'play-short-event')
      .find(a => (a.action as PlayShortEventAction).targetCharacterId === gandalfId);
    const after = dispatch(state, action!.action);

    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, THE_SUN_UNVEILED);
  });

  test('cannot be included in a Fallen-wizard deck (rule 1.18)', () => {
    const deck: DeckList = {
      id: 'test-as56-fw', name: 'as-56 FW ban', alignment: 'fallen-wizard',
      pool: [], sideboard: [],
      sites: [{ name: 'The White Towers', card: 'wh-58' as CardDefinitionId, qty: 1 }],
      deck: {
        characters: [],
        hazards: [],
        resources: [{ name: 'The Sun Unveiled', card: THE_SUN_UNVEILED, qty: 1 }],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.card === THE_SUN_UNVEILED && e.message.includes('rule 1.18'))).toBe(true);
  });
});
