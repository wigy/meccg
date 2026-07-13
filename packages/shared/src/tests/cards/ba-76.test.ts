/**
 * @module ba-76.test
 *
 * Card test: Strangling Coils (ba-76)
 * Type: minion-resource-event (permanent), keyword "Demon fána"
 * Alignment: Balrog specific
 *
 * Text:
 *   "Balrog specific. Demon fána. Playable during your organization phase on
 *    The Balrog. Return this card to your hand: when you play another Demon
 *    fána card, or, if you choose, during your organization phase. +3 direct
 *    influence; -1 body. The Balrog gains the diplomat skill and may have
 *    followers. Once during his movement/hazard phase, you may untap all
 *    tapped characters in The Balrog's company. If then untapped, tap The
 *    Balrog."
 *
 * Engine support:
 * | # | Rule                                                          | Status      |
 * |---|---------------------------------------------------------------|-------------|
 * | 1 | Playable only on The Balrog, during organization phase        | IMPLEMENTED |
 * | 2 | On-play: bounce another Demon fána card on the Balrog to hand | IMPLEMENTED |
 * | 3 | Return-to-hand grant-action, free, during organization phase  | IMPLEMENTED |
 * | 4 | +3 direct influence                                           | IMPLEMENTED |
 * | 5 | -1 body                                                       | IMPLEMENTED |
 * | 6 | The Balrog gains diplomat skill                                | IMPLEMENTED |
 * | 7 | The Balrog may have followers (overrides ba-3's restriction)  | IMPLEMENTED |
 * | 8 | Once during M/H phase: untap the whole company, then tap the  | IMPLEMENTED |
 * |   | Balrog (the new `set-character-status target:"company"` apply |             |
 * |   | + `oncePerTurn` grant-action lock + `phase` gate)             |             |
 *
 * Fixture alignment: Balrog-specific minion card, so tests use Balrog-alignment
 * fixtures (The Balrog ba-3, Crook-legged Orc ba-6, ba-84 dark-hold site).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  Phase, CardStatus, Alignment,
  buildTestState, resetMint, recomputeDerived,
  viableActions,
  findCharInstanceId, findHandCardId, getCharacter,
  attachItemToChar, playPermanentEventAndResolve,
  grantedActionsFor, viablePlayCharacterActions, dispatch,
  makeMHState, expectCharStatus,
} from '../test-helpers.js';
import { getItemGrantedSkills } from '../../engine/effects/index.js';
import type { CardDefinitionId } from '../../index.js';

// ── Local card-ID constants ───────────────────────────────────────────────────

/** Strangling Coils — the card under test */
const STRANGLING_COILS = 'ba-76' as CardDefinitionId;
/** The Balrog — Balrog avatar, mind null, base DI 6 / body 11 */
const THE_BALROG = 'ba-3' as CardDefinitionId;
/** Crook-legged Orc — Balrog-specific, non-unique, mind 2, no Leader keyword */
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;
/** Barad-dûr (BA) — dark-hold, surface (non-under-deeps) */
const BARAD_DUR_BA = 'ba-84' as CardDefinitionId;
/** The Under-gates (BA) — haven; Crook-legged Orc's homesite region */
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId;

// ── State builders ────────────────────────────────────────────────────────────

function orgState(opts: {
  companyChars?: CardDefinitionId[];
  hand?: CardDefinitionId[];
  site?: CardDefinitionId;
} = {}) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Balrog,
        companies: [{ site: opts.site ?? BARAD_DUR_BA, characters: opts.companyChars ?? [THE_BALROG] }],
        hand: opts.hand ?? [STRANGLING_COILS],
        siteDeck: [],
      },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
    ],
  });
}

/**
 * Build a Movement/Hazard play-hazards state with The Balrog (carrying
 * Strangling Coils) and a Crook-legged Orc companion, each with the requested
 * status. P1 is the active resource player.
 */
