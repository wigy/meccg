/**
 * @module tw-63.test
 *
 * Card test: Morgul-horse (tw-63)
 * Type: hazard-event (short), non-unique, Neutral
 *
 * Card text:
 *   "This card allows you to place a tapped Nazgûl permanent-event back into
 *    your hand instead of discarding it. Alternatively, allows a Nazgûl to be
 *    played keyed to a Shadow-land [{s}]."
 *
 * CRF ruling:
 *   "To bring a Nazgûl permanent-event back into your hand, Morgul-horse must
 *    be declared after tapping the Nazgûl is declared and before it
 *    resolves." — "The alternative effect of this card can be played and
 *    resolved before any Nazgûl is played with it. A Nazgûl must be played as
 *    the first declared action in the chain of effects following the
 *    resolution of the alternative effect of Morgul-horse. If a Nazgûl is not
 *    played immediately following the resolution of this card, this card is
 *    returned to its player's hand. This card cannot be played for no effect
 *    just to discard it."
 *
 * Effects:
 *   Mode 1 (chain response) — `on-event self-enters-play` →
 *     `return-chain-entry-card-to-hand` (select target, filter Nazgûl hazard
 *     creature). Played while a Nazgûl permanent-event's tap-to-short-event
 *     conversion sits unresolved on the chain; redirects the Nazgûl's card
 *     from discard back to its owner's hand without disturbing its own
 *     on-tap effect resolution.
 *   Mode 2 (standalone, played before any Nazgûl) — `on-event self-enters-play`
 *     → `add-constraint nazgul-boost-pending` (scope company-mh-phase, race
 *     ringwraith, keyingRegionTypes ["shadow"]). Consumed by the next
 *     ringwraith hazard-creature played against the same company: it may
 *     additionally be keyed via a Shadow-land region on top of its own
 *     printed `keyedTo`. If the company's M/H phase ends unconsumed, the
 *     source card returns from discard to hand (same `nazgul-boost-pending`
 *     unconsumed-boost handling Fell Beast tw-33 already relies on).
 *
 * Playable: YES
 * Certified: 2026-08-28
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, FRODO, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, CAVE_DRAKE,
  makeMHState,
  playHazardAndResolve,
  findHandCardId, findCharInstanceId, companyIdAt,
  viableActions, dispatch, resolveChain,
} from '../test-helpers.js';
import { Race, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayHazardAction, PlayShortEventAction } from '../../index.js';

const MORGUL_HORSE = 'tw-63' as CardDefinitionId;
const AKHORAHIL = 'tw-4' as CardDefinitionId;
const DWAR_OF_WAW = 'tw-31' as CardDefinitionId;

/** M/H state for the return-to-hand mode: PLAYER_1 (resource) fields Aragorn+Legolas at Moria; PLAYER_2 holds `hand`. */
function buildState(hand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand, siteDeck: [RIVENDELL] },
    ],
  });
  return { ...state, phaseState: makeMHState({ destinationSiteName: 'Barad-dûr' }) };
}

/** M/H state for the alternate-keying mode: a path with a Shadow-land region, no other Nazgûl keying route. */
function buildKeyingState(hand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand, siteDeck: [MINAS_TIRITH] },
    ],
  });
  return {
    ...state,
    phaseState: makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Southern Mirkwood'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    }),
  };
}

/** Play Akhôrahil as a permanent-event, then tap it naming `victimId`; returns the state right after the tap is declared (chain still active, resource player has priority). */
function playAndDeclareTap(state: GameState, victimId: CardInstanceId): { afterTap: GameState; akhorahilId: CardInstanceId } {
  const akhorahilId = findHandCardId(state, HAZARD_PLAYER, AKHORAHIL);
  const afterPlay = resolveChain(dispatch(state, {
    type: 'play-hazard', player: PLAYER_2, cardInstanceId: akhorahilId,
    targetCompanyId: companyIdAt(state, RESOURCE_PLAYER), altEventMode: 'permanent-event',
  }));
  const tap = viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')
    .find(a => (a.action as { targetCharacterId?: string }).targetCharacterId === (victimId as unknown as string))!;
  expect(tap).toBeDefined();
  return { afterTap: dispatch(afterPlay, tap.action), akhorahilId };
}

