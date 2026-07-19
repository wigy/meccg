/**
 * @module le-170.test
 *
 * Card test: Black Rider (le-170)
 * Type: minion-resource-event (permanent), alignment ringwraith. Non-unique.
 *
 * Card text:
 *   "Black Rider mode. Playable at a Darkhaven [{DH}] during the organization
 *    phase on your Ringwraith's own company. The company may move to a
 *    non-Darkhaven site. Discard this card and any other Ringwraith followers in
 *    the company during any of your following organization phases the company is
 *    at a Darkhaven [{DH}]. Cannot be duplicated on a given company. Cannot be
 *    included in a Balrog's deck."
 *
 * Black Rider is one of the three Ringwraith *mode* cards (with Fell Rider
 * le-183 and Heralded Lord le-190). A mode card is a permanent-event resource
 * bound to the Ringwraith's company via `CardInPlay.companyId`; the bound mode
 * is surfaced to the effective-stats resolver as `bearer.ringwraithMode` and
 * lifts the Ringwraith's Darkhaven-only movement gate.
 *
 * Unlike Fell Rider (which strips the company of all allies and followers on
 * play and closes it to new joins), Black Rider grants no stat change, leaves
 * the company's members and followers in place while it rides out, and only
 * discards itself *and the company's Ringwraith followers* when the company
 * returns to a Darkhaven at a following organization phase. The avatar's own
 * allies survive that purge — the text targets Ringwraith followers only.
 *
 * Engine Support:
 * | # | Rule                                                       | Status      | Notes                                                              |
 * |---|------------------------------------------------------------|-------------|--------------------------------------------------------------------|
 * | 1 | Black Rider mode established on the company                 | IMPLEMENTED | `ringwraith-mode` effect read by `resolveCompanyRingwraithMode`     |
 * | 2 | Playable at a Darkhaven on the Ringwraith's company         | IMPLEMENTED | `play-target` company + `target.siteType: haven` filter             |
 * | 3 | The company may move to a non-Darkhaven site                | IMPLEMENTED | `ringwraithHasModeCard` lifts the Darkhaven-only movement gate       |
 * | 4 | Discard this card + Ringwraith followers at a Darkhaven org | IMPLEMENTED | `on-event: organization-phase-start` self-discard w/ `alsoDiscardCompanyFollowers` → `purgeCompanyFollowers` when `atHaven` |
 * | 5 | Cannot be duplicated on a given company                     | IMPLEMENTED | `duplication-limit` scope "company", max 1                          |
 * | 6 | Cannot be included in a Balrog's deck                       | IMPLEMENTED | `deck-validation.ts` BALROG_BANNED_CARD_IDS (rule 1.23)             |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableActions, runActions, Phase, Alignment,
  addCardInPlay, companyIdAt, getCharacter, findCharInstanceId,
  attachAllyToChar,
  pool, MINION_RESOURCES_30, HAZARD_CREATURES_12,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  LEGOLAS, LORIEN,
} from '../test-helpers.js';
import { validateDeck } from '../../index.js';
import type { CardDefinitionId, GameAction, DeckList } from '../../index.js';
import type { PlanMovementAction, PlayPermanentEventAction } from '../../types/actions-organization.js';

const BLACK_RIDER = 'le-170' as CardDefinitionId;
// le-58: The Witch-king — Ringwraith avatar (mind null, race ringwraith).
const THE_WITCH_KING = 'le-58' as CardDefinitionId;
// le-11: Gorbag — non-avatar minion (orc) character, controllable as a follower.
const GORBAG = 'le-11' as CardDefinitionId;
// le-157: War-wolf — non-unique minion ally.
const WAR_WOLF = 'le-157' as CardDefinitionId;
// le-367 / le-390: Dol Guldur / Minas Morgul — Darkhavens (siteType: haven).
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
// le-364: Dead Marshes — shadow-hold (non-Darkhaven).
const DEAD_MARSHES = 'le-364' as CardDefinitionId;

/** A Ringwraith company at Dol Guldur opposed by a hero company at Lórien. */
function ringwraithAtDolGuldur(opts: {
  phase: Phase;
  hand?: CardDefinitionId[];
  siteDeck?: CardDefinitionId[];
  site?: CardDefinitionId;
  characters?: (CardDefinitionId | { defId: CardDefinitionId; followerOf?: number })[];
}) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: opts.phase,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: opts.site ?? DOL_GULDUR, characters: opts.characters ?? [THE_WITCH_KING] }],
        hand: opts.hand ?? [],
        siteDeck: opts.siteDeck ?? [MINAS_MORGUL, DEAD_MARSHES],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [],
      },
    ],
  });
}

