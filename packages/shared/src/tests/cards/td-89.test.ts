/**
 * @module td-89.test
 *
 * Card test: Worn and Famished (td-89)
 * Type: hazard-event (Long-event), Neutral, non-unique. Cannot be duplicated.
 *
 * Card text:
 *   "Each non-Wizard character that is not in a Haven [{H}], Free-hold [{F}],
 *    or Border-hold [{B}] does not untap normally during his untap phase.
 *    Character's player may instead make a roll adding his mind. If the
 *    result is greater than 12, he untaps. This card has no effect on a
 *    minion player. Cannot be duplicated."
 *
 * Engine Support — CERTIFICATION STATUS: CERTIFIED
 * | # | Rule                                                    | Status      | Notes                                             |
 * |---|----------------------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | Non-exempt tapped character does not untap normally     | IMPLEMENTED | `untap-mind-roll` effect, `performUntap`           |
 * | 2 | Player may roll +mind; >12 untaps                        | IMPLEMENTED | generic `dice-check`, `set-character-status`       |
 * | 3 | Exempt at Haven/Free-hold/Border-hold                    | IMPLEMENTED | `exemptSiteTypes`                                  |
 * | 4 | "non-Wizard" — Wizards always exempt                     | IMPLEMENTED | race check in `isExemptFromUntapMindRoll`          |
 * | 5 | No effect on a minion player                             | IMPLEMENTED | `noEffectOnMinion` gate on the untapping player    |
 * | 6 | Cannot be duplicated                                      | IMPLEMENTED | duplication-limit scope game, max 1                |
 *
 * Rolling has no downside (no `onFail` penalty attached to the dice-check), so
 * the printed "may instead make a roll" is modeled as an always-taken roll
 * rather than an interactive decline — a rational player always rolls.
 *
 * Playable: FULLY — CERTIFIED. Every printed rule is enforced.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase, CardStatus,
  viableActions, findCharInstanceId,
  addCardInPlay, makeMHState,
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  BILBO, GANDALF,
  RIVENDELL, LORIEN, MORIA, BREE, EDORAS, MINAS_TIRITH,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const WORN_AND_FAMISHED = 'td-89' as CardDefinitionId;
// BILBO (tw-131): hobbit, mind 5, non-Wizard. GANDALF (tw-156): Wizard, mind null (→ 0).
// RIVENDELL (tw-421): Haven. BREE (tw-378): Border-hold. EDORAS (tw-394): Free-hold.
// MORIA (tw-413): shadow-hold — not Haven/Free-hold/Border-hold, so a restricted site.

/**
 * Untap-phase state: the active player has a tapped `charDef` in a company at
 * `site`; Worn and Famished sits in the hazard player's `cardsInPlay` unless
 * `omitCard` is set.
 */
function untapState(opts: {
  site: CardDefinitionId;
  charDef: CardDefinitionId;
  alignment?: Alignment;
  omitCard?: boolean;
}): GameState {
  let state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Untap,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: opts.alignment ?? Alignment.Wizard,
        companies: [{ site: opts.site, characters: [{ defId: opts.charDef, status: CardStatus.Tapped }] }],
        hand: [],
        siteDeck: [],
      },
      { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
    ],
  });
  if (!opts.omitCard) {
    state = addCardInPlay(state, HAZARD_PLAYER, WORN_AND_FAMISHED);
  }
  return state;
}

