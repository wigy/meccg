/**
 * @module tw-35.test
 *
 * Card test: Fell Winter (tw-35)
 * Type: hazard-event (long-event, Environment), non-unique.
 *
 * Card text:
 *   "Environment. Each Border-hold [{B}] receives an additional
 *    automatic-attack: Wolves — 3 strikes with 7 prowess. Additionally, if
 *    Doors of Night is in play, treat all Free-domains [{f}] as Border-lands
 *    [{b}] and all Border-lands [{b}] as Wildernesses [{w}]. Cannot be
 *    duplicated."
 *
 * tw-35 is the **Wizards printing** of Fell Winter: same name, same text and
 * the same long-event Environment type as le-111 (verified against
 * `data/cards.json` — TW-35 and LE-111 are identical but for the artwork).
 * Its data carried the type and keywords but an empty `effects` array, so this
 * printing was an environment that changed nothing: no Wolves at Border-holds,
 * no region remap under Doors of Night, and no duplication limit.
 *
 * Rule coverage:
 *
 * | # | Rule                                                    | Status | Notes                                     |
 * |---|---------------------------------------------------------|--------|-------------------------------------------|
 * | 1 | Every Border-hold gains a Wolves 3×7 automatic-attack   | FIXED  | `permanent-event-auto-attack` siteType    |
 * | 2 | With Doors of Night: {f}→{b} and {b}→{w} for keying     | FIXED  | `region-type-remap`, gated live on DoN    |
 * | 3 | Cannot be duplicated                                     | FIXED  | `duplication-limit` scope game, max 1     |
 *
 * The duplication limit counts in-play copies **by card name**
 * (`countCopiesInPlay`), so it spans printings — one Fell Winter on the table
 * bars the other, which is what "cannot be duplicated" means for a card
 * printed twice. That cross-printing case is the one thing this file tests
 * that le-111's cannot; the remap's simultaneous-not-cascading behaviour and
 * the non-Border-hold control stay pinned there.
 *
 * Playable: FULLY — CERTIFIED (2026-08-18).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  DOORS_OF_NIGHT,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint,
  makeMHState, addCardInPlay,
  buildSitePhaseState, addP2CardsInPlay, setupAutoAttackStep, dispatch,
  viableActions,
  HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, Alignment, RegionType, SiteType, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay, GameState } from '../../index.js';

const FELL_WINTER_TW = 'tw-35' as CardDefinitionId;
const FELL_WINTER_LE = 'le-111' as CardDefinitionId; // the other printing of this same card
const BREE = 'tw-378' as CardDefinitionId;           // Border-hold with no printed auto-attacks
const GIANT = 'tw-39' as CardDefinitionId;           // keyed {w}{w} (region type only)

const fellWinterInPlay: CardInPlay = {
  instanceId: 'fw-tw-1' as CardInstanceId,
  definitionId: FELL_WINTER_TW,
  status: CardStatus.Untapped,
};

describe('Fell Winter (tw-35)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: the Wolves attack every Border-hold gains ─────────────────────

  test('a Border-hold (Bree) gains a Wolves 3×7 automatic-attack while Fell Winter is in play', () => {
    const withFellWinter = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: BREE, characters: [ARAGORN] }), [fellWinterInPlay]),
    );
    const attacked = dispatch(withFellWinter, { type: 'pass', player: PLAYER_1 });
    expect(attacked.combat).not.toBeNull();
    expect(attacked.combat!.strikesTotal).toBe(3);
    expect(attacked.combat!.strikeProwess).toBe(7);

    // Control: the same Border-hold has no automatic-attack of its own.
    const without = setupAutoAttackStep(buildSitePhaseState({ site: BREE, characters: [ARAGORN] }));
    expect(dispatch(without, { type: 'pass', player: PLAYER_1 }).combat).toBeNull();
  });

  // ─── Rule 2: the Doors-of-Night region remap ──────────────────────────────

  test('with Doors of Night, Border-lands count as Wildernesses — a {w}{w} creature becomes playable', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GIANT], siteDeck: [RIVENDELL] },
      ],
    });
    const onBorderPath: GameState = {
      ...base,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Border, RegionType.Border],
        resolvedSitePathNames: ['Andrast', 'Enedwaith'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };
    const giantId = onBorderPath.players[HAZARD_PLAYER].hand.find(c => c.definitionId === GIANT)!.instanceId;

    // Fell Winter alone does not remap — the remap is gated on Doors of Night.
    const fellWinterOnly = addCardInPlay(onBorderPath, HAZARD_PLAYER, FELL_WINTER_TW);
    expect(computeLegalActions(fellWinterOnly, PLAYER_2).some(
      ea => ea.action.type === 'play-hazard' && ea.action.cardInstanceId === giantId && ea.viable,
    )).toBe(false);

    const withDoors = addCardInPlay(fellWinterOnly, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const play = computeLegalActions(withDoors, PLAYER_2).find(
      ea => ea.action.type === 'play-hazard' && ea.action.cardInstanceId === giantId && ea.viable,
    );
    expect(play).toBeDefined();
    // Keyed through the remapped region type, not the printed one.
    expect((play!.action as { keyedBy?: { method: string; value: string } }).keyedBy)
      .toEqual({ method: 'region-type', value: RegionType.Wilderness });
  });

  // ─── Rule 3: cannot be duplicated — across printings ──────────────────────

  test('cannot be duplicated: the Wizards printing is unplayable while the Lidless Eye printing is in play', () => {
    // The duplication limit counts in-play copies by card *name*, so the two
    // printings are one card for this purpose — which is what "cannot be
    // duplicated" means for a card that was printed twice.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [FELL_WINTER_TW], siteDeck: [RIVENDELL] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState() };
    const twId = state.players[HAZARD_PLAYER].hand.find(c => c.definitionId === FELL_WINTER_TW)!.instanceId;

    // On its own it is a legal hazard long-event play.
    expect(viableActions(state, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === twId).length).toBeGreaterThan(0);

    const otherPrintingInPlay = addCardInPlay(state, HAZARD_PLAYER, FELL_WINTER_LE);
    expect(viableActions(otherPrintingInPlay, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === twId)).toHaveLength(0);
  });
});
