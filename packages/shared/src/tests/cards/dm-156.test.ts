/**
 * @module dm-156.test
 *
 * Card test: Saw Further and Deeper (dm-156)
 * Type: hero-resource-event (Wizard permanent-event)
 *
 * Printed text:
 *   "Playable only if your Wizard is not revealed. Your general influence is
 *    increased by 5. Your Wizard may only be brought into play at his home site.
 *    Discard when you bring your Wizard into play. Cannot be duplicated by a
 *    given player."
 *
 * Card shape (data): a non-unique Wizard permanent-event, MP 0 (category misc),
 * whose four clauses map onto DSL effects:
 *   1. play-condition `player-state` `{ "player.avatarInPlay": false }` — the
 *      "not revealed" gate. `player.avatarInPlay` is a new player-state context
 *      field: `true` once the player has brought any avatar (mind === null) into
 *      play, so `false` means the Wizard is still in the deck/hand.
 *   2. stat-modifier `general-influence` +5 — collected while the card sits in
 *      `cardsInPlay`, so the bonus applies exactly while the Wizard is unrevealed.
 *   3. avatar-home-site-restriction — a marker that suppresses the Wizard
 *      avatar's extra-haven reveal option (Rivendell), confining it to its home
 *      site, consulted by the play-character legal action.
 *   4. on-event `avatar-enters-play` → move self → discard — fires when the
 *      controller brings their avatar into play, discarding this card.
 *   5. duplication-limit scope `player` — one copy per player.
 *
 * Fixtures use Saruman (tw-181), a hero Wizard avatar whose home site is
 * Isengard (tw-404), and Rivendell (tw-421), the extra haven a Wizard avatar may
 * normally be revealed at (rule 2.II.2.1.W1). All tests drive the recompute /
 * legal-action / reducer pipeline; the card shape is documented here rather than
 * asserted against the JSON.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, reduce, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  viableActions, viablePlayCharacterActions,
  addCardInPlay, recomputeDerived, effectiveGeneralInfluence,
  findHandCardId, findCharInstanceId,
  ARAGORN, LEGOLAS, SARUMAN, ISENGARD, RIVENDELL, MORIA, LORIEN,
  Alignment,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const SAW_FURTHER = 'dm-156' as CardDefinitionId; // the card under test

describe('Saw Further and Deeper (dm-156)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: "Playable only if your Wizard is not revealed" ──────────────────

  test('playable while the Wizard avatar is not in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [SAW_FURTHER],
          playDeck: [SARUMAN],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    // No avatar in play → the play-condition holds → the card is offered.
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(1);
  });

  test('NOT playable once the Wizard avatar has been revealed (is in play)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          // Saruman (the Wizard avatar) is in a company → revealed.
          companies: [{ site: ISENGARD, characters: [SARUMAN] }],
          hand: [SAW_FURTHER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ─── Rule: "Your general influence is increased by 5" ──────────────────────

  test('while in play, the controller has +5 general influence', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    // Baseline: a Wizard's general-influence pool is the base 20 with no bonus.
    expect(state.players[RESOURCE_PLAYER].generalInfluenceBonus).toBe(0);
    expect(effectiveGeneralInfluence(state, PLAYER_1)).toBe(20);

    state = addCardInPlay(state, RESOURCE_PLAYER, SAW_FURTHER);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].generalInfluenceBonus).toBe(5);
    expect(effectiveGeneralInfluence(state, PLAYER_1)).toBe(25);
  });

  // ─── Rule: "Your Wizard may only be brought into play at his home site" ────

  test('without the card, the Wizard may be revealed at his home site OR Rivendell', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN] },
            { site: ISENGARD, characters: [LEGOLAS] },
          ],
          hand: [SARUMAN],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const sarumanId = findHandCardId(state, RESOURCE_PLAYER, SARUMAN);
    const isengardId = state.players[RESOURCE_PLAYER].companies.find(c => c.currentSite?.definitionId === ISENGARD)!.currentSite!.instanceId;
    const rivendellId = state.players[RESOURCE_PLAYER].companies.find(c => c.currentSite?.definitionId === RIVENDELL)!.currentSite!.instanceId;
    const sites = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === sarumanId)
      .map(a => a.atSite);

    expect(sites).toContain(isengardId);  // home site
    expect(sites).toContain(rivendellId); // extra haven (W1)
  });

  test('with the card in play, the Wizard may be revealed only at his home site (no Rivendell)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN] },
            { site: ISENGARD, characters: [LEGOLAS] },
          ],
          hand: [SARUMAN],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, SAW_FURTHER);
    state = recomputeDerived(state);

    const sarumanId = findHandCardId(state, RESOURCE_PLAYER, SARUMAN);
    const isengardId = state.players[RESOURCE_PLAYER].companies.find(c => c.currentSite?.definitionId === ISENGARD)!.currentSite!.instanceId;
    const rivendellId = state.players[RESOURCE_PLAYER].companies.find(c => c.currentSite?.definitionId === RIVENDELL)!.currentSite!.instanceId;
    const sites = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === sarumanId)
      .map(a => a.atSite);

    expect(sites).toContain(isengardId);      // home site still allowed
    expect(sites).not.toContain(rivendellId); // Rivendell suppressed
  });

  // ─── Rule: "Discard when you bring your Wizard into play" ──────────────────

  test('bringing the Wizard into play discards the card', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: ISENGARD, characters: [ARAGORN] }],
          hand: [SARUMAN],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, SAW_FURTHER);
    state = recomputeDerived(state);
    // Sanity: the card is in play and the +5 applies before the reveal.
    expect(state.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === SAW_FURTHER)).toBe(true);
    expect(state.players[RESOURCE_PLAYER].generalInfluenceBonus).toBe(5);

    const isengardId = state.players[RESOURCE_PLAYER].companies.find(c => c.currentSite?.definitionId === ISENGARD)!.currentSite!.instanceId;
    const result = reduce(state, {
      type: 'play-character',
      player: PLAYER_1,
      characterInstanceId: findHandCardId(state, RESOURCE_PLAYER, SARUMAN),
      atSite: isengardId,
      controlledBy: 'general',
    });

    expect(result.error).toBeUndefined();
    const p1 = result.state.players[RESOURCE_PLAYER];
    // The Wizard is now in play …
    expect(findCharInstanceId(result.state, RESOURCE_PLAYER, SARUMAN)).toBeDefined();
    // … and Saw Further and Deeper has been discarded (no longer boosting GI).
    expect(p1.cardsInPlay.some(c => c.definitionId === SAW_FURTHER)).toBe(false);
    expect(p1.discardPile.some(c => c.definitionId === SAW_FURTHER)).toBe(true);
    expect(p1.generalInfluenceBonus).toBe(0);
  });

  test('bringing a NON-avatar character into play does not discard the card', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [LEGOLAS],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, SAW_FURTHER);
    state = recomputeDerived(state);

    const rivendellId = state.players[RESOURCE_PLAYER].companies.find(c => c.currentSite?.definitionId === RIVENDELL)!.currentSite!.instanceId;
    const result = reduce(state, {
      type: 'play-character',
      player: PLAYER_1,
      characterInstanceId: findHandCardId(state, RESOURCE_PLAYER, LEGOLAS),
      atSite: rivendellId,
      controlledBy: 'general',
    });

    expect(result.error).toBeUndefined();
    // Legolas is not an avatar, so the card stays in play.
    expect(result.state.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === SAW_FURTHER)).toBe(true);
  });

  // ─── Rule: "Cannot be duplicated by a given player" ───────────────────────

  test('a second copy is not playable while the player already has one in play', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [SAW_FURTHER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, SAW_FURTHER);
    state = recomputeDerived(state);

    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });
});
