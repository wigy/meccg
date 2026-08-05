/**
 * @module le-183.test
 *
 * Card test: Fell Rider (le-183)
 * Type: minion-resource-event (permanent), alignment ringwraith. Non-unique.
 *
 * Card text:
 *   "Fell Rider mode. Playable at a Darkhaven [{DH}] during the organization
 *    phase on your Ringwraith's own company. +2 prowess, -3 direct influence to
 *    your Ringwraith. Discard all allies and Ringwraith followers in the
 *    company; none may join the company. Your Ringwraith may move to a
 *    non-Darkhaven site. Discard this card during any of your following
 *    organization phases your Ringwraith is at a Darkhaven [{DH}]. Cannot be
 *    duplicated on a given company. Cannot be included in a Balrog's deck."
 *
 * Fell Rider is one of the three Ringwraith *mode* cards (with Black Rider
 * le-170 and Heralded Lord le-190). A mode card is a permanent-event resource
 * bound to the Ringwraith's company via `CardInPlay.companyId`; the bound mode
 * is surfaced to the effective-stats resolver as `bearer.ringwraithMode` and
 * gates the Ringwraith's movement out of its Darkhaven.
 *
 * Engine Support:
 * | # | Rule                                                      | Status      | Notes                                                                 |
 * |---|-----------------------------------------------------------|-------------|-----------------------------------------------------------------------|
 * | 1 | Fell Rider mode established on the company                 | IMPLEMENTED | `ringwraith-mode` effect read by `resolveCompanyRingwraithMode`       |
 * | 2 | Playable at a Darkhaven on a company, binds via companyId  | IMPLEMENTED | `play-target` company + `target.siteType: haven` filter               |
 * | 2b| Only on your Ringwraith's own company (not any company)   | IMPLEMENTED | `target.hasRingwraith` filter requires a `race: ringwraith` character  |
 * | 2c| Playable only during the organization phase               | IMPLEMENTED | `play-condition` requires `"phase"`, `phases: ["organization"]`        |
 * | 3 | Ringwraith may move to a non-Darkhaven site               | IMPLEMENTED | `ringwraithHasModeCard` lifts the Darkhaven-only movement gate         |
 * | 4 | Cannot be duplicated on a given company                   | IMPLEMENTED | `duplication-limit` scope "company", max 1                            |
 * | 5 | Discard at a following organization phase at a Darkhaven   | IMPLEMENTED | `on-event: organization-phase-start` + `discard-self` when `atHaven`   |
 * | 6 | +2 prowess / -3 direct influence to your Ringwraith       | IMPLEMENTED | per-mode stats live on the named avatar card (gated on `bearer.ringwraithMode`); Fell Rider establishes the mode that activates them |
 * | 7 | Discard all allies & Ringwraith followers; none may join  | IMPLEMENTED | `block-company-joins` play-flag: on-play purge + ally/follower gates   |
 * | 8 | Cannot be included in a Balrog's deck                     | IMPLEMENTED | `deck-validation.ts` BALROG_BANNED_CARD_IDS (rule 1.23)               |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, recomputeDerived, resetMint, viableActions, runActions, Phase, Alignment,
  addCardInPlay, companyIdAt, getCharacter, findCharInstanceId,
  attachAllyToChar, playPermanentEventAndResolve,
  pool, MINION_RESOURCES_30, HAZARD_CREATURES_12,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  LEGOLAS, LORIEN,
} from '../test-helpers.js';
import { validateDeck, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameAction, DeckList, SitePhaseState } from '../../index.js';
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

const FELL_RIDER = 'le-183' as CardDefinitionId;
// le-58: The Witch-king — Ringwraith avatar (mind null, race ringwraith).
const THE_WITCH_KING = 'le-58' as CardDefinitionId;
// le-53: Hoarmûrath — Ringwraith avatar with its own per-mode stats (+2 prowess
// in Fell Rider mode, direct influence unchanged).
const HOARMURATH = 'le-53' as CardDefinitionId;
// le-11 / le-39: Gorbag / Shagrat — non-avatar minion (orc) characters.
const GORBAG = 'le-11' as CardDefinitionId;
// le-30: Orc Brawler — mind 1, controllable as a follower by the Witch-king (DI 3).
const ORC_BRAWLER = 'le-30' as CardDefinitionId;
// le-154: Stinker — minion ally playable at Moria.
const STINKER = 'le-154' as CardDefinitionId;
// le-157: War-wolf — non-unique minion ally.
const WAR_WOLF = 'le-157' as CardDefinitionId;
// le-367 / le-390: Dol Guldur / Minas Morgul — Darkhavens (siteType: haven).
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
// le-392: Moria — shadow-hold (allies playable). le-364: Dead Marshes — shadow-hold.
const MORIA = 'le-392' as CardDefinitionId;
const DEAD_MARSHES = 'le-364' as CardDefinitionId;

/** A Ringwraith company at Dol Guldur opposed by a hero company at Lórien. */
function ringwraithAtDolGuldur(opts: {
  phase: Phase;
  hand?: CardDefinitionId[];
  siteDeck?: CardDefinitionId[];
  site?: CardDefinitionId;
}) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: opts.phase,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: opts.site ?? DOL_GULDUR, characters: [THE_WITCH_KING] }],
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

