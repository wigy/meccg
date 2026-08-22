/**
 * @module tw-36.test
 *
 * Card test: Foul Fumes (tw-36)
 * Type: hazard-event (Long-event, Environment)
 * Unique: no. Cannot be duplicated.
 *
 * Card text:
 *   "Environment. Each moving company that has a Shadow-land [{s}] or a
 *    Dark-domain [{d}] in its site path must return to its site of origin
 *    unless it contains a ranger. Additionally, if Doors of Night is in play,
 *    each non-Haven site in play with a Shadow-land [{s}] or a Dark-domain
 *    [{d}] in its site path is tapped. This card has no effect on a minion
 *    player. Cannot be duplicated."
 *
 * Engine Support — CERTIFICATION STATUS: CERTIFIED (2026-06-12)
 * | # | Rule                                              | Status      | Notes                                                      |
 * |---|---------------------------------------------------|-------------|------------------------------------------------------------|
 * | 1 | Moving companies with {s}/{d} return to origin    | IMPLEMENTED | rule 5.31 force-return enforced in endCompanyMH            |
 * | 2 | Ranger exception (`rangerException: true`)        | IMPLEMENTED | company with a ranger is exempt                            |
 * | 3 | Tag consumed by Goldberry's cancel ability        | IMPLEMENTED | force-return-to-origin enables `cancel-return-to-origin`   |
 * | 4 | Doors of Night → tap non-Haven {s}/{d} sites      | IMPLEMENTED | `tap-sites-in-play` effect, applied on resolution          |
 * | 5 | No effect on a minion player                      | IMPLEMENTED | `player.minion` gate on force-return and site-tap          |
 * | 6 | Cannot be duplicated                              | IMPLEMENTED | duplication-limit scope game, max 1                        |
 *
 * Playable: FULLY — CERTIFIED. Every printed rule is enforced. Generic
 * rule-5.31 coverage also lives in rule-5.31-returned-to-origin.test.ts.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase,
  attachAllyToChar,
  findCharInstanceId,
  makeMHState,
  addCardInPlay, buildForceReturnMHState, resolveChain, viableActions,
  mint,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment, RegionType, CardStatus } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId,
  CancelReturnToOriginAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { initiateChain } from '../../engine/chain-reducer.js';

const GOLDBERRY = 'tw-245' as CardDefinitionId;
const FOUL_FUMES = 'tw-36' as CardDefinitionId;
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId;
/** Dwar the Ringwraith — a minion (Ringwraith) avatar. */
const DWAR = 'le-52' as CardDefinitionId;
/** Barad-dûr (le-352): minion dark-hold, site path [shadow, dark]. */
const BARAD_DUR = 'le-352' as CardDefinitionId;