describe('Black Rider (le-170)', () => {
  beforeEach(() => resetMint());

  // ─── Rule #3: mode card lifts the Darkhaven-only movement restriction ────────

  test('without Black Rider, the Ringwraith may only plan movement to a Darkhaven', () => {
    const state = ringwraithAtDolGuldur({ phase: Phase.Organization });
    const minasInst = state.players[0].siteDeck.find(s => s.definitionId === MINAS_MORGUL)!.instanceId;
    const deadInst = state.players[0].siteDeck.find(s => s.definitionId === DEAD_MARSHES)!.instanceId;

    const plans = viableActions(state, PLAYER_1, 'plan-movement');
    // Minas Morgul (Darkhaven) is reachable; Dead Marshes (shadow-hold) is gated out.
    expect(plans.some(ea => (ea.action as PlanMovementAction).destinationSite === minasInst)).toBe(true);
    expect(plans.every(ea => (ea.action as PlanMovementAction).destinationSite !== deadInst)).toBe(true);
  });

  test('with Black Rider bound, the company may plan movement to a non-Darkhaven site', () => {
    let state = ringwraithAtDolGuldur({ phase: Phase.Organization });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    state = addCardInPlay(state, RESOURCE_PLAYER, BLACK_RIDER, companyId);

    const minasInst = state.players[0].siteDeck.find(s => s.definitionId === MINAS_MORGUL)!.instanceId;
    const deadInst = state.players[0].siteDeck.find(s => s.definitionId === DEAD_MARSHES)!.instanceId;

    const plans = viableActions(state, PLAYER_1, 'plan-movement');
    // The mode card now allows the non-Darkhaven destination, and the Darkhaven
    // destination remains available.
    expect(plans.some(ea => (ea.action as PlanMovementAction).destinationSite === deadInst)).toBe(true);
    expect(plans.some(ea => (ea.action as PlanMovementAction).destinationSite === minasInst)).toBe(true);
  });

  // ─── Rule #2: playable at a Darkhaven, bound to the company ──────────────────

  test('playable on the company while at a Darkhaven, carrying the company binding', () => {
    const state = ringwraithAtDolGuldur({ phase: Phase.Organization, hand: [BLACK_RIDER] });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .filter(a => a.cardInstanceId === state.players[0].hand[0].instanceId);

    expect(plays).toHaveLength(1);
    expect(plays[0].targetCompanyId).toBe(companyId);
  });

  test('not playable while the company is at a non-Darkhaven site', () => {
    const state = ringwraithAtDolGuldur({
      phase: Phase.Organization,
      hand: [BLACK_RIDER],
      site: DEAD_MARSHES,
      siteDeck: [DOL_GULDUR],
    });

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .filter(a => a.cardInstanceId === state.players[0].hand[0].instanceId);

    expect(plays).toHaveLength(0);
  });

  // ─── Rule #5: cannot be duplicated on a given company ────────────────────────

  test('a second copy cannot be played on a company that already has Black Rider', () => {
    let state = ringwraithAtDolGuldur({ phase: Phase.Organization, hand: [BLACK_RIDER] });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    // One copy already bound to the company.
    state = addCardInPlay(state, RESOURCE_PLAYER, BLACK_RIDER, companyId);

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .filter(a => a.cardInstanceId === state.players[0].hand[0].instanceId);

    expect(plays).toHaveLength(0);
  });

  // ─── Rule #4: self-discard + follower purge at a Darkhaven org phase ──────────

  test('at the next Darkhaven organization phase, discards itself AND the company followers, sparing the avatar and its ally', () => {
    let state = ringwraithAtDolGuldur({
      phase: Phase.Untap,
      siteDeck: [MINAS_MORGUL],
      characters: [THE_WITCH_KING, { defId: GORBAG, followerOf: 0 }],
    });
    // The avatar bears a (non-follower) ally — it must survive the purge.
    state = attachAllyToChar(state, RESOURCE_PLAYER, THE_WITCH_KING, WAR_WOLF);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    state = addCardInPlay(state, RESOURCE_PLAYER, BLACK_RIDER, companyId);

    const afterOrg = runActions(state, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ] as GameAction[]);

    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
    // The mode card is discarded.
    expect(afterOrg.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === BLACK_RIDER)).toBe(false);
    expect(afterOrg.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === BLACK_RIDER)).toBe(true);
    // The Ringwraith follower is discarded and removed from the company.
    expect(afterOrg.players[RESOURCE_PLAYER].characters[gorbagId]).toBeUndefined();
    expect(afterOrg.players[RESOURCE_PLAYER].companies[0].characters).not.toContain(gorbagId);
    expect(afterOrg.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === GORBAG)).toBe(true);
    // The avatar itself stays, and keeps its ally (the purge targets followers only).
    const avatar = getCharacter(afterOrg, RESOURCE_PLAYER, THE_WITCH_KING);
    expect(afterOrg.players[RESOURCE_PLAYER].companies[0].characters).toContain(
      findCharInstanceId(afterOrg, RESOURCE_PLAYER, THE_WITCH_KING),
    );
    expect(avatar.allies.some(a => a.definitionId === WAR_WOLF)).toBe(true);
  });

  test('not discarded (and followers untouched) at the organization phase while at a non-Darkhaven site', () => {
    let state = ringwraithAtDolGuldur({
      phase: Phase.Untap,
      site: DEAD_MARSHES,
      siteDeck: [DOL_GULDUR],
      characters: [THE_WITCH_KING, { defId: GORBAG, followerOf: 0 }],
    });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    state = addCardInPlay(state, RESOURCE_PLAYER, BLACK_RIDER, companyId);

    const afterOrg = runActions(state, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ] as GameAction[]);

    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
    // Still in play; the follower is still in the company.
    expect(afterOrg.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === BLACK_RIDER)).toBe(true);
    expect(afterOrg.players[RESOURCE_PLAYER].characters[gorbagId]).toBeDefined();
    expect(afterOrg.players[RESOURCE_PLAYER].companies[0].characters).toContain(gorbagId);
    expect(afterOrg.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === BLACK_RIDER)).toBe(false);
  });

  // ─── Rule #6: cannot be included in a Balrog's deck ───────────────────────────

  test('a Balrog deck containing Black Rider is rejected by deck validation', () => {
    const deck: DeckList = {
      id: 'test-balrog-black-rider',
      name: 'Balrog Black Rider',
      alignment: 'balrog',
      pool: [],
      sideboard: [],
      sites: [{ name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 }],
      deck: {
        characters: [{ name: 'Azog', card: 'ba-2' as CardDefinitionId, qty: 1 }],
        hazards: [...HAZARD_CREATURES_12],
        resources: [...MINION_RESOURCES_30, { name: 'Black Rider', card: BLACK_RIDER, qty: 1 }],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.card === BLACK_RIDER)).toBe(true);
  });
});
