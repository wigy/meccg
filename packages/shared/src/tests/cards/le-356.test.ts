/**
 * @module le-356.test
 *
 * Card test: Bree (le-356)
 * Type: minion-site (border-hold) in Arthedain
 * Effects: 2 (combat-detainment gated on defender.covert; site-rule allow-agent-play)
 *
 * Text:
 *   "Nearest Darkhaven: Carn Dûm
 *    Playable: Information, Items (minor, gold ring)
 *    Automatic-attacks: Dúnedain — each character faces 1 strike with 7 prowess
 *      (detainment against covert company)
 *    Special: Agent minions may be brought into play under direct influence at
 *      this site."
 *
 * Rules interpretation:
 *   - The single Dúnedain automatic-attack is an each-character attack (prowess
 *     7). Marked "(detainment against covert company)": it is detainment against
 *     a covert company and a regular attack against an overt company (MELE site
 *     guardians, same encoding as Minas Tirith le-391).
 *   - "Special": an agent character (played as a character by a Ringwraith or
 *     Fallen-wizard player) may be brought into play at Bree under a character's
 *     DIRECT influence, even though Bree is not the agent's home site — an
 *     override of rule 2.II.2.2.5 (which otherwise confines agents-as-characters
 *     to their home site). Only direct influence is granted; general-influence
 *     play at Bree is NOT.
 *
 * Data encoding:
 *   - Dúnedain attack: `combatRules: ["each-character"]`, prowess 7, no
 *     `appliesTo` (faced by all companies).
 *   - Site effect `combat-detainment` gated on `defender.covert`.
 *   - Site effect `site-rule: allow-agent-play` — grants direct-influence agent
 *     play at the site.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                              |
 * | 2 | sitePath          | OK     | [shadow, wilderness] — matches {s}{w}              |
 * | 3 | nearestHaven      | OK     | "Carn Dûm" — valid minion Darkhaven (le-359)       |
 * | 4 | region            | OK     | "Arthedain" — valid region                         |
 * | 5 | playableResources | OK     | [minor, gold-ring, information] — matches text     |
 * | 6 | automaticAttacks  | OK     | Dúnedain (each-character, prowess 7)               |
 * | 7 | resourceDraws     | OK     | 1                                                  |
 * | 8 | hazardDraws       | OK     | 1                                                  |
 *
 * Engine Support:
 * | # | Feature                          | Status      | Notes                                              |
 * |---|----------------------------------|-------------|----------------------------------------------------|
 * | 1 | Haven path movement              | IMPLEMENTED | Carn Dûm ↔ Bree via starter movement               |
 * | 2 | Auto-attack (each-character)     | IMPLEMENTED | Dúnedain: 1 strike per character, prowess 7        |
 * | 3 | Detainment vs covert company     | IMPLEMENTED | combat-detainment site effect + defendingCovert    |
 * | 4 | Regular attack vs overt company  | IMPLEMENTED | Dúnedain not detainment when company is overt      |
 * | 5 | Agent play under direct influence| IMPLEMENTED | site-rule allow-agent-play (organization-characters)|
 *
 * Playable: YES
 * Certified: 2026-07-15
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, GIMLI, LORIEN,
  findCharInstanceId, findHandCardId, viablePlayCharacterActions,
  resetMint, pool,
  buildTestState, runAutoAttackCombatMulti,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites, Phase, Alignment, SiteType, type Race,
} from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { reduce } from '../../engine/reducer.js';
import type { SiteCard, CardDefinitionId, GameState, SitePhaseState } from '../../index.js';

const BREE = 'le-356' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;         // minion Darkhaven (Bree's nearest haven)
const CAMETH_BRIN = 'le-358' as CardDefinitionId;      // another minion border-hold (no allow-agent-play)

// Minion characters. Men do not make a company overt; an Orc does.
const THE_MOUTH = 'le-24' as CardDefinitionId;   // Man, direct influence 4 — a DI controller
const ASTERNAK = 'le-1' as CardDefinitionId;     // Man
const ORC_CAPTAIN = 'le-31' as CardDefinitionId; // Orc → makes the company overt

// Herion (dm-16): a minion agent, mind 3, home Lond Galen / Dol Amroth — NOT
// Bree — so any Bree play proves the special rule, not the home-site rule.
const HERION = 'dm-16' as CardDefinitionId;

/** Build a Ringwraith site-phase state at the automatic-attacks step with a company at Bree. */
function siteAutoAttackStep(characters: CardDefinitionId[]): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: BREE, characters }],
        hand: [],
        siteDeck: [CARN_DUM],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [CARN_DUM],
      },
    ],
  });

  const sitePhaseState: SitePhaseState = {
    phase: Phase.Site,
    step: 'automatic-attacks' as const,
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    siteEntered: false,
    resourcePlayed: false,
    minorItemAvailable: false,
    hoardBountyAvailable: false,
    thoroughSearchAvailable: false,
    declaredAgentAttack: null,
    automaticAttacksResolved: 0,
    awaitingOnGuardReveal: false,
    pendingResourceAction: null,
    opponentInteractionThisTurn: null,
    pendingOpponentInfluence: null,
  };
  return { ...base, phaseState: sitePhaseState };
}

