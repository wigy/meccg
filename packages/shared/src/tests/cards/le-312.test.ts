/**
 * @module le-312.test
 *
 * Card test: Gold Ring that Sauron Fancies (le-312)
 * Type: minion-resource-item (subtype: gold-ring, alignment: ringwraith)
 * Corruption: 4, Marshalling Points: 2, non-unique
 *
 * "May only be played at Bag End or a Ruins & Lairs [{R}] where gold rings are
 *  playable. Bearer must make a corruption check at the end of each of his untap
 *  phases. Discard this ring when tested. If tested, obtain a random value to
 *  determine which ring card may be immediately played: The One Ring (11,12+);
 *  a Dwarven Ring (8,9,10,11,12+); a Magic Ring (1,2,3,4,5); a Lesser Ring
 *  (any result)."
 *
 * Engine support:
 * | # | Rule                                                        | Status      | Notes                                                       |
 * |---|-------------------------------------------------------------|-------------|-------------------------------------------------------------|
 * | 1 | +4 corruption points on bearer                              | IMPLEMENTED | itemDef.corruptionPoints summed                             |
 * | 2 | Playable at Bag End (named) OR a R&L with gold rings         | IMPLEMENTED | item-play-site: `sites` (name) OR `filter` (siteType+res)   |
 * | 3 | Forced corruption check at end of each untap phase          | IMPLEMENTED | on-event untap-phase-end → force-check corruption            |
 * | 4 | Discard when tested                                         | IMPLEMENTED | gold-ring-test resolution discards ring                     |
 * | 5 | Roll determines eligible ring categories                    | IMPLEMENTED | ring-test-table effect, eligibleRingCategories              |
 * | 6 | The One Ring eligible on 11+                                 | IMPLEMENTED | ring-test-table row min:11                                  |
 * | 7 | Dwarven Ring eligible on 8+                                  | IMPLEMENTED | ring-test-table row min:8                                   |
 * | 8 | Magic Ring eligible on 1–5                                   | IMPLEMENTED | ring-test-table row min:1 max:5                             |
 * | 9 | Lesser Ring always eligible                                  | IMPLEMENTED | ring-test-table row min:null max:null                       |
 * |10 | No deck/discard search clause                               | IMPLEMENTED | no ring-test-search — ring-play-offer has no searchCategories|
 * |11 | Storable at the minion dark-havens                          | IMPLEMENTED | storable-at effect                                          |
 *
 * The `item-play-site` effect is the first to combine both `sites` (name match)
 * and `filter` (site-type/resource match), reflecting the "at Bag End OR a R&L"
 * disjunction; the engine ORs the two (`matchesSiteList || matchesFilter`).
 *
 * Fixture alignment: minion (ringwraith) — uses minion characters and sites.
 *
 * Character fixtures:
 *   - GORBAG (le-11):  warrior, ringwraith — standard item bearer
 *   - SHAGRAT (le-39): warrior, ringwraith — opponent dummy
 *
 * Site fixtures:
 *   - BANDIT_LAIR (le-351): ruins-and-lairs, gold-ring playable  ← valid play site (filter)
 *   - BAG_END (le-350):     free-hold, named "Bag End"           ← valid play site (name)
 *   - ETTENMOORS (le-373):  ruins-and-lairs, NO gold-ring        ← invalid (R&L without gold-ring)
 *   - DALE (le-363):        border-hold, gold-ring playable      ← invalid (gold-ring but not R&L / Bag End)
 *   - DOL_GULDUR (le-367):  dark-haven                           ← corruption / storage / test fixture
 *   - MINAS_MORGUL (le-390):haven                                ← opponent fixture
 *
 * Ring fixtures (special rings, keyword-categorized):
 *   - THE_ONE_RING (tw-347):  keyword the-one-ring
 *   - DWARVEN_RING (as-123):  keyword dwarven-ring
 *   - MAGIC_RING (tw-274):    keyword magic-ring
 *   - MINOR_RING (le-324):    keyword lesser-ring
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  attachItemToChar, addCardToHand, addCardToPlayDeck,
  charIdAt, dispatch, viableActions, RESOURCE_PLAYER,
  getCharacter,
  expectInDiscardPile,
  enqueueGoldRingTest,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayRingAfterTestAction } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type { SitePhaseState } from '../../types/state-phases.js';

const GOLD_RING_SAURON = 'le-312' as CardDefinitionId;
const THE_ONE_RING = 'tw-347' as CardDefinitionId;
const DWARVEN_RING = 'as-123' as CardDefinitionId;
const MAGIC_RING = 'tw-274' as CardDefinitionId;
const MINOR_RING = 'le-324' as CardDefinitionId;

const GORBAG = 'le-11' as CardDefinitionId;
const SHAGRAT = 'le-39' as CardDefinitionId;

const BANDIT_LAIR = 'le-351' as CardDefinitionId;
const BAG_END = 'le-350' as CardDefinitionId;
const ETTENMOORS = 'le-373' as CardDefinitionId;
const DALE = 'le-363' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
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

/** Enqueue a gold-ring test on Gorbag bearing the Sauron gold ring, return [state, gorbagId]. */
function withTestOnGorbag(
  build: Parameters<typeof buildTestState>[0],
): ReturnType<typeof enqueueGoldRingTest> {
  const base = buildTestState(build);
  const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, GOLD_RING_SAURON);
  const gorbagId = charIdAt(withRing, RESOURCE_PLAYER);
  const ringInstanceId = getCharacter(withRing, RESOURCE_PLAYER, GORBAG).items[0].instanceId;
  return enqueueGoldRingTest(withRing, PLAYER_1, ringInstanceId, gorbagId);
}