describe('Foul Fumes (tw-36)', () => {
  beforeEach(() => resetMint());

  // ─── Implemented slice: force-return-to-origin tag drives Goldberry ───────

  test('Foul Fumes on the M/H chain carries force-return-to-origin, enabling Goldberry to cancel it', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoldberry = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);

    // P2 (hazard) plays Foul Fumes as a long-event onto the chain.
    const foulFumesCard = { instanceId: mint(), definitionId: FOUL_FUMES };
    const withChain = initiateChain(
      { ...withGoldberry, phaseState: makeMHState() },
      PLAYER_2,
      foulFumesCard,
      { type: 'long-event' },
    );

    // After P2 initiates the chain, P1 (resource player) holds priority.
    expect(withChain.chain!.priority).toBe(PLAYER_1);

    const aragornId = findCharInstanceId(withChain, RESOURCE_PLAYER, ARAGORN);
    const goldberryInstanceId =
      withChain.players[RESOURCE_PLAYER].characters[aragornId]?.allies[0]?.instanceId;
    expect(goldberryInstanceId).toBeDefined();

    const cancelActions = computeLegalActions(withChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-return-to-origin')
      .map(ea => ea.action as CancelReturnToOriginAction);

    // The cancel action targets the Foul Fumes chain entry specifically —
    // proving the engine reads tw-36's `force-return-to-origin` effect.
    expect(cancelActions.some(a => a.allyInstanceId === goldberryInstanceId
      && a.targetInstanceId === foulFumesCard.instanceId)).toBe(true);
  });

  // ─── Rule 1/2: force-return-to-origin (rule 5.31) with ranger exception ───

  test('moving hero company with a Shadow-land in its site path returns to its site of origin', () => {
    // LEGOLAS (tw-168) is not a ranger.
    const { state, originInstanceId } = buildForceReturnMHState(
      [LEGOLAS], [RegionType.Shadow], FOUL_FUMES,
    );
    const after = dispatch(dispatch(state, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    const company = after.players[RESOURCE_PLAYER].companies[0];
    expect(company.currentSite?.instanceId).toBe(originInstanceId);
    expect(company.currentSite?.definitionId).toBe(MINAS_TIRITH);
    expect(company.moved).toBe(false);
  });

  test('a Dark-domain in the site path also triggers the return', () => {
    const { state, originInstanceId } = buildForceReturnMHState(
      [LEGOLAS], [RegionType.Dark], FOUL_FUMES,
    );
    const after = dispatch(dispatch(state, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.instanceId).toBe(originInstanceId);
  });

  test('a company containing a ranger is exempt from the forced return', () => {
    // ARAGORN (tw-120) is a ranger.
    const { state, originInstanceId } = buildForceReturnMHState(
      [ARAGORN], [RegionType.Shadow], FOUL_FUMES,
    );
    const after = dispatch(dispatch(state, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.instanceId).not.toBe(originInstanceId);
  });

  test('a site path with neither Shadow nor Dark does not trigger the return', () => {
    const { state, originInstanceId } = buildForceReturnMHState(
      [LEGOLAS], [RegionType.Wilderness], FOUL_FUMES,
    );
    const after = dispatch(dispatch(state, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.instanceId).not.toBe(originInstanceId);
  });

  // ─── Rule 5: no effect on a minion player ─────────────────────────────────

  test('a minion company is NOT forced back even with a Shadow-land in its path', () => {
    // Moving player is a Ringwraith (minion) — "no effect on a minion player".
    const { state, originInstanceId } = buildForceReturnMHState(
      [DWAR], [RegionType.Shadow], FOUL_FUMES, { movingPlayerAlignment: Alignment.Ringwraith },
    );
    const after = dispatch(dispatch(state, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    // The minion company completes its move (not returned to origin).
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.instanceId).not.toBe(originInstanceId);
  });

  // ─── Rule 4 (+5): Doors-of-Night site-tap, excluding Havens & minion sites ─

  test('Doors of Night: non-Haven {s}/{d} hero site is tapped; Haven and minion-owned sites are not', () => {
    // P1 (hero): company at Mount Doom (shadow-hold, {s}/{d} path → tapped) and
    // a company at Lórien (a Haven → not tapped). P2 (minion Ringwraith): a
    // company at Barad-dûr ({s}/{d} path, but minion-owned → not tapped).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [
          { site: MOUNT_DOOM, characters: [ARAGORN] },
          { site: LORIEN, characters: [LEGOLAS] },
        ], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: BARAD_DUR, characters: [DWAR] }], hand: [], siteDeck: [] },
      ],
    });
    const withDon = addCardInPlay({ ...base, phaseState: makeMHState() }, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const chained = initiateChain(withDon, PLAYER_2, { instanceId: mint(), definitionId: FOUL_FUMES }, { type: 'long-event' });
    const resolved = resolveChain(chained);

    const p1 = resolved.players[RESOURCE_PLAYER];
    expect(p1.companies[0].currentSite?.status).toBe(CardStatus.Tapped);   // Mount Doom
    expect(p1.companies[1].currentSite?.status).toBe(CardStatus.Untapped); // Lórien (Haven)
    expect(resolved.players[HAZARD_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped); // minion-owned
  });

  test('without Doors of Night, the site-tap clause does not fire', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MOUNT_DOOM, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const chained = initiateChain({ ...base, phaseState: makeMHState() }, PLAYER_2, { instanceId: mint(), definitionId: FOUL_FUMES }, { type: 'long-event' });
    const resolved = resolveChain(chained);
    expect(resolved.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
  });

  // ─── Rule 6: cannot be duplicated ─────────────────────────────────────────

  test('a second Foul Fumes cannot be played while one is in play', () => {
    const foulFumesInPlay = { instanceId: 'foul-fumes-1' as CardInstanceId, definitionId: FOUL_FUMES, status: CardStatus.Untapped };
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [FOUL_FUMES], siteDeck: [MINAS_TIRITH], cardsInPlay: [foulFumesInPlay] },
      ],
    });
    const state = { ...built, phaseState: makeMHState() };
    const foulFumesHandId = state.players[HAZARD_PLAYER].hand.find(c => c.definitionId === FOUL_FUMES)!.instanceId;

    const viablePlays = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === foulFumesHandId);
    expect(viablePlays).toHaveLength(0);

    const blocked = computeLegalActions(state, PLAYER_2).find(
      ea => !ea.viable && ea.action.type === 'play-hazard'
        && (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === foulFumesHandId,
    );
    expect(blocked?.reason ?? '').toMatch(/duplicat/i);
  });

  test('cannot be played against a BALROG opponent — "minion player" covers both minion alignments', () => {
    // "This card has no effect on a minion player": minion player = Ringwraith
    // OR Balrog. The declared unplayable-when previously matched only
    // "ringwraith", silently letting the card be played against a Balrog.
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: MORIA, characters: [DWAR] }], hand: [], siteDeck: [MOUNT_DOOM] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [FOUL_FUMES], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...built, phaseState: makeMHState() };
    const foulFumesHandId = state.players[HAZARD_PLAYER].hand[0].instanceId;

    const viablePlays = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === foulFumesHandId);
    expect(viablePlays).toHaveLength(0);

    // The declared restriction replaces the play with a not-playable entry.
    const blocked = computeLegalActions(state, PLAYER_2).find(
      ea => !ea.viable && ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === foulFumesHandId,
    );
    expect(blocked?.reason ?? '').toMatch(/minion player/i);
  });
});
