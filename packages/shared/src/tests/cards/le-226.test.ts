/**
 * @module le-226.test
 *
 * Card test: Secrets of Their Forging (le-226)
 * Type: minion-resource-event (short, alignment: ringwraith)
 *
 * "Sage only. Playable on a sage during the site phase at a site where
 *  Information is playable if a character in his company has a gold ring
 *  item. Tap the sage and the site. You may replace the gold ring with a
 *  special item ring from your hand (except for The One Ring) for which
 *  the gold ring could normally be tested. Discard the gold ring item."
 *
 * Engine support:
 * | # | Rule                                                  | Status      | Notes                                                  |
 * |---|-------------------------------------------------------|-------------|--------------------------------------------------------|
 * | 1 | Playable only during the site phase                   | IMPLEMENTED | play-window phase:site                                 |
 * | 2 | Sage only — targets an untapped sage (tap cost)       | IMPLEMENTED | play-target filter target.skills:sage, cost tap:char   |
 * | 3 | Only at a site where Information is playable          | IMPLEMENTED | play-condition site-has-resource subtype:information   |
 * | 4 | Requires a gold ring in the company                   | IMPLEMENTED | play-condition company-has-item subtype:gold-ring      |
 * | 5 | Sage is tapped on play                                | IMPLEMENTED | play-target cost tap:character                         |
 * | 6 | Site is tapped on play                                | IMPLEMENTED | enqueue-ring-play-offer handler taps active site       |
 * | 7 | Gold ring is discarded                                | IMPLEMENTED | enqueue-ring-play-offer handler removes ring from char |
 * | 8 | Ring-play-offer offered with all categories except    | IMPLEMENTED | eligibleRingCategories(table, 999) minus the-one-ring  |
 * |   | The One Ring                                          |             |                                                        |
 * | 9 | One action per (sage × gold ring) combination         | IMPLEMENTED | legal-action emitter cross-products sage × ring        |
 *
 * Fixture alignment: minion (ringwraith) — uses minion characters and sites
 * from the LE set (le-characters.json, le-sites.json).
 *
 * Character fixtures:
 *   - HADOR      (le-14): dunadan, warrior+sage — untapped sage
 *   - CIRYAHER   (le-6):  dunadan, scout+sage   — second sage for multi-sage test
 *   - LAYOS      (le-19): man, sage+diplomat     — non-sage companion (check exclusion)
 *
 * Wait — Layos IS a sage. Use a non-sage for the exclusion test.
 * Non-sage minion characters: Gorbag (le-11) warrior, Shagrat (le-39) warrior.
 *
 * Site fixtures:
 *   - DIMRILL_DALE  (le-365): ruins-and-lairs, information playable  ← valid site
 *   - MOUNT_DOOM_LE (le-393): shadow-hold, information playable      ← valid site
 *   - ETTENMOORS    (le-373): ruins-and-lairs, information NOT listed ← invalid site
 *   - DOL_GULDUR    (le-367): haven, information NOT listed           ← invalid site
 *
 * Ring fixtures:
 *   - LEAST_OF_GOLD_RINGS (le-315): subtype gold-ring, ring-test-table
 *   - MINOR_RING          (le-324): subtype special, keyword lesser-ring
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2,
  attachItemToChar, addCardToHand,
  charIdAt, dispatch, viableActions, RESOURCE_PLAYER,
  findCharInstanceId, getCharacter,
  expectCharStatus, expectInDiscardPile,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayShortEventAction } from '../../index.js';
import type { SitePhaseState } from '../../types/state-phases.js';

// ── Card under test ──────────────────────────────────────────────────────────
const SECRETS_OF_THEIR_FORGING = 'le-226' as CardDefinitionId;

// ── Minion characters ────────────────────────────────────────────────────────
const HADOR = 'le-14' as CardDefinitionId;       // warrior+sage
const CIRYAHER = 'le-6' as CardDefinitionId;     // scout+sage
const GORBAG = 'le-11' as CardDefinitionId;      // warrior (no sage skill)
const SHAGRAT = 'le-39' as CardDefinitionId;     // warrior (no sage skill)

// ── Sites ────────────────────────────────────────────────────────────────────
const DIMRILL_DALE = 'le-365' as CardDefinitionId;    // ruins-and-lairs, information playable
const MOUNT_DOOM_LE = 'le-393' as CardDefinitionId;   // shadow-hold, information playable
const ETTENMOORS = 'le-373' as CardDefinitionId;      // ruins-and-lairs, NO information
const DOL_GULDUR = 'le-367' as CardDefinitionId;      // haven (minion), NO information

// ── Ring items ───────────────────────────────────────────────────────────────
const LEAST_OF_GOLD_RINGS = 'le-315' as CardDefinitionId;
const MINOR_RING = 'le-324' as CardDefinitionId;

/** Build a minion site-phase state with the given setup. */
function buildMinionSitePhase(opts: {
  site: CardDefinitionId;
  characters: CardDefinitionId[];
  hand?: CardDefinitionId[];
  siteStatus?: CardStatus;
}): ReturnType<typeof buildTestState> {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: opts.site, characters: opts.characters }],
        hand: opts.hand ?? [],
        siteDeck: [ETTENMOORS],
      },
      {
        id: PLAYER_2,
        companies: [{ site: DOL_GULDUR, characters: [SHAGRAT] }],
        hand: [],
        siteDeck: [DIMRILL_DALE],
      },
    ],
    phase: Phase.Site,
  });

  const sitePhaseState: SitePhaseState = {
    phase: Phase.Site,
    step: 'play-resources',
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    siteEntered: true,
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

  if (opts.siteStatus) {
    const company = state.players[0].companies[0];
    (company.currentSite as { status: CardStatus }).status = opts.siteStatus;
  }

  return { ...state, phaseState: sitePhaseState };
}

