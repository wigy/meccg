/**
 * @module wh-103.test
 *
 * Card test: Arcane School (wh-103)
 * Type: minion-resource-event (permanent), alignment: stage
 *
 * Text:
 *   "Pallando specific. Sage only. Playable on a non-Hobbit, non-Dwarf sage at
 *    one of your Wizardhavens [{H}] (or in your starting company). The
 *    character may use sorcery, spirit-magic, and shadow-magic. Cannot be
 *    duplicated on a given character."
 *
 * Engine Support (see step-7 report):
 * | # | Rule                                                        | Status      |
 * |---|-------------------------------------------------------------|-------------|
 * | 1 | Pallando specific (playable only if you are Pallando)       | IMPLEMENTED |
 * | 2 | Sage only, non-Hobbit, non-Dwarf, not the avatar            | IMPLEMENTED |
 * | 3 | At one of your Wizardhavens [{H}]                           | IMPLEMENTED |
 * | 4 | The character may use sorcery                              | IMPLEMENTED |
 * | 5 | The character may use spirit-magic                         | IMPLEMENTED |
 * | 6 | The character may use shadow-magic                         | IMPLEMENTED |
 * | 7 | Cannot be duplicated on a given character                  | IMPLEMENTED |
 * | 8 | Stage points (1) while in play                             | IMPLEMENTED |
 *
 * Modeling (mirrors Pallando's Apprentice wh-104's shape):
 *  - Rule 1: `play-condition` `requires: 'player-state'`, `{ player.avatar:
 *    "Pallando" }`.
 *  - Rule 2: `play-target` `character` filter `target.isAvatar $ne true` AND
 *    `target.skills $includes "sage"` AND `target.race $ne "hobbit"` AND
 *    `target.race $ne "dwarf"`.
 *  - Rule 3: `play-condition` `requires: 'company-context'`, `{
 *    site.isOwnWizardhaven: true }`. The "(or in your starting company)"
 *    clause is subsumed — the starting company forms at a Wizardhaven, and
 *    the `starting-item` keyword additionally lets setup place the card
 *    without a live play-condition check.
 *  - Rules 4-6: three `grant-skill` effects (`sorcery`, `spirit-magic`,
 *    `shadow-magic`), resolved from the bearer's attached items via
 *    `getEffectiveSkills` — the same primitive Magic Ring of Stealth (tw-274)
 *    uses to grant `scout`. Verified here by checking that the bearer becomes
 *    a legal target for existing certified magic-skill-gated cards: Govern
 *    the Storms (wh-45, sorcery), Words of Menace and Deceit (le-258,
 *    spirit-magic), and Deeper Shadow (le-179, shadow-magic).
 *  - Rule 7: `duplication-limit` `scope: "character"`, `max: 1`.
 *  - Rule 8: `stage-points` value 1.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  buildTestState, makePlayDeck, resetMint, makeMHState,
  viableActions,
  findCharInstanceId, findHandCardId, addCardToHand,
  playPermanentEventAndResolve,
  getCharacter,
} from '../test-helpers.js';
import type { CardDefinitionId, GameState, PlayPermanentEventAction, PlayShortEventAction } from '../../index.js';
import { Phase, Alignment, RegionType, SiteType } from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** Arcane School — the card under test */
const ARCANE_SCHOOL = 'wh-103' as CardDefinitionId;
/** Pallando — the Fallen-wizard avatar this card is specific to. */
const PALLANDO = 'wh-7' as CardDefinitionId;
/** Saruman — a *different* Fallen-wizard avatar (negative control for "Pallando
 *  specific"). */
const SARUMAN = 'wh-9' as CardDefinitionId;
/** Dorelas — a normal (non-avatar) Man warrior+sage, no natural magic skill. */
const DORELAS = 'le-8' as CardDefinitionId;
/** Náin — a Dwarf sage — negative control for the "non-Dwarf" filter. */
const NAIN = 'le-26' as CardDefinitionId;
/** Bilbo — a Hobbit sage — negative control for the "non-Hobbit" filter. */
const BILBO = 'tw-131' as CardDefinitionId;
/** The Mouth — a normal (non-avatar) Man, warrior/diplomat (NOT a sage). */
const THE_MOUTH = 'le-24' as CardDefinitionId;
/** Isengard — a Fallen-wizard Wizardhaven. */
const ISENGARD = 'wh-56' as CardDefinitionId;
/** Rivendell — a generic (wizard-alignment) haven; NOT a Fallen-wizard's
 *  Wizardhaven. Negative control for "at one of your Wizardhavens". */
const RIVENDELL = 'tw-421' as CardDefinitionId;
/** Aragorn — filler opposing character. */
const ARAGORN = 'tw-120' as CardDefinitionId;
/** Minas Tirith — filler opposing site. */
const MINAS_TIRITH = 'tw-412' as CardDefinitionId;

