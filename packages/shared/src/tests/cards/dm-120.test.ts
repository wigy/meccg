/**
 * @module dm-120.test
 *
 * Card test: Choice of Lúthien (dm-120)
 * Type: hero-resource-event (permanent), alignment: wizard
 *
 * "Unique. Playable on Arwen in Minas Tirith. She receives +2 direct
 *  influence and her mind increases by 2. Discard if Arwen moves to a site
 *  not in Anórien, Lebennin, Lamedon, Belfalas, or Anfalas. Tap Arwen to take
 *  one item, ally, or faction playable at her current site from your play
 *  deck or discard pile into your hand (reshuffle play deck if searched)."
 *
 * Bug report: a player played this card with an empty `effects: []` array —
 * it landed as an unattached `cardsInPlay` entry with none of its printed
 * effects (no site/character restriction, no stat bonus, no discard-on-move,
 * no tap ability). Modeling follows the established templates: Gandalf's
 * Friend (wh-98) for the character-target + company-context + stat-modifier
 * shape, and Mistress Lobelia (dm-178) / Strider (ba-1) for the tap-to-fetch
 * and bearer-company-moves discard shape.
 *
 * Modeling:
 *  - Restriction: `play-target` `character` filter `target.name: "Arwen"`,
 *    plus `play-condition` `requires: 'company-context'`, `{ site.name:
 *    "Minas Tirith" }`.
 *  - Stat bonus: `stat-modifier` `direct-influence` +2 and `stat-modifier`
 *    `mind` +2, resolved from Arwen's attached items while the card stays in
 *    play.
 *  - Discard-on-move: `on-event` `bearer-company-moves`, discarding unless
 *    the destination region is one of Anórien/Lebennin/Lamedon/Belfalas/
 *    Anfalas.
 *  - Tap ability: `grant-action` with `cost: { tap: 'bearer' }` (taps Arwen,
 *    not the card itself) and `enqueue-pending-fetch` searching the discard
 *    pile and play deck, gated on cards playable at Arwen's current site.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  MINAS_TIRITH, RIVENDELL, LORIEN, DOL_AMROTH,
  MEN_OF_ANORIEN, RANGERS_OF_THE_NORTH,
  buildTestState, makePlayDeck, resetMint,
  viableActions, dispatch,
  findCharInstanceId, findHandCardId,
  attachItemToChar, setCharStatus, makeMHState,
  playPermanentEventAndResolve,
  getCharacter,
  assertEveryInstanceReachable,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CardDefinitionId, CharacterCard, GameState } from '../../index.js';
import { Phase, CardStatus, computeLegalActions } from '../../index.js';

const CHOICE_OF_LUTHIEN = 'dm-120' as CardDefinitionId;
const ARWEN = 'tw-122' as CardDefinitionId;

const FETCH_ACTION = 'choice-of-luthien-fetch';

function orgState(opts?: { characters?: CardDefinitionId[]; site?: CardDefinitionId; hand?: CardDefinitionId[] }) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: opts?.site ?? MINAS_TIRITH, characters: opts?.characters ?? [ARWEN] }],
        hand: opts?.hand ?? [CHOICE_OF_LUTHIEN],
        siteDeck: [RIVENDELL],
        playDeck: makePlayDeck(),
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

describe('Choice of Lúthien (dm-120)', () => {
  beforeEach(() => resetMint());

  // ─── Restriction: playable only on Arwen, only at Minas Tirith ────────────

  test('offered on Arwen at Minas Tirith', () => {
    const state = orgState({ characters: [ARWEN, ARAGORN] });
    const arwenId = findCharInstanceId(state, RESOURCE_PLAYER, ARWEN);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const targetIds = actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);
    expect(targetIds).toContain(arwenId);
  });

  test('NOT offered on a different character (Aragorn), even at Minas Tirith', () => {
    const state = orgState({ characters: [ARWEN, ARAGORN] });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const targetIds = actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);
    expect(targetIds).not.toContain(aragornId);
    expect(actions.length).toBe(1); // only Arwen
  });

  test('NOT offered at any other site (Rivendell)', () => {
    const state = orgState({ characters: [ARWEN], site: RIVENDELL });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ─── Stat bonus: +2 direct influence, +2 mind ──────────────────────────────

  test('while attached, raises Arwen\'s direct influence and mind by 2 each', () => {
    const base = orgState({ characters: [ARWEN] });
    const arwenDef = pool[ARWEN as string] as CharacterCard;
    const cardId = findHandCardId(base, RESOURCE_PLAYER, CHOICE_OF_LUTHIEN);
    const arwenId = findCharInstanceId(base, RESOURCE_PLAYER, ARWEN);

    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, arwenId);
    const bearer = getCharacter(after, RESOURCE_PLAYER, ARWEN);

    expect(bearer.effectiveStats.directInfluence).toBe(arwenDef.directInfluence + 2);
    expect(bearer.effectiveStats.mind).toBe(arwenDef.mind! + 2);
    expect(bearer.items.some(i => i.definitionId === CHOICE_OF_LUTHIEN)).toBe(true);
    assertEveryInstanceReachable(after);
  });

  // ─── Discard-on-move ────────────────────────────────────────────────────────

  function movingState(destination: CardDefinitionId): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARWEN] }], hand: [], siteDeck: [destination], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARWEN, CHOICE_OF_LUTHIEN);
    const destCard = withItem.players[0].siteDeck[0];
    const p0 = {
      ...withItem.players[0],
      companies: [{
        ...withItem.players[0].companies[0],
        destinationSite: { instanceId: destCard.instanceId, definitionId: destCard.definitionId, status: CardStatus.Untapped },
      }],
    };
    return {
      ...withItem,
      players: [p0, withItem.players[1]] as typeof withItem.players,
      phaseState: makeMHState({ activeCompanyIndex: 0 }),
    };
  }

  function completeMove(state: GameState): GameState {
    const afterResource = dispatch(state, { type: 'pass', player: PLAYER_1 });
    return dispatch(afterResource, { type: 'pass', player: PLAYER_2 });
  }

  test('discarded when Arwen\'s company moves to a disallowed region (Rivendell)', () => {
    const state = movingState(RIVENDELL);
    const arwenId = findCharInstanceId(state, RESOURCE_PLAYER, ARWEN);
    expect(getCharacter(state, RESOURCE_PLAYER, ARWEN).items.some(i => i.definitionId === CHOICE_OF_LUTHIEN)).toBe(true);

    const after = completeMove(state);
    expect(after.players[RESOURCE_PLAYER].characters[arwenId].items.some(i => i.definitionId === CHOICE_OF_LUTHIEN)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === CHOICE_OF_LUTHIEN)).toBe(true);
    assertEveryInstanceReachable(after);
  });

  test('NOT discarded when Arwen\'s company moves to a site in an allowed region (Dol Amroth, Belfalas)', () => {
    const state = movingState(DOL_AMROTH);
    const arwenId = findCharInstanceId(state, RESOURCE_PLAYER, ARWEN);
    const after = completeMove(state);
    expect(after.players[RESOURCE_PLAYER].characters[arwenId].items.some(i => i.definitionId === CHOICE_OF_LUTHIEN)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === CHOICE_OF_LUTHIEN)).toBe(false);
  });

  // ─── Tap ability: fetch a playable item/ally/faction ───────────────────────

  function tapFixture(opts: { discard?: CardDefinitionId[]; deck?: CardDefinitionId[] }): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [ARWEN] }],
          hand: [],
          siteDeck: [RIVENDELL],
          discardPile: opts.discard ?? [],
          playDeck: opts.deck ?? makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    return attachItemToChar(base, RESOURCE_PLAYER, ARWEN, CHOICE_OF_LUTHIEN);
  }

  const fetchActionsOf = (state: GameState) =>
    viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === FETCH_ACTION);

  test('the tap ability is offered while Arwen (the bearer) is untapped', () => {
    const state = tapFixture({ discard: [MEN_OF_ANORIEN] });
    expect(fetchActionsOf(state)).toHaveLength(1);
  });

  test('the tap ability is NOT offered while Arwen is already tapped', () => {
    const state = setCharStatus(tapFixture({ discard: [MEN_OF_ANORIEN] }), RESOURCE_PLAYER, ARWEN, CardStatus.Tapped);
    expect(fetchActionsOf(state)).toHaveLength(0);
  });

  test('activation taps Arwen (the bearer, not the card) and enqueues a to-hand fetch gated on Minas Tirith', () => {
    const state = tapFixture({ discard: [MEN_OF_ANORIEN] });
    const activate = fetchActionsOf(state)[0];
    const after = dispatch(state, activate.action);

    const arwenId = findCharInstanceId(after, RESOURCE_PLAYER, ARWEN);
    expect(after.players[0].characters[arwenId].status).toBe(CardStatus.Tapped);
    const item = after.players[0].characters[arwenId].items.find(i => i.definitionId === CHOICE_OF_LUTHIEN)!;
    expect(item.status).toBe(CardStatus.Untapped);

    expect(after.pendingEffects).toHaveLength(1);
    const effect = (after.pendingEffects[0] as { effect: { type: string; to?: string; playableAtSite?: string; source?: string[] } }).effect;
    expect(effect.type).toBe('fetch-to-deck');
    expect(effect.to).toBe('hand');
    expect(effect.playableAtSite).toBe(MINAS_TIRITH);
    expect(effect.source).toEqual(['discard-pile', 'deck']);
  });

  test('only cards playable at Minas Tirith are offered; fetching from the discard brings it to hand', () => {
    // Men of Anórien is playable at Minas Tirith; Rangers of the North is not.
    const state = tapFixture({ discard: [MEN_OF_ANORIEN, RANGERS_OF_THE_NORTH] });
    const after = dispatch(state, fetchActionsOf(state)[0].action);

    const fetchActions = computeLegalActions(after, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    expect(fetchActions).toHaveLength(1);
    const menInst = after.players[0].discardPile.find(c => c.definitionId === MEN_OF_ANORIEN)!;
    expect((fetchActions[0].action as { cardInstanceId: string }).cardInstanceId).toBe(menInst.instanceId as unknown as string);

    const afterFetch = dispatch(after, fetchActions[0].action);
    expect(afterFetch.players[0].hand.some(c => c.definitionId === MEN_OF_ANORIEN)).toBe(true);
    expect(afterFetch.players[0].discardPile.some(c => c.definitionId === MEN_OF_ANORIEN)).toBe(false);
    assertEveryInstanceReachable(afterFetch);
  });
});
