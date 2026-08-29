/**
 * @module tw-192.test
 *
 * Card test: Andúril, the Flame of the West (tw-192)
 * Type: hero-resource-event (permanent)
 *
 * Text:
 *   "Unique. Sage only during the site phase at an untapped site where
 *    Information is playable. Tap the sage and the site. Sage makes a
 *    corruption check modified by -3. Keep sage tapped until Andúril is
 *    stored at a Haven. Once stored, you may discard a stored Reforging and
 *    place Andúril with Narsil. In addition to Narsil's effects, Andúril
 *    gives its bearer 4 marshalling points, +4 prowess (to a maximum of 11),
 *    +1 direct influence, and one more corruption point. Andúril may be
 *    tapped to untap a Dúnadan character in the same company, but its bearer
 *    must make a corruption check modified by -1."
 *
 * Regression: a bug report (msg 59508721ea62ac32) showed Andúril entering
 * play with no sage/site verification, no tap, and no corruption check — the
 * card had an empty `effects` array, so it did nothing at all. This test
 * covers the play-time half of the card: the sage/site play conditions, the
 * tap costs, the corruption check on entering play, and the
 * bearer-cannot-untap-until-stored lock (same primitives as the sibling
 * Reforging tw-314, itself fixed for an identical empty-effects bug).
 *
 * Regression: a second bug report (msg 33fc9d48b98a2470) showed a stored
 * Andúril offering no way to discard a stored Reforging and combine with
 * Narsil — the "once stored, combine with Narsil" clause had no DSL
 * primitive at all (see `place-source-with-item` / `storedCombineGrantActions`
 * / `handleStoredCardGrantAction`). The combine action itself — moving
 * Andúril out of storage and onto Narsil's bearer — is covered below.
 * Andúril's post-combine stat bonuses (+4 marshalling points, +4 prowess,
 * +1 direct influence, +1 corruption point) and its tap-to-untap-a-Dúnadan
 * ability are not yet certified and remain a follow-up.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  CardStatus,
  resetMint,
  buildSitePhaseState,
  buildTestState, makePlayDeck,
  findCharInstanceId, findInPile,
  viableActions, viableFor, dispatch, resolveChain,
  GALADRIEL, ARAGORN, RIVENDELL, LORIEN, LEGOLAS,
  mint, addToPile,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, PlayPermanentEventAction, GameAction, EndOfTurnPhaseState } from '../../index.js';
import type { SupportCorruptionCheckAction } from '../../types/actions-universal.js';

const ANDURIL = 'tw-192' as CardDefinitionId;
const NARSIL = 'tw-289' as CardDefinitionId;
const REFORGING = 'tw-314' as CardDefinitionId;
const AMON_HEN = 'tw-371' as CardDefinitionId; // ruins-and-lairs, Information playable
const TOLFALAS = 'tw-433' as CardDefinitionId; // ruins-and-lairs, NO Information

describe('Andúril, the Flame of the West (tw-192)', () => {
  beforeEach(() => resetMint());

  // ── Effects 1 + 2: sage-only, site where Information is playable ──

  test('offered on an untapped sage at a site where Information is playable', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL], // scout+sage
      site: AMON_HEN,
      hand: [ANDURIL],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBeGreaterThan(0);
  });

  test('NOT offered on a non-sage character', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN], // warrior/scout/ranger — no sage skill
      site: AMON_HEN,
      hand: [ANDURIL],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT offered at a site where Information is not playable', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: TOLFALAS,
      hand: [ANDURIL],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── untapped-site-required: both sage and site must be untapped ──

  test('NOT offered when the sage is already tapped', () => {
    const state = buildSitePhaseState({
      characters: [{ defId: GALADRIEL, status: CardStatus.Tapped }],
      site: AMON_HEN,
      hand: [ANDURIL],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT offered at an already-tapped site', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: AMON_HEN,
      hand: [ANDURIL],
      siteStatus: CardStatus.Tapped,
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Tap the sage and the site, attach to the sage, corruption check ──

  test('playing it taps the sage and the site, attaches to the sage, and enqueues a corruption check modified by -3', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: AMON_HEN,
      hand: [ANDURIL],
    });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action;
    const after = resolveChain(dispatch(state, action));

    const galadrielId = findCharInstanceId(after, RESOURCE_PLAYER, GALADRIEL);
    const galadriel = after.players[RESOURCE_PLAYER].characters[galadrielId];
    expect(galadriel.status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
    expect(galadriel.items.some(i => i.definitionId === ANDURIL)).toBe(true);

    const corruptionChecks = after.pendingResolutions.filter(
      r => r.kind.type === 'corruption-check'
        && (r.kind as { characterId: CardInstanceId }).characterId === galadrielId,
    );
    expect(corruptionChecks).toHaveLength(1);
    expect((corruptionChecks[0].kind as { modifier: number }).modifier).toBe(-3);
  });

  test('CoE 7.1.1: an untapped company mate may tap in support of the corruption check on play', () => {
    // Bug report (game msdfe1fe-2pnv8f, seq 443): Andúril was played on
    // Ioreth (sage) while Boromir II, an untapped company mate, stood by.
    // The engine enqueued Ioreth's corruption check but never offered
    // Boromir's tap-in-support option (CoE 7.1.1), which applies to any
    // corruption check that has been declared but not yet resolved — not
    // just the item-transfer/store checks it was already wired up for.
    const state = buildSitePhaseState({
      characters: [GALADRIEL, ARAGORN],
      site: AMON_HEN,
      hand: [ANDURIL],
    });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action;
    const after = resolveChain(dispatch(state, action));

    const galadrielId = findCharInstanceId(after, RESOURCE_PLAYER, GALADRIEL);
    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);

    const supports = viableFor(after, PLAYER_1)
      .filter(a => a.action.type === 'support-corruption-check') as { action: SupportCorruptionCheckAction }[];

    expect(supports.some(a =>
      a.action.supportingCharacterId === aragornId &&
      a.action.targetCharacterId === galadrielId,
    )).toBe(true);
  });

  // ── Storable-at Haven + bearer-cannot-untap-until-stored ──

  test('sage bearing Andúril cannot untap until it is stored', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: AMON_HEN,
      hand: [ANDURIL],
    });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    const afterPlay = resolveChain(dispatch(state, action));

    const galadrielId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, GALADRIEL);
    const constraint = afterPlay.activeConstraints.find(
      c => c.kind.type === 'bearer-cannot-untap'
        && c.target.kind === 'character'
        && c.target.characterId === galadrielId,
    );
    expect(constraint).toBeDefined();

    // Resolve the pending corruption check (from enqueue-corruption-check on play)
    // before advancing to the untap phase.
    const ccAction = viableActions({ ...afterPlay, cheatRollTotal: 12 }, PLAYER_1, 'corruption-check')[0].action;
    const afterCC = dispatch({ ...afterPlay, cheatRollTotal: 12 }, ccAction);

    const inUntap = {
      ...afterCC,
      phaseState: {
        phase: Phase.Untap,
        untapped: false,
        hazardSideboardDestination: null,
        hazardSideboardFetched: 0,
        hazardSideboardAccessed: false,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      } as typeof afterPlay.phaseState,
    };
    const afterUntap = dispatch(inUntap, { type: 'untap', player: PLAYER_1 });
    expect(afterUntap.players[RESOURCE_PLAYER].characters[galadrielId].status).toBe(CardStatus.Tapped);
  });

  test('Andúril can be stored at a Haven during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: GALADRIEL, items: [ANDURIL] }] }],
          hand: [],
          siteDeck: [AMON_HEN],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [AMON_HEN] },
      ],
    });

    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions.length).toBe(1);
  });

  test('no marshalling points while Andúril is attached to a character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: GALADRIEL, items: [ANDURIL] }] }],
          hand: [],
          siteDeck: [AMON_HEN],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [AMON_HEN] },
      ],
    });

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
  });

  test('no marshalling points awarded when Andúril is stored (no override declared)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GALADRIEL] }],
          hand: [],
          siteDeck: [AMON_HEN],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [AMON_HEN] },
      ],
    });
    const stored = addToPile(
      base, RESOURCE_PLAYER, 'killPile',
      { instanceId: mint(), definitionId: ANDURIL },
    );
    const state = recomputeDerived(stored);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
  });

  // ── Organization-phase combine: discard a stored Reforging, place Andúril
  //    with Narsil (bug report msg 33fc9d48b98a2470) ──

  function combineState(opts: { withReforging?: boolean; narsilBearer?: boolean }) {
    const site = RIVENDELL;
    const withReforging = opts.withReforging ?? true;
    const bearNarsil = opts.narsilBearer ?? true;
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site, characters: [bearNarsil ? { defId: ARAGORN, items: [NARSIL] } : ARAGORN] }],
          hand: [],
          siteDeck: [AMON_HEN],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [AMON_HEN] },
      ],
    });
    let stored = addToPile(
      base, RESOURCE_PLAYER, 'killPile',
      { instanceId: mint(), definitionId: ANDURIL, storedAtSite: site },
    );
    if (withReforging) {
      stored = addToPile(
        stored, RESOURCE_PLAYER, 'killPile',
        { instanceId: mint(), definitionId: REFORGING, storedAtSite: site },
      );
    }
    return recomputeDerived(stored);
  }

  test('offers discard-stored-Reforging + combine when a stored Reforging and a Narsil bearer are both present', () => {
    const state = combineState({});
    const reforgingId = findInPile(state, RESOURCE_PLAYER, 'killPile', REFORGING)!.instanceId;
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const matches = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as GameAction & { actionId?: string; targetCardId?: unknown; recipientCharacterId?: unknown })
      .filter(a => a.actionId === 'anduril-combine-with-narsil');

    expect(matches.some(a => a.targetCardId === reforgingId && a.recipientCharacterId === aragornId)).toBe(true);
  });

  test('activating it discards the stored Reforging and places Andúril with Narsil on the bearer', () => {
    const state = combineState({});
    const reforgingId = findInPile(state, RESOURCE_PLAYER, 'killPile', REFORGING)!.instanceId;
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const act = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as GameAction & { actionId?: string; targetCardId?: unknown; recipientCharacterId?: unknown })
      .find(a => a.actionId === 'anduril-combine-with-narsil' && a.targetCardId === reforgingId && a.recipientCharacterId === aragornId);
    expect(act).toBeDefined();

    const after = dispatch(state, act as GameAction);

    const aragorn = after.players[RESOURCE_PLAYER].characters[aragornId];
    expect(aragorn.items.some(i => i.definitionId === NARSIL)).toBe(true);
    const placed = aragorn.items.find(i => i.definitionId === ANDURIL);
    expect(placed).toBeDefined();
    expect(placed!.status).toBe(CardStatus.Untapped);

    // Andúril leaves the marshalling-point pile; the stored Reforging is
    // discarded (not returned to storage).
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.definitionId === ANDURIL)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.definitionId === REFORGING)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === REFORGING)).toBe(true);
  });

  test('NOT offered when there is no stored Reforging', () => {
    const state = combineState({ withReforging: false });
    const offered = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as { actionId?: string })
      .some(a => a.actionId === 'anduril-combine-with-narsil');
    expect(offered).toBe(false);
  });

  test('NOT offered when no character bears Narsil', () => {
    const state = combineState({ narsilBearer: false });
    const offered = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as { actionId?: string })
      .some(a => a.actionId === 'anduril-combine-with-narsil');
    expect(offered).toBe(false);
  });

  // ── Rule 2.1.1: combine is not restricted to the organization phase
  //    (bug report msg f4380bc5ef290ece, game mtek3wk2-frgnkn seq 413) ──

  test('CoE 2.1.1: offered during the end-of-turn phase, not just organization', () => {
    const site = RIVENDELL;
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site, characters: [{ defId: ARAGORN, items: [NARSIL] }] }],
          hand: [],
          siteDeck: [],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    let stored = addToPile(
      base, RESOURCE_PLAYER, 'killPile',
      { instanceId: mint(), definitionId: ANDURIL, storedAtSite: site },
    );
    stored = addToPile(
      stored, RESOURCE_PLAYER, 'killPile',
      { instanceId: mint(), definitionId: REFORGING, storedAtSite: site },
    );
    const signalEnd: EndOfTurnPhaseState = {
      phase: Phase.EndOfTurn,
      step: 'signal-end',
      discardDone: [true, true],
      resetHandDone: [true, true],
    };
    const state = { ...recomputeDerived(stored), phaseState: signalEnd };

    const reforgingId = findInPile(state, RESOURCE_PLAYER, 'killPile', REFORGING)!.instanceId;
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const matches = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as GameAction & { actionId?: string; targetCardId?: unknown; recipientCharacterId?: unknown })
      .filter(a => a.actionId === 'anduril-combine-with-narsil');

    expect(matches.some(a => a.targetCardId === reforgingId && a.recipientCharacterId === aragornId)).toBe(true);
  });
});
