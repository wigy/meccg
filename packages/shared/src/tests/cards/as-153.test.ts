/**
 * @module as-153.test
 *
 * Card test: Isle of the Ulond (as-153)
 * Type: minion-site (ruins-and-lairs)
 * Effects: 1
 *
 * "Nearest Darkhaven: Geann a-Lisch
 *  Playable: Information, Items (minor, major)
 *  Automatic-attacks: Dragon — 1 strike with 14 prowess
 *  Special: An overt company must tap an untapped character (if available)
 *  if this site is revealed as its new site."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid ({R})                    |
 * | 2 | sitePath          | OK     | [wilderness, wilderness, coastal] — matches {w}{w}{c} |
 * | 3 | nearestHaven      | OK     | "Geann a-Lisch" — valid Darkhaven (le-374)         |
 * | 4 | region            | OK     | "Andrast Coast"                                    |
 * | 5 | playableResources | OK     | [information, minor, major] — matches card text    |
 * | 6 | automaticAttacks  | OK     | Dragon, 1 strike, 14 prowess                       |
 * | 7 | resourceDraws     | OK     | 2                                                  |
 * | 8 | hazardDraws       | OK     | 2                                                  |
 *
 * Engine Support:
 * | # | Feature                        | Status      | Notes                                  |
 * |---|--------------------------------|-------------|-----------------------------------------|
 * | 1 | Site phase flow                | IMPLEMENTED | select-company, enter-or-skip, etc.     |
 * | 2 | Item playability               | IMPLEMENTED | minor, major playable; greater not      |
 * | 3 | Information playability        | IMPLEMENTED | site-has-resource "information" gate    |
 * | 4 | Automatic attack               | IMPLEMENTED | combat initiated with correct stats     |
 * | 5 | Overt reveal → tap a character | IMPLEMENTED | on-event: site-revealed-as-new-site →   |
 * |   |                                |             | tap-one-character (mh-steps.ts, as-150) |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER,
  resetMint, CardStatus,
  dispatch, viableFor, viableActions,
  buildMinionSitePhaseState, setupAutoAttackStep,
  buildMinionMHRevealState, declareStarterPath,
  findCharInstanceId, findHandCardId, expectCharStatus,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const ISLE_OF_THE_ULOND = 'as-153' as CardDefinitionId;
const GEANN_A_LISCH = 'le-374' as CardDefinitionId;

// Gorbag and Shagrat are Orcs — a company containing either is overt.
const GORBAG = 'le-11' as CardDefinitionId;
const SHAGRAT = 'le-39' as CardDefinitionId;
// The Mouth is a Man — a company of only Men is covert.
const THE_MOUTH = 'le-24' as CardDefinitionId;
// Layos is a sage Man — carrier for the Information-gated event below.
const LAYOS = 'le-19' as CardDefinitionId;

const BLACK_MACE = 'le-299' as CardDefinitionId;         // greater item
const HIGH_HELM = 'le-313' as CardDefinitionId;          // major item
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;  // minor item
const GLEAMING_GOLD_RING = 'le-311' as CardDefinitionId; // gold ring (le-226 requirement)
const SECRETS_OF_THEIR_FORGING = 'le-226' as CardDefinitionId; // Information-gated event

describe('Isle of the Ulond (as-153)', () => {
  beforeEach(() => resetMint());

  // ─── Special: overt company must tap an untapped character on reveal ───────

  test('overt company revealing the Isle as its new site must tap one untapped character', () => {
    const state = buildMinionMHRevealState({
      origin: GEANN_A_LISCH,
      destination: ISLE_OF_THE_ULOND,
      characters: [GORBAG, SHAGRAT],
    });
    const declared = declareStarterPath(state);

    // The reveal enqueues a mandatory tap-one-character resolution.
    const pending = declared.pendingResolutions;
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('tap-one-character');
    expect(pending[0].actor).toBe(PLAYER_1);
    if (pending[0].kind.type !== 'tap-one-character') return;
    expect(pending[0].kind.sourceDefinitionId).toBe(ISLE_OF_THE_ULOND);
    expect(pending[0].kind.companyId).toBe(declared.players[0].companies[0].id);

    // One tap action per untapped character; the tap is mandatory, so pass
    // is NOT offered while an untapped character remains.
    const viable = viableFor(declared, PLAYER_1).map(a => a.action);
    expect(viable.filter(a => a.type === 'tap-character-by-effect')).toHaveLength(2);
    expect(viable.some(a => a.type === 'pass')).toBe(false);
  });

  test('tapping a character resolves the pending and the character becomes tapped', () => {
    const declared = declareStarterPath(buildMinionMHRevealState({
      origin: GEANN_A_LISCH,
      destination: ISLE_OF_THE_ULOND,
      characters: [GORBAG, SHAGRAT],
    }));

    const gorbagId = findCharInstanceId(declared, RESOURCE_PLAYER, GORBAG);
    const tapAction = viableFor(declared, PLAYER_1)
      .map(a => a.action)
      .find(a => a.type === 'tap-character-by-effect' && a.characterInstanceId === gorbagId);
    expect(tapAction).toBeDefined();

    const after = dispatch(declared, tapAction!);
    expect(after.pendingResolutions).toHaveLength(0);
    expectCharStatus(after, RESOURCE_PLAYER, GORBAG, CardStatus.Tapped);
    expectCharStatus(after, RESOURCE_PLAYER, SHAGRAT, CardStatus.Untapped);
  });

  test('with no untapped character available only pass is offered and it clears the pending', () => {
    const declared = declareStarterPath(buildMinionMHRevealState({
      origin: GEANN_A_LISCH,
      destination: ISLE_OF_THE_ULOND,
      characters: [
        { defId: GORBAG, status: CardStatus.Tapped },
        { defId: SHAGRAT, status: CardStatus.Tapped },
      ],
    }));

    expect(declared.pendingResolutions).toHaveLength(1);
    const viable = viableFor(declared, PLAYER_1).map(a => a.action);
    expect(viable.filter(a => a.type === 'tap-character-by-effect')).toHaveLength(0);
    expect(viable.some(a => a.type === 'pass')).toBe(true);

    const after = dispatch(declared, { type: 'pass', player: PLAYER_1 });
    expect(after.pendingResolutions).toHaveLength(0);
    expectCharStatus(after, RESOURCE_PLAYER, GORBAG, CardStatus.Tapped);
    expectCharStatus(after, RESOURCE_PLAYER, SHAGRAT, CardStatus.Tapped);
  });

  test('a covert company revealing the Isle is NOT forced to tap', () => {
    // The Mouth is a Man: a company without Orcs, Trolls, or overt-making
    // allies is covert, so the special rule does not fire.
    const declared = declareStarterPath(buildMinionMHRevealState({
      origin: GEANN_A_LISCH,
      destination: ISLE_OF_THE_ULOND,
      characters: [THE_MOUTH],
    }));

    expect(declared.pendingResolutions).toHaveLength(0);
    expectCharStatus(declared, RESOURCE_PLAYER, THE_MOUTH, CardStatus.Untapped);
  });

  // ─── Automatic attack ──────────────────────────────────────────────────────

  test('Dragon automatic attack triggers with 1 strike and 14 prowess', () => {
    const state = buildMinionSitePhaseState({ site: ISLE_OF_THE_ULOND, characters: [{ defId: THE_MOUTH }] });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(1);
    expect(nextState.combat!.strikeProwess).toBe(14);
    expect(nextState.combat!.creatureRace).toBe('dragon');
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Item playability: minor, major (not greater) ──────────────────────────

  test('minor and major items are playable at the Isle, greater items are not', () => {
    const state = buildMinionSitePhaseState({
      site: ISLE_OF_THE_ULOND,
      characters: [{ defId: THE_MOUTH }],
      hand: [SAW_TOOTHED_BLADE, HIGH_HELM, BLACK_MACE],
    });

    const playable = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => (a.action as { cardInstanceId?: string }).cardInstanceId);

    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, SAW_TOOTHED_BLADE));
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, HIGH_HELM));
    expect(playable).not.toContain(findHandCardId(state, RESOURCE_PLAYER, BLACK_MACE));
  });

  // ─── Information playability ───────────────────────────────────────────────

  test('an Information-gated card is playable at the Isle', () => {
    // Secrets of Their Forging (le-226) is playable on a sage during the site
    // phase at a site where Information is playable, if the company has a gold
    // ring. All its other requirements are met here, so its playability turns
    // on the Isle listing Information.
    const state = buildMinionSitePhaseState({
      site: ISLE_OF_THE_ULOND,
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
