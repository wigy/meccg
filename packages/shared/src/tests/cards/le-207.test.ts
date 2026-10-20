/**
 * @module le-207.test
 *
 * Card test: The Names Among Them (le-207)
 * Type: minion-resource-event (permanent), Stolen Knowledge, alignment
 * ringwraith, non-unique. Marshalling points: (1) miscellaneous — printed in
 * parentheses, so the point is received only once the card is stored.
 *
 * Card text: "Playable on an untapped scout immediately after facing an
 * automatic-attack at a Border-hold [{B}] or Free-hold [{F}]. Tap the scout.
 * No marshalling points are received until this card is stored at a
 * Darkhaven [{DH}] during his organization phase. Once stored, this card may
 * be discarded to cancel an automatic-attack at a Free-hold [{F}] or
 * Border-hold [{B}]."
 *
 * Effects & engine support:
 * | # | Rule                                                              | Mechanism |
 * |---|-------------------------------------------------------------------|-----------|
 * | 1 | Playable immediately after facing an automatic-attack at a {B}/{F} | play-window { combat, after-attack, when: attack.source = automatic-attack ∧ site.type ∈ {border-hold, free-hold} } |
 * | 2 | … on an untapped scout                                            | play-target character, filter target.skills ∋ scout ∧ target.status untapped |
 * | 3 | Tap the scout                                                     | play-target cost { tap: "character" } |
 * | 4 | No MP until stored at a Darkhaven during organization             | card marshallingPoints 0; storable-at siteTypes ["haven"], marshallingPoints 1 |
 * | 5 | Once stored, discard to cancel an automatic-attack at a {F}/{B}   | cancel-attack { fromStored, cost { discard: "self" }, same when } |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  CardStatus, Phase, Alignment,
  buildTestState, buildSitePhaseState, attachSiteAutomaticAttackCombat, makeCancelWindowCombat,
  makePlayDeck, resetMint, mint, addToPile, setCharStatus,
  findCharInstanceId, viableActions, dispatch, resolveChain,
} from '../test-helpers.js';
import { Race } from '../../index.js';
import type { CardDefinitionId, CardInstance, GameState, PlayPermanentEventAction } from '../../index.js';
import { enqueuePostAttackPlayOffers } from '../../engine/post-attack-play.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const NAMES_AMONG_THEM = 'le-207' as CardDefinitionId;

const GORBAG = 'le-11' as CardDefinitionId;   // minion orc, warrior/scout
const ASTERNAK = 'le-1' as CardDefinitionId;  // minion man, warrior/diplomat — not a scout

const DOL_GULDUR = 'le-367' as CardDefinitionId; // Darkhaven
const BAG_END = 'le-350' as CardDefinitionId;    // Free-hold
const DALE = 'le-363' as CardDefinitionId;       // Border-hold
const MORIA = 'le-392' as CardDefinitionId;      // Shadow-hold

describe('The Names Among Them (le-207)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: the after-attack window, gated on automatic-attack at {B}/{F} ──

  test.each([
    ['Free-hold (Bag End)', BAG_END],
    ['Border-hold (Dale)', DALE],
  ])('an automatic-attack at a %s opens the after-attack play window', (_label, site) => {
    const base = buildSitePhaseState({
      alignment: Alignment.Ringwraith, characters: [GORBAG, ASTERNAK], site, hand: [NAMES_AMONG_THEM],
    });
    const prev = attachSiteAutomaticAttackCombat(base);
    const after = enqueuePostAttackPlayOffers(prev, { ...prev, combat: null });
    expect(after.pendingResolutions.some(r => r.kind.type === 'post-attack-play-offer')).toBe(true);
  });

  test('an automatic-attack at a Shadow-hold does NOT open the window', () => {
    const base = buildSitePhaseState({
      alignment: Alignment.Ringwraith, characters: [GORBAG], site: MORIA, hand: [NAMES_AMONG_THEM],
    });
    const prev = attachSiteAutomaticAttackCombat(base, { creatureRace: Race.Orc });
    const after = enqueuePostAttackPlayOffers(prev, { ...prev, combat: null });
    expect(after.pendingResolutions.some(r => r.kind.type === 'post-attack-play-offer')).toBe(false);
  });

  test('a hazard creature attack at a Free-hold does NOT open the window', () => {
    const base = buildSitePhaseState({
      alignment: Alignment.Ringwraith, characters: [GORBAG], site: BAG_END, hand: [NAMES_AMONG_THEM],
    });
    const prev = makeCancelWindowCombat(base, { attackSourceType: 'creature' });
    const after = enqueuePostAttackPlayOffers(prev, { ...prev, combat: null });
    expect(after.pendingResolutions.some(r => r.kind.type === 'post-attack-play-offer')).toBe(false);
  });

  test('the window opens end-to-end once a Border-hold automatic-attack is fought out', () => {
    const base = buildSitePhaseState({
      alignment: Alignment.Ringwraith, characters: [GORBAG, ASTERNAK], site: DALE, hand: [NAMES_AMONG_THEM],
    });
    const inCombat = attachSiteAutomaticAttackCombat(base, { strikesTotal: 1, strikeProwess: 5 });
    const asternakId = findCharInstanceId(inCombat, RESOURCE_PLAYER, ASTERNAK);
    const assigned = dispatch(inCombat, { type: 'assign-strike', player: PLAYER_1, characterId: asternakId });
    const strike = viableActions({ ...assigned, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike')[0].action;
    const after = dispatch({ ...assigned, cheatRollTotal: 12 }, strike);
    expect(after.combat).toBeNull();
    expect(after.pendingResolutions.some(r => r.kind.type === 'post-attack-play-offer')).toBe(true);
  });

  // ── Rule 2: only an untapped scout is a legal bearer ──────────────────────

  test('only an untapped scout is offered as bearer', () => {
    const base = buildSitePhaseState({
      alignment: Alignment.Ringwraith, characters: [GORBAG, ASTERNAK], site: BAG_END, hand: [NAMES_AMONG_THEM],
    });
    const prev = attachSiteAutomaticAttackCombat(base);
    const offered = enqueuePostAttackPlayOffers(prev, { ...prev, combat: null });

    const targets = viableActions(offered, PLAYER_1, 'play-permanent-event')
      .map(ea => (ea.action as PlayPermanentEventAction).targetCharacterId);
    expect(targets).toEqual([findCharInstanceId(offered, RESOURCE_PLAYER, GORBAG)]);
  });

  test('no window opens when the only scout is tapped', () => {
    const base = buildSitePhaseState({
      alignment: Alignment.Ringwraith, characters: [GORBAG, ASTERNAK], site: BAG_END, hand: [NAMES_AMONG_THEM],
    });
    const prev = attachSiteAutomaticAttackCombat(setCharStatus(base, RESOURCE_PLAYER, GORBAG, CardStatus.Tapped));
    const after = enqueuePostAttackPlayOffers(prev, { ...prev, combat: null });
    expect(after.pendingResolutions.some(r => r.kind.type === 'post-attack-play-offer')).toBe(false);
  });

  // ── Rule 3: tap the scout; the card attaches to him ───────────────────────

  test('playing the card taps the scout and attaches the card to him, earning no MP yet', () => {
    const base = buildSitePhaseState({
      alignment: Alignment.Ringwraith, characters: [GORBAG, ASTERNAK], site: BAG_END, hand: [NAMES_AMONG_THEM],
    });
    const prev = attachSiteAutomaticAttackCombat(base);
    const offered = enqueuePostAttackPlayOffers(prev, { ...prev, combat: null });
    const play = viableActions(offered, PLAYER_1, 'play-permanent-event')[0].action;
    const played = recomputeDerived(resolveChain(dispatch(offered, play)));

    const gorbag = played.players[RESOURCE_PLAYER].characters[findCharInstanceId(played, RESOURCE_PLAYER, GORBAG)];
    expect(gorbag.status).toBe(CardStatus.Tapped);
    expect(gorbag.items.some(i => i.definitionId === NAMES_AMONG_THEM)).toBe(true);
    expect(played.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === NAMES_AMONG_THEM)).toBe(false);
    // Rule 4: no marshalling points while borne.
    expect(played.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
  });

  // ── Rule 4: stored at a Darkhaven during organization → 1 MP ──────────────

  test('storable at a Darkhaven during organization, then worth 1 misc MP', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: GORBAG, items: [NAMES_AMONG_THEM] }] }],
          hand: [],
          siteDeck: [BAG_END],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: BAG_END, characters: [ASTERNAK] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
    const store = viableActions(state, PLAYER_1, 'store-item');
    expect(store).toHaveLength(1);

    const stored = recomputeDerived(dispatch(state, store[0].action));
    const entry = stored.players[RESOURCE_PLAYER].killPile.find(c => c.definitionId === NAMES_AMONG_THEM);
    expect(entry?.storedAtSite).toBeDefined();
    expect(stored.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(1);
  });

  test('NOT storable at a non-Darkhaven site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BAG_END, characters: [{ defId: GORBAG, items: [NAMES_AMONG_THEM] }] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [BAG_END] },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'store-item')).toHaveLength(0);
  });

  // ── Rule 5: once stored, discard to cancel an automatic-attack at {F}/{B} ──

  test.each([
    ['Free-hold (Bag End)', BAG_END],
    ['Border-hold (Dale)', DALE],
  ])('the stored card may be discarded to cancel an automatic-attack at a %s', (_label, site) => {
    const storedCard: CardInstance = { instanceId: mint(), definitionId: NAMES_AMONG_THEM, storedAtSite: DOL_GULDUR };
    const base = addToPile(
      buildSitePhaseState({ alignment: Alignment.Ringwraith, characters: [GORBAG], site }),
      RESOURCE_PLAYER, 'killPile', storedCard,
    );
    const state = attachSiteAutomaticAttackCombat(base);

    const cancel = viableActions(state, PLAYER_1, 'cancel-attack')
      .filter(ea => ea.action.type === 'cancel-attack' && ea.action.cardInstanceId === storedCard.instanceId);
    expect(cancel).toHaveLength(1);

    const after: GameState = recomputeDerived(dispatch(state, cancel[0].action));
    expect(after.combat).toBeNull();
    const p = after.players[RESOURCE_PLAYER];
    expect(p.killPile.some(c => c.instanceId === storedCard.instanceId)).toBe(false);
    expect(p.discardPile.some(c => c.instanceId === storedCard.instanceId)).toBe(true);
    expect(p.marshallingPoints.misc).toBe(0);
  });

  test('the stored card cannot cancel an automatic-attack at a Shadow-hold', () => {
    const storedCard: CardInstance = { instanceId: mint(), definitionId: NAMES_AMONG_THEM, storedAtSite: DOL_GULDUR };
    const base = addToPile(
      buildSitePhaseState({ alignment: Alignment.Ringwraith, characters: [GORBAG], site: MORIA }),
      RESOURCE_PLAYER, 'killPile', storedCard,
    );
    const state = attachSiteAutomaticAttackCombat(base, { creatureRace: Race.Orc });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')
      .some(ea => ea.action.type === 'cancel-attack' && ea.action.cardInstanceId === storedCard.instanceId)).toBe(false);
  });

  test('the stored card cannot cancel a hazard creature attack at a Free-hold', () => {
    const storedCard: CardInstance = { instanceId: mint(), definitionId: NAMES_AMONG_THEM, storedAtSite: DOL_GULDUR };
    const base = addToPile(
      buildSitePhaseState({ alignment: Alignment.Ringwraith, characters: [GORBAG], site: BAG_END }),
      RESOURCE_PLAYER, 'killPile', storedCard,
    );
    const state = makeCancelWindowCombat(base, { attackSourceType: 'creature' });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')
      .some(ea => ea.action.type === 'cancel-attack' && ea.action.cardInstanceId === storedCard.instanceId)).toBe(false);
  });

  test('NOT yet stored (still borne by the scout) it cannot cancel an automatic-attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BAG_END, characters: [{ defId: GORBAG, items: [NAMES_AMONG_THEM] }] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [BAG_END] },
      ],
    });
    const state = attachSiteAutomaticAttackCombat(base);
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });
});
