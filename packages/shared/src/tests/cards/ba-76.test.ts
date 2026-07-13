/**
 * @module ba-76.test
 *
 * Card test: Strangling Coils (ba-76)
 * Type: minion-resource-event (permanent), keywords "balrog-specific", "demon-fana"
 * Alignment: Balrog specific
 *
 * Text:
 *   "Balrog specific. Demon fána. Playable during your organization phase on
 *    The Balrog. Return this card to your hand: when you play another Demon
 *    fána card, or, if you choose, during your organization phase. +3 direct
 *    influence; -1 body. The Balrog gains the diplomat skill and may have
 *    followers. Once during his movement/hazard phase, you may untap all tapped
 *    characters in The Balrog's company. If then untapped, tap The Balrog."
 *
 * Engine support:
 * | # | Rule                                                          | Status      |
 * |---|----------------------------------------------------------------|-------------|
 * | 1 | Playable only on The Balrog, during organization phase         | IMPLEMENTED |
 * | 2 | On-play: bounce another Demon fána card on the Balrog to hand  | IMPLEMENTED |
 * | 3 | Return-to-hand grant-action, free, during organization phase   | IMPLEMENTED |
 * | 4 | +3 direct influence                                            | IMPLEMENTED |
 * | 5 | -1 body                                                        | IMPLEMENTED |
 * | 6 | The Balrog gains the diplomat skill                            | IMPLEMENTED |
 * | 7 | The Balrog may have followers (overrides ba-3 restriction)    | IMPLEMENTED |
 * | 8 | Once/turn in M/H: untap all tapped chars in company, then tap  | IMPLEMENTED |
 * |   | The Balrog if he is then untapped                             |             |
 *
 * The untap ability (rule 8) is modeled as an `mhPhaseOnly` + `oncePerTurn`
 * grant-action whose `untap-company-tap-bearer` apply untaps every Tapped
 * character in the bearer's company (wounded characters untouched) and re-taps
 * the bearer if he is left untapped.
 *
 * Fixture alignment: Balrog-specific minion card, so tests use Balrog-alignment
 * fixtures (The Balrog ba-3, Crook-legged Orc ba-6, ba-84 dark-hold site,
 * ba-100 under-deeps haven).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  Phase, CardStatus, Alignment,
  buildTestState, resetMint, recomputeDerived,
  viableActions, dispatch,
  findCharInstanceId, findHandCardId, getCharacter,
  attachItemToChar, playPermanentEventAndResolve,
  grantedActionsFor, viablePlayCharacterActions,
  expectCharStatus, makeMHState,
} from '../test-helpers.js';
import { getItemGrantedSkills } from '../../engine/effects/index.js';
import type { CardDefinitionId } from '../../index.js';

// ── Local card-ID constants ───────────────────────────────────────────────────

/** Strangling Coils — the card under test */
const STRANGLING_COILS = 'ba-76' as CardDefinitionId;
/** Another Demon fána card, used to test the on-play bounce */
const GREAT_SHADOW = 'ba-62' as CardDefinitionId;
/** The Balrog — Balrog avatar, mind null, prowess 8, body 11, DI 6 */
const THE_BALROG = 'ba-3' as CardDefinitionId;
/** Crook-legged Orc — Balrog-specific, non-unique, mind 2, no Leader keyword */
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;
/** Barad-dûr (BA) — dark-hold, surface (non-under-deeps) */
const BARAD_DUR_BA = 'ba-84' as CardDefinitionId;
/** The Under-gates (BA) — haven, under-deeps; Crook-legged Orc's homesite region */
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId;

// ── State builders ────────────────────────────────────────────────────────────