describe('Secrets of Their Forging (le-226)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1+2+3+4: Playability gating ──────────────────────────────────────

  test('offered at an information site when company has sage and gold ring', () => {
    const base = buildMinionSitePhase({
      site: DIMRILL_DALE,
      characters: [HADOR],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    expect(plays.length).toBeGreaterThanOrEqual(1);
    const action = plays[0].action as PlayShortEventAction;
    expect(action.targetScoutInstanceId).toBeTruthy();
    expect(action.targetGoldRingInstanceId).toBeTruthy();
  });

  test('not offered when site does not have information as playable resource', () => {
    const base = buildMinionSitePhase({
      site: ETTENMOORS,
      characters: [HADOR],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    expect(plays.length).toBe(0);
  });

  test('not offered when company has no gold ring', () => {
    const base = buildMinionSitePhase({
      site: DIMRILL_DALE,
      characters: [HADOR],
    });
    const withCard = addCardToHand(base, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    expect(plays.length).toBe(0);
  });

  test('not offered when no sage in company', () => {
    const base = buildMinionSitePhase({
      site: DIMRILL_DALE,
      characters: [GORBAG],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    expect(plays.length).toBe(0);
  });

  test('not offered when sage is tapped', () => {
    const base = buildMinionSitePhase({
      site: DIMRILL_DALE,
      characters: [HADOR],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);

    // Tap the sage
    const hadorId = findCharInstanceId(withCard, RESOURCE_PLAYER, HADOR);
    const hadorChar = withCard.players[RESOURCE_PLAYER].characters[hadorId as string];
    const tappedP0 = {
      ...withCard.players[RESOURCE_PLAYER],
      characters: { ...withCard.players[RESOURCE_PLAYER].characters, [hadorId as string]: { ...hadorChar, status: CardStatus.Tapped } },
    };
    const tappedState = {
      ...withCard,
      players: [tappedP0, withCard.players[1]] as unknown as typeof withCard.players,
    };

    const plays = viableActions(tappedState, PLAYER_1, 'play-short-event');
    expect(plays.length).toBe(0);
  });

  // ── Rule 5: Sage is tapped on play ────────────────────────────────────────

  test('playing the card taps the sage', () => {
    const base = buildMinionSitePhase({
      site: DIMRILL_DALE,
      characters: [HADOR],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    expect(plays.length).toBeGreaterThanOrEqual(1);
    const afterPlay = dispatch(withCard, plays[0].action);

    expectCharStatus(afterPlay, RESOURCE_PLAYER, HADOR, CardStatus.Tapped);
  });

  // ── Rule 6: Site is tapped on play ────────────────────────────────────────

  test('playing the card taps the site', () => {
    const base = buildMinionSitePhase({
      site: DIMRILL_DALE,
      characters: [HADOR],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(withCard, plays[0].action);

    const company = afterPlay.players[RESOURCE_PLAYER].companies[0];
    expect(company.currentSite?.status).toBe(CardStatus.Tapped);
  });

  // ── Rule 7: Gold ring is discarded on play ────────────────────────────────

  test('playing the card discards the gold ring from the bearer', () => {
    const base = buildMinionSitePhase({
      site: DIMRILL_DALE,
      characters: [HADOR],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);

    expect(getCharacter(withCard, RESOURCE_PLAYER, HADOR).items).toHaveLength(1);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(withCard, plays[0].action);

    // Gold ring removed from character
    expect(getCharacter(afterPlay, RESOURCE_PLAYER, HADOR).items).toHaveLength(0);
    // Gold ring is in discard pile
    expectInDiscardPile(afterPlay, RESOURCE_PLAYER, LEAST_OF_GOLD_RINGS);
  });

  // ── Rule 8: Ring-play-offer enqueued (no dice roll, all categories except The One Ring) ──

  test('playing the card enqueues a ring-play-offer pending resolution', () => {
    const base = buildMinionSitePhase({
      site: DIMRILL_DALE,
      characters: [HADOR],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(withCard, plays[0].action);

    const pending = afterPlay.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('ring-play-offer');
  });

  test('ring-play-offer includes lesser-ring, magic-ring, and dwarven-ring but NOT the-one-ring', () => {
    const base = buildMinionSitePhase({
      site: DIMRILL_DALE,
      characters: [HADOR],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(withCard, plays[0].action);

    const pending = afterPlay.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending[0].kind.type).toBe('ring-play-offer');
    if (pending[0].kind.type !== 'ring-play-offer') return;
    const categories = pending[0].kind.eligibleCategories;
    expect(categories).toContain('lesser-ring');
    expect(categories).toContain('magic-ring');
    expect(categories).toContain('dwarven-ring');
    expect(categories).not.toContain('the-one-ring');
  });

  test('a matching special ring in hand can be played via ring-play-offer', () => {
    const base = buildMinionSitePhase({
      site: DIMRILL_DALE,
      characters: [HADOR],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);
    const withMinorRing = addCardToHand(withCard, RESOURCE_PLAYER, MINOR_RING);

    const plays = viableActions(withMinorRing, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(withMinorRing, plays[0].action);

    // ring-play-offer should offer the Minor Ring (lesser-ring category)
    const playActions = viableActions(afterPlay, PLAYER_1, 'play-ring-after-test');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('player can pass the ring-play-offer and not play a ring', () => {
    const base = buildMinionSitePhase({
      site: DIMRILL_DALE,
      characters: [HADOR],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(withCard, plays[0].action);

    const passes = viableActions(afterPlay, PLAYER_1, 'pass');
    expect(passes.length).toBeGreaterThanOrEqual(1);

    const afterPass = dispatch(afterPlay, passes[0].action);
    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending.length).toBe(0);
  });

  // ── Rule 9: One action per (sage × gold ring) combination ─────────────────

  test('two gold rings in company emit two play-short-event actions', () => {
    const base = buildMinionSitePhase({
      site: DIMRILL_DALE,
      characters: [HADOR, GORBAG],
    });
    // Hador has one gold ring, Gorbag has another gold ring
    const withRing1 = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withRing2 = attachItemToChar(withRing1, RESOURCE_PLAYER, GORBAG, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing2, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    // One action per gold ring (both attached to different chars in company)
    expect(plays.length).toBe(2);
    // Each action references a different gold ring
    const ringIds = plays.map(p => (p.action as PlayShortEventAction).targetGoldRingInstanceId);
    expect(new Set(ringIds).size).toBe(2);
  });

  test('two sages and one ring emit two play-short-event actions', () => {
    const base = buildMinionSitePhase({
      site: DIMRILL_DALE,
      characters: [HADOR, CIRYAHER],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    // One action per sage (both can tap and use the same ring)
    expect(plays.length).toBe(2);
    // Both target the same ring, different sages
    const sageIds = plays.map(p => (p.action as PlayShortEventAction).targetScoutInstanceId);
    expect(new Set(sageIds).size).toBe(2);
  });

  // ── Edge case: also works at Mount Doom (shadow-hold with information) ─────

  test('offered at Mount Doom (shadow-hold) when information is playable', () => {
    const base = buildMinionSitePhase({
      site: MOUNT_DOOM_LE,
      characters: [HADOR],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  // ── Correct ring bearer receives the replacement ───────────────────────────

  test('ring-play-offer targets the bearer of the discarded gold ring', () => {
    // Gorbag (non-sage) carries the gold ring; Hador (sage) plays the event.
    const base = buildMinionSitePhase({
      site: DIMRILL_DALE,
      characters: [HADOR, GORBAG],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    expect(plays.length).toBeGreaterThanOrEqual(1);
    const afterPlay = dispatch(withCard, plays[0].action);

    const pending = afterPlay.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending[0].kind.type).toBe('ring-play-offer');
    if (pending[0].kind.type !== 'ring-play-offer') return;
    // The replacement ring should go on Gorbag (who bore the gold ring)
    const gorbagId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, GORBAG);
    expect(pending[0].kind.characterInstanceId).toBe(gorbagId);
  });

  // ── card discarded to discard pile after play ──────────────────────────────

  test('Secrets of Their Forging is discarded from hand on play', () => {
    const base = buildMinionSitePhase({
      site: DIMRILL_DALE,
      characters: [HADOR],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);

    expect(withCard.players[RESOURCE_PLAYER].hand).toHaveLength(1);
    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(withCard, plays[0].action);

    expect(afterPlay.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(afterPlay, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);
  });

  // ── charIdAt: used as a quick single-character company lookup ─────────────

  test('charIdAt returns the sage character ID for single-character company', () => {
    const base = buildMinionSitePhase({
      site: DIMRILL_DALE,
      characters: [HADOR],
    });
    const hadorId = charIdAt(base, RESOURCE_PLAYER);
    expect(hadorId).toBeTruthy();
    expect(base.players[RESOURCE_PLAYER].characters[hadorId as string]).toBeDefined();
  });
});