describe('Fell Rider (le-183)', () => {
  beforeEach(() => resetMint());

  // ─── Rule #3: mode card lifts the Darkhaven-only movement restriction ────────

  test('without Fell Rider, the Ringwraith may only plan movement to a Darkhaven', () => {
    const state = ringwraithAtDolGuldur({ phase: Phase.Organization });
    const minasInst = state.players[0].siteDeck.find(s => s.definitionId === MINAS_MORGUL)!.instanceId;
    const deadInst = state.players[0].siteDeck.find(s => s.definitionId === DEAD_MARSHES)!.instanceId;

    const plans = viableActions(state, PLAYER_1, 'plan-movement');
    // Minas Morgul (Darkhaven) is reachable; Dead Marshes (shadow-hold) is gated out.
    expect(plans.some(ea => (ea.action as PlanMovementAction).destinationSite === minasInst)).toBe(true);
    expect(plans.every(ea => (ea.action as PlanMovementAction).destinationSite !== deadInst)).toBe(true);
  });

  test('with Fell Rider bound, the Ringwraith may plan movement to a non-Darkhaven site', () => {
    let state = ringwraithAtDolGuldur({ phase: Phase.Organization });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    state = addCardInPlay(state, RESOURCE_PLAYER, FELL_RIDER, companyId);

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
    const state = ringwraithAtDolGuldur({ phase: Phase.Organization, hand: [FELL_RIDER] });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .filter(a => a.cardInstanceId === state.players[0].hand[0].instanceId);

    expect(plays).toHaveLength(1);
    expect(plays[0].targetCompanyId).toBe(companyId);
  });

  test('not playable while the company is at a non-Darkhaven site', () => {
    // Same company stationed at Dead Marshes (shadow-hold) instead of a Darkhaven.
    const state = ringwraithAtDolGuldur({
      phase: Phase.Organization,
      hand: [FELL_RIDER],
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
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [GORBAG] }],
          hand: [FELL_RIDER],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .filter(a => a.cardInstanceId === state.players[0].hand[0].instanceId);

    expect(plays).toHaveLength(0);
  });

  test('not playable during the site phase, even while the company is at a Darkhaven with the Ringwraith', () => {
    const built = ringwraithAtDolGuldur({ phase: Phase.Organization, hand: [FELL_RIDER] });
    const state = { ...built, phaseState: PLAY_RESOURCES_STEP };

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .filter(a => a.cardInstanceId === state.players[0].hand[0].instanceId);

    expect(plays).toHaveLength(0);
  });

  // ─── Rule #4: cannot be duplicated on a given company ────────────────────────

  test('a second copy cannot be played on a company that already has Fell Rider', () => {
    let state = ringwraithAtDolGuldur({ phase: Phase.Organization, hand: [FELL_RIDER] });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    // One copy already bound to the company.
    state = addCardInPlay(state, RESOURCE_PLAYER, FELL_RIDER, companyId);

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .filter(a => a.cardInstanceId === state.players[0].hand[0].instanceId);

    expect(plays).toHaveLength(0);
  });

  // ─── Rule #5: self-discard at a following Darkhaven organization phase ────────

  test('discarded at the next organization phase while the company is at a Darkhaven', () => {
    let state = ringwraithAtDolGuldur({ phase: Phase.Untap, siteDeck: [MINAS_MORGUL] });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    state = addCardInPlay(state, RESOURCE_PLAYER, FELL_RIDER, companyId);

    const afterOrg = runActions(state, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ] as GameAction[]);

    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
    expect(afterOrg.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === FELL_RIDER)).toBe(false);
    expect(afterOrg.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === FELL_RIDER)).toBe(true);
  });

  test('not discarded at the organization phase while the company is at a non-Darkhaven site', () => {
    let state = ringwraithAtDolGuldur({ phase: Phase.Untap, site: DEAD_MARSHES, siteDeck: [DOL_GULDUR] });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    state = addCardInPlay(state, RESOURCE_PLAYER, FELL_RIDER, companyId);

    const afterOrg = runActions(state, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ] as GameAction[]);

    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
    expect(afterOrg.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === FELL_RIDER)).toBe(true);
    expect(afterOrg.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === FELL_RIDER)).toBe(false);
  });

  // ─── Rule #6: stat change to your Ringwraith (delivered by the avatar) ────────

  test('Fell Rider mode activates the Ringwraith avatar’s per-mode stat bonus', () => {
    // The "+2 prowess / -3 direct influence to your Ringwraith" is delivered by
    // each named Ringwraith's OWN per-mode stat-modifiers (gated on
    // `bearer.ringwraithMode`); a named avatar's values supersede the generic
    // mode bonus. Fell Rider's role is to establish the mode that activates
    // them. Hoarmûrath (le-53) gains +2 prowess in Fell Rider mode (his direct
    // influence is unchanged).
    const base = recomputeDerived(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    }));

    const avatarBefore = getCharacter(base, RESOURCE_PLAYER, HOARMURATH);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const withMode = recomputeDerived(addCardInPlay(base, RESOURCE_PLAYER, FELL_RIDER, companyId));
    const avatarAfter = getCharacter(withMode, RESOURCE_PLAYER, HOARMURATH);

    expect(avatarAfter.effectiveStats.prowess - avatarBefore.effectiveStats.prowess).toBe(2);
    expect(avatarAfter.effectiveStats.directInfluence).toBe(avatarBefore.effectiveStats.directInfluence);
  });

  // ─── Rule #7: discard all allies & Ringwraith followers on play ───────────────

  test('playing Fell Rider discards the company’s allies and Ringwraith followers', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_WITCH_KING, { defId: GORBAG, followerOf: 0 }] }],
          hand: [FELL_RIDER],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    // Attach a (non-unique) ally to the avatar.
    state = attachAllyToChar(state, RESOURCE_PLAYER, THE_WITCH_KING, WAR_WOLF);

    const fellRiderId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === FELL_RIDER)!.instanceId;
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);

    const after = playPermanentEventAndResolve(state, PLAYER_1, fellRiderId, undefined, { targetCompanyId: companyId });

    // Fell Rider is in play, bound to the company.
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === FELL_RIDER && c.companyId === companyId)).toBe(true);
    // The ally was discarded and removed from the avatar.
    const avatar = getCharacter(after, RESOURCE_PLAYER, THE_WITCH_KING);
    expect(avatar.allies.some(a => a.definitionId === WAR_WOLF)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === WAR_WOLF)).toBe(true);
    // The follower character was discarded and removed from the company.
    expect(after.players[RESOURCE_PLAYER].characters[gorbagId]).toBeUndefined();
    expect(after.players[RESOURCE_PLAYER].companies[0].characters).not.toContain(gorbagId);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === GORBAG)).toBe(true);
    // The avatar itself stays.
    expect(after.players[RESOURCE_PLAYER].companies[0].characters).toContain(findCharInstanceId(after, RESOURCE_PLAYER, THE_WITCH_KING));
  });

  // ─── Rule #7: none may join — allies blocked while Fell Rider is in play ───────

  test('while Fell Rider is in play, no ally may join the company', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA, characters: [THE_WITCH_KING] }],
          hand: [STINKER],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const withoutMode = { ...built, phaseState: PLAY_RESOURCES_STEP };
    const stinkerId = withoutMode.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === STINKER)!.instanceId;
    const playableWithout = computeLegalActions(withoutMode, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-hero-resource'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === stinkerId,
    );
    // Sanity: Stinker is a viable ally play at Moria without the mode card.
    expect(playableWithout.length).toBeGreaterThan(0);

    const companyId = companyIdAt(withoutMode, RESOURCE_PLAYER);
    const withMode = addCardInPlay(withoutMode, RESOURCE_PLAYER, FELL_RIDER, companyId);
    const playableWith = computeLegalActions(withMode, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-hero-resource'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === stinkerId,
    );
    expect(playableWith).toHaveLength(0);
  });

  // ─── Rule #7: none may join — direct-influence followers blocked ──────────────

  test('while Fell Rider is in play, no direct-influence follower may join the company', () => {
    // At a Darkhaven (where follower plays are legal); Fell Rider is placed
    // directly in play (bypassing the untap→org self-discard transition) so we
    // can observe the join gate independently of rule #5.
    const withoutMode = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_WITCH_KING] }],
          hand: [ORC_BRAWLER],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const avatarId = findCharInstanceId(withoutMode, RESOURCE_PLAYER, THE_WITCH_KING);
    const brawlerId = withoutMode.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === ORC_BRAWLER)!.instanceId;

    const followerPlaysWithout = computeLegalActions(withoutMode, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-character'
        && (a.action).characterInstanceId === brawlerId
        && (a.action).controlledBy === avatarId,
    );
    // Sanity: Orc Brawler may join as a DI follower of the Witch-king without the mode card.
    expect(followerPlaysWithout.length).toBeGreaterThan(0);

    const companyId = companyIdAt(withoutMode, RESOURCE_PLAYER);
    const withMode = addCardInPlay(withoutMode, RESOURCE_PLAYER, FELL_RIDER, companyId);
    const followerPlaysWith = computeLegalActions(withMode, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-character'
        && (a.action).characterInstanceId === brawlerId
        && (a.action).controlledBy === avatarId,
    );
    expect(followerPlaysWith).toHaveLength(0);
  });

  // ─── Rule #8: cannot be included in a Balrog's deck ───────────────────────────

  test('a Balrog deck containing Fell Rider is rejected by deck validation', () => {
    const deck: DeckList = {
      id: 'test-balrog-fell-rider',
      name: 'Balrog Fell Rider',
      alignment: 'balrog',
      pool: [],
      sideboard: [],
      sites: [{ name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 }],
      deck: {
        characters: [{ name: 'Azog', card: 'ba-2' as CardDefinitionId, qty: 1 }],
        hazards: [...HAZARD_CREATURES_12],
        resources: [...MINION_RESOURCES_30, { name: 'Fell Rider', card: FELL_RIDER, qty: 1 }],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.card === FELL_RIDER)).toBe(true);
  });
});
