/**
 * @module as-142.test
 *
 * Card test: The Worthy Hills (as-142)
 * Type: hero-site (ruins-and-lairs) in Cardolan
 * Effects:
 *   1 — combat-detainment (automatic attack is always detainment)
 *   2 — grant-action "untap-site" with cost sage-and-scout-in-company:
 *         during the site phase, tap one sage and one scout in the company
 *         to untap this site.
 *
 * Text:
 *   Nearest Haven: Rivendell
 *   Playable: Information
 *   Automatic-attacks: Men — each character faces 1 strike with 9 prowess (detainment).
 *   Special: During the site phase, you may tap two characters to untap this site—
 *            one a sage, one a scout.
 *
 * Note: The "each character faces 1 strike" mechanic (rule 8.07) is encoded as
 * strikes: 1 + combatRules ["each-character"]; the engine pre-assigns one strike
 * per character so strikesTotal equals the company size. This site's detainment
 * is unconditional (a plain combat-detainment effect, not gated on covert).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                          |
 * |---|-------------------|--------|----------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                      |
 * | 2 | sitePath          | OK     | [wilderness, wilderness]                                       |
 * | 3 | nearestHaven      | OK     | "Rivendell" — valid hero haven (tw-392)                        |
 * | 4 | region            | OK     | "Cardolan"                                                     |
 * | 5 | playableResources | OK     | [information] — matches text; engine gates non-info items      |
 * | 6 | automaticAttacks  | OK     | Men, prowess 9, each-character (strikes=1)                     |
 * | 7 | effects           | OK     | combat-detainment + grant-action untap-site                    |
 * | 8 | resourceDraws     | OK     | 1                                                              |
 * | 9 | hazardDraws       | OK     | 2                                                              |
 *
 * Engine Support:
 * | # | Feature                                    | Status      | Notes                                          |
 * |---|-------------------------------------------|-------------|------------------------------------------------|
 * | 1 | Site phase flow                           | IMPLEMENTED | select-company, enter-or-skip, play-resources  |
 * | 2 | Automatic attack trigger                  | IMPLEMENTED | combat initiated via automatic-attacks step    |
 * | 3 | Detainment (combat-detainment effect)     | IMPLEMENTED | isDetainmentAttack() reads siteDef.effects     |
 * | 4 | Each-char-faces-1-strike (rule 8.07)      | IMPLEMENTED | strikes=1 + combatRules ["each-character"]     |
 * | 5 | Information playability gate              | IMPLEMENTED | playableResources gates non-information items  |
 * | 6 | Grant-action: tap sage+scout to untap site| IMPLEMENTED | sitePhaseGrantActions + untap-site apply       |
 * | 7 | Haven path movement                       | IMPLEMENTED | movement-map.ts resolves Rivendell ↔ Cardolan  |
 *
 * Playable: YES
 * Certified: 2026-05-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN,
  ELROND,
  BILBO,
  RIVENDELL,
  resetMint,
  pool,
  buildSitePhaseState,
  setupAutoAttackStep,
  viableActions,
  dispatch,
  charIdAt,
  RESOURCE_PLAYER,
  DAGGER_OF_WESTERNESSE,
} from '../test-helpers.js';
import {
  isSiteCard,
  buildMovementMap,
  getReachableSites,
  CardStatus,
} from '../../index.js';
import type { CardDefinitionId, CardInstanceId, SiteCard } from '../../index.js';

const THE_WORTHY_HILLS = 'as-142' as CardDefinitionId;
// Elrond (tw-145): warrior, sage, diplomat — sage but NOT scout
const ELROND_DEF = ELROND;
// Aragorn (tw-120): warrior, scout, ranger — scout but NOT sage
const ARAGORN_DEF = ARAGORN;
// Bilbo (tw-131): scout, sage — both; use to verify single-char cannot fill both roles
const BILBO_DEF = BILBO;

describe('The Worthy Hills (as-142)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack: Men, each character faces 1 strike (detainment) ───────

  test('automatic attack initiates combat against Men with 9 prowess', () => {
    const state = buildSitePhaseState({
      site: THE_WORTHY_HILLS,
      characters: [ARAGORN_DEF],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikeProwess).toBe(9);
    expect(next.combat!.creatureRace).toBe('man');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  test('automatic attack is always detainment', () => {
    const state = buildSitePhaseState({
      site: THE_WORTHY_HILLS,
      characters: [ARAGORN_DEF],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.detainment).toBe(true);
  });

  test('each-character: one strike per character (strikesTotal = company size)', () => {
    // Regression for the each-character encoding (strikes: 1 + combatRules
    // ["each-character"]). The earlier authoring used the sentinel strikes: -1,
    // which opened combat with strikesTotal: -1 and stalled assignment.
    const state = buildSitePhaseState({
      site: THE_WORTHY_HILLS,
      characters: [ELROND_DEF, ARAGORN_DEF, BILBO_DEF],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.eachCharacterFacesOneStrike).toBe(true);
    expect(next.combat!.phase).not.toBe('assign-strikes');
    expect(next.combat!.assignmentPhase).toBe('done');
  });

  // ─── Playable: Information — non-information items are not offered ────────────

  test('minor hero item is NOT offered as a viable play at The Worthy Hills', () => {
    const state = buildSitePhaseState({
      site: THE_WORTHY_HILLS,
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBe(0);
  });

  // ─── Grant-action: tap sage + scout to untap site ─────────────────────────────

  test('untap-site action is offered when site is tapped and company has sage and scout', () => {
    const state = buildSitePhaseState({
      site: THE_WORTHY_HILLS,
      characters: [ELROND_DEF, ARAGORN_DEF],
      siteStatus: CardStatus.Tapped,
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(a => {
      const act = a.action as { actionId?: string };
      return act.actionId === 'untap-site';
    });
    expect(untapActions.length).toBeGreaterThan(0);
  });

  test('untap-site: dispatching the action untaps the site and taps sage and scout', () => {
    const state = buildSitePhaseState({
      site: THE_WORTHY_HILLS,
      characters: [ELROND_DEF, ARAGORN_DEF],
      siteStatus: CardStatus.Tapped,
    });

    const elrondId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 1);

    // Site starts tapped
    expect(state.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);

    // Find the sage (Elrond) and scout (Aragorn) IDs in the action
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapActs = actions.filter(a => (a.action as { actionId?: string }).actionId === 'untap-site');
    expect(untapActs.length).toBeGreaterThan(0);

    const act = untapActs[0].action as {
      type: string;
      player: string;
      characterId: CardInstanceId;
      secondCharacterId?: CardInstanceId;
      sourceCardId: CardInstanceId;
      sourceCardDefinitionId: CardDefinitionId;
      actionId: string;
      rollThreshold: number;
    };

    const next = dispatch(state, {
      type: 'activate-granted-action',
      player: PLAYER_1,
      characterId: act.characterId,
      secondCharacterId: act.secondCharacterId,
      sourceCardId: act.sourceCardId,
      sourceCardDefinitionId: act.sourceCardDefinitionId,
      actionId: 'untap-site',
      rollThreshold: 0,
    });

    // Site is now untapped
    expect(next.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Untapped);

    // Both sage and scout are tapped
    const elrondAfter = next.players[RESOURCE_PLAYER].characters[elrondId];
    const aragornAfter = next.players[RESOURCE_PLAYER].characters[aragornId];
    expect(elrondAfter.status).toBe(CardStatus.Tapped);
    expect(aragornAfter.status).toBe(CardStatus.Tapped);
  });

  test('untap-site action is NOT offered when site is untapped', () => {
    const state = buildSitePhaseState({
      site: THE_WORTHY_HILLS,
      characters: [ELROND_DEF, ARAGORN_DEF],
      // siteStatus defaults to Untapped
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(a => (a.action as { actionId?: string }).actionId === 'untap-site');
    expect(untapActions.length).toBe(0);
  });

  test('untap-site action is NOT offered when company has no untapped sage', () => {
    const state = buildSitePhaseState({
      site: THE_WORTHY_HILLS,
      characters: [ARAGORN_DEF],  // scout, not a sage
      siteStatus: CardStatus.Tapped,
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(a => (a.action as { actionId?: string }).actionId === 'untap-site');
    expect(untapActions.length).toBe(0);
  });

  test('untap-site action is NOT offered when company has no untapped scout', () => {
    const state = buildSitePhaseState({
      site: THE_WORTHY_HILLS,
      characters: [ELROND_DEF],  // sage, not a scout
      siteStatus: CardStatus.Tapped,
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(a => (a.action as { actionId?: string }).actionId === 'untap-site');
    expect(untapActions.length).toBe(0);
  });

  test('untap-site: Bilbo (sage+scout) cannot fill both roles alone — two different characters required', () => {
    // Bilbo has both sage and scout skills, but one character cannot serve
    // as both the sage AND the scout for the cost.
    const state = buildSitePhaseState({
      site: THE_WORTHY_HILLS,
      characters: [BILBO_DEF],
      siteStatus: CardStatus.Tapped,
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(a => (a.action as { actionId?: string }).actionId === 'untap-site');
    // Bilbo is both a sage and a scout, but the emitter requires characterId ≠ secondCharacterId.
    // A one-character company can never produce a valid pair.
    expect(untapActions.length).toBe(0);
  });

  test('untap-site: Bilbo (sage+scout) CAN fill one role when paired with another sage/scout', () => {
    // With Bilbo (sage+scout) + Aragorn (scout), Bilbo can act as sage and
    // Aragorn as scout — a valid pair.
    const state = buildSitePhaseState({
      site: THE_WORTHY_HILLS,
      characters: [BILBO_DEF, ARAGORN_DEF],
      siteStatus: CardStatus.Tapped,
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(a => (a.action as { actionId?: string }).actionId === 'untap-site');
    expect(untapActions.length).toBeGreaterThan(0);
  });

  // ─── Movement: Rivendell → The Worthy Hills ──────────────────────────────────

  test('starter movement from Rivendell reaches The Worthy Hills (as-142)', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (THE_WORTHY_HILLS as string),
    );

    expect(starter).toBeDefined();
  });

  test('starter movement from The Worthy Hills reaches Rivendell', () => {
    const worthyHills = pool[THE_WORTHY_HILLS as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, worthyHills, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (RIVENDELL as string),
    );

    expect(starter).toBeDefined();
  });
});