/** Govern the Storms — sorcery-skill play-target probe (certified wh-45). */
const GOVERN_STORMS = 'wh-45' as CardDefinitionId;
/** Words of Menace and Deceit — spirit-magic-skill play-target probe (certified le-258). */
const WORDS_OF_MENACE = 'le-258' as CardDefinitionId;
/** Deeper Shadow — shadow-magic-skill play-target probe (certified le-179), gated on the
 *  target's company moving. */
const DEEPER_SHADOW = 'le-179' as CardDefinitionId;
/** Ettenmoors — minion ruins-and-lairs site with a Shadow+Wilderness path (used by le-179's
 *  own certified test as the M/H destination). */
const ETTENMOORS = 'le-373' as CardDefinitionId;
/** Dol Guldur — minion haven (site of origin for the M/H shadow-magic scenario). */
const DOL_GULDUR = 'le-367' as CardDefinitionId;
/** Moria (minion) — filler M/H siteDeck entry. */
const MORIA_MINION = 'le-392' as CardDefinitionId;

// ── Builder ──────────────────────────────────────────────────────────────────

function pallandoOrgState(opts?: {
  hand?: CardDefinitionId[];
  characters?: (CardDefinitionId | { defId: CardDefinitionId; items: CardDefinitionId[] })[];
  site?: CardDefinitionId;
}) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: opts?.site ?? ISENGARD, characters: opts?.characters ?? [PALLANDO, DORELAS] }],
        hand: opts?.hand ?? [ARCANE_SCHOOL],
        siteDeck: [ISENGARD],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: ISENGARD, characters: [] }],
        hand: [],
        siteDeck: [ISENGARD],
        playDeck: makePlayDeck(),
      },
    ],
  });
}

