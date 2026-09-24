/**
 * @module as-10.test
 *
 * Card test: Galadhrim (as-10)
 * Type: hazard-creature
 * Race: Elves
 * Strikes: 3  Prowess: 11  Body: 7  Kill-MP: 2*
 *
 * Card text:
 *   "Elves. Three strikes. Detainment and -2 prowess against hero companies.
 *    Playable keyed to Lindon, Rhudaur, Wold & Foothills, or Anfalas; or at
 *    non-Haven sites in these regions. Each character wounded by Galadhrim
 *    must discard all items he bears."
 *
 * Rule coverage:
 *   - Three-strike creature combat (base data — engine handles unconditionally)
 *   - Detainment and -2 prowess against hero (and covert fallen-wizard)
 *     companies only; full prowess and no detainment against minion companies
 *   - Keyed to the four named regions (Lindon, Rhudaur, Wold & Foothills,
 *     Anfalas); may also be played at a non-Haven site in one of these
 *     regions even when the movement path never enters one (siteInRegionNames
 *     + `destinationSite.siteType !== haven`, the Beorning Toll le-62 shape)
 *   - Each character wounded by Galadhrim must discard ALL items he bears —
 *     unlike the Troll cycle (tw-016/103/112), there is no "non-special"
 *     exception and no extra "already faced X" precondition
 *
 * Effects: combat-detainment (hero / covert fallen-wizard defenders),
 * stat-modifier prowess -2 vs hero, on-event character-wounded-by-self ->
 * move (filter-all, items-on-wounded -> discard, no filter — every item).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  GLAMDRING,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, expectCharItemCount,
  dispatch, executeAction, findCharInstanceId,
} from '../test-helpers.js';
import { computeLegalActions, Alignment, Phase, SiteType, ETTENMOORS_HERO } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const GALADHRIM = 'as-10' as CardDefinitionId;
const THE_MOUTH = 'le-24' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const BARAD_DUR = 'le-352' as CardDefinitionId;
// Unique minion "special"-subtype item — the Troll cycle's "non-special
// items" exception would spare this, so it isolates the fact that Galadhrim
// discards ALL items, special or not.
const ANCIENT_BLACK_AXE = 'as-122' as CardDefinitionId;

const RHUDAUR_KEYING = { method: 'region-name' as const, value: 'Rhudaur' };

/**
 * Galadhrim assigns all 3 strikes at once against a single character: since
 * only one defender exists, each `assign-strike` call to the same character
 * merges into one strike assignment with incrementing `excessStrikes` (CoE
 * 3.iv.2 — multiple strikes at one character resolve as a single roll with a
 * cumulative -1 prowess penalty per excess strike), so a single
 * `resolve-strike` (and optional body check) finishes combat.
 */
function resolveGaladhrimCombat(
  state: GameState,
  characterDefId: CardDefinitionId,
  strikeRoll: number,
  bodyRoll: number | null,
): GameState {
  const charId = findCharInstanceId(state, RESOURCE_PLAYER, characterDefId);
  let s = state;
  for (let i = 0; i < 3; i++) {
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: charId });
  }
  const afterStrike = executeAction(s, PLAYER_1, 'resolve-strike', strikeRoll, false);
  if (afterStrike.combat?.phase === 'body-check' && bodyRoll !== null) {
    const bodyRoller = afterStrike.combat.bodyCheckTarget === 'creature' ? PLAYER_1 : PLAYER_2;
    return executeAction(afterStrike, bodyRoller, 'body-check-roll', bodyRoll);
  }
  return afterStrike;
}

