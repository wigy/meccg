/**
 * @module le-88.test
 *
 * Card test: Pirates (le-88)
 * Type: hazard-creature
 * Race: man
 * Stats: prowess 7, strikes 3, kill-marshalling-points 1
 *
 * Card text:
 *   "Men. Three strikes. If any strike of Pirates wounds a character, the
 *    company must immediately discard one item (of defender's choice).
 *    Pirates receives +2 prowess when keyed to Coastal Seas [{c}]."
 *
 * Keying (playable: {w}{c}{R}) — one region/site-type entry, each token an
 * independent OR alternative:
 * | # | Entry                                        |
 * |---|-----------------------------------------------|
 * | 1 | regionTypes: [wilderness, coastal]             |
 * |   | siteTypes: [ruins-and-lairs]                   |
 *
 * Effects:
 * | # | Effect Type    | Status | Notes                                          |
 * |---|----------------|--------|-------------------------------------------------|
 * | 1 | on-event       | OK     | character-wounded-by-self → force-discard-one-  |
 * |   |                |        | company-item (Brigands le-64 precedent)         |
 * | 2 | stat-modifier  | OK     | +2 prowess when `attack.keying` includes coastal |
 *
 * Data fix: the imported `keyedTo`/text used the literal "coastal-sea",
 * which is not a valid `RegionType` (the enum value is `"coastal"`) — the
 * region-type keying and the +2 prowess condition would never have matched
 * any real coastal region. Corrected to `"coastal"`.
 *
 * Engine change: `CreatureSelfContext` gained an `attackKeying` field so a
 * creature's own untargeted `stat-modifier` (the Orc-lieutenant self-boost
 * mechanism) can gate on `attack.keying` — which region type *this specific
 * play* was keyed to — not just company/defender state. See
 * `docs/certification-engine-support.md`.
 *
 * Playable: YES — CERTIFIED.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS, GIMLI,
  GLAMDRING, DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeWildernessMHState, makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch,
  viableActions, expectCharItemCount,
  executeAction,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const PIRATES = 'le-88' as CardDefinitionId;
const WILDERNESS_KEYING = { method: 'region-type' as const, value: RegionType.Wilderness };
const COASTAL_KEYING = { method: 'region-type' as const, value: RegionType.Coastal };

function baseState(characters: CardDefinitionId[] = [ARAGORN, LEGOLAS]) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [PIRATES], siteDeck: [RIVENDELL] },
    ],
  });
}

describe('Pirates (le-88)', () => {
  beforeEach(() => resetMint());

  // ─── Keying ────────────────────────────────────────────────────────────

  test('playable keyed to a coastal region', () => {
    const mhCoastal = makeMHState({
      resolvedSitePath: [RegionType.Coastal],
      resolvedSitePathNames: ['Elven Shores'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Pelargir',
    });
    const ready: GameState = { ...baseState(), phaseState: mhCoastal };
    const piratesId = handCardId(ready, HAZARD_PLAYER);
    const plays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => {
        if (a.action.type !== 'play-hazard') return false;
        const act = a.action as { cardInstanceId: CardInstanceId; keyedBy?: { method: string; value: string } };
        return act.cardInstanceId === piratesId && act.keyedBy?.value === 'coastal' && a.viable;
      });
    expect(plays.length).toBeGreaterThan(0);
  });

  test('playable keyed to a wilderness region', () => {
    const ready: GameState = { ...baseState(), phaseState: makeWildernessMHState() };
    const piratesId = handCardId(ready, HAZARD_PLAYER);
    const plays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId === piratesId && a.viable);
    expect(plays.length).toBeGreaterThan(0);
  });

  test('NOT playable on a border path to a non-Ruins-and-Lairs site', () => {
    const mhBorder = makeMHState({
      resolvedSitePath: [RegionType.Border],
      resolvedSitePathNames: ['Andrast'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Pelargir',
    });
    const ready: GameState = { ...baseState(), phaseState: mhBorder };
    const piratesId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId === piratesId && a.viable);
    expect(viable).toHaveLength(0);
  });

  // ─── Combat: base stats, no coastal bonus ─────────────────────────────

  test('combat initiates with 3 strikes and prowess 7 when keyed to wilderness (no coastal bonus)', () => {
    const ready: GameState = { ...baseState(), phaseState: makeWildernessMHState() };
    const piratesId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, piratesId, companyId, WILDERNESS_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(7);
    expect(afterChain.combat!.creatureRace).toBe('man');
  });

  // ─── Combat: +2 prowess when keyed to Coastal Seas ────────────────────

  test('combat initiates with prowess 9 (base 7 + 2) when keyed to a coastal region', () => {
    const mhCoastal = makeMHState({
      resolvedSitePath: [RegionType.Coastal],
      resolvedSitePathNames: ['Elven Shores'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Pelargir',
    });
    const ready: GameState = { ...baseState(), phaseState: mhCoastal };
    const piratesId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, piratesId, companyId, COASTAL_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(9);
  });

  // ─── Wound effect: forced item discard ────────────────────────────────

  test('a wounded character forces the company to discard one item, chosen by the defender', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING, DAGGER_OF_WESTERNESSE] }, BILBO, GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [PIRATES], siteDeck: [RIVENDELL] },
      ],
    });
    // Keyed to a coastal region (prowess 9) so a minimum 2d6 roll (2) against
    // Aragorn's prowess (5) — total 7 — is a wound, not a tie.
    const mhCoastal = makeMHState({
      resolvedSitePath: [RegionType.Coastal],
      resolvedSitePathNames: ['Elven Shores'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Pelargir',
    });
    const ready = { ...state, phaseState: mhCoastal };

    // Three strikes against three characters — one strike each.
    let s = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER), COASTAL_KEYING,
    );
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);   // first character wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2);  // survives the body check
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);  // second character beats their strike
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);  // third character auto-selected, beats their strike

    expect(s.combat).toBeNull();
    const pending = s.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('discard-one-company-item');

    // Both of the company's items are offered — the choice is the defender's.
    const choices = viableActions(s, PLAYER_1, 'discard-item-from-company');
    expect(choices).toHaveLength(2);

    const chosen = choices[0].action;
    const chosenInstanceId = (chosen as { itemInstanceId: string }).itemInstanceId;
    const after = dispatch(s, chosen);

    expectCharItemCount(after, RESOURCE_PLAYER, ARAGORN, 1);
    expect(after.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId)).toContain(chosenInstanceId);
    expect(after.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
  });

  test('no wound, no discard — the company keeps its items', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING] }, BILBO, GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [PIRATES], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };

    let s = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER), WILDERNESS_KEYING,
    );
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);  // all three strikes beaten
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);

    expect(s.combat).toBeNull();
    expect(s.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
    expectCharItemCount(s, RESOURCE_PLAYER, ARAGORN, 1);
  });
});