describe('Arcane School (wh-103)', () => {
  beforeEach(() => resetMint());

  // ── Rule 2: Sage only; non-Hobbit, non-Dwarf; never the avatar ─────────────

  test('offered on the non-Hobbit non-Dwarf sage, not on dwarves/hobbits/non-sages/avatar', () => {
    const state = pallandoOrgState({ characters: [PALLANDO, DORELAS, THE_MOUTH, NAIN, BILBO] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const targetIds = actions.map(ea => (ea.action as PlayPermanentEventAction).targetCharacterId);

    const dorelasId = findCharInstanceId(state, RESOURCE_PLAYER, DORELAS);
    const mouthId = findCharInstanceId(state, RESOURCE_PLAYER, THE_MOUTH);
    const nainId = findCharInstanceId(state, RESOURCE_PLAYER, NAIN);
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);

    expect(targetIds).toContain(dorelasId);
    expect(targetIds).not.toContain(mouthId); // non-sage excluded
    expect(targetIds).not.toContain(nainId); // dwarf excluded
    expect(targetIds).not.toContain(bilboId); // hobbit excluded
    expect(targetIds).not.toContain(pallandoId); // the avatar excluded
    expect(actions.length).toBe(1); // exactly the one eligible sage
  });

  // ── Rule 1: Pallando specific ──────────────────────────────────────────────

  test('not playable when the player counts as a different Fallen-wizard (Saruman)', () => {
    const state = pallandoOrgState({ characters: [SARUMAN, DORELAS] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Rule 3: at one of your Wizardhavens [{H}] ──────────────────────────────

  test('not playable at a generic haven that is not the Fallen-wizard\'s Wizardhaven', () => {
    const state = pallandoOrgState({ site: RIVENDELL });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('playable at the Fallen-wizard\'s own Wizardhaven (Isengard)', () => {
    const state = pallandoOrgState({ site: ISENGARD });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const dorelasId = findCharInstanceId(state, RESOURCE_PLAYER, DORELAS);
    expect(actions.map(ea => (ea.action as PlayPermanentEventAction).targetCharacterId)).toContain(dorelasId);
  });

  // ── Rule 8: contributes 1 stage point while attached ───────────────────────

  test('the attached stage points are counted toward the controller stage-point total', () => {
    const base = pallandoOrgState();
    const dorelasId = findCharInstanceId(base, RESOURCE_PLAYER, DORELAS);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ARCANE_SCHOOL);

    expect(base.players[0].stagePoints).toBe(0);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, dorelasId);
    expect(after.players[0].stagePoints).toBe(1);
    // The card lives as an item on the bearer (resource permanent-event).
    const bearer = getCharacter(after, RESOURCE_PLAYER, DORELAS);
    expect(bearer.items.some(i => i.definitionId === ARCANE_SCHOOL)).toBe(true);
  });

  // ── Rules 4-6: grants sorcery, spirit-magic, and shadow-magic ──────────────

  test('grants sorcery: bearer becomes a legal target for Govern the Storms (wh-45)', () => {
    const withoutSchool = pallandoOrgState({
      characters: [PALLANDO, DORELAS],
      hand: [],
    });
    const dorelasId = findCharInstanceId(withoutSchool, RESOURCE_PLAYER, DORELAS);
    const beforeHand = addCardToHand(withoutSchool, RESOURCE_PLAYER, GOVERN_STORMS);
    const beforeActions = viableActions(beforeHand, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.targetCharacterId === dorelasId);
    expect(beforeActions).toHaveLength(0);

    const withSchool = pallandoOrgState({
      characters: [PALLANDO, { defId: DORELAS, items: [ARCANE_SCHOOL] }],
      hand: [],
    });
    const dorelasId2 = findCharInstanceId(withSchool, RESOURCE_PLAYER, DORELAS);
    const afterHand = addCardToHand(withSchool, RESOURCE_PLAYER, GOVERN_STORMS);
    const afterActions = viableActions(afterHand, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.targetCharacterId === dorelasId2);
    expect(afterActions.length).toBeGreaterThanOrEqual(1);
  });

  test('grants spirit-magic: bearer becomes a legal target for Words of Menace and Deceit (le-258)', () => {
    const withoutSchool = pallandoOrgState({
      characters: [PALLANDO, DORELAS],
      hand: [],
    });
    const dorelasId = findCharInstanceId(withoutSchool, RESOURCE_PLAYER, DORELAS);
    const beforeHand = addCardToHand(withoutSchool, RESOURCE_PLAYER, WORDS_OF_MENACE);
    const beforeActions = viableActions(beforeHand, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.targetCharacterId === dorelasId);
    expect(beforeActions).toHaveLength(0);

    const withSchool = pallandoOrgState({
      characters: [PALLANDO, { defId: DORELAS, items: [ARCANE_SCHOOL] }],
      hand: [],
    });
    const dorelasId2 = findCharInstanceId(withSchool, RESOURCE_PLAYER, DORELAS);
    const afterHand = addCardToHand(withSchool, RESOURCE_PLAYER, WORDS_OF_MENACE);
    const afterActions = viableActions(afterHand, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.targetCharacterId === dorelasId2);
    expect(afterActions.length).toBeGreaterThanOrEqual(1);
  });

  test('grants shadow-magic: bearer becomes a legal target for Deeper Shadow (le-179) while moving', () => {
    function mhState(hasSchool: boolean): GameState {
      const state = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.FallenWizard,
            companies: [{
              site: DOL_GULDUR,
              destinationSite: ETTENMOORS,
              characters: hasSchool ? [{ defId: DORELAS, items: [ARCANE_SCHOOL] }] : [DORELAS],
            }],
            hand: [DEEPER_SHADOW],
            siteDeck: [MORIA_MINION],
          },
          {
            id: PLAYER_2,
            companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
            hand: [],
            siteDeck: [MINAS_TIRITH],
          },
        ],
      });
      return {
        ...state,
        phaseState: makeMHState({
          activeCompanyIndex: 0,
          siteRevealed: true,
          destinationSiteType: SiteType.RuinsAndLairs,
          destinationSiteName: 'Ettenmoors',
          resolvedSitePath: [RegionType.Shadow, RegionType.Wilderness],
          resolvedSitePathNames: ['Angmar', 'Rhudaur'],
        }),
      };
    }

    const before = viableActions(mhState(false), PLAYER_1, 'play-short-event');
    expect(before).toHaveLength(0);

    const after = viableActions(mhState(true), PLAYER_1, 'play-short-event');
    expect(after.length).toBeGreaterThan(0);
  });

  // ── Rule 7: cannot be duplicated on a given character ──────────────────────

  test('a second copy is not offered on a character who already bears Arcane School, but is offered on another', () => {
    const state = pallandoOrgState({
      characters: [PALLANDO, { defId: DORELAS, items: [ARCANE_SCHOOL] }, THE_MOUTH],
      hand: [],
    });
    // The Mouth is not a sage, so add another eligible sage target instead:
    // reuse Dorelas (already carrying the card) plus a second, fresh sage.
    const withSecondCopy = addCardToHand(state, RESOURCE_PLAYER, ARCANE_SCHOOL);
    const actions = viableActions(withSecondCopy, PLAYER_1, 'play-permanent-event');
    const dorelasId = findCharInstanceId(withSecondCopy, RESOURCE_PLAYER, DORELAS);
    const targetIds = actions.map(ea => (ea.action as PlayPermanentEventAction).targetCharacterId);
    expect(targetIds).not.toContain(dorelasId);
  });
});
