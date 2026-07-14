/**
 * @module ba-63.test
 *
 * Card test: Heart of Dark Fire (ba-63)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0. Balrog specific.
 *
 * Text:
 *   "Balrog specific. Playable if Strangling Coils is in play. You may bring
 *    this card from your sideboard into your play deck and reshuffle during your
 *    organization phase. The Balrog receives +5 direct influence this turn while
 *    Strangling Coils is in play. Cannot be duplicated on a given turn."
 *
 * Distinct rules:
 *   1. Play gate — `play-window` (organization) + `play-condition`
 *      (`card-in-play`, "Strangling Coils"). Strangling Coils (ba-76) is a
 *      demon-fána held in The Balrog's items; the gate is attachment-aware.
 *   2. Main effect — a turn-scoped `character-stat-modifier` constraint added on
 *      play (`on-event self-enters-play` → `add-constraint character-stat-modifier
 *      direct-influence +5`) targeting The Balrog, carrying a
 *      `requiresCardInPlay: "Strangling Coils"` gate. The effect resolver
 *      synthesises the +5 into The Balrog's effective direct influence, but only
 *      *while* Strangling Coils remains in play — the bonus lapses the moment it
 *      leaves play.
 *   3. Sideboard self-relocation — a `move` (`select: self`, `from: sideboard`,
 *      `to: deck`, `shuffleAfter`) surfaced during the organization phase as a
 *      dedicated `card-sideboard-to-deck` action; taps nothing.
 *   4. "Cannot be duplicated on a given turn" — a `duplication-limit` (scope
 *      turn, max 1): a second copy is unplayable once one has resolved this turn.
 *
 * "Balrog specific" is a deck-construction keyword (`balrog-specific`), no
 * play-time gate — per the ba-45/ba-46 precedent.
 *
 * Rule coverage:
 * | # | Rule                                                                  | Status      |
 * |---|-----------------------------------------------------------------------|-------------|
 * | 1 | NOT playable in org phase while Strangling Coils is not in play        | IMPLEMENTED |
 * | 2 | Playable in org phase once Strangling Coils is in play (item on Balrog)| IMPLEMENTED |
 * | 3 | NOT playable during the site phase (play-window: organization)         | IMPLEMENTED |
 * | 4 | Playing it adds a turn-scoped character-stat-modifier constraint; discard| IMPLEMENTED |
 * | 5 | The Balrog's effective direct influence rises by exactly +5 on play    | IMPLEMENTED |
 * | 6 | The +5 lapses if Strangling Coils leaves play (requiresCardInPlay gate) | IMPLEMENTED |
 * | 7 | Cannot be duplicated on a given turn (a second copy is unplayable)      | IMPLEMENTED |
 * | 8 | Sideboard copy offers card-sideboard-to-deck in the org phase          | IMPLEMENTED |
 * | 9 | Dispatching it moves the card sideboard → play deck                    | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   BA_63 (ba-63)            - minion short event (this card)
 *   STRANGLING_COILS (ba-76) - minion demon-fána (the gate card, item on Balrog)
 *   THE_BALROG (ba-3)        - minion balrog avatar (base direct influence 6)
 *   VARIAG_CAMP (le-411)     - minion border-hold (site of origin)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, dispatch,
  viableActions, findHandCardId, expectInDiscardPile, getCharacter,
  MINAS_TIRITH, PLAYER_1, PLAYER_2, Phase, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayShortEventAction } from '../../index.js';
import { Alignment } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { addConstraint } from '../../engine/pending.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const BA_63 = 'ba-63' as CardDefinitionId;
const STRANGLING_COILS = 'ba-76' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId;
const VARIAG_CAMP = 'le-411' as CardDefinitionId;

/** The ba-63 play-short-event action for a specific hand instance, if viable. */
function heartPlayAction(state: GameState, inst: CardInstanceId): PlayShortEventAction | undefined {
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .find(a => a.cardInstanceId === inst);
}