function mhState(opts: { balrogTapped?: boolean; orcTapped?: boolean } = {}) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Balrog,
        companies: [{
          site: BARAD_DUR_BA,
          characters: [
            { defId: THE_BALROG, status: opts.balrogTapped ? CardStatus.Tapped : CardStatus.Untapped, items: [STRANGLING_COILS] },
            { defId: CROOK_LEGGED_ORC, status: opts.orcTapped ? CardStatus.Tapped : CardStatus.Untapped },
          ],
        }],
        hand: [],
        siteDeck: [],
      },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
    ],
  });
  return { ...state, phaseState: makeMHState() };
}

describe('Strangling Coils (ba-76)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Playable only on The Balrog ──────────────────────────────────

  test('playable on The Balrog', () => {
    const state = orgState();
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const target = (actions[0].action as { targetCharacterId?: unknown }).targetCharacterId;
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    expect(target).toBe(balrogId);
  });

  test('NOT playable on a non-Balrog character', () => {
    const state = orgState({ companyChars: [CROOK_LEGGED_ORC] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Rule 2: On-play bounce of another Demon fána card ────────────────────

  test('entering play does not bounce anything when the Balrog has no other Demon fána card', () => {
    const base = orgState();
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, STRANGLING_COILS);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, balrogId);
    expect(getCharacter(after, RESOURCE_PLAYER, THE_BALROG).items).toHaveLength(1);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
  });

  test('bounces an existing Demon fána card on the Balrog when a new one is played', () => {
    const base = orgState({ hand: [STRANGLING_COILS, STRANGLING_COILS] });
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const withFirstAttached = attachItemToChar(base, RESOURCE_PLAYER, THE_BALROG, STRANGLING_COILS);
    expect(getCharacter(withFirstAttached, RESOURCE_PLAYER, THE_BALROG).items).toHaveLength(1);
    const secondCardId = findHandCardId(withFirstAttached, RESOURCE_PLAYER, STRANGLING_COILS);
    const after = playPermanentEventAndResolve(withFirstAttached, PLAYER_1, secondCardId, balrogId);
    // First copy bounced, leaving only the newly played copy attached
    expect(getCharacter(after, RESOURCE_PLAYER, THE_BALROG).items).toHaveLength(1);
    expect(after.players[RESOURCE_PLAYER].hand.map(c => c.definitionId as string))
      .toContain(STRANGLING_COILS as string);
  });

  // ── Rule 3: Return-to-hand grant-action ──────────────────────────────────

  test('return-self-to-hand grant-action is available during organization phase', () => {
    const base = orgState();
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, STRANGLING_COILS);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, cardId, balrogId);
    expect(grantedActionsFor(attached, balrogId, 'return-self-to-hand', PLAYER_1)).toHaveLength(1);
  });

  test('return-self-to-hand moves the card from Balrog items back to hand', () => {
    const base = orgState();
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, STRANGLING_COILS);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, cardId, balrogId);
    const returnActions = grantedActionsFor(attached, balrogId, 'return-self-to-hand', PLAYER_1);
    const after = dispatch(attached, returnActions[0]);
    expect(getCharacter(after, RESOURCE_PLAYER, THE_BALROG).items).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(1);
    expect(after.players[RESOURCE_PLAYER].hand[0].definitionId).toBe(STRANGLING_COILS);
  });

  // ── Rule 4 & 5: +3 direct influence; -1 body ─────────────────────────────

  test('+3 direct influence and -1 body applied to the Balrog while attached', () => {
    const base = orgState();
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, STRANGLING_COILS);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, balrogId);
    const basePool = base.cardPool[THE_BALROG] as { directInfluence: number; body: number };
    const balrog = getCharacter(after, RESOURCE_PLAYER, THE_BALROG);
    expect(balrog.effectiveStats.directInfluence).toBe(basePool.directInfluence + 3);
    expect(balrog.effectiveStats.body).toBe(basePool.body - 1);
  });

  test('the stat bonuses revert when the card leaves play', () => {
    const base = orgState();
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, STRANGLING_COILS);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, cardId, balrogId);
    const basePool = base.cardPool[THE_BALROG] as { directInfluence: number; body: number };
    const returnActions = grantedActionsFor(attached, balrogId, 'return-self-to-hand', PLAYER_1);
    const after = dispatch(attached, returnActions[0]);
    const balrog = getCharacter(after, RESOURCE_PLAYER, THE_BALROG);
    expect(balrog.effectiveStats.directInfluence).toBe(basePool.directInfluence);
    expect(balrog.effectiveStats.body).toBe(basePool.body);
  });

  // ── Rule 6: Grants diplomat skill ────────────────────────────────────────

  test('grants the Balrog diplomat skill while attached', () => {
    const base = orgState();
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    expect(getItemGrantedSkills(base, base.players[RESOURCE_PLAYER].characters[balrogId]))
      .not.toContain('diplomat');

    const withFana = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, THE_BALROG, STRANGLING_COILS));
    expect(getItemGrantedSkills(withFana, withFana.players[RESOURCE_PLAYER].characters[balrogId]))
      .toContain('diplomat');
  });

  // ── Rule 7: May have followers ───────────────────────────────────────────

  describe('may have followers', () => {
    test('negative control: without Strangling Coils, the Balrog is never offered as a DI controller', () => {
      const state = orgState({ hand: [CROOK_LEGGED_ORC], site: THE_UNDER_GATES_BA });
      const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
      const actions = viablePlayCharacterActions(state, PLAYER_1);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.some(a => a.controlledBy === balrogId)).toBe(false);
    });

    test('with Strangling Coils attached, the Balrog IS offered as a DI controller', () => {
      const base = orgState({ hand: [CROOK_LEGGED_ORC], site: THE_UNDER_GATES_BA });
      const withFana = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, THE_BALROG, STRANGLING_COILS));
      const balrogId = findCharInstanceId(withFana, RESOURCE_PLAYER, THE_BALROG);
      const actions = viablePlayCharacterActions(withFana, PLAYER_1);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.some(a => a.controlledBy === balrogId)).toBe(true);
    });
  });

  // ── Rule 8: Once during M/H phase, untap the company then tap the Balrog ──

  describe('untap-balrog-company (M/H phase)', () => {
    test('offered during the movement/hazard phase', () => {
      const state = mhState({ orcTapped: true });
      const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
      expect(grantedActionsFor(state, balrogId, 'untap-balrog-company', PLAYER_1)).toHaveLength(1);
    });

    test('NOT offered during the organization phase', () => {
      const base = orgState();
      const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
      const withFana = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, THE_BALROG, STRANGLING_COILS));
      expect(grantedActionsFor(withFana, balrogId, 'untap-balrog-company', PLAYER_1)).toHaveLength(0);
    });

    test('untaps every company member and taps the Balrog', () => {
      const state = mhState({ orcTapped: true });
      const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
      const [action] = grantedActionsFor(state, balrogId, 'untap-balrog-company', PLAYER_1);
      const after = dispatch(state, action);
      // The Orc (was tapped) is now untapped; The Balrog is tapped.
      expectCharStatus(after, RESOURCE_PLAYER, CROOK_LEGGED_ORC, CardStatus.Untapped);
      expectCharStatus(after, RESOURCE_PLAYER, THE_BALROG, CardStatus.Tapped);
    });

    test('works even when The Balrog starts tapped (no tap cost to activate)', () => {
      const state = mhState({ balrogTapped: true, orcTapped: true });
      const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
      const actions = grantedActionsFor(state, balrogId, 'untap-balrog-company', PLAYER_1);
      expect(actions).toHaveLength(1);
      const after = dispatch(state, actions[0]);
      expectCharStatus(after, RESOURCE_PLAYER, CROOK_LEGGED_ORC, CardStatus.Untapped);
      // "If then untapped, tap The Balrog" — the untap catches him, then he re-taps.
      expectCharStatus(after, RESOURCE_PLAYER, THE_BALROG, CardStatus.Tapped);
    });

    test('may only be used once per turn', () => {
      const state = mhState({ orcTapped: true });
      const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
      const [first] = grantedActionsFor(state, balrogId, 'untap-balrog-company', PLAYER_1);
      const after = dispatch(state, first);
      // The turn-scoped lock suppresses any further activation this turn.
      expect(grantedActionsFor(after, balrogId, 'untap-balrog-company', PLAYER_1)).toHaveLength(0);
    });
  });
});
