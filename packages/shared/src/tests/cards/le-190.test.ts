/**
 * @module le-190.test
 *
 * Card test: Heralded Lord (le-190)
 * Type: minion-resource-event (permanent), alignment ringwraith. Non-unique.
 *
 * Card text:
 *   "Heralded Lord mode. Playable on your Ringwraith's company at a Darkhaven
 *    during the organization phase. -2 prowess, +3 direct influence to entire
 *    company. His own company may move to a non-Darkhaven site. Discard this
 *    card and any other Ringwraith followers in the company during any of your
 *    following organization phases the company is at a Darkhaven. Cannot be
 *    included in a Balrog's deck."
 *
 * Heralded Lord is one of the three Ringwraith *mode* cards (with Black Rider
 * le-170 and Fell Rider le-183). A mode card is a permanent-event resource
 * bound to the Ringwraith's company via `CardInPlay.companyId`; the bound mode
 * is surfaced to the effective-stats resolver as `bearer.ringwraithMode` and
 * lifts the Ringwraith's Darkhaven-only movement gate.
 *
 * Unlike Black Rider (no stat change) and Fell Rider (a stat change to the
 * Ringwraith alone, plus stripping allies/followers on play and closing the
 * company to new joins), Heralded Lord swings -2 prowess / +3 direct
 * influence across the **entire company** and carries no duplication-limit
 * (the printed text has no "cannot be duplicated" clause) and no ally/join
 * restriction. It discards itself and the company's Ringwraith followers
 * (not allies) when the company returns to a Darkhaven at a following
 * organization phase, exactly like Black Rider.
 *
 * Engine Support:
 * | # | Rule                                                       | Status      | Notes                                                              |
 * |---|------------------------------------------------------------|-------------|--------------------------------------------------------------------|
 * | 1 | Heralded Lord mode established on the company               | IMPLEMENTED | `ringwraith-mode` effect read by `resolveCompanyRingwraithMode`     |
 * | 2 | Playable at a Darkhaven on the Ringwraith's company         | IMPLEMENTED | `play-target` company + `target.siteType: haven` filter             |
 * | 2b| Only on your Ringwraith's own company (not any company)    | IMPLEMENTED | `target.hasRingwraith` filter requires a `race: ringwraith` character |
 * | 2c| Playable only during the organization phase                | IMPLEMENTED | `play-condition` requires `"phase"`, `phases: ["organization"]`      |
 * | 3 | -2 prowess, +3 direct influence to entire company           | IMPLEMENTED | two `company-modifier` effects, `collectCompanyPermanentEventEffects` synthesis |
 * | 4 | The company may move to a non-Darkhaven site                | IMPLEMENTED | `ringwraithHasModeCard` lifts the Darkhaven-only movement gate       |
 * | 5 | Discard this card + Ringwraith followers at a Darkhaven org | IMPLEMENTED | `on-event: organization-phase-start` self-discard w/ `alsoDiscardCompanyFollowers` → `purgeCompanyFollowers` when `atHaven` |
 * | 6 | Cannot be included in a Balrog's deck                       | IMPLEMENTED | `deck-validation.ts` BALROG_BANNED_CARD_IDS (rule 1.23)             |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableActions, runActions, Phase, Alignment, CardStatus,
  addCardInPlay, companyIdAt, getCharacter, findCharInstanceId,
  attachAllyToChar,
  pool, MINION_RESOURCES_30, HAZARD_CREATURES_12,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  LEGOLAS, LORIEN,
  baseProwess, P1_COMPANY,
} from '../test-helpers.js';
import { validateDeck } from '../../index.js';
import type { CardDefinitionId, CardInPlay, GameAction, DeckList, SitePhaseState } from '../../index.js';
import type { PlanMovementAction, PlayPermanentEventAction } from '../../types/actions-organization.js';

/** A site-phase state for the active company at the play-resources step. */
const PLAY_RESOURCES_STEP: SitePhaseState = {
  phase: Phase.Site,
  step: 'play-resources',
  activeCompanyIndex: 0,
  handledCompanyIds: [],
  siteEntered: true,
  resourcePlayed: false,
  minorItemAvailable: false,
  hoardBountyAvailable: false,
  thoroughSearchAvailable: false,
  declaredAgentAttack: null,
  automaticAttacksResolved: 0,
  awaitingOnGuardReveal: false,
  pendingResourceAction: null,
  opponentInteractionThisTurn: null,
  pendingOpponentInfluence: null,
};

const HERALDED_LORD = 'le-190' as CardDefinitionId;
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