/** Org-phase state with The Balrog (optionally carrying Strangling Coils) and a hand. */
function orgState(opts: { coils: boolean; hand: CardDefinitionId[]; sideboard?: CardDefinitionId[] }): GameState {
  const balrog = opts.coils ? { defId: THE_BALROG, items: [STRANGLING_COILS] } : THE_BALROG;
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith,
        companies: [{ site: VARIAG_CAMP, characters: [balrog] }],
        hand: opts.hand, sideboard: opts.sideboard ?? [], playDeck: [MINAS_TIRITH], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

/** Add a turn-scoped character-stat-modifier (+5 DI on The Balrog) with the Coils gate. */
function withCoilsGatedBonus(state: GameState): GameState {
  const balrogId = getCharacter(state, RESOURCE_PLAYER, THE_BALROG).instanceId;
  return recomputeDerived(addConstraint(state, {
    source: 'heart-1' as CardInstanceId,
    sourceDefinitionId: BA_63,
    scope: { kind: 'turn' },
    target: { kind: 'character', characterId: balrogId },
    kind: { type: 'character-stat-modifier', stat: 'direct-influence', value: 5, characterId: balrogId, requiresCardInPlay: 'Strangling Coils' },
  }));
}

describe('Heart of Dark Fire (ba-63)', () => {
  beforeEach(() => resetMint());

  // ─── Play gate (Strangling Coils) ───────────────────────────────────────────

  test('NOT playable during the organization phase while Strangling Coils is not in play', () => {
    const state = orgState({ coils: false, hand: [BA_63] });
    const inst = findHandCardId(state, RESOURCE_PLAYER, BA_63);
    expect(heartPlayAction(state, inst)).toBeUndefined();
  });

  test('playable during the organization phase once Strangling Coils is in play (item on The Balrog)', () => {
    const state = orgState({ coils: true, hand: [BA_63] });
    const inst = findHandCardId(state, RESOURCE_PLAYER, BA_63);
    expect(heartPlayAction(state, inst)).toBeDefined();
  });

  test('NOT playable during the site phase even with Strangling Coils in play (play-window: organization)', () => {
    const base = buildSitePhaseState({
      characters: [{ defId: THE_BALROG, items: [STRANGLING_COILS] }],
      site: VARIAG_CAMP,
      hand: [BA_63],
    });
    const state = {
      ...base,
      players: [{ ...base.players[0], alignment: Alignment.Ringwraith }, base.players[1]] as typeof base.players,
    };
    const inst = findHandCardId(state, RESOURCE_PLAYER, BA_63);
    expect(heartPlayAction(state, inst)).toBeUndefined();
  });

  // ─── Main effect: +5 direct influence via character-stat-modifier ────────────

  test('playing it adds a turn-scoped character-stat-modifier (+5 direct influence on The Balrog) and discards the card', () => {
    const state = orgState({ coils: true, hand: [BA_63] });
    const inst = findHandCardId(state, RESOURCE_PLAYER, BA_63);
    const after = dispatch(state, heartPlayAction(state, inst)!);

    const balrogId = getCharacter(after, RESOURCE_PLAYER, THE_BALROG).instanceId;
    const mods = after.activeConstraints.filter(
      c => c.kind.type === 'character-stat-modifier' && c.target.kind === 'character',
    );
    expect(mods).toHaveLength(1);
    const constraint = mods[0];
    expect(constraint.scope.kind).toBe('turn');
    if (constraint.kind.type === 'character-stat-modifier') {
      expect(constraint.kind.stat).toBe('direct-influence');
      expect(constraint.kind.value).toBe(5);
      expect(constraint.kind.characterId).toBe(balrogId);
      expect(constraint.kind.requiresCardInPlay).toBe('Strangling Coils');
    }

    expectInDiscardPile(after, RESOURCE_PLAYER, inst);
  });

  test('The Balrog’s effective direct influence rises by exactly +5 on play', () => {
    const state = orgState({ coils: true, hand: [BA_63] });
    const before = getCharacter(state, RESOURCE_PLAYER, THE_BALROG).effectiveStats.directInfluence;
    const inst = findHandCardId(state, RESOURCE_PLAYER, BA_63);
    const after = dispatch(state, heartPlayAction(state, inst)!);
    const afterDI = getCharacter(after, RESOURCE_PLAYER, THE_BALROG).effectiveStats.directInfluence;
    expect(afterDI).toBe(before + 5);
  });

  // ─── The "while Strangling Coils is in play" gate ────────────────────────────

  test('the +5 applies while Strangling Coils is in play', () => {
    const base = orgState({ coils: true, hand: [] });
    const baselineDI = getCharacter(base, RESOURCE_PLAYER, THE_BALROG).effectiveStats.directInfluence;
    const gated = withCoilsGatedBonus(base);
    const gatedDI = getCharacter(gated, RESOURCE_PLAYER, THE_BALROG).effectiveStats.directInfluence;
    expect(gatedDI).toBe(baselineDI + 5);
  });

  test('the +5 lapses when Strangling Coils is not in play (requiresCardInPlay gate)', () => {
    const base = orgState({ coils: false, hand: [] });
    const baselineDI = getCharacter(base, RESOURCE_PLAYER, THE_BALROG).effectiveStats.directInfluence;
    // Same constraint, but The Balrog no longer carries Strangling Coils.
    const gated = withCoilsGatedBonus(base);
    const gatedDI = getCharacter(gated, RESOURCE_PLAYER, THE_BALROG).effectiveStats.directInfluence;
    expect(gatedDI).toBe(baselineDI);
  });

  // ─── Cannot be duplicated on a given turn ────────────────────────────────────

  test('a second copy is unplayable once one has resolved this turn', () => {
    const state = orgState({ coils: true, hand: [BA_63, BA_63] });
    const insts = state.players[RESOURCE_PLAYER].hand
      .filter(c => c.definitionId === BA_63)
      .map(c => c.instanceId);
    expect(insts).toHaveLength(2);

    // Both copies are playable before either resolves.
    expect(heartPlayAction(state, insts[0])).toBeDefined();
    expect(heartPlayAction(state, insts[1])).toBeDefined();

    const after = dispatch(state, heartPlayAction(state, insts[0])!);
    const remaining = findHandCardId(after, RESOURCE_PLAYER, BA_63);

    // The surviving copy is no longer viable...
    expect(heartPlayAction(after, remaining)).toBeUndefined();
    // ...and is explicitly surfaced as a non-viable action citing duplication.
    const blocked = computeLegalActions(after, PLAYER_1).find(
      ea => !ea.viable
        && ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === remaining,
    );
    expect(blocked).toBeDefined();
    expect(blocked?.reason).toMatch(/duplicated/i);
  });

  // ─── Sideboard self-relocation ───────────────────────────────────────────────

  test('a sideboard copy offers a card-sideboard-to-deck action during the org phase', () => {
    const state = orgState({ coils: true, hand: [], sideboard: [BA_63] });
    const sideboardInst = state.players[RESOURCE_PLAYER].sideboard[0].instanceId;
    const offers = viableActions(state, PLAYER_1, 'card-sideboard-to-deck')
      .map(ea => ea.action as { cardInstanceId: CardInstanceId });
    expect(offers).toHaveLength(1);
    expect(offers[0].cardInstanceId).toBe(sideboardInst);
  });

  test('dispatching card-sideboard-to-deck moves the card from the sideboard into the play deck', () => {
    const state = orgState({ coils: true, hand: [], sideboard: [BA_63] });
    const sideboardInst = state.players[RESOURCE_PLAYER].sideboard[0].instanceId;
    const action = viableActions(state, PLAYER_1, 'card-sideboard-to-deck')[0].action;
    const after = dispatch(state, action);

    expect(after.players[RESOURCE_PLAYER].sideboard.map(c => c.instanceId)).not.toContain(sideboardInst);
    expect(after.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId)).toContain(sideboardInst);
  });
});
