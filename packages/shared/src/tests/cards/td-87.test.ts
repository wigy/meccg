/**
 * @module td-87.test
 *
 * Card test: Wolf-riders (td-87)
 * Type: hazard-creature (Creature/Short-event), non-unique
 *
 * Card text:
 *   "Orcs. May be played following any Orc attack not keyed to a site.
 *    Three strikes. If played as a short-event, modify the prowess and
 *    strikes of a Wolf attack by +1."
 *
 * td-87 is the **second printing** of Wolf-riders — same name, same text,
 * same 8 prowess / 3 strikes / 1 kill-MP as td-86, differing only in
 * artwork (`Wolfriders2.jpg`). Verified against the card database
 * (`data/cards.json`, TD-86 and TD-87 are identical but for the image), so
 * certifying it is a data fix: td-87 was missing both the
 * `followsAttackRaces` keying and the `modify-attack` short-event mode that
 * td-86 already carries, leaving it playable in neither mode.
 *
 * Rule coverage:
 *
 * | # | Rule                                                  | Status | Notes                                  |
 * |---|-------------------------------------------------------|--------|----------------------------------------|
 * | 1 | Orcs, three strikes, 8 prowess                        | OK     | printed stats                          |
 * | 2 | May be played following any Orc attack                | FIXED  | `keyedTo: followsAttackRaces: [orc]`   |
 * | 3 | Short-event: +1 prowess / +1 strikes to a Wolf attack | FIXED  | `modify-attack` fromHand, enemy.race   |
 *
 * The shared implementation's edge cases — the CRF ruling that the two
 * paragraphs' conditions are independent, and the hazard-limit gate on the
 * short-event mode — are pinned by td-86's test; this file exercises both
 * modes for this printing.
 *
 * Playable: FULLY — CERTIFIED (2026-08-18).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI,
  ORC_LIEUTENANT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  resolveChain, makeCancelWindowCombat, viableActions,
  handCardId, companyIdAt, dispatch,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, SiteType, Race } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState, ModifyAttackAction, PlayHazardAction } from '../../index.js';

const WOLF_RIDERS_2 = 'td-87' as CardDefinitionId;
const WOLVES = 'tw-114' as CardDefinitionId;

describe('Wolf-riders (td-87)', () => {
  beforeEach(() => resetMint());

  // ─── Creature mode: follow-up keying ──────────────────────────────────

  test('creature mode: offered as a follow-up to an Orc attack, initiating an 8-prowess / 3-strike Orc attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [WOLF_RIDERS_2], siteDeck: [RIVENDELL] },
      ],
    });
    // An Orc attack has already been faced by this company this sub-phase —
    // the condition the printed "following any Orc attack" keying reads.
    const state = {
      ...base,
      phaseState: makeMHState({
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Moria',
        hazardsEncountered: ['Orc-lieutenant'],
      }),
    };
    const wrId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const followUp = viableActions(state, PLAYER_2, 'play-hazard')
      .find(a => (a.action as PlayHazardAction).cardInstanceId === wrId
        && (a.action as PlayHazardAction).keyedBy?.method === 'follows-attack');
    expect(followUp).toBeDefined();
    expect((followUp!.action as PlayHazardAction).keyedBy).toEqual({ method: 'follows-attack', value: 'orc' });

    const after = resolveChain(dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: wrId,
      targetCompanyId: companyId,
      keyedBy: { method: 'follows-attack' as const, value: 'orc' },
    }));
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('orc');
    expect(after.combat!.strikeProwess).toBe(8);
    expect(after.combat!.strikesTotal).toBe(3);
  });

  test('creature mode: NOT playable when the company has faced no Orc attack this sub-phase', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [WOLF_RIDERS_2], siteDeck: [RIVENDELL] },
      ],
    });
    // A Wolf attack was faced, not an Orc one — the keying does not match, and
    // the card has no other keying to fall back on.
    const state = {
      ...base,
      phaseState: makeMHState({
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Moria',
        hazardsEncountered: ['Wolves'],
      }),
    };
    const wrId = handCardId(state, HAZARD_PLAYER);

    const offered = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(a => (a.action as PlayHazardAction).cardInstanceId === wrId);
    expect(offered).toHaveLength(0);
  });

  // ─── Short-event mode: modify a Wolf attack by +1/+1 ──────────────────

  test('short-event mode: +1 prowess and +1 strike to a live Wolf attack, discarding the card', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [WOLF_RIDERS_2], siteDeck: [RIVENDELL] },
      ],
    });
    const combat = makeCancelWindowCombat(base, {
      creatureDefId: WOLVES,
      creatureRace: Race.Wolf,
      attackSourceType: 'creature',
      strikesTotal: 2,
      strikeProwess: 6,
    });
    const state = { ...combat, phaseState: makeMHState({ hazardsPlayedThisCompany: 0 }) };

    const boost = viableActions(state, PLAYER_2, 'modify-attack').find(a => {
      const inst = (a.action as ModifyAttackAction).cardInstanceId;
      return state.players[HAZARD_PLAYER].hand.some(c => c.instanceId === inst && c.definitionId === WOLF_RIDERS_2);
    });
    expect(boost).toBeDefined();

    const after = dispatch(state, boost!.action);
    expect(after.combat!.strikeProwess).toBe(7);
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.players[HAZARD_PLAYER].hand.some(c => c.definitionId === WOLF_RIDERS_2)).toBe(false);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === WOLF_RIDERS_2)).toBe(true);
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(1);
  });

  test('short-event mode: NOT offered against a non-Wolf attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [WOLF_RIDERS_2], siteDeck: [RIVENDELL] },
      ],
    });
    const combat = makeCancelWindowCombat(base, {
      creatureDefId: ORC_LIEUTENANT,
      creatureRace: Race.Orc,
      attackSourceType: 'creature',
    });
    const state = { ...combat, phaseState: makeMHState({ hazardsPlayedThisCompany: 0 }) };

    const boost = viableActions(state, PLAYER_2, 'modify-attack').find(a => {
      const inst = (a.action as ModifyAttackAction).cardInstanceId;
      return state.players[HAZARD_PLAYER].hand.some(c => c.instanceId === inst && c.definitionId === WOLF_RIDERS_2);
    });
    expect(boost).toBeUndefined();
  });
});