describe('Heralded Lord (le-190)', () => {
  beforeEach(() => resetMint());

  // ─── Rule #4: mode card lifts the Darkhaven-only movement restriction ────────

  test('without Heralded Lord, the Ringwraith may only plan movement to a Darkhaven', () => {
    const state = ringwraithAtDolGuldur({ phase: Phase.Organization });
    const minasInst = state.players[0].siteDeck.find(s => s.definitionId === MINAS_MORGUL)!.instanceId;
    const deadInst = state.players[0].siteDeck.find(s => s.definitionId === DEAD_MARSHES)!.instanceId;

    const plans = viableActions(state, PLAYER_1, 'plan-movement');
    expect(plans.some(ea => (ea.action as PlanMovementAction).destinationSite === minasInst)).toBe(true);
    expect(plans.every(ea => (ea.action as PlanMovementAction).destinationSite !== deadInst)).toBe(true);
  });

  test('with Heralded Lord bound, the company may plan movement to a non-Darkhaven site', () => {
    let state = ringwraithAtDolGuldur({ phase: Phase.Organization });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    state = addCardInPlay(state, RESOURCE_PLAYER, HERALDED_LORD, companyId);

    const minasInst = state.players[0].siteDeck.find(s => s.definitionId === MINAS_MORGUL)!.instanceId;
    const deadInst = state.players[0].siteDeck.find(s => s.definitionId === DEAD_MARSHES)!.instanceId;

    const plans = viableActions(state, PLAYER_1, 'plan-movement');
    expect(plans.some(ea => (ea.action as PlanMovementAction).destinationSite === deadInst)).toBe(true);
    expect(plans.some(ea => (ea.action as PlanMovementAction).destinationSite === minasInst)).toBe(true);
  });

  // ─── Rule #2: playable at a Darkhaven, bound to the company ──────────────────

  test('playable on the company while at a Darkhaven, carrying the company binding', () => {
    const state = ringwraithAtDolGuldur({ phase: Phase.Organization, hand: [HERALDED_LORD] });
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
      hand: [HERALDED_LORD],
      site: DEAD_MARSHES,
      siteDeck: [DOL_GULDUR],
    });

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .filter(a => a.cardInstanceId === state.players[0].hand[0].instanceId);

    expect(plays).toHaveLength(0);
  });

  test('not playable on a company at a Darkhaven that does not contain the Ringwraith', () => {
    // Gorbag (a non-avatar orc, not the Ringwraith) leads the company alone.
    const state = ringwraithAtDolGuldur({
      phase: Phase.Organization,
      hand: [HERALDED_LORD],
      characters: [GORBAG],
    });

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .filter(a => a.cardInstanceId === state.players[0].hand[0].instanceId);

    expect(plays).toHaveLength(0);
  });

  test('not playable during the site phase, even while the company is at a Darkhaven with the Ringwraith', () => {
    const built = ringwraithAtDolGuldur({ phase: Phase.Organization, hand: [HERALDED_LORD] });
    const state = { ...built, phaseState: PLAY_RESOURCES_STEP };

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .filter(a => a.cardInstanceId === state.players[0].hand[0].instanceId);

    expect(plays).toHaveLength(0);
  });

  // ─── Rule #3: -2 prowess / +3 direct influence to the entire company ─────────

  test('-2 prowess and +3 direct influence applied to every character in the bound company', () => {
    const heraldedLordInPlay: CardInPlay = {
      instanceId: 'heralded-lord-1' as CardInPlay['instanceId'],
      definitionId: HERALDED_LORD,
      status: CardStatus.Untapped,
      companyId: P1_COMPANY,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_WITCH_KING, { defId: GORBAG, followerOf: 0 }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL, DEAD_MARSHES],
          cardsInPlay: [heraldedLordInPlay],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const witchKingBaseDI = (pool[THE_WITCH_KING] as unknown as { directInfluence: number }).directInfluence;
    const gorbagBaseDI = (pool[GORBAG] as unknown as { directInfluence: number }).directInfluence;

    const witchKing = getCharacter(state, RESOURCE_PLAYER, THE_WITCH_KING);
    const gorbag = getCharacter(state, RESOURCE_PLAYER, GORBAG);

    expect(witchKing.effectiveStats.prowess).toBe(baseProwess(THE_WITCH_KING) - 2);
    expect(gorbag.effectiveStats.prowess).toBe(baseProwess(GORBAG) - 2);
    // The Witch-king's own text also grants "+3 direct influence in Heralded
    // Lord mode" (a personal ability, le-characters.json), stacking on top of
    // the mode card's company-wide +3 — so he nets +6 while Gorbag (no
    // personal mode ability) nets the card's +3 alone.
    expect(witchKing.effectiveStats.directInfluence).toBe(witchKingBaseDI + 6);
    expect(gorbag.effectiveStats.directInfluence).toBe(gorbagBaseDI + 3);

    // The opposing company is unaffected.
    const legolas = getCharacter(state, 1, LEGOLAS);
    expect(legolas.effectiveStats.prowess).toBe(baseProwess(LEGOLAS));
  });

  // ─── Rule #5: self-discard + follower purge at a Darkhaven org phase ─────────

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
    state = addCardInPlay(state, RESOURCE_PLAYER, HERALDED_LORD, companyId);

    const afterOrg = runActions(state, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ] as GameAction[]);

    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
    // The mode card is discarded.
    expect(afterOrg.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === HERALDED_LORD)).toBe(false);
    expect(afterOrg.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === HERALDED_LORD)).toBe(true);
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
    state = addCardInPlay(state, RESOURCE_PLAYER, HERALDED_LORD, companyId);

    const afterOrg = runActions(state, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ] as GameAction[]);

    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
    // Still in play; the follower is still in the company.
    expect(afterOrg.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === HERALDED_LORD)).toBe(true);
    expect(afterOrg.players[RESOURCE_PLAYER].characters[gorbagId]).toBeDefined();
    expect(afterOrg.players[RESOURCE_PLAYER].companies[0].characters).toContain(gorbagId);
    expect(afterOrg.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === HERALDED_LORD)).toBe(false);
  });

  // ─── Rule #6: cannot be included in a Balrog's deck ───────────────────────────

  test('a Balrog deck containing Heralded Lord is rejected by deck validation', () => {
    const deck: DeckList = {
      id: 'test-balrog-heralded-lord',
      name: 'Balrog Heralded Lord',
      alignment: 'balrog',
      pool: [],
      sideboard: [],
      sites: [{ name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 }],
      deck: {
        characters: [{ name: 'Azog', card: 'ba-2' as CardDefinitionId, qty: 1 }],
        hazards: [...HAZARD_CREATURES_12],
        resources: [...MINION_RESOURCES_30, { name: 'Heralded Lord', card: HERALDED_LORD, qty: 1 }],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.card === HERALDED_LORD)).toBe(true);
  });
});
