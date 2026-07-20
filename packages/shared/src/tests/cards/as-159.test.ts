/**
 * @module as-159.test
 *
 * Card test: Rhosgobel (as-159)
 * Type: minion-site (free-hold, Southern Mirkwood)
 * Effects: 1
 *
 * "Nearest Darkhaven: Dol Guldur
 *  Playable: Information, Items (minor)
 *  Automatic-attacks (2):
 *  (1st) Maia — 1 strike with 13 prowess
 *  (2nd) Maia — 1 strike with 13 prowess
 *  Special: If the Wizard card Radagast is in play, the automatic-attacks
 *  are removed."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                       |
 * |---|-------------------|--------|---------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — matches {F}                   |
 * | 2 | sitePath          | OK     | [dark] — matches {d}                        |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid Darkhaven (le-367)     |
 * | 4 | region            | OK     | "Southern Mirkwood"                         |
 * | 5 | playableResources | OK     | [information, minor] — matches card text    |
 * | 6 | automaticAttacks  | OK     | Maia 1×13; Maia 1×13                        |
 * | 7 | resourceDraws     | OK     | 1                                           |
 * | 8 | hazardDraws       | OK     | 1                                           |
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                     |
 * |---|------------------------------------------|-------------|-------------------------------------------|
 * | 1 | Site phase flow                          | IMPLEMENTED | select-company, enter-or-skip, etc.       |
 * | 2 | Item playability (minor only)            | IMPLEMENTED | site.ts enforces playableResources        |
 * | 3 | Information playability                  | IMPLEMENTED | site-has-resource "information" gate      |
 * | 4 | Two sequential Maia auto-attacks         | IMPLEMENTED | reducer-site.ts, automaticAttacksResolved |
 * | 5 | Radagast in play removes the attacks     | IMPLEMENTED | site-rule cancel-attacks-if-character-    |
 * |   |                                          |             | in-play (manifestations.ts), name-matched |
 * |   |                                          |             | so tw-178 and wh-8 both count             |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment } from '../../index.js';
import type { CardDefinitionId, SitePhaseState } from '../../index.js';
import {
  PLAYER_1, RESOURCE_PLAYER, RIVENDELL,
  resetMint,
  dispatch, viableActions, viableFor,
  buildMinionSitePhaseState, setupAutoAttackStep,
  findHandCardId,
} from '../test-helpers.js';

const RHOSGOBEL_AS = 'as-159' as CardDefinitionId;

// Radagast exists as the hero Wizard (tw-178) and the Fallen-wizard (wh-8);
// the special rule fires for either version, matched by card name.
const RADAGAST_HERO = 'tw-178' as CardDefinitionId;
const RADAGAST_FW = 'wh-8' as CardDefinitionId;

// Minion company members.
const GORBAG = 'le-11' as CardDefinitionId;
const SHAGRAT = 'le-39' as CardDefinitionId;
const THE_MOUTH = 'le-24' as CardDefinitionId;
// Layos is a sage Man — carrier for the Information-gated event below.
const LAYOS = 'le-19' as CardDefinitionId;

const BLACK_MACE = 'le-299' as CardDefinitionId;         // greater item
const HIGH_HELM = 'le-313' as CardDefinitionId;          // major item
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;  // minor item
const GLEAMING_GOLD_RING = 'le-311' as CardDefinitionId; // gold ring (le-226 requirement)
const SECRETS_OF_THEIR_FORGING = 'le-226' as CardDefinitionId; // Information-gated event

describe('Rhosgobel (as-159)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic-attacks: two sequential Maia 1×13 ───────────────────────────

  test('1st automatic-attack fires a Maia attack with 1 strike and 13 prowess', () => {
    const ready = setupAutoAttackStep(buildMinionSitePhaseState({
      site: RHOSGOBEL_AS,
      characters: [{ defId: GORBAG }, { defId: SHAGRAT }],
    }));

    const next = dispatch(ready, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('maia');
    expect(next.combat!.strikesTotal).toBe(1);
    expect(next.combat!.strikeProwess).toBe(13);
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
    expect((next.phaseState as SitePhaseState).automaticAttacksResolved).toBe(1);
  });

  test('2nd automatic-attack fires another Maia attack with 1 strike and 13 prowess', () => {
    const ready = setupAutoAttackStep(buildMinionSitePhaseState({
      site: RHOSGOBEL_AS,
      characters: [{ defId: GORBAG }, { defId: SHAGRAT }],
    }));
    const afterFirst = { ...ready, phaseState: { ...(ready.phaseState as SitePhaseState), automaticAttacksResolved: 1 } };

    const next = dispatch(afterFirst, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('maia');
    expect(next.combat!.strikesTotal).toBe(1);
    expect(next.combat!.strikeProwess).toBe(13);
    expect((next.phaseState as SitePhaseState).automaticAttacksResolved).toBe(2);
  });

  test('after both attacks are resolved the site phase advances without further combat', () => {
    const ready = setupAutoAttackStep(buildMinionSitePhaseState({
      site: RHOSGOBEL_AS,
      characters: [{ defId: GORBAG }, { defId: SHAGRAT }],
    }));
    const afterBoth = { ...ready, phaseState: { ...(ready.phaseState as SitePhaseState), automaticAttacksResolved: 2 } };

    const next = dispatch(afterBoth, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).toBeNull();
    expect((next.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });

  // ─── Special: Radagast in play removes the automatic-attacks ───────────────

  test('with the hero Wizard Radagast in play, no automatic-attack fires', () => {
    const ready = setupAutoAttackStep(buildMinionSitePhaseState({
      site: RHOSGOBEL_AS,
      characters: [{ defId: GORBAG }, { defId: SHAGRAT }],
      opponent: { alignment: Alignment.Wizard, site: RIVENDELL, characters: [{ defId: RADAGAST_HERO }] },
    }));

    const next = dispatch(ready, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).toBeNull();
    expect((next.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });

  test('the Fallen-wizard version of Radagast (wh-8) also removes the attacks', () => {
    const ready = setupAutoAttackStep(buildMinionSitePhaseState({
      site: RHOSGOBEL_AS,
      characters: [{ defId: GORBAG }, { defId: SHAGRAT }],
      opponent: { alignment: Alignment.FallenWizard, site: RIVENDELL, characters: [{ defId: RADAGAST_FW }] },
    }));

    const next = dispatch(ready, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).toBeNull();
    expect((next.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });

  test('a different Wizard in play does NOT remove the attacks', () => {
    // Gandalf is a Wizard but not Radagast — the special rule must not fire.
    const GANDALF_HERO = 'tw-156' as CardDefinitionId;
    const ready = setupAutoAttackStep(buildMinionSitePhaseState({
      site: RHOSGOBEL_AS,
      characters: [{ defId: GORBAG }, { defId: SHAGRAT }],
      opponent: { alignment: Alignment.Wizard, site: RIVENDELL, characters: [{ defId: GANDALF_HERO }] },
    }));

    const next = dispatch(ready, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('maia');
    expect(next.combat!.strikeProwess).toBe(13);
  });

  // ─── Item playability: minor only (not major, not greater) ─────────────────

  test('minor items are playable at Rhosgobel, major and greater items are not', () => {
    const state = buildMinionSitePhaseState({
      site: RHOSGOBEL_AS,
      characters: [{ defId: THE_MOUTH }],
      hand: [SAW_TOOTHED_BLADE, HIGH_HELM, BLACK_MACE],
    });

    const playable = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => (a.action as { cardInstanceId?: string }).cardInstanceId);

    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, SAW_TOOTHED_BLADE));
    expect(playable).not.toContain(findHandCardId(state, RESOURCE_PLAYER, HIGH_HELM));
    expect(playable).not.toContain(findHandCardId(state, RESOURCE_PLAYER, BLACK_MACE));
  });

  // ─── Information playability ───────────────────────────────────────────────

  test('an Information-gated card is playable at Rhosgobel', () => {
    // Secrets of Their Forging (le-226) is playable on a sage during the site
    // phase at a site where Information is playable, if the company has a gold
    // ring. All its other requirements are met here, so its playability turns
    // on Rhosgobel listing Information.
    const state = buildMinionSitePhaseState({
      site: RHOSGOBEL_AS,
      characters: [{ defId: LAYOS, items: [GLEAMING_GOLD_RING] }],
      hand: [SECRETS_OF_THEIR_FORGING],
    });

    const secretsId = findHandCardId(state, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);
    const viable = viableFor(state, PLAYER_1)
      .map(a => a.action)
      .filter(a => (a as { cardInstanceId?: string }).cardInstanceId === secretsId);
    expect(viable.length).toBeGreaterThan(0);
  });
});
