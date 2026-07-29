/**
 * @module rule-9.18-item-movement-restrictions
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.18: Item Movement Restrictions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Movement restrictions on an item (e.g. discarding the item if the company moves) are always implemented regardless of whether the item is being used and regardless of the alignment of the item, its controlling character, or its player.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, CardStatus } from '../../../index.js';
import type { CardDefinitionId, GameState } from '../../../index.js';
import type { CharacterEntry } from '../../test-helpers.js';
import {
  buildTestState, resetMint, dispatch, makeMHState, makePlayDeck,
  findCharInstanceId,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  Phase, ARAGORN, LEGOLAS, GIMLI, GANDALF, RIVENDELL, BREE, LORIEN,
} from '../../test-helpers.js';

// The two items whose printed text is a movement restriction, in both of their
// alignments: "If the bearer's company is ever below N characters and it moves,
// discard this item."
const AMON_SUL_HERO = 'tw-296' as CardDefinitionId;    // below 2 characters
const AMON_SUL_MINION = 'le-330' as CardDefinitionId;  // below 2 characters
const OSGILIATH_HERO = 'tw-301' as CardDefinitionId;   // below 4 characters

// Minion fixtures for the minion-alignment half of the rule.
const MINION_CHAR = 'le-23' as CardDefinitionId;         // Luitprand — plain minion Man
const MINION_SITE = 'le-390' as CardDefinitionId;        // Minas Morgul (Darkhaven)
const MINION_DESTINATION = 'le-402' as CardDefinitionId; // Shelob's Lair (Imlad Morgul)

/**
 * A company that has already declared movement to `destination`, mid
 * movement/hazard phase — both players passing from here completes the move and
 * fires the item's movement restriction.
 */
function movingCompany(opts: {
  alignment: Alignment;
  characters: CharacterEntry[];
  site: CardDefinitionId;
  destination: CardDefinitionId;
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: opts.alignment,
        companies: [{ site: opts.site, characters: opts.characters, destinationSite: opts.destination }],
        hand: [],
        siteDeck: [opts.destination],
        playDeck: makePlayDeck(),
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
    ],
  });
  return { ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
}

/** Completes the movement/hazard phase for the moving company. */
function completeMove(state: GameState): GameState {
  return dispatch(dispatch(state, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
}

/** Whether `bearer` still holds `item` after the move. */
function stillBorne(state: GameState, bearer: CardDefinitionId, item: CardDefinitionId): boolean {
  const charId = findCharInstanceId(state, RESOURCE_PLAYER, bearer);
  return state.players[RESOURCE_PLAYER].characters[charId].items.some(i => i.definitionId === item);
}

describe('Rule 9.18 — Item Movement Restrictions', () => {
  beforeEach(() => resetMint());

  test('an item whose restriction is met is discarded when the company moves', () => {
    const after = completeMove(movingCompany({
      alignment: Alignment.Wizard,
      characters: [{ defId: ARAGORN, items: [AMON_SUL_HERO] }],
      site: RIVENDELL,
      destination: BREE,
    }));

    expect(stillBorne(after, ARAGORN, AMON_SUL_HERO)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === AMON_SUL_HERO)).toBe(true);
  });

  test('the restriction is only implemented on the terms the card states', () => {
    // Amon Sûl's clause is "below 2 characters"; with two in the company the
    // item survives the same move.
    const after = completeMove(movingCompany({
      alignment: Alignment.Wizard,
      characters: [{ defId: ARAGORN, items: [AMON_SUL_HERO] }, LEGOLAS],
      site: RIVENDELL,
      destination: BREE,
    }));

    expect(stillBorne(after, ARAGORN, AMON_SUL_HERO)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === AMON_SUL_HERO)).toBe(false);
  });

  test('each item is held to its own threshold', () => {
    // Osgiliath's clause is "below 4 characters", so a three-strong company
    // that keeps Amon Sûl loses Osgiliath on the very same move.
    const after = completeMove(movingCompany({
      alignment: Alignment.Wizard,
      characters: [{ defId: ARAGORN, items: [AMON_SUL_HERO, OSGILIATH_HERO] }, LEGOLAS, GIMLI],
      site: RIVENDELL,
      destination: BREE,
    }));

    expect(stillBorne(after, ARAGORN, AMON_SUL_HERO)).toBe(true);
    expect(stillBorne(after, ARAGORN, OSGILIATH_HERO)).toBe(false);
  });

  test('the restriction applies although the item is not being used', () => {
    // Aragorn is no sage and holds no "able to use a Palantír" grant, so none of
    // the item's own tap abilities were ever available to him — the restriction
    // is implemented regardless.
    const before = movingCompany({
      alignment: Alignment.Wizard,
      characters: [{ defId: ARAGORN, items: [AMON_SUL_HERO] }],
      site: RIVENDELL,
      destination: BREE,
    });
    const bearerId = findCharInstanceId(before, RESOURCE_PLAYER, ARAGORN);
    expect(before.players[RESOURCE_PLAYER].characters[bearerId].items.every(i => i.status === CardStatus.Untapped)).toBe(true);

    expect(stillBorne(completeMove(before), ARAGORN, AMON_SUL_HERO)).toBe(false);
  });

  test('the restriction applies regardless of the alignment of the item and its player', () => {
    // The same clause on the minion printing, borne by a minion character of a
    // minion player.
    const minion = completeMove(movingCompany({
      alignment: Alignment.Ringwraith,
      characters: [{ defId: MINION_CHAR, items: [AMON_SUL_MINION] }],
      site: MINION_SITE,
      destination: MINION_DESTINATION,
    }));

    expect(stillBorne(minion, MINION_CHAR, AMON_SUL_MINION)).toBe(false);

    // …and the hero printing borne by a Fallen-wizard's character, where the
    // item's alignment matches neither its player nor the Wizard who normally
    // carries it.
    const fallenWizard = completeMove(movingCompany({
      alignment: Alignment.FallenWizard,
      characters: [{ defId: GANDALF, items: [AMON_SUL_HERO] }],
      site: RIVENDELL,
      destination: BREE,
    }));

    expect(stillBorne(fallenWizard, GANDALF, AMON_SUL_HERO)).toBe(false);
  });

  test('a company that does not move keeps the item', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [AMON_SUL_HERO] }] }],
          hand: [],
          siteDeck: [BREE],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const after = completeMove({ ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }) });

    expect(stillBorne(after, ARAGORN, AMON_SUL_HERO)).toBe(true);
  });
});