function orgState(opts: {
  companyChars?: CardDefinitionId[];
  hand?: CardDefinitionId[];
  site?: CardDefinitionId;
}) {
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

describe('Strangling Coils (ba-76)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Playable only on The Balrog ──────────────────────────────────

  test('playable on The Balrog', () => {
    const state = orgState({});
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
    const base = orgState({});
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, STRANGLING_COILS);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, balrogId);
    expect(getCharacter(after, RESOURCE_PLAYER, THE_BALROG).items).toHaveLength(1);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
  });

  test('bounces an existing Demon fána card on the Balrog back to hand when this is played', () => {
    const base = orgState({ hand: [STRANGLING_COILS] });
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    // Attach a different Demon fána card (Great Shadow) to simulate a pre-existing one
    const withFirstAttached = attachItemToChar(base, RESOURCE_PLAYER, THE_BALROG, GREAT_SHADOW);
    expect(getCharacter(withFirstAttached, RESOURCE_PLAYER, THE_BALROG).items).toHaveLength(1);
    const cardId = findHandCardId(withFirstAttached, RESOURCE_PLAYER, STRANGLING_COILS);
    const after = playPermanentEventAndResolve(withFirstAttached, PLAYER_1, cardId, balrogId);
    // The Great Shadow copy is bounced, leaving only the newly played Strangling Coils
    const items = getCharacter(after, RESOURCE_PLAYER, THE_BALROG).items;
    expect(items).toHaveLength(1);
    expect(items[0].definitionId).toBe(STRANGLING_COILS);
    const handDefIds = after.players[RESOURCE_PLAYER].hand.map(c => c.definitionId as string);
    expect(handDefIds).toContain(GREAT_SHADOW as string);
  });

  // ── Rule 3: Return-to-hand grant-action ──────────────────────────────────

  test('return-self-to-hand grant-action is available during organization phase', () => {
    const base = orgState({});
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, STRANGLING_COILS);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, cardId, balrogId);
    const returnActions = grantedActionsFor(attached, balrogId, 'return-self-to-hand', PLAYER_1);
    expect(returnActions.length).toBe(1);
  });

  test('return-self-to-hand moves the card from Balrog items back to hand', () => {
    const base = orgState({});
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, STRANGLING_COILS);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, cardId, balrogId);
    expect(getCharacter(attached, RESOURCE_PLAYER, THE_BALROG).items).toHaveLength(1);
    const returnActions = grantedActionsFor(attached, balrogId, 'return-self-to-hand', PLAYER_1);
    const after = dispatch(attached, returnActions[0]);
    expect(getCharacter(after, RESOURCE_PLAYER, THE_BALROG).items).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(1);
    expect(after.players[RESOURCE_PLAYER].hand[0].definitionId).toBe(STRANGLING_COILS);
  });

  // ── Rule 4 & 5: +3 direct influence; -1 body ─────────────────────────────

  test('+3 direct influence and -1 body applied to the Balrog while attached', () => {
    const base = orgState({});
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, STRANGLING_COILS);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, balrogId);
    const basePool = base.cardPool[THE_BALROG] as { directInfluence: number; body: number };
    const balrog = getCharacter(after, RESOURCE_PLAYER, THE_BALROG);
    expect(balrog.effectiveStats.directInfluence).toBe(basePool.directInfluence + 3);
    expect(balrog.effectiveStats.body).toBe(basePool.body - 1);
  });

  // ── Rule 6: Grants diplomat skill ────────────────────────────────────────

  test('grants the Balrog the diplomat skill while attached', () => {
    const base = orgState({});
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    expect(getItemGrantedSkills(base, base.players[RESOURCE_PLAYER].characters[balrogId]))
      .not.toContain('diplomat');

    const withFana = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, THE_BALROG, STRANGLING_COILS));
    expect(getItemGrantedSkills(withFana, withFana.players[RESOURCE_PLAYER].characters[balrogId]))
      .toContain('diplomat');
  });

  // ── Rule 7: May have followers ────────────────────────────────────────────

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

  // ── Rule 8: Once/turn M/H untap of the company, then tap The Balrog ───────

  describe('untap-company-tap-bearer (once per M/H phase)', () => {
    /**
     * M/H play-hazards state: The Balrog (optionally tapped) shares a company
     * with a tapped Crook-legged Orc; Strangling Coils is attached to the Balrog.
     */
    function mhState(opts: { balrogTapped?: boolean } = {}) {
      const built = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Balrog,
            companies: [{
              site: BARAD_DUR_BA,
              characters: [
                { defId: THE_BALROG, status: opts.balrogTapped ? CardStatus.Tapped : CardStatus.Untapped, items: [STRANGLING_COILS] },
                { defId: CROOK_LEGGED_ORC, status: CardStatus.Tapped },
              ],
            }],
            hand: [],
            siteDeck: [],
          },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
        ],
      });
      return recomputeDerived({ ...built, phaseState: makeMHState() });
    }

    test('the untap ability is offered during the M/H phase', () => {
      const state = mhState();
      const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
      const actions = grantedActionsFor(state, balrogId, 'untap-company-tap-bearer', PLAYER_1);
      expect(actions.length).toBe(1);
    });

    test('the untap ability is NOT offered during the organization phase', () => {
      const base = orgState({});
      const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
      const withFana = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, THE_BALROG, STRANGLING_COILS));
      const actions = grantedActionsFor(withFana, balrogId, 'untap-company-tap-bearer', PLAYER_1);
      expect(actions.length).toBe(0);
    });

    test('activating untaps all tapped companions and taps The Balrog', () => {
      const state = mhState();
      const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
      const actions = grantedActionsFor(state, balrogId, 'untap-company-tap-bearer', PLAYER_1);
      const after = dispatch(state, actions[0]);
      // Companion untapped, Balrog tapped
      expectCharStatus(after, RESOURCE_PLAYER, CROOK_LEGGED_ORC, CardStatus.Untapped);
      expectCharStatus(after, RESOURCE_PLAYER, THE_BALROG, CardStatus.Tapped);
    });

    test('a tapped Balrog is untapped with the company, then re-tapped', () => {
      const state = mhState({ balrogTapped: true });
      const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
      const actions = grantedActionsFor(state, balrogId, 'untap-company-tap-bearer', PLAYER_1);
      const after = dispatch(state, actions[0]);
      expectCharStatus(after, RESOURCE_PLAYER, CROOK_LEGGED_ORC, CardStatus.Untapped);
      expectCharStatus(after, RESOURCE_PLAYER, THE_BALROG, CardStatus.Tapped);
    });

    test('the untap ability is once per turn — not offered again after use', () => {
      const state = mhState();
      const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
      const first = grantedActionsFor(state, balrogId, 'untap-company-tap-bearer', PLAYER_1);
      expect(first.length).toBe(1);
      const after = dispatch(state, first[0]);
      const second = grantedActionsFor(after, balrogId, 'untap-company-tap-bearer', PLAYER_1);
      expect(second.length).toBe(0);
    });
  });
});