describe('Morgul-horse (tw-63)', () => {
  beforeEach(() => resetMint());

  // ─── Mode 1: return a tapped Nazgûl permanent-event to hand ────────────────

  test('offered as a chain response while a Nazgûl tap-conversion is unresolved, targeting that entry', () => {
    const state = buildState([AKHORAHIL, MORGUL_HORSE]);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const { afterTap, akhorahilId } = playAndDeclareTap(state, aragornId);
    expect(afterTap.chain).not.toBeNull();
    expect(afterTap.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === akhorahilId)).toBe(true);

    // The opponent (resource player) has priority first and passes with nothing to play.
    const p1Passed = dispatch(afterTap, { type: 'pass-chain-priority', player: PLAYER_1 });
    const morgulReturn = viableActions(p1Passed, PLAYER_2, 'play-short-event')
      .find(a => (a.action as PlayShortEventAction).targetInstanceId === akhorahilId);
    expect(morgulReturn).toBeDefined();
  });

  test('playing it moves the tapped Nazgûl back to hand instead of discarding it, while its own on-tap ability still resolves', () => {
    const state = buildState([AKHORAHIL, MORGUL_HORSE]);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const { afterTap, akhorahilId } = playAndDeclareTap(state, aragornId);

    const p1Passed = dispatch(afterTap, { type: 'pass-chain-priority', player: PLAYER_1 });
    const morgulReturn = viableActions(p1Passed, PLAYER_2, 'play-short-event')
      .find(a => (a.action as PlayShortEventAction).targetInstanceId === akhorahilId)!;
    const morgulHorseId = (morgulReturn.action as PlayShortEventAction).cardInstanceId;
    const afterMorgul = dispatch(p1Passed, morgulReturn.action);
    const final = resolveChain(afterMorgul);
    expect(final.chain).toBeNull();

    // "back into your hand instead of discarding it".
    expect(final.players[HAZARD_PLAYER].hand.some(c => c.instanceId === akhorahilId)).toBe(true);
    expect(final.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === akhorahilId)).toBe(false);

    // Morgul-horse itself was played and is discarded — it doesn't come back.
    expect(final.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === morgulHorseId)).toBe(true);

    // Akhôrahil's own on-tap ability (-1 body on the named character) still resolves.
    expect(final.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.body).toBe(8);
    const mods = final.activeConstraints.filter(c => c.kind.type === 'character-stat-modifier');
    expect(mods).toHaveLength(1);
  });

  test('only the player who declared the tap may play the redirect — the opponent cannot rescue it', () => {
    const state = buildState([AKHORAHIL, MORGUL_HORSE]);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const { afterTap, akhorahilId } = playAndDeclareTap(state, aragornId);

    // Give the resource player their own copy of Morgul-horse — it still
    // isn't offered against the hazard player's own Nazgûl.
    const withOpponentCopy: GameState = {
      ...afterTap,
      players: [
        { ...afterTap.players[RESOURCE_PLAYER], hand: [{ instanceId: 'mh-p1' as CardInstanceId, definitionId: MORGUL_HORSE }] },
        afterTap.players[HAZARD_PLAYER],
      ] as GameState['players'],
    };
    const p1Redirect = viableActions(withOpponentCopy, PLAYER_1, 'play-short-event')
      .find(a => (a.action as PlayShortEventAction).targetInstanceId === akhorahilId);
    expect(p1Redirect).toBeUndefined();
  });

  test('not offered once the tap-conversion has already fully resolved — nothing left to redirect', () => {
    const state = buildState([AKHORAHIL, MORGUL_HORSE]);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const { afterTap, akhorahilId } = playAndDeclareTap(state, aragornId);
    const finished = resolveChain(afterTap);
    expect(finished.chain).toBeNull();
    expect(finished.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === akhorahilId)).toBe(true);

    const morgulHorseId = findHandCardId(finished, HAZARD_PLAYER, MORGUL_HORSE);
    const offers = viableActions(finished, PLAYER_2, 'play-short-event')
      .filter(a => (a.action as PlayShortEventAction).cardInstanceId === morgulHorseId);
    expect(offers).toHaveLength(0);
  });

  // ─── Mode 2: alternate keying grant (Shadow-land) ───────────────────────────

  test('Mode 2: playable standalone (no target) during the M/H phase', () => {
    const state = buildKeyingState([MORGUL_HORSE]);
    const mhId = findHandCardId(state, HAZARD_PLAYER, MORGUL_HORSE);
    const plays = viableActions(state, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.cardInstanceId === mhId);
    expect(plays.length).toBeGreaterThan(0);
  });

  test('Mode 2: resolving it installs a company-scoped nazgul-boost-pending constraint granting only Shadow-land keying, and discards the card', () => {
    const state = buildKeyingState([MORGUL_HORSE]);
    const mhId = findHandCardId(state, HAZARD_PLAYER, MORGUL_HORSE);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playHazardAndResolve(state, PLAYER_2, mhId, companyId);

    const constraint = after.activeConstraints.find(c => c.kind.type === 'nazgul-boost-pending');
    expect(constraint).toBeDefined();
    if (constraint?.kind.type !== 'nazgul-boost-pending') throw new Error('unreachable');
    expect(constraint.target).toEqual({ kind: 'company', companyId });
    expect(constraint.kind.race).toBe(Race.Ringwraith);
    expect(constraint.kind.keyingRegionTypes).toEqual([RegionType.Shadow]);
    // No combat boost, no site-type keying — only the region keying grant.
    expect(constraint.kind.strikesModifier).toBeUndefined();
    expect(constraint.kind.prowessModifier).toBeUndefined();
    expect(constraint.kind.grantAttackerChoosesDefenders).toBeUndefined();
    expect(constraint.kind.keyingSiteTypes).toBeUndefined();

    expect(after.players[HAZARD_PLAYER].hand.some(c => c.definitionId === MORGUL_HORSE)).toBe(false);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === MORGUL_HORSE)).toBe(true);
  });

  test('Mode 2: grants extra keying (region-type shadow) to a Nazgûl not otherwise keyable on this path', () => {
    const state = buildKeyingState([MORGUL_HORSE, DWAR_OF_WAW]);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const mhId = findHandCardId(state, HAZARD_PLAYER, MORGUL_HORSE);
    const afterMH = playHazardAndResolve(state, PLAYER_2, mhId, companyId);

    const dwarId = findHandCardId(afterMH, HAZARD_PLAYER, DWAR_OF_WAW);
    const dwarPlays = viableActions(afterMH, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.cardInstanceId === dwarId);
    const keyedPlay = dwarPlays.find(a => a.keyedBy?.method === 'region-type' && a.keyedBy.value === RegionType.Shadow);
    expect(keyedPlay).toBeDefined();
  });

  test('Mode 2: control — without Morgul-horse, Dwar of Waw cannot be keyed on this Shadow-land path', () => {
    const state = buildKeyingState([DWAR_OF_WAW]);
    const dwarId = findHandCardId(state, HAZARD_PLAYER, DWAR_OF_WAW);
    const dwarPlays = viableActions(state, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.cardInstanceId === dwarId && !!a.keyedBy);
    expect(dwarPlays).toHaveLength(0);
  });

  test('Mode 2: control — the grant never applies to a non-Nazgûl creature', () => {
    const state = buildKeyingState([MORGUL_HORSE, CAVE_DRAKE]);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const mhId = findHandCardId(state, HAZARD_PLAYER, MORGUL_HORSE);
    const afterMH = playHazardAndResolve(state, PLAYER_2, mhId, companyId);

    const drakeId = findHandCardId(afterMH, HAZARD_PLAYER, CAVE_DRAKE);
    const drakePlays = viableActions(afterMH, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.cardInstanceId === drakeId);
    expect(drakePlays.some(a => a.keyedBy?.method === 'region-type' && a.keyedBy.value === RegionType.Shadow)).toBe(false);
  });

  test('Mode 2: if no Nazgûl is played this company\'s M/H phase, Morgul-horse returns to hand', () => {
    const state = buildKeyingState([MORGUL_HORSE]); // no Nazgûl available to consume it
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const mhId = findHandCardId(state, HAZARD_PLAYER, MORGUL_HORSE);
    const afterMH = playHazardAndResolve(state, PLAYER_2, mhId, companyId);
    expect(afterMH.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === MORGUL_HORSE)).toBe(true);

    let finished = dispatch(afterMH, { type: 'pass', player: PLAYER_1 });
    finished = dispatch(finished, { type: 'pass', player: PLAYER_2 });

    expect(finished.players[HAZARD_PLAYER].hand.some(c => c.definitionId === MORGUL_HORSE)).toBe(true);
    expect(finished.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === MORGUL_HORSE)).toBe(false);
    expect(finished.activeConstraints.some(c => c.kind.type === 'nazgul-boost-pending')).toBe(false);
  });
});