/** Standard two-player build with Gorbag at `site` and Shagrat at Minas Morgul. */
function buildAt(site: CardDefinitionId): Parameters<typeof buildTestState>[0] {
  return {
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
      { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [ETTENMOORS] },
    ],
  };
}

describe('Gold Ring that Sauron Fancies (le-312)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +4 corruption points on bearer ─────────────────────────────

  test('bearer gains +4 effective corruption points while ring is held', () => {
    const base = buildTestState(buildAt(DOL_GULDUR));
    const gorbagId = charIdAt(base, RESOURCE_PLAYER);
    expect(base.players[0].characters[gorbagId].effectiveStats.corruptionPoints).toBe(0);

    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, GORBAG, GOLD_RING_SAURON));
    expect(withRing.players[0].characters[gorbagId].effectiveStats.corruptionPoints).toBe(4);
  });

  // ── Effect 2: Play restriction — Bag End OR a R&L with gold rings ─────────

  test('offered at Bandit Lair (Ruins & Lairs with gold-ring playable)', () => {
    const base = buildTestState({ ...buildAt(BANDIT_LAIR), phase: Phase.Site });
    const withRing = addCardToHand({ ...base, phaseState: PLAY_RESOURCES_STATE }, RESOURCE_PLAYER, GOLD_RING_SAURON);
    const plays = viableActions(withRing, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('offered at Bag End (named site) even though it is a Free-hold, not a R&L', () => {
    const base = buildTestState({ ...buildAt(BAG_END), phase: Phase.Site });
    const withRing = addCardToHand({ ...base, phaseState: PLAY_RESOURCES_STATE }, RESOURCE_PLAYER, GOLD_RING_SAURON);
    const plays = viableActions(withRing, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT offered at Ettenmoors (Ruins & Lairs but gold rings not playable)', () => {
    const base = buildTestState({ ...buildAt(ETTENMOORS), phase: Phase.Site, players: [
      { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [GORBAG] }], hand: [], siteDeck: [DOL_GULDUR] },
      { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [DOL_GULDUR] },
    ] });
    const withRing = addCardToHand({ ...base, phaseState: PLAY_RESOURCES_STATE }, RESOURCE_PLAYER, GOLD_RING_SAURON);
    const plays = viableActions(withRing, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBe(0);
  });

  test('NOT offered at Dale (gold rings playable but a Border-hold, not R&L or Bag End)', () => {
    const base = buildTestState({ ...buildAt(DALE), phase: Phase.Site });
    const withRing = addCardToHand({ ...base, phaseState: PLAY_RESOURCES_STATE }, RESOURCE_PLAYER, GOLD_RING_SAURON);
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
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [GORBAG] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, GOLD_RING_SAURON);
    const afterUntap = dispatch(withRing, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });

    expect(afterPass.phaseState.phase).toBe(Phase.Organization);

    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.reason).toBe('Gold Ring that Sauron Fancies');

    const gorbagId = charIdAt(afterPass, RESOURCE_PLAYER);
    expect(pending[0].kind.characterId).toBe(gorbagId);
  });

  test('no corruption check when the ring is not attached', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [GORBAG] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const afterUntap = dispatch(base, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.pendingResolutions).toHaveLength(0);
  });

  // ── Effects 5–9: Ring-test table boundaries ──────────────────────────────

  test('roll 5: magic-ring and lesser-ring eligible; dwarven/the-one-ring NOT', () => {
    const withTest = withTestOnGorbag(buildAt(DOL_GULDUR));
    const rollActions = viableActions(withTest, PLAYER_1, 'gold-ring-test-roll');
    expect(rollActions.length).toBe(1);

    const afterRoll = dispatch({ ...withTest, cheatRollTotal: 5 }, rollActions[0].action);
    const pending = afterRoll.pendingResolutions.filter(r => r.actor === PLAYER_1);
    if (pending[0].kind.type !== 'ring-play-offer') throw new Error('expected ring-play-offer');
    expect(pending[0].kind.eligibleCategories).toContain('magic-ring');
    expect(pending[0].kind.eligibleCategories).toContain('lesser-ring');
    expect(pending[0].kind.eligibleCategories).not.toContain('dwarven-ring');
    expect(pending[0].kind.eligibleCategories).not.toContain('the-one-ring');
  });

  test('roll 6: magic-ring NOT eligible (max 5); only lesser-ring (below dwarven min 8)', () => {
    const withTest = withTestOnGorbag(buildAt(DOL_GULDUR));
    const rollActions = viableActions(withTest, PLAYER_1, 'gold-ring-test-roll');

    const afterRoll = dispatch({ ...withTest, cheatRollTotal: 6 }, rollActions[0].action);
    const pending = afterRoll.pendingResolutions.filter(r => r.actor === PLAYER_1);
    if (pending[0].kind.type !== 'ring-play-offer') throw new Error('expected ring-play-offer');
    expect(pending[0].kind.eligibleCategories).toContain('lesser-ring');
    expect(pending[0].kind.eligibleCategories).not.toContain('magic-ring');
    expect(pending[0].kind.eligibleCategories).not.toContain('dwarven-ring');
    expect(pending[0].kind.eligibleCategories).not.toContain('the-one-ring');
  });

  test('roll 8: dwarven-ring eligible; the-one-ring and magic-ring NOT', () => {
    const withTest = withTestOnGorbag(buildAt(DOL_GULDUR));
    const rollActions = viableActions(withTest, PLAYER_1, 'gold-ring-test-roll');

    const afterRoll = dispatch({ ...withTest, cheatRollTotal: 8 }, rollActions[0].action);
    const pending = afterRoll.pendingResolutions.filter(r => r.actor === PLAYER_1);
    if (pending[0].kind.type !== 'ring-play-offer') throw new Error('expected ring-play-offer');
    expect(pending[0].kind.eligibleCategories).toContain('dwarven-ring');
    expect(pending[0].kind.eligibleCategories).toContain('lesser-ring');
    expect(pending[0].kind.eligibleCategories).not.toContain('the-one-ring');
    expect(pending[0].kind.eligibleCategories).not.toContain('magic-ring');
  });

  test('roll 10: dwarven-ring eligible but the-one-ring NOT (min 11)', () => {
    const withTest = withTestOnGorbag(buildAt(DOL_GULDUR));
    const rollActions = viableActions(withTest, PLAYER_1, 'gold-ring-test-roll');

    const afterRoll = dispatch({ ...withTest, cheatRollTotal: 10 }, rollActions[0].action);
    const pending = afterRoll.pendingResolutions.filter(r => r.actor === PLAYER_1);
    if (pending[0].kind.type !== 'ring-play-offer') throw new Error('expected ring-play-offer');
    expect(pending[0].kind.eligibleCategories).toContain('dwarven-ring');
    expect(pending[0].kind.eligibleCategories).not.toContain('the-one-ring');
  });

  test('roll 11: the-one-ring, dwarven-ring, and lesser-ring all eligible', () => {
    const withTest = withTestOnGorbag(buildAt(DOL_GULDUR));
    const rollActions = viableActions(withTest, PLAYER_1, 'gold-ring-test-roll');

    const afterRoll = dispatch({ ...withTest, cheatRollTotal: 11 }, rollActions[0].action);
    const pending = afterRoll.pendingResolutions.filter(r => r.actor === PLAYER_1);
    if (pending[0].kind.type !== 'ring-play-offer') throw new Error('expected ring-play-offer');
    expect(pending[0].kind.eligibleCategories).toContain('the-one-ring');
    expect(pending[0].kind.eligibleCategories).toContain('dwarven-ring');
    expect(pending[0].kind.eligibleCategories).toContain('lesser-ring');
    expect(pending[0].kind.eligibleCategories).not.toContain('magic-ring');
  });

  // ── Eligible rings in hand are actually offered as play-ring-after-test ───

  test('The One Ring in hand is offered after a roll of 11', () => {
    const base = buildTestState(buildAt(DOL_GULDUR));
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, GOLD_RING_SAURON);
    const withOneRing = addCardToHand(withRing, RESOURCE_PLAYER, THE_ONE_RING);
    const gorbagId = charIdAt(withOneRing, RESOURCE_PLAYER);
    const ringInstanceId = getCharacter(withOneRing, RESOURCE_PLAYER, GORBAG).items[0].instanceId;

    const withTest = enqueueGoldRingTest(withOneRing, PLAYER_1, ringInstanceId, gorbagId);
    const rollActions = viableActions(withTest, PLAYER_1, 'gold-ring-test-roll');
    const afterRoll = dispatch({ ...withTest, cheatRollTotal: 11 }, rollActions[0].action);

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('The One Ring in hand is NOT offered after a roll of 10 (below its min)', () => {
    const base = buildTestState(buildAt(DOL_GULDUR));
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, GOLD_RING_SAURON);
    const withOneRing = addCardToHand(withRing, RESOURCE_PLAYER, THE_ONE_RING);
    const gorbagId = charIdAt(withOneRing, RESOURCE_PLAYER);
    const ringInstanceId = getCharacter(withOneRing, RESOURCE_PLAYER, GORBAG).items[0].instanceId;

    const withTest = enqueueGoldRingTest(withOneRing, PLAYER_1, ringInstanceId, gorbagId);
    const rollActions = viableActions(withTest, PLAYER_1, 'gold-ring-test-roll');
    const afterRoll = dispatch({ ...withTest, cheatRollTotal: 10 }, rollActions[0].action);

    // The One Ring is the only ring in hand and it is not eligible at 10.
    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    expect(playActions.length).toBe(0);
  });

  test('a Dwarven Ring in hand is offered on 8, a Magic Ring is not (magic max 5)', () => {
    const base = buildTestState(buildAt(DOL_GULDUR));
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, GOLD_RING_SAURON);
    const withDwarven = addCardToHand(withRing, RESOURCE_PLAYER, DWARVEN_RING);
    const withBoth = addCardToHand(withDwarven, RESOURCE_PLAYER, MAGIC_RING);
    const gorbagId = charIdAt(withBoth, RESOURCE_PLAYER);
    const ringInstanceId = getCharacter(withBoth, RESOURCE_PLAYER, GORBAG).items[0].instanceId;

    const withTest = enqueueGoldRingTest(withBoth, PLAYER_1, ringInstanceId, gorbagId);
    const rollActions = viableActions(withTest, PLAYER_1, 'gold-ring-test-roll');
    const afterRoll = dispatch({ ...withTest, cheatRollTotal: 8 }, rollActions[0].action);

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    // Exactly the Dwarven Ring is offered; the Magic Ring is not eligible at 8.
    const dwarvenInstance = withBoth.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === DWARVEN_RING);
    const magicInstance = withBoth.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === MAGIC_RING);
    const offeredIds = playActions.map(a => (a.action as PlayRingAfterTestAction).ringInstanceId);
    expect(offeredIds).toContain(dwarvenInstance!.instanceId);
    expect(offeredIds).not.toContain(magicInstance!.instanceId);
  });

  test('playing an eligible ring from hand attaches it to the bearer', () => {
    const base = buildTestState(buildAt(DOL_GULDUR));
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, GOLD_RING_SAURON);
    const withMinor = addCardToHand(withRing, RESOURCE_PLAYER, MINOR_RING);
    const gorbagId = charIdAt(withMinor, RESOURCE_PLAYER);
    const ringInstanceId = getCharacter(withMinor, RESOURCE_PLAYER, GORBAG).items[0].instanceId;

    const withTest = enqueueGoldRingTest(withMinor, PLAYER_1, ringInstanceId, gorbagId);
    const rollActions = viableActions(withTest, PLAYER_1, 'gold-ring-test-roll');
    // Roll 5: the Sauron gold ring is discarded (bearer keeps no gold ring),
    // and the lesser-ring is eligible.
    const afterRoll = dispatch({ ...withTest, cheatRollTotal: 5 }, rollActions[0].action);

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    expect(playActions.length).toBeGreaterThanOrEqual(1);

    const afterPlay = dispatch(afterRoll, playActions[0].action);
    // Minor Ring left the hand and is now the bearer's sole item.
    expect(afterPlay.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === MINOR_RING)).toBe(false);
    const items = getCharacter(afterPlay, RESOURCE_PLAYER, GORBAG).items;
    expect(items).toHaveLength(1);
    expect(items[0].definitionId).toBe(MINOR_RING);
  });

  // ── Effect 4: ring is discarded when tested ──────────────────────────────

  test('the Sauron gold ring is discarded from the bearer when tested', () => {
    const withTest = withTestOnGorbag(buildAt(DOL_GULDUR));
    expect(getCharacter(withTest, RESOURCE_PLAYER, GORBAG).items).toHaveLength(1);

    const rollActions = viableActions(withTest, PLAYER_1, 'gold-ring-test-roll');
    const afterRoll = dispatch({ ...withTest, cheatRollTotal: 7 }, rollActions[0].action);

    expect(getCharacter(afterRoll, RESOURCE_PLAYER, GORBAG).items).toHaveLength(0);
    expectInDiscardPile(afterRoll, RESOURCE_PLAYER, GOLD_RING_SAURON);
  });

  // ── Effect 10: no search clause — ring-play-offer carries no searchCategories ─

  test('ring-play-offer exposes no searchCategories (no deck/discard search clause)', () => {
    const withTest = withTestOnGorbag(buildAt(DOL_GULDUR));
    const rollActions = viableActions(withTest, PLAYER_1, 'gold-ring-test-roll');
    const afterRoll = dispatch({ ...withTest, cheatRollTotal: 7 }, rollActions[0].action);

    const pending = afterRoll.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('ring-play-offer');
    if (pending[0].kind.type !== 'ring-play-offer') return;
    expect(pending[0].kind.searchCategories).toBeUndefined();
  });

  test('an eligible lesser-ring sitting in the play deck is NOT offered (no search)', () => {
    const base = buildTestState(buildAt(DOL_GULDUR));
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, GOLD_RING_SAURON);
    // Put a lesser-ring in the deck, none in hand.
    const withRingInDeck = addCardToPlayDeck(withRing, RESOURCE_PLAYER, MINOR_RING);
    const gorbagId = charIdAt(withRingInDeck, RESOURCE_PLAYER);
    const ringInstanceId = getCharacter(withRingInDeck, RESOURCE_PLAYER, GORBAG).items[0].instanceId;

    const withTest = enqueueGoldRingTest(withRingInDeck, PLAYER_1, ringInstanceId, gorbagId);
    const rollActions = viableActions(withTest, PLAYER_1, 'gold-ring-test-roll');
    const afterRoll = dispatch({ ...withTest, cheatRollTotal: 5 }, rollActions[0].action);

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    // No search clause on this ring — nothing from deck/discard may be played.
    expect(playActions.length).toBe(0);
  });

  // ── Effect 11: storable at the minion dark-havens ────────────────────────

  test('ring is storable at Dol Guldur during organization phase', () => {
    const withRing = attachItemToChar(buildTestState(buildAt(DOL_GULDUR)), RESOURCE_PLAYER, GORBAG, GOLD_RING_SAURON);
    const storeActions = viableActions(withRing, PLAYER_1, 'store-item');
    expect(storeActions.length).toBeGreaterThanOrEqual(1);
  });

  test('ring is NOT storable at Ettenmoors (a non-haven site)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [GORBAG] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, GOLD_RING_SAURON);
    const storeActions = viableActions(withRing, PLAYER_1, 'store-item');
    expect(storeActions.length).toBe(0);
  });
});
