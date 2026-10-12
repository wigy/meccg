/**
 * @module as-72.test
 *
 * Card test: Black Horse (as-72)
 * Type: minion-resource-ally, alignment ringwraith, non-unique. Prowess 4 /
 * body 6 / mind 2, no marshalling points.
 *
 * Card text: "Playable on a Ringwraith at a Darkhaven [{DH}] (does not tap the
 * site). Each Black Horse in your Ringwraith's company allows you to play one
 * Ringwraith follower who requires no direct influence to control. If each
 * Ringwraith in a company has a Black Horse, the company is in Black Rider mode
 * and may freely move (using starter movement). You may include up to nine
 * copies of this card in your play deck and sideboard combined. Return its
 * controller to your hand if Black Horse leaves active play. Cannot be
 * included in a Balrog's deck."
 *
 * Card shape (documented here, not asserted against the JSON):
 *   - `playableAt: [{ siteType: "haven" }]` — a Darkhaven for a Ringwraith player.
 *   - `play-target` character filter `target.race: ringwraith` — only a
 *     Ringwraith may control it.
 *   - `play-flag: does-not-tap-site` — the site stays untapped.
 *   - `ringwraith-follower-slots` (count 1) on the ally — each Black Horse in the
 *     revealed Ringwraith's company adds one no-influence follower slot.
 *   - `ringwraith-mode` (`black-rider`, `granted: each-ringwraith-bears`) — the
 *     company is in Black Rider mode while every Ringwraith in it bears one,
 *     lifting the Darkhaven-only movement gate (starter movement only, as for
 *     every Ringwraith company).
 *   - `deck-restriction: max-copies` (9) and `excluded-from-deck` for Balrog.
 *   - `return-controller-to-hand-on-leave` — the controller returns to hand when
 *     the ally leaves active play by any route.
 *
 * All tests drive the reducer / legal-action pipeline; none assert JSON shape.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildMinionSitePhaseState, buildTestState, resetMint, Phase, Alignment, CardStatus,
  attachAllyToChar, findCharInstanceId, getCharacter, companyIdAt,
  viableActions, viableActionsForHandCard, viablePlayCharacterActions, dispatch,
  playPermanentEventAndResolve,
  pool, MINION_RESOURCES_30, HAZARD_CREATURES_12,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  LEGOLAS, LORIEN,
} from '../test-helpers.js';
import { validateDeck } from '../../index.js';
import type { CardDefinitionId, DeckList } from '../../index.js';
import type { PlanMovementAction } from '../../types/actions-organization.js';

const BLACK_HORSE = 'as-72' as CardDefinitionId;
// Ringwraith avatars. Dwar has no follower ability of his own.
const DWAR = 'le-52' as CardDefinitionId;
const REN = 'le-56' as CardDefinitionId;
const KHAMUL = 'le-55' as CardDefinitionId;
// le-11: Gorbag — a non-Ringwraith minion character.
const GORBAG = 'le-11' as CardDefinitionId;
// le-183: Fell Rider — discards every ally in the company when played.
const FELL_RIDER = 'le-183' as CardDefinitionId;
// Darkhavens (siteType: haven) and a non-Darkhaven shadow-hold.
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DEAD_MARSHES = 'le-364' as CardDefinitionId;

describe('Black Horse (as-72)', () => {
  beforeEach(() => resetMint());

  // ─── Playable on a Ringwraith at a Darkhaven (does not tap the site) ────────

  test('playable on a Ringwraith at a Darkhaven; taps the Ringwraith but not the site', () => {
    const state = buildMinionSitePhaseState({ site: DOL_GULDUR, characters: [DWAR], hand: [BLACK_HORSE] });
    const dwarId = findCharInstanceId(state, RESOURCE_PLAYER, DWAR);

    const plays = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, BLACK_HORSE);
    expect(plays).toHaveLength(1);
    expect((plays[0].action as { attachToCharacterId?: string }).attachToCharacterId).toBe(dwarId);

    const after = dispatch(state, plays[0].action);
    const dwar = after.players[RESOURCE_PLAYER].characters[dwarId];
    expect(dwar.allies.some(a => a.definitionId === BLACK_HORSE)).toBe(true);
    expect(dwar.status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Untapped);
  });

  test('a second Black Horse may follow on another Ringwraith at the still-untapped Darkhaven', () => {
    const state = buildMinionSitePhaseState({
      site: DOL_GULDUR, characters: [DWAR, { defId: REN, followerOf: 0 }], hand: [BLACK_HORSE, BLACK_HORSE],
    });
    const renId = findCharInstanceId(state, RESOURCE_PLAYER, REN);
    const first = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, BLACK_HORSE)
      .find(ea => (ea.action as { attachToCharacterId?: string }).attachToCharacterId !== renId)!;
    const afterFirst = dispatch(state, first.action);

    const second = viableActionsForHandCard(afterFirst, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, BLACK_HORSE);
    expect(second.map(ea => (ea.action as { attachToCharacterId?: string }).attachToCharacterId)).toEqual([renId]);
  });

  test('not playable on a non-Ringwraith character', () => {
    const state = buildMinionSitePhaseState({
      site: DOL_GULDUR, characters: [DWAR, GORBAG], hand: [BLACK_HORSE],
    });
    const dwarId = findCharInstanceId(state, RESOURCE_PLAYER, DWAR);
    const plays = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, BLACK_HORSE);
    expect(plays.map(ea => (ea.action as { attachToCharacterId?: string }).attachToCharacterId)).toEqual([dwarId]);
  });

  test('not playable at a non-Darkhaven site', () => {
    const state = buildMinionSitePhaseState({ site: DEAD_MARSHES, characters: [DWAR], hand: [BLACK_HORSE] });
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, BLACK_HORSE)).toHaveLength(0);
  });

  // ─── Each Black Horse allows one no-influence Ringwraith follower ──────────

  test('without a Black Horse, Dwar (no follower ability) cannot take a Ringwraith follower', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [DWAR] }], hand: [REN], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
  });

  test('a Black Horse in the company lets a Ringwraith follower join with no influence', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [DWAR] }], hand: [REN], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = attachAllyToChar(base, RESOURCE_PLAYER, DWAR, BLACK_HORSE);
    const dwarId = findCharInstanceId(state, RESOURCE_PLAYER, DWAR);

    const plays = viablePlayCharacterActions(state, PLAYER_1);
    expect(plays).toHaveLength(1);
    expect(plays[0].controlledBy).toBe(dwarId);

    const after = dispatch(state, plays[0]);
    const ren = getCharacter(after, RESOURCE_PLAYER, REN);
    expect(ren.controlledBy).toBe(dwarId);
    expect(after.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(0);
  });

  test('one Black Horse allows only one follower; each further Black Horse adds one', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [DWAR, { defId: REN, followerOf: 0 }] }], hand: [KHAMUL], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    // One horse, already used by Ren.
    const oneHorse = attachAllyToChar(base, RESOURCE_PLAYER, DWAR, BLACK_HORSE);
    expect(viablePlayCharacterActions(oneHorse, PLAYER_1)).toHaveLength(0);

    // A second horse (borne by Ren — any Black Horse in the company counts).
    const twoHorses = attachAllyToChar(oneHorse, RESOURCE_PLAYER, REN, BLACK_HORSE);
    const plays = viablePlayCharacterActions(twoHorses, PLAYER_1);
    expect(plays).toHaveLength(1);
    expect(plays[0].controlledBy).toBe(findCharInstanceId(twoHorses, RESOURCE_PLAYER, DWAR));
  });

  test('Black Horse slots add to the revealed Ringwraith\'s own follower slots', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [KHAMUL, { defId: REN, followerOf: 0 }] }], hand: [DWAR], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    // Khamûl's single slot is used by Ren.
    expect(viablePlayCharacterActions(base, PLAYER_1)).toHaveLength(0);
    const state = attachAllyToChar(base, RESOURCE_PLAYER, KHAMUL, BLACK_HORSE);
    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(1);
  });

  // ─── Black Rider mode when each Ringwraith has a Black Horse ────────────────

  test('a Ringwraith without a Black Horse may only move to a Darkhaven', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [DWAR] }], hand: [], siteDeck: [MINAS_MORGUL, DEAD_MARSHES] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const deadInst = state.players[RESOURCE_PLAYER].siteDeck.find(s => s.definitionId === DEAD_MARSHES)!.instanceId;
    const plans = viableActions(state, PLAYER_1, 'plan-movement');
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every(ea => (ea.action as PlanMovementAction).destinationSite !== deadInst)).toBe(true);
  });

  test('with a Black Horse the lone Ringwraith is in Black Rider mode and may move to a non-Darkhaven by starter movement', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [DWAR] }], hand: [], siteDeck: [MINAS_MORGUL, DEAD_MARSHES] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = attachAllyToChar(base, RESOURCE_PLAYER, DWAR, BLACK_HORSE);
    const deadInst = state.players[RESOURCE_PLAYER].siteDeck.find(s => s.definitionId === DEAD_MARSHES)!.instanceId;
    // (Starter-only movement is the standing rule 2.II.7.R1 for every
    // Ringwraith company, enforced when the path is declared.)
    const plans = viableActions(state, PLAYER_1, 'plan-movement')
      .filter(ea => (ea.action as PlanMovementAction).destinationSite === deadInst);
    expect(plans.length).toBeGreaterThan(0);
  });

  test('Black Rider mode needs a Black Horse on EACH Ringwraith in the company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [KHAMUL, { defId: REN, followerOf: 0 }] }], hand: [], siteDeck: [MINAS_MORGUL, DEAD_MARSHES] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const deadInst = base.players[RESOURCE_PLAYER].siteDeck.find(s => s.definitionId === DEAD_MARSHES)!.instanceId;
    const reachesDead = (s: typeof base) => viableActions(s, PLAYER_1, 'plan-movement')
      .some(ea => (ea.action as PlanMovementAction).destinationSite === deadInst);

    const oneHorse = attachAllyToChar(base, RESOURCE_PLAYER, KHAMUL, BLACK_HORSE);
    expect(reachesDead(oneHorse)).toBe(false);
    const bothHorses = attachAllyToChar(oneHorse, RESOURCE_PLAYER, REN, BLACK_HORSE);
    expect(reachesDead(bothHorses)).toBe(true);
  });

  // ─── Return its controller to your hand if Black Horse leaves play ──────────

  test('when Black Horse leaves play (discarded by Fell Rider), its Ringwraith returns to hand', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [DWAR] }], hand: [FELL_RIDER], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    state = attachAllyToChar(state, RESOURCE_PLAYER, DWAR, BLACK_HORSE);
    const dwarId = findCharInstanceId(state, RESOURCE_PLAYER, DWAR);
    const horseId = state.players[RESOURCE_PLAYER].characters[dwarId].allies[0].instanceId;
    const fellRiderId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === FELL_RIDER)!.instanceId;

    const after = playPermanentEventAndResolve(state, PLAYER_1, fellRiderId, undefined, { targetCompanyId: companyIdAt(state, RESOURCE_PLAYER) });

    const p = after.players[RESOURCE_PLAYER];
    expect(p.discardPile.some(c => c.instanceId === horseId)).toBe(true);
    expect(p.characters[dwarId]).toBeUndefined();
    expect(p.hand.some(c => c.instanceId === dwarId)).toBe(true);
  });

  test('a Ringwraith whose ally is not a Black Horse stays in play when that ally is discarded', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [DWAR] }], hand: [FELL_RIDER], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    state = attachAllyToChar(state, RESOURCE_PLAYER, DWAR, 'le-157' as CardDefinitionId); // War-wolf
    const dwarId = findCharInstanceId(state, RESOURCE_PLAYER, DWAR);
    const fellRiderId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === FELL_RIDER)!.instanceId;

    const after = playPermanentEventAndResolve(state, PLAYER_1, fellRiderId, undefined, { targetCompanyId: companyIdAt(state, RESOURCE_PLAYER) });
    expect(after.players[RESOURCE_PLAYER].characters[dwarId]).toBeDefined();
  });

  // ─── Up to nine copies; banned from Balrog decks ────────────────────────────

  test('a Ringwraith deck may hold nine copies across play deck and sideboard, but not ten', () => {
    const deckWith = (inDeck: number, inSideboard: number): DeckList => ({
      id: 'test-black-horse', name: 'Black Horses', alignment: 'minion',
      pool: [],
      sideboard: [{ name: 'Black Horse', card: BLACK_HORSE, qty: inSideboard }],
      sites: [{ name: 'Dol Guldur', card: DOL_GULDUR, qty: 1 }],
      deck: {
        characters: [{ name: 'Dwar the Ringwraith', card: DWAR, qty: 1 }],
        hazards: [...HAZARD_CREATURES_12],
        resources: [...MINION_RESOURCES_30, { name: 'Black Horse', card: BLACK_HORSE, qty: inDeck }],
      },
    });
    expect(validateDeck(deckWith(6, 3), pool).some(e => e.card === BLACK_HORSE)).toBe(false);
    expect(validateDeck(deckWith(7, 3), pool).some(e => e.card === BLACK_HORSE)).toBe(true);
  });

  test('cannot be included in a Balrog deck', () => {
    const deck: DeckList = {
      id: 'test-balrog-black-horse', name: 'Balrog Black Horse', alignment: 'balrog',
      pool: [], sideboard: [],
      sites: [{ name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 }],
      deck: {
        characters: [{ name: 'Azog', card: 'ba-2' as CardDefinitionId, qty: 1 }],
        hazards: [...HAZARD_CREATURES_12],
        resources: [...MINION_RESOURCES_30, { name: 'Black Horse', card: BLACK_HORSE, qty: 1 }],
      },
    };
    expect(validateDeck(deck, pool).some(e => e.card === BLACK_HORSE)).toBe(true);
  });
});
