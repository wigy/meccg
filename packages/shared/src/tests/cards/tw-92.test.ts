/**
 * @module tw-92.test
 *
 * Card test: Storms of Ossë (tw-92)
 * Type: hazard-event (Long-event, Environment)
 * Unique: no. Cannot be duplicated.
 *
 * Card text:
 *   "Environment. Playable if Doors of Night is in play. Each non-Haven/
 *    non-Darkhaven site in play with a Coastal Sea [{c}] in its site path is
 *    tapped. Cannot be duplicated."
 *
 * Effects (data):
 *   - play-condition, requires card-in-play "Doors of Night"
 *   - tap-sites-in-play, condition { site.type != haven AND sitePath.coastalCount >= 1 }
 *   - duplication-limit, scope game, max 1
 *
 * Engine Support — CERTIFICATION STATUS: CERTIFIED (2026-08-27)
 * | # | Rule                                                    | Status      | Notes                                                        |
 * |---|----------------------------------------------------------|-------------|---------------------------------------------------------------|
 * | 1 | Environment / long-event enters play on resolution       | IMPLEMENTED | resolveLongEvent adds card to cardsInPlay                     |
 * | 2 | Playable only if Doors of Night is in play                | IMPLEMENTED | play-condition `card-in-play` gate in legal-actions            |
 * | 3 | Non-Haven/non-Darkhaven site with a Coastal Sea is tapped  | IMPLEMENTED | `tap-sites-in-play` effect; sitePath.coastalCount added to ctx |
 * | 4 | Havens/Darkhavens are excluded                             | IMPLEMENTED | `site.type != "haven"` condition (Darkhavens are also `haven`) |
 * | 5 | Applies to both hero and minion sites alike                | IMPLEMENTED | no alignment gate on the effect (unlike tw-36 Foul Fumes)      |
 * | 6 | Cannot be duplicated                                       | IMPLEMENTED | duplication-limit scope game, max 1                            |
 *
 * Playable: FULLY — CERTIFIED. Every printed rule is enforced.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  makeMHState,
  addCardInPlay, resolveChain, viableActions,
  mint,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment, CardStatus } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, PlayHazardAction } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { initiateChain } from '../../engine/chain-reducer.js';

const STORMS_OF_OSSE = 'tw-92' as CardDefinitionId;
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId;
/** Tolfalas (tw-433): hero ruins-and-lairs, site path [wilderness, free, coastal]. */
const TOLFALAS = 'tw-433' as CardDefinitionId;
/** Isles of the Dead That Live (as-154): minion ruins-and-lairs, path [wilderness, coastal]. */
const DEAD_THAT_LIVE = 'as-154' as CardDefinitionId;
/** Dwar the Ringwraith — a minion (Ringwraith) avatar. */
const DWAR = 'le-52' as CardDefinitionId;

describe('Storms of Ossë (tw-92)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: non-Haven/non-Darkhaven site with a Coastal Sea is tapped ──────

  test('Doors of Night: a hero site with a Coastal Sea in its site path is tapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [
          { site: TOLFALAS, characters: [ARAGORN] },
          { site: LORIEN, characters: [LEGOLAS] },
        ], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withDon = addCardInPlay({ ...base, phaseState: makeMHState() }, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const chained = initiateChain(withDon, PLAYER_2, { instanceId: mint(), definitionId: STORMS_OF_OSSE }, { type: 'long-event' });
    const resolved = resolveChain(chained);

    const p1 = resolved.players[RESOURCE_PLAYER];
    expect(p1.companies[0].currentSite?.status).toBe(CardStatus.Tapped);   // Tolfalas (coastal)
    expect(p1.companies[1].currentSite?.status).toBe(CardStatus.Untapped); // Lórien (Haven, no coastal path)
  });

  test('a minion site with a Coastal Sea in its site path is also tapped — no alignment exclusion', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DEAD_THAT_LIVE, characters: [DWAR] }], hand: [], siteDeck: [] },
      ],
    });
    const withDon = addCardInPlay({ ...base, phaseState: makeMHState() }, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const chained = initiateChain(withDon, PLAYER_2, { instanceId: mint(), definitionId: STORMS_OF_OSSE }, { type: 'long-event' });
    const resolved = resolveChain(chained);

    expect(resolved.players[HAZARD_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
  });

  test('a site without a Coastal Sea in its site path is not tapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const withDon = addCardInPlay({ ...base, phaseState: makeMHState() }, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const chained = initiateChain(withDon, PLAYER_2, { instanceId: mint(), definitionId: STORMS_OF_OSSE }, { type: 'long-event' });
    const resolved = resolveChain(chained);

    expect(resolved.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
  });

  // ─── Playable only if Doors of Night is in play ───────────────────────────

  test('Storms of Ossë is only playable while Doors of Night is in play', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: TOLFALAS, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [STORMS_OF_OSSE], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...built, phaseState: makeMHState() };
    const cardHandId = state.players[HAZARD_PLAYER].hand.find(c => c.definitionId === STORMS_OF_OSSE)!.instanceId;
    const isStormsPlay = (ea: { action: { type: string } }) =>
      ea.action.type === 'play-hazard'
      && (ea.action as PlayHazardAction).cardInstanceId === cardHandId;

    const withoutDon = computeLegalActions(state, PLAYER_2).find(isStormsPlay);
    expect(withoutDon?.viable).toBe(false);
    expect(withoutDon?.reason).toMatch(/Doors of Night/);

    const withDon = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    expect(computeLegalActions(withDon, PLAYER_2).find(isStormsPlay)?.viable).toBe(true);
  });

  // ─── Cannot be duplicated ──────────────────────────────────────────────────

  test('a second Storms of Ossë cannot be played while one is in play', () => {
    const stormsInPlay = { instanceId: 'storms-1' as CardInstanceId, definitionId: STORMS_OF_OSSE, status: CardStatus.Untapped };
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [STORMS_OF_OSSE], siteDeck: [MINAS_TIRITH], cardsInPlay: [stormsInPlay] },
      ],
    });
    const state = addCardInPlay({ ...built, phaseState: makeMHState() }, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const cardHandId = state.players[HAZARD_PLAYER].hand.find(c => c.definitionId === STORMS_OF_OSSE)!.instanceId;

    const viablePlays = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === cardHandId);
    expect(viablePlays).toHaveLength(0);

    const blocked = computeLegalActions(state, PLAYER_2).find(
      ea => !ea.viable && ea.action.type === 'play-hazard'
        && (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === cardHandId,
    );
    expect(blocked?.reason ?? '').toMatch(/duplicat/i);
  });
});