const MH_RHUDAUR = {
  resolvedSitePathNames: ['Rhudaur'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Ettenmoors',
};

describe('Galadhrim (as-10)', () => {
  beforeEach(() => resetMint());

  // ─── Detainment / -2 prowess vs hero only ──────────────────────────────────

  test('attack on a hero company: 3 strikes, prowess 11-2 = 9, detainment', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GALADHRIM], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState(MH_RHUDAUR) };

    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(ready, PLAYER_2, cardId, companyId, RHUDAUR_KEYING);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.strikeProwess).toBe(9);
    expect(after.combat!.detainment).toBe(true);
  });

  test('attack on a minion company: full prowess 11, no detainment', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }], hand: [], siteDeck: [BARAD_DUR] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GALADHRIM], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState(MH_RHUDAUR) };

    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(ready, PLAYER_2, cardId, companyId, RHUDAUR_KEYING);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.strikeProwess).toBe(11);
    expect(after.combat!.detainment).toBe(false);
  });

  // ─── Keying: named regions, and non-Haven sites in these regions ───────────

  test('keyable to Rhudaur by region name', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GALADHRIM], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState(MH_RHUDAUR) };

    const hazardActions = computeLegalActions(ready, PLAYER_2);
    const plays = hazardActions.filter(
      a => a.action.type === 'play-hazard'
        && 'cardInstanceId' in a.action
        && a.action.cardInstanceId === handCardId(ready, HAZARD_PLAYER)
        && a.viable,
    );
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'Rhudaur';
    })).toBe(true);
  });

  test('keyable at a non-Haven site in Rhudaur even when the path never enters a named region', () => {
    // Ettenmoors is a Ruins & Lairs site in Rhudaur, reached here through a
    // path that names no keyed region — only the site-in-region entry can
    // key this.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN], destinationSite: ETTENMOORS_HERO }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GALADHRIM], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePathNames: ['Old Forest'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Ettenmoors',
      }),
    };

    const hazardActions = computeLegalActions(ready, PLAYER_2);
    const plays = hazardActions.filter(
      a => a.action.type === 'play-hazard'
        && 'cardInstanceId' in a.action
        && a.action.cardInstanceId === handCardId(ready, HAZARD_PLAYER)
        && a.viable,
    );
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-in-region' && a.keyedBy?.value === 'Rhudaur';
    })).toBe(true);
  });

  test('NOT keyable at a Haven in Rhudaur via site-in-region (non-Haven qualifier)', () => {
    // Rivendell is a Haven in Rhudaur, reached through a path that names no
    // keyed region — the site-in-region entry is gated on
    // destinationSite.siteType !== haven, so it must not match.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN], destinationSite: RIVENDELL }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GALADHRIM], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePathNames: ['Old Forest'],
        destinationSiteType: SiteType.Haven,
        destinationSiteName: 'Rivendell',
      }),
    };

    const hazardActions = computeLegalActions(ready, PLAYER_2);
    const plays = hazardActions.filter(
      a => a.action.type === 'play-hazard'
        && 'cardInstanceId' in a.action
        && a.action.cardInstanceId === handCardId(ready, HAZARD_PLAYER)
        && a.viable,
    );
    expect(plays).toHaveLength(0);
  });

  test('not playable when the path and destination match none of the four named regions', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GALADHRIM], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePathNames: ['Fangorn', 'Rohan'],
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Edoras',
      }),
    };

    const hazardActions = computeLegalActions(ready, PLAYER_2);
    const plays = hazardActions.filter(
      a => a.action.type === 'play-hazard'
        && 'cardInstanceId' in a.action
        && a.action.cardInstanceId === handCardId(ready, HAZARD_PLAYER),
    );
    expect(plays.every(a => !a.viable)).toBe(true);
  });

  // ─── Wound trigger: discard ALL items (no "non-special" exception) ────────

  // These use a minion defender: Galadhrim's detainment rule only applies
  // against hero (or covert fallen-wizard) companies, and a detainment
  // result taps rather than wounds — which would never trigger the
  // wound-item-discard event at all. A minion company gets a genuine wound.

  test('wounded character discards all items he bears, including special items', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: THE_MOUTH, items: [GLAMDRING, ANCIENT_BLACK_AXE] }] }],
          hand: [], siteDeck: [BARAD_DUR],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GALADHRIM], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState(MH_RHUDAUR) };

    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, cardId, companyId, RHUDAUR_KEYING);

    // Strike roll 2: low → wounded (no detainment against a minion company).
    // Body check 5 → survives.
    const afterWound = resolveGaladhrimCombat(afterChain, THE_MOUTH, 2, 5);
    expect(afterWound.combat).toBeNull();

    // All of The Mouth's items are discarded — including the Ancient Black
    // Axe, a genuine `subtype: "special"` item that the Troll cycle's
    // "non-special items" exception would have spared. Galadhrim's text
    // carries no such exception.
    expectCharItemCount(afterWound, RESOURCE_PLAYER, THE_MOUTH, 0);
    const discardDefIds = afterWound.players[0].discardPile.map(c => c.definitionId);
    expect(discardDefIds).toContain(GLAMDRING);
    expect(discardDefIds).toContain(ANCIENT_BLACK_AXE);
  });

  test('character who defeats Galadhrim keeps his items', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: THE_MOUTH, items: [GLAMDRING] }] }],
          hand: [], siteDeck: [BARAD_DUR],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GALADHRIM], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState(MH_RHUDAUR) };

    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, cardId, companyId, RHUDAUR_KEYING);

    // High roll → The Mouth defeats the strike, no wound. A defeated strike
    // still forces a body check against the creature; the roll here (2, a
    // miss) is irrelevant to this test beyond finishing combat.
    const afterStrike = resolveGaladhrimCombat(afterChain, THE_MOUTH, 12, 2);
    expect(afterStrike.combat).toBeNull();

    expectCharItemCount(afterStrike, RESOURCE_PLAYER, THE_MOUTH, 1);
  });
});