describe('Worn and Famished (td-89)', () => {
  beforeEach(() => resetMint());

  // ─── Rules 1–2: restricted character stays tapped, roll may untap it ──────

  test('a non-Wizard character not at a Haven/Free-hold/Border-hold stays tapped and queues a roll', () => {
    const state = untapState({ site: MORIA, charDef: BILBO });
    const charId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);

    const after = dispatch(state, { type: 'untap', player: PLAYER_1 });
    expect(after.players[RESOURCE_PLAYER].characters[charId].status).toBe(CardStatus.Tapped);
    expect(viableActions(after, PLAYER_1, 'resolve-dice-check')).toHaveLength(1);
  });

  test('roll pass (2d6 + mind > 12) untaps the character', () => {
    const state = untapState({ site: MORIA, charDef: BILBO });
    const charId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const afterUntap = dispatch(state, { type: 'untap', player: PLAYER_1 });

    // Bilbo's mind is 5; a rolled 8 → 8 + 5 = 13 > 12 → untaps.
    const resolved = dispatch(
      { ...afterUntap, cheatRollTotal: 8 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );
    expect(resolved.players[RESOURCE_PLAYER].characters[charId].status).toBe(CardStatus.Untapped);
  });

  test('roll fail (2d6 + mind not > 12) leaves the character tapped', () => {
    const state = untapState({ site: MORIA, charDef: BILBO });
    const charId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const afterUntap = dispatch(state, { type: 'untap', player: PLAYER_1 });

    // Bilbo's mind is 5; a rolled 7 → 7 + 5 = 12, not strictly greater than 12.
    const resolved = dispatch(
      { ...afterUntap, cheatRollTotal: 7 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );
    expect(resolved.players[RESOURCE_PLAYER].characters[charId].status).toBe(CardStatus.Tapped);
  });

  // ─── Rule 3: exempt at Haven/Free-hold/Border-hold ─────────────────────────

  test('a character at a Haven untaps normally — no roll queued', () => {
    const state = untapState({ site: RIVENDELL, charDef: BILBO });
    const charId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const after = dispatch(state, { type: 'untap', player: PLAYER_1 });
    expect(after.players[RESOURCE_PLAYER].characters[charId].status).toBe(CardStatus.Untapped);
    expect(viableActions(after, PLAYER_1, 'resolve-dice-check')).toHaveLength(0);
  });

  test('a character at a Border-hold untaps normally — no roll queued', () => {
    const state = untapState({ site: BREE, charDef: BILBO });
    const charId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const after = dispatch(state, { type: 'untap', player: PLAYER_1 });
    expect(after.players[RESOURCE_PLAYER].characters[charId].status).toBe(CardStatus.Untapped);
    expect(viableActions(after, PLAYER_1, 'resolve-dice-check')).toHaveLength(0);
  });

  test('a character at a Free-hold untaps normally — no roll queued', () => {
    const state = untapState({ site: EDORAS, charDef: BILBO });
    const charId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const after = dispatch(state, { type: 'untap', player: PLAYER_1 });
    expect(after.players[RESOURCE_PLAYER].characters[charId].status).toBe(CardStatus.Untapped);
    expect(viableActions(after, PLAYER_1, 'resolve-dice-check')).toHaveLength(0);
  });

  // ─── Rule 4: "non-Wizard" — Wizards are always exempt ──────────────────────

  test('a Wizard character untaps normally regardless of site', () => {
    const state = untapState({ site: MORIA, charDef: GANDALF });
    const charId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const after = dispatch(state, { type: 'untap', player: PLAYER_1 });
    expect(after.players[RESOURCE_PLAYER].characters[charId].status).toBe(CardStatus.Untapped);
    expect(viableActions(after, PLAYER_1, 'resolve-dice-check')).toHaveLength(0);
  });

  // ─── Rule 5: no effect on a minion player ──────────────────────────────────

  test('no effect on a minion (Ringwraith) player — untaps normally despite a non-exempt site', () => {
    const state = untapState({ site: MORIA, charDef: BILBO, alignment: Alignment.Ringwraith });
    const charId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const after = dispatch(state, { type: 'untap', player: PLAYER_1 });
    expect(after.players[RESOURCE_PLAYER].characters[charId].status).toBe(CardStatus.Untapped);
    expect(viableActions(after, PLAYER_1, 'resolve-dice-check')).toHaveLength(0);
  });

  // ─── Sanity: without the card in play, untapping is unaffected ────────────

  test('without Worn and Famished in play, the character untaps normally', () => {
    const state = untapState({ site: MORIA, charDef: BILBO, omitCard: true });
    const charId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const after = dispatch(state, { type: 'untap', player: PLAYER_1 });
    expect(after.players[RESOURCE_PLAYER].characters[charId].status).toBe(CardStatus.Untapped);
  });

  // ─── Play restriction: unplayable against a Ringwraith opponent ───────────

  test('NOT playable against a minion (Ringwraith) opponent', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [BILBO] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [WORN_AND_FAMISHED], siteDeck: [] },
      ],
    });
    const state = { ...built, phaseState: makeMHState() };
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Rule 6: cannot be duplicated ──────────────────────────────────────────

  test('a second copy cannot be played while one is in play', () => {
    const wornInPlay = { instanceId: 'worn-1' as CardInstanceId, definitionId: WORN_AND_FAMISHED, status: CardStatus.Untapped };
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BILBO] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [WORN_AND_FAMISHED], siteDeck: [MINAS_TIRITH], cardsInPlay: [wornInPlay] },
      ],
    });
    const state = { ...built, phaseState: makeMHState() };
    const handId = state.players[HAZARD_PLAYER].hand.find(c => c.definitionId === WORN_AND_FAMISHED)!.instanceId;

    const viablePlays = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === handId);
    expect(viablePlays).toHaveLength(0);

    const blocked = computeLegalActions(state, PLAYER_2).find(
      ea => !ea.viable && ea.action.type === 'play-hazard'
        && (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === handId,
    );
    expect(blocked?.reason ?? '').toMatch(/duplicat/i);
  });
});