/** Build a Ringwraith organization-phase state: one company at `site` holding The Mouth, Herion in hand. */
function orgPhaseAtSite(site: CardDefinitionId): GameState {
  return buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site, characters: [THE_MOUTH] }],
        hand: [HERION],
        siteDeck: [CARN_DUM],
      },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [CARN_DUM] },
    ],
  });
}

describe('Bree (le-356)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Carn Dûm ↔ Bree ─────────────────────────────────────────────

  test('starter movement from Carn Dûm reaches Bree (le-356)', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (BREE as string),
    );

    expect(starter).toBeDefined();
  });

  // ─── Playable resources encode the printed "Information, Items (minor, gold ring)" ──

  test('playableResources match the printed list (information, minor, gold-ring)', () => {
    const bree = pool[BREE as string] as SiteCard;
    expect(bree.playableResources).toEqual(
      expect.arrayContaining(['information', 'minor', 'gold-ring']),
    );
    // No major items — Bree only allows minor + gold ring.
    expect(bree.playableResources).not.toContain('major');
  });

  // ─── Detainment helper: covert vs overt at a border-hold ───────────────────
  // Bree is a border-hold, so the §3.II.2.R1 dark-hold/shadow-hold branch does
  // NOT fire. Detainment comes solely from the combat-detainment site effect.

  test('covert Ringwraith company: Dúnedain auto-attack is detainment (site effect)', () => {
    const siteDef = pool[BREE as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: 'dunadan' as Race,
      attackKeyedTo: [{ siteTypes: [SiteType.BorderHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingCovert: true,
      attackEffects: siteDef.effects,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(true);
  });

  test('overt Ringwraith company: Dúnedain auto-attack is NOT detainment', () => {
    const siteDef = pool[BREE as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: 'dunadan' as Race,
      attackKeyedTo: [{ siteTypes: [SiteType.BorderHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingCovert: false,
      attackEffects: siteDef.effects,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('baseline: without the site effect, covert company vs Dúnedain at border-hold is NOT detainment', () => {
    const detainment = isDetainmentAttack({
      attackRace: 'dunadan' as Race,
      attackKeyedTo: [{ siteTypes: [SiteType.BorderHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingCovert: true,
    });
    expect(detainment).toBe(false);
  });

  // ─── Auto-attack combat resolution ─────────────────────────────────────────

  test('covert company: Dúnedain attack is each-character detainment with prowess 7', () => {
    const state = siteAutoAttackStep([THE_MOUTH, ASTERNAK]);

    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.creatureRace).toBe('dunadan');
    expect(afterAttack.combat!.strikeProwess).toBe(7);
    // each-character: one strike pre-assigned per character (company size 2)
    expect(afterAttack.combat!.strikesTotal).toBe(2);
    expect(afterAttack.combat!.strikeAssignments).toHaveLength(2);
    expect(afterAttack.combat!.eachCharacterFacesOneStrike).toBe(true);
    // Covert company → Dúnedain attack is detainment.
    expect(afterAttack.combat!.detainment).toBe(true);
  });

  test('overt company: Dúnedain attack is each-character but NOT detainment', () => {
    const state = siteAutoAttackStep([ORC_CAPTAIN, THE_MOUTH]);

    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.creatureRace).toBe('dunadan');
    expect(afterAttack.combat!.strikeProwess).toBe(7);
    expect(afterAttack.combat!.strikesTotal).toBe(2);
    // Overt company → regular (non-detainment) attack.
    expect(afterAttack.combat!.detainment).toBe(false);
  });

  test('covert company: after resolving the Dúnedain detainment attack, advances past automatic-attacks', () => {
    const state = siteAutoAttackStep([THE_MOUTH, ASTERNAK]);

    const afterAttack = runAutoAttackCombatMulti(
      state,
      [
        { characterDefId: THE_MOUTH, roll: 12, tapToFight: true },
        { characterDefId: ASTERNAK, roll: 12, tapToFight: true },
      ],
      PLAYER_1,
      PLAYER_2,
    );
    expect(afterAttack.state.combat).toBeNull();
    const sps = afterAttack.state.phaseState as SitePhaseState;
    expect(sps.automaticAttacksResolved).toBe(1);

    // Bree has only one automatic-attack → next pass leaves automatic-attacks.
    const { state: afterSkip, error } = reduce(afterAttack.state, { type: 'pass', player: PLAYER_1 });
    expect(error).toBeUndefined();
    expect(afterSkip.combat).toBeNull();
    expect((afterSkip.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });

  // ─── Special: agent minions playable under direct influence at Bree ─────────

  test('agent may be brought into play under direct influence at Bree (allow-agent-play)', () => {
    const state = orgPhaseAtSite(BREE);
    const mouthId = findCharInstanceId(state, 0, THE_MOUTH);
    const breeSiteId = state.players[0].companies[0].currentSite!.instanceId;

    const herionActions = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === findHandCardId(state, 0, HERION));

    // At least one viable play: under The Mouth's direct influence, at Bree.
    const underMouthAtBree = herionActions.filter(
      a => a.controlledBy === mouthId && a.atSite === breeSiteId,
    );
    expect(underMouthAtBree.length).toBeGreaterThanOrEqual(1);
  });

  test('agent play at Bree is direct-influence only — never offered under general influence', () => {
    const state = orgPhaseAtSite(BREE);
    const breeSiteId = state.players[0].companies[0].currentSite!.instanceId;

    const herionAtBree = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === findHandCardId(state, 0, HERION) && a.atSite === breeSiteId);

    // No general-influence play permitted at Bree for the agent.
    expect(herionAtBree.some(a => a.controlledBy === 'general')).toBe(false);
    // But direct-influence play IS available.
    expect(herionAtBree.some(a => a.controlledBy !== 'general')).toBe(true);
  });

  test('baseline: at a border-hold WITHOUT allow-agent-play, the agent cannot be played (home-site-only)', () => {
    // Cameth Brin is a minion border-hold that is NOT Herion's home site and has
    // no allow-agent-play rule — so the standard agent home-site-only restriction
    // (rule 2.II.2.2.5) blocks the play entirely.
    const state = orgPhaseAtSite(CAMETH_BRIN);
    const herionId = findHandCardId(state, 0, HERION);

    const herionActions = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === herionId);

    expect(herionActions).toHaveLength(0);
  });

  test('Wizard player still cannot play the agent as a character at Bree', () => {
    // Rule 1.3.W2: a Wizard player treats agents as hazards, never characters —
    // Bree's special does not change alignment eligibility.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: BREE, characters: [GIMLI] }],
          hand: [HERION],
          siteDeck: [CARN_DUM],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const herionId = findHandCardId(state, 0, HERION);
    const herionActions = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === herionId);
    expect(herionActions).toHaveLength(0);
  });
});
