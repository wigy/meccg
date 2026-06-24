/**
 * @module tw-498.test
 *
 * Card test: Swordmaster (tw-498)
 * Type: hero-resource-event (permanent), Light Enchantment
 * Marshalling points: 1 (miscellaneous, scored while in play on the sage)
 *
 * Text:
 *   "Sage only. Playable on an untapped sage at an untapped site where
 *    Information is playable during site phase. Tap the site and the sage. Gives
 *    the sage warrior skill. If the sage is already a warrior, he can use two
 *    weapons (both modifiers count). If he uses two weapons, he can't use a
 *    shield. Cannot be duplicated on a given character."
 *
 * Effects (implementable subset):
 *   1. play-target — site, filter playableResources includes "information"
 *   2. play-target — character, filter sage skill AND untapped
 *   3. play-flag — untapped-site-required
 *   4. play-flag — tap-site-on-play
 *   5. play-flag — tap-character-on-play
 *   6. grant-skill — warrior
 *   7. duplication-limit — scope character, max 1
 *
 * | # | Rule                                                          | Status          |
 * |---|---------------------------------------------------------------|-----------------|
 * | 1 | Sage only / playable on an untapped sage                      | OK              |
 * | 2 | At a site where Information is playable                        | OK              |
 * | 3 | At an untapped site                                            | OK              |
 * | 4 | Tap the site on play                                           | OK              |
 * | 5 | Tap the sage on play                                           | OK              |
 * | 6 | Gives the sage warrior skill                                   | OK (grant-skill)|
 * | 7 | If already a warrior, he can use two weapons (both mods count) | NOT IMPLEMENTED |
 * | 8 | If he uses two weapons, he can't use a shield                  | NOT IMPLEMENTED |
 * | 9 | Cannot be duplicated on a given character                     | OK              |
 *
 * Rules 7 & 8 require engine-wide weapon/shield item-slot enforcement
 * (`item-slots.ts` currently enforces only the helmet slot) plus rule 9.16
 * (the active player's election of which item is "in use"). Until that exists,
 * the "two weapons / no shield" privilege has no baseline to modify — every
 * weapon's modifiers already count for every character — so those clauses
 * cannot be exercised with real assertions. Therefore this card is
 * **NOT CERTIFIED** (PARTIALLY playable).
 *
 * Character selection:
 * - GALADRIEL (tw-153): scout+sage, NOT a warrior — the granted warrior skill
 *   is observable on her (warrior-only cards become legal); also used as the
 *   sage gate.
 * - ARAGORN (tw-120): warrior+scout+ranger, NOT a sage — the sage-gate negative.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  CardStatus,
  resetMint,
  buildSitePhaseState,
  attachItemToChar,
  findCharInstanceId, findHandCardId,
  firstFactionInfluenceAttempt,
  viableActions, dispatch, resolveChain,
  GALADRIEL, ARAGORN,
  PELARGIR, MEN_OF_LEBENNIN,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { getItemGrantedSkills } from '../../engine/effects/index.js';
import type { CardDefinitionId, PlayPermanentEventAction } from '../../index.js';

const SWORDMASTER = 'tw-498' as CardDefinitionId;
const MUSTER = 'tw-288' as CardDefinitionId;       // warrior-only short event (probe)
const AMON_HEN = 'tw-371' as CardDefinitionId;     // ruins-and-lairs, Information playable
const TOLFALAS = 'tw-433' as CardDefinitionId;     // ruins-and-lairs, NO Information

describe('Swordmaster (tw-498)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1 (sage only) + Rule 2 (Information site) ───────────────────────

  test('offered on an untapped sage at a site where Information is playable', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL], // scout+sage
      site: AMON_HEN,
      hand: [SWORDMASTER],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBeGreaterThan(0);
  });

  test('NOT offered on a non-sage character', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN], // warrior/scout/ranger — no sage skill
      site: AMON_HEN,
      hand: [SWORDMASTER],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT offered at a site where Information is not playable', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: TOLFALAS,
      hand: [SWORDMASTER],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 1 (untapped sage) + Rule 3 (untapped site) ──────────────────────

  test('NOT offered when the sage is already tapped', () => {
    const state = buildSitePhaseState({
      characters: [{ defId: GALADRIEL, status: CardStatus.Tapped }],
      site: AMON_HEN,
      hand: [SWORDMASTER],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT offered at an already-tapped site', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: AMON_HEN,
      hand: [SWORDMASTER],
      siteStatus: CardStatus.Tapped,
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rules 4 + 5: tap site and sage on play, attach to the sage ───────────

  test('playing it taps the sage and the site, and attaches to the sage', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: AMON_HEN,
      hand: [SWORDMASTER],
    });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action;
    const after = resolveChain(dispatch(state, action));

    const galadrielId = findCharInstanceId(after, RESOURCE_PLAYER, GALADRIEL);
    const galadriel = after.players[RESOURCE_PLAYER].characters[galadrielId as string];
    expect(galadriel.status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
    // Resource permanent-event attaches to the sage's items slot.
    expect(galadriel.items.some(i => i.definitionId === SWORDMASTER)).toBe(true);
  });

  // ── Rule 6: gives the sage warrior skill ─────────────────────────────────

  test('the granted warrior skill is collected from the attached enchantment', () => {
    // Galadriel is scout+sage; without Swordmaster she has no warrior skill.
    const base = buildSitePhaseState({ characters: [GALADRIEL], site: AMON_HEN });
    const galadrielId = findCharInstanceId(base, RESOURCE_PLAYER, GALADRIEL);
    expect(getItemGrantedSkills(base, base.players[RESOURCE_PLAYER].characters[galadrielId as string]))
      .not.toContain('warrior');

    const withSword = attachItemToChar(base, RESOURCE_PLAYER, GALADRIEL, SWORDMASTER);
    expect(getItemGrantedSkills(withSword, withSword.players[RESOURCE_PLAYER].characters[galadrielId as string]))
      .toContain('warrior');
  });

  test('the warrior skill makes a warrior-only card (Muster) legal on the sage', () => {
    // Behavioral probe: Muster (tw-288) is "Warrior only" — its play-target
    // character filter requires the warrior skill. A non-warrior sage bearing
    // Swordmaster counts as a warrior, so Muster becomes playable on her.
    const base = buildSitePhaseState({
      characters: [{ defId: GALADRIEL, items: [SWORDMASTER] }],
      site: PELARGIR,
      hand: [MUSTER, MEN_OF_LEBENNIN],
    });
    // Open the influence-check window so Muster (an influence booster) is offered.
    const factionId = findHandCardId(base, RESOURCE_PLAYER, MEN_OF_LEBENNIN);
    const attempt = firstFactionInfluenceAttempt(base, factionId)!;
    const afterAttempt = dispatch(base, attempt);
    const pass = computeLegalActions(afterAttempt, PLAYER_2)
      .find(ea => ea.viable && ea.action.type === 'pass-chain-priority')!;
    const chainState = dispatch(afterAttempt, pass.action);

    const musterOffered = computeLegalActions(chainState, PLAYER_1).some(
      ea => ea.viable && ea.action.type === 'play-short-event' && ea.action.optionId === 'influence-boost',
    );
    expect(musterOffered).toBe(true);
  });

  test('without Swordmaster, the same non-warrior sage cannot use the warrior-only card', () => {
    const base = buildSitePhaseState({
      characters: [GALADRIEL], // no enchantment → not a warrior
      site: PELARGIR,
      hand: [MUSTER, MEN_OF_LEBENNIN],
    });
    const factionId = findHandCardId(base, RESOURCE_PLAYER, MEN_OF_LEBENNIN);
    const attempt = firstFactionInfluenceAttempt(base, factionId)!;
    const afterAttempt = dispatch(base, attempt);
    const pass = computeLegalActions(afterAttempt, PLAYER_2)
      .find(ea => ea.viable && ea.action.type === 'pass-chain-priority')!;
    const chainState = dispatch(afterAttempt, pass.action);

    const musterOffered = computeLegalActions(chainState, PLAYER_1).some(
      ea => ea.viable && ea.action.type === 'play-short-event' && ea.action.optionId === 'influence-boost',
    );
    expect(musterOffered).toBe(false);
  });

  // ── Rule 9: cannot be duplicated on a given character ────────────────────

  test('not offered on a sage who already bears a Swordmaster', () => {
    const state = buildSitePhaseState({
      characters: [{ defId: GALADRIEL, items: [SWORDMASTER] }], // already enchanted
      site: AMON_HEN,
      hand: [SWORDMASTER],
    });
    const galadrielId = findCharInstanceId(state, RESOURCE_PLAYER, GALADRIEL);
    const targeted = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .filter(a => a.targetCharacterId === galadrielId);
    expect(targeted).toHaveLength(0);
  });

  test('control: a sage with no Swordmaster yet IS offered one', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: AMON_HEN,
      hand: [SWORDMASTER],
    });
    const galadrielId = findCharInstanceId(state, RESOURCE_PLAYER, GALADRIEL);
    const targeted = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .filter(a => a.targetCharacterId === galadrielId);
    expect(targeted.length).toBeGreaterThan(0);
  });
});
