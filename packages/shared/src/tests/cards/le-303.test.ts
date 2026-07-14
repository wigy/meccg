/**
 * @module le-303.test
 *
 * Card test: Bright Gold Ring (le-303)
 * Type: minion-resource-item (subtype: gold-ring, alignment: ringwraith)
 * Corruption: 4, Marshalling Points: 2
 *
 * "May only be played at a Free-hold [{F}] where gold rings are playable.
 *  Bearer must make a corruption check at the end of each of his untap phases.
 *  Discard Bright Gold Ring when tested. If tested, make a roll to determine
 *  which ring card may be immediately played: a Spirit Ring (8,9,10,11,12+);
 *  a Dwarven Ring (9,10,11,12+); a Magic Ring (1,2,3,4,5); a Lesser Ring
 *  (any result). You may search your play deck or discard pile for a Lesser
 *  Ring to be played."
 *
 * Engine support (all shared with the certified sibling le-311/le-315):
 * | # | Rule                                                    | Status      | Notes                                              |
 * |---|---------------------------------------------------------|-------------|---------------------------------------------------|
 * | 1 | +4 corruption points on bearer                          | IMPLEMENTED | itemDef.corruptionPoints summed                   |
 * | 2 | May only be played at Free-hold with gold rings         | IMPLEMENTED | item-play-site filter: siteType+playableResources |
 * | 3 | Forced corruption check at end of untap                 | IMPLEMENTED | on-event untap-phase-end (no when)                |
 * | 4 | Discard when tested                                     | IMPLEMENTED | gold-ring-test resolution discards ring           |
 * | 5 | Roll determines eligible ring categories                | IMPLEMENTED | ring-test-table effect, eligibleRingCategories    |
 * | 6 | Spirit Ring eligible on 8+                              | IMPLEMENTED | ring-test-table row min:8                          |
 * | 7 | Dwarven Ring eligible on 9+                             | IMPLEMENTED | ring-test-table row min:9                          |
 * | 8 | Magic Ring eligible on 1–5                              | IMPLEMENTED | ring-test-table row min:1 max:5                   |
 * | 9 | Lesser Ring always eligible                             | IMPLEMENTED | ring-test-table row min:null max:null             |
 * |10 | Search play deck or discard pile for Lesser Ring        | IMPLEMENTED | ring-test-search, ringPlayOfferActions            |
 * |11 | Playing Lesser Ring from deck removes it from deck      | IMPLEMENTED | applyRingPlayOfferResolution source:play-deck     |
 * |12 | Playing Lesser Ring from discard removes from discard   | IMPLEMENTED | applyRingPlayOfferResolution source:discard-pile  |
 * |13 | Storable at Dol Guldur, Minas Morgul, Carn Dûm          | IMPLEMENTED | storable-at effect                                |
 *
 * Distinctive vs. le-311: Spirit Ring becomes eligible one pip earlier (8+
 * instead of 10+), so on a roll of 8 the ring yields Spirit + Lesser but NOT
 * Dwarven (min 9); Magic Ring tops out at 5 rather than 6.
 *
 * Fixture alignment: minion (ringwraith) — uses minion characters and sites.
 *
 * Character fixtures:
 *   - GORBAG (le-11): warrior, ringwraith — standard item bearer
 *   - SHAGRAT (le-39): warrior, ringwraith — opponent dummy
 *
 * Site fixtures:
 *   - EDORAS (le-372):          free-hold, gold-ring playable    ← valid play site
 *   - MORIA (le-392):           shadow-hold, gold-ring playable  ← invalid (not free-hold)
 *   - PELARGIR (le-398):        free-hold, nothing playable      ← invalid (no gold-ring)
 *   - DOL_GULDUR (le-367):      haven, storable                  ← for corruption/storage/test
 *   - ETTENMOORS (le-373):      ruins-and-lairs                  ← for corruption check tests
 *   - MINAS_MORGUL (le-390):    haven                            ← opponent fixture
 *
 * Ring fixture:
 *   - MINOR_RING (le-324): subtype special, keyword lesser-ring — for ring-play-offer
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  attachItemToChar, addCardToHand, addCardToPlayDeck, addCardToDiscardPile,
  charIdAt, dispatch, viableActions, RESOURCE_PLAYER,
  getCharacter,
  expectInDiscardPile,
  enqueueGoldRingTest,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayRingAfterTestAction } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type { SitePhaseState } from '../../types/state-phases.js';

const BRIGHT_GOLD_RING = 'le-303' as CardDefinitionId;
const MINOR_RING = 'le-324' as CardDefinitionId;

const GORBAG = 'le-11' as CardDefinitionId;
const SHAGRAT = 'le-39' as CardDefinitionId;

const EDORAS = 'le-372' as CardDefinitionId;
const MORIA = 'le-392' as CardDefinitionId;
const PELARGIR = 'le-398' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const ETTENMOORS = 'le-373' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

/** Site-phase state fixture for play restriction tests. */
const PLAY_RESOURCES_STATE: SitePhaseState = {
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

describe('Bright Gold Ring (le-303)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +4 corruption points on bearer ─────────────────────────────

  test('bearer gains +4 effective corruption points while ring is held', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [ETTENMOORS] },
      ],
    });

    const gorbagId = charIdAt(base, RESOURCE_PLAYER);
    expect(base.players[0].characters[gorbagId].effectiveStats.corruptionPoints).toBe(0);

    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, GORBAG, BRIGHT_GOLD_RING));
    expect(withRing.players[0].characters[gorbagId].effectiveStats.corruptionPoints).toBe(4);
  });

  // ── Effect 2: Play restriction — free-hold with gold rings only ───────────

  test('offered at Edoras (free-hold with gold-ring playable)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EDORAS, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [SHAGRAT] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
      phase: Phase.Site,
    });
    const withRing = addCardToHand({ ...base, phaseState: PLAY_RESOURCES_STATE }, RESOURCE_PLAYER, BRIGHT_GOLD_RING);

    const plays = viableActions(withRing, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('not offered at Moria (shadow-hold with gold-ring but not free-hold)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [SHAGRAT] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
      phase: Phase.Site,
    });
    const withRing = addCardToHand({ ...base, phaseState: PLAY_RESOURCES_STATE }, RESOURCE_PLAYER, BRIGHT_GOLD_RING);

    const plays = viableActions(withRing, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBe(0);
  });

  test('not offered at Pelargir (free-hold without gold-ring)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: PELARGIR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [SHAGRAT] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
      phase: Phase.Site,
    });
    const withRing = addCardToHand({ ...base, phaseState: PLAY_RESOURCES_STATE }, RESOURCE_PLAYER, BRIGHT_GOLD_RING);

    const plays = viableActions(withRing, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBe(0);
  });

  // ── Effect 3: Forced corruption check at end of each untap phase ──────────

  test('untap → org transition enqueues a corruption check for the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [GORBAG] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, BRIGHT_GOLD_RING);
    const afterUntap = dispatch(withRing, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });

    expect(afterPass.phaseState.phase).toBe(Phase.Organization);

    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.reason).toBe('Bright Gold Ring');

    const gorbagId = charIdAt(afterPass, RESOURCE_PLAYER);
    expect(pending[0].kind.characterId).toBe(gorbagId);
  });

  test('no corruption check when ring is not attached', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [GORBAG] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const afterUntap = dispatch(base, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.pendingResolutions).toHaveLength(0);
  });

  // ── Effect 4+5: Ring test table — roll determines eligible categories ──────

  test('ring-test-table: only lesser-ring eligible on roll 7 (above magic max, below dwarven/spirit min)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [ETTENMOORS] },
      ],
    });

    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, BRIGHT_GOLD_RING);
    const gorbagId = charIdAt(withRing, RESOURCE_PLAYER);
    const ringInstanceId = getCharacter(withRing, RESOURCE_PLAYER, GORBAG).items[0].instanceId;

    const withTest = enqueueGoldRingTest(withRing, PLAYER_1, ringInstanceId, gorbagId);
    const rollActions = viableActions(withTest, PLAYER_1, 'gold-ring-test-roll');
    expect(rollActions.length).toBe(1);

    // Roll 7: above magic-ring max (5) and below spirit-ring min (8) — only lesser-ring
    const afterRoll = dispatch({ ...withTest, cheatRollTotal: 7 }, rollActions[0].action);

    const pending = afterRoll.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('ring-play-offer');
    if (pending[0].kind.type !== 'ring-play-offer') return;
    expect(pending[0].kind.eligibleCategories).toContain('lesser-ring');
    expect(pending[0].kind.eligibleCategories).not.toContain('magic-ring');
    expect(pending[0].kind.eligibleCategories).not.toContain('dwarven-ring');
    expect(pending[0].kind.eligibleCategories).not.toContain('spirit-ring');
  });

  test('ring-test-table: magic-ring eligible on roll 5 but not roll 6', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [ETTENMOORS] },
      ],
    });

    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, BRIGHT_GOLD_RING);
    const gorbagId = charIdAt(withRing, RESOURCE_PLAYER);
    const ringInstanceId = getCharacter(withRing, RESOURCE_PLAYER, GORBAG).items[0].instanceId;

    // Roll 5: magic-ring eligible (max 5)
    const withTest5 = enqueueGoldRingTest(withRing, PLAYER_1, ringInstanceId, gorbagId);
    const roll5 = viableActions(withTest5, PLAYER_1, 'gold-ring-test-roll');
    const after5 = dispatch({ ...withTest5, cheatRollTotal: 5 }, roll5[0].action);
    const p5 = after5.pendingResolutions.filter(r => r.actor === PLAYER_1);
    if (p5[0].kind.type !== 'ring-play-offer') return;
    expect(p5[0].kind.eligibleCategories).toContain('magic-ring');
    expect(p5[0].kind.eligibleCategories).toContain('lesser-ring');

    // Roll 6: magic-ring NOT eligible (max 5), no dwarven (min 9), no spirit (min 8)
    const withTest6 = enqueueGoldRingTest(withRing, PLAYER_1, ringInstanceId, gorbagId);
    const roll6 = viableActions(withTest6, PLAYER_1, 'gold-ring-test-roll');
    const after6 = dispatch({ ...withTest6, cheatRollTotal: 6 }, roll6[0].action);
    const p6 = after6.pendingResolutions.filter(r => r.actor === PLAYER_1);
    if (p6[0].kind.type !== 'ring-play-offer') return;
    expect(p6[0].kind.eligibleCategories).not.toContain('magic-ring');
    expect(p6[0].kind.eligibleCategories).toContain('lesser-ring');
  });

  test('ring-test-table: spirit-ring eligible on roll 8 but dwarven-ring not until roll 9', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [ETTENMOORS] },
      ],
    });

    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, BRIGHT_GOLD_RING);
    const gorbagId = charIdAt(withRing, RESOURCE_PLAYER);
    const ringInstanceId = getCharacter(withRing, RESOURCE_PLAYER, GORBAG).items[0].instanceId;

    // Roll 8: spirit-ring eligible (min 8), dwarven NOT eligible (min 9)
    const withTest8 = enqueueGoldRingTest(withRing, PLAYER_1, ringInstanceId, gorbagId);
    const roll8 = viableActions(withTest8, PLAYER_1, 'gold-ring-test-roll');
    const after8 = dispatch({ ...withTest8, cheatRollTotal: 8 }, roll8[0].action);
    const p8 = after8.pendingResolutions.filter(r => r.actor === PLAYER_1);
    if (p8[0].kind.type !== 'ring-play-offer') return;
    expect(p8[0].kind.eligibleCategories).toContain('spirit-ring');
    expect(p8[0].kind.eligibleCategories).not.toContain('dwarven-ring');
    expect(p8[0].kind.eligibleCategories).toContain('lesser-ring');

    // Roll 9: both spirit-ring and dwarven-ring eligible
    const withTest9 = enqueueGoldRingTest(withRing, PLAYER_1, ringInstanceId, gorbagId);
    const roll9 = viableActions(withTest9, PLAYER_1, 'gold-ring-test-roll');
    const after9 = dispatch({ ...withTest9, cheatRollTotal: 9 }, roll9[0].action);
    const p9 = after9.pendingResolutions.filter(r => r.actor === PLAYER_1);
    if (p9[0].kind.type !== 'ring-play-offer') return;
    expect(p9[0].kind.eligibleCategories).toContain('spirit-ring');
    expect(p9[0].kind.eligibleCategories).toContain('dwarven-ring');
  });

  // ── Effect 4: Ring is discarded when tested ───────────────────────────────

  test('ring is discarded from character when tested', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [ETTENMOORS] },
      ],
    });

    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, BRIGHT_GOLD_RING);
    expect(getCharacter(withRing, RESOURCE_PLAYER, GORBAG).items).toHaveLength(1);

    const gorbagId = charIdAt(withRing, RESOURCE_PLAYER);
    const ringInstanceId = getCharacter(withRing, RESOURCE_PLAYER, GORBAG).items[0].instanceId;

    const withTest = enqueueGoldRingTest(withRing, PLAYER_1, ringInstanceId, gorbagId);
    const rollActions = viableActions(withTest, PLAYER_1, 'gold-ring-test-roll');
    const afterRoll = dispatch({ ...withTest, cheatRollTotal: 4 }, rollActions[0].action);

    expect(getCharacter(afterRoll, RESOURCE_PLAYER, GORBAG).items).toHaveLength(0);
    expectInDiscardPile(afterRoll, RESOURCE_PLAYER, BRIGHT_GOLD_RING);
  });

  // ── Effect 10: ring-test-search — searchCategories set on ring-play-offer ──

  test('ring-play-offer has searchCategories with lesser-ring after the test', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [ETTENMOORS] },
      ],
    });

    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, BRIGHT_GOLD_RING);
    const gorbagId = charIdAt(withRing, RESOURCE_PLAYER);
    const ringInstanceId = getCharacter(withRing, RESOURCE_PLAYER, GORBAG).items[0].instanceId;

    const withTest = enqueueGoldRingTest(withRing, PLAYER_1, ringInstanceId, gorbagId);
    const rollActions = viableActions(withTest, PLAYER_1, 'gold-ring-test-roll');

    // Any roll — lesser-ring is always eligible so searchCategories must include it
    const afterRoll = dispatch({ ...withTest, cheatRollTotal: 4 }, rollActions[0].action);

    const pending = afterRoll.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('ring-play-offer');
    if (pending[0].kind.type !== 'ring-play-offer') return;
    expect(pending[0].kind.searchCategories).toBeDefined();
    expect(pending[0].kind.searchCategories).toContain('lesser-ring');
  });

  // ── Effect 10+11: lesser-ring in play deck is offered / removed ────────────

  test('playing lesser-ring from play deck removes it from the deck and attaches to bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [ETTENMOORS] },
      ],
    });

    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, BRIGHT_GOLD_RING);
    const withRingInDeck = addCardToPlayDeck(withRing, RESOURCE_PLAYER, MINOR_RING);
    const deckSizeBefore = withRingInDeck.players[RESOURCE_PLAYER].playDeck.length;

    const gorbagId = charIdAt(withRingInDeck, RESOURCE_PLAYER);
    const ringInstanceId = getCharacter(withRingInDeck, RESOURCE_PLAYER, GORBAG).items[0].instanceId;

    const withTest = enqueueGoldRingTest(withRingInDeck, PLAYER_1, ringInstanceId, gorbagId);
    const rollActions = viableActions(withTest, PLAYER_1, 'gold-ring-test-roll');
    const afterRoll = dispatch({ ...withTest, cheatRollTotal: 4 }, rollActions[0].action);

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    const deckOffer = playActions.find(a => (a.action as PlayRingAfterTestAction).source === 'play-deck');
    expect(deckOffer).toBeDefined();

    const afterPlay = dispatch(afterRoll, deckOffer!.action);
    expect(afterPlay.players[RESOURCE_PLAYER].playDeck.length).toBe(deckSizeBefore - 1);
    expect(getCharacter(afterPlay, RESOURCE_PLAYER, GORBAG).items).toHaveLength(1);
  });

  // ── Effect 12: lesser-ring in discard pile is offered / removed ────────────

  test('playing lesser-ring from discard pile removes it from discard and attaches to bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [ETTENMOORS] },
      ],
    });

    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, BRIGHT_GOLD_RING);
    const withRingInDiscard = addCardToDiscardPile(withRing, RESOURCE_PLAYER, MINOR_RING);

    const gorbagId = charIdAt(withRingInDiscard, RESOURCE_PLAYER);
    const ringInstanceId = getCharacter(withRingInDiscard, RESOURCE_PLAYER, GORBAG).items[0].instanceId;

    const withTest = enqueueGoldRingTest(withRingInDiscard, PLAYER_1, ringInstanceId, gorbagId);
    const rollActions = viableActions(withTest, PLAYER_1, 'gold-ring-test-roll');
    const afterRoll = dispatch({ ...withTest, cheatRollTotal: 4 }, rollActions[0].action);

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    const discardOffer = playActions.find(a => (a.action as PlayRingAfterTestAction).source === 'discard-pile');
    expect(discardOffer).toBeDefined();

    const afterPlay = dispatch(afterRoll, discardOffer!.action);
    const minorRingInDiscard = afterPlay.players[RESOURCE_PLAYER].discardPile.some(
      c => c.definitionId === MINOR_RING,
    );
    expect(minorRingInDiscard).toBe(false);
    expect(getCharacter(afterPlay, RESOURCE_PLAYER, GORBAG).items).toHaveLength(1);
  });

  test('player can pass the ring-play-offer without playing a searched ring', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [ETTENMOORS] },
      ],
    });

    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, BRIGHT_GOLD_RING);
    const withRingInDeck = addCardToPlayDeck(withRing, RESOURCE_PLAYER, MINOR_RING);
    const deckSizeBefore = withRingInDeck.players[RESOURCE_PLAYER].playDeck.length;

    const gorbagId = charIdAt(withRingInDeck, RESOURCE_PLAYER);
    const ringInstanceId = getCharacter(withRingInDeck, RESOURCE_PLAYER, GORBAG).items[0].instanceId;

    const withTest = enqueueGoldRingTest(withRingInDeck, PLAYER_1, ringInstanceId, gorbagId);
    const rollActions = viableActions(withTest, PLAYER_1, 'gold-ring-test-roll');
    const afterRoll = dispatch({ ...withTest, cheatRollTotal: 4 }, rollActions[0].action);

    const passes = viableActions(afterRoll, PLAYER_1, 'pass');
    expect(passes.length).toBeGreaterThanOrEqual(1);

    const afterPass = dispatch(afterRoll, passes[0].action);
    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending.length).toBe(0);
    expect(afterPass.players[RESOURCE_PLAYER].playDeck.length).toBe(deckSizeBefore);
  });

  // ── ring-test-search applies only to lesser-ring category ────────────────

  test('ring-test-search does not offer non-lesser-ring cards from deck/discard', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [ETTENMOORS] },
      ],
    });

    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, BRIGHT_GOLD_RING);
    // Put a non-lesser-ring gold ring in the deck — must not be offered via search
    const withGoldRingInDeck = addCardToPlayDeck(withRing, RESOURCE_PLAYER, BRIGHT_GOLD_RING);

    const gorbagId = charIdAt(withGoldRingInDeck, RESOURCE_PLAYER);
    const ringInstanceId = getCharacter(withGoldRingInDeck, RESOURCE_PLAYER, GORBAG).items[0].instanceId;

    const withTest = enqueueGoldRingTest(withGoldRingInDeck, PLAYER_1, ringInstanceId, gorbagId);
    const rollActions = viableActions(withTest, PLAYER_1, 'gold-ring-test-roll');
    const afterRoll = dispatch({ ...withTest, cheatRollTotal: 4 }, rollActions[0].action);

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    const searchOffers = playActions.filter(a => {
      const act = a.action as PlayRingAfterTestAction;
      return act.source === 'play-deck' || act.source === 'discard-pile';
    });
    expect(searchOffers.length).toBe(0);
  });

  // ── Effect 13: Storable at minion dark-havens ─────────────────────────────

  test('ring is storable at Dol Guldur during organization phase', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [ETTENMOORS] },
      ],
    });

    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, BRIGHT_GOLD_RING);
    const storeActions = viableActions(withRing, PLAYER_1, 'store-item');
    expect(storeActions.length).toBeGreaterThanOrEqual(1);
  });

  test('ring is NOT storable at Ettenmoors (a non-storable site)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [GORBAG] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, BRIGHT_GOLD_RING);
    const storeActions = viableActions(withRing, PLAYER_1, 'store-item');
    expect(storeActions.length).toBe(0);
  });
});
