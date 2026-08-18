/**
 * @module projection.test
 *
 * Regression tests for {@link projectPlayerView} — the redaction boundary that
 * turns the omniscient server state into a per-player view.
 */

import { describe, test, expect } from 'vitest';
import {
  createGame, reduce, loadCardPool, Alignment, UNKNOWN_SITE, UNKNOWN_CARD, CardStatus, PALLANDO, THE_GREAT_HUNT,
} from '@meccg/shared';
import type {
  GameState, GameConfig, GameAction, PlayerId, CardDefinitionId, CardInstanceId, ViewCard,
} from '@meccg/shared';
import { projectPlayerView, projectSpectatorView } from './projection.js';

const ALICE = 'p1' as PlayerId;
const BOB = 'p2' as PlayerId;
const HIDDEN_HAVEN = 'wh-75' as CardDefinitionId;
const BALIN = 'tw-123' as CardDefinitionId;
const ARAGORN = 'tw-120' as CardDefinitionId;
const WORTHY_HILLS = 'as-142' as CardDefinitionId; // non-lair Ruins & Lairs in a wilderness region
const RIVENDELL = 'tw-258' as CardDefinitionId;
const GLAMDRING = 'tw-244' as CardDefinitionId; // hero-resource-item

const pool = loadCardPool();

/** Apply actions in sequence, throwing on the first rejected one. */
function run(state: GameState, actions: readonly GameAction[]): GameState {
  for (const action of actions) {
    const result = reduce(state, action);
    if (result.error) throw new Error(`Action ${action.type} failed: ${result.error}`);
    state = result.state;
  }
  return state;
}

/** Instance id of a freshly-minted draft-pool card for player `idx`. */
function draftInst(state: GameState, idx: number, defId: CardDefinitionId): CardInstanceId {
  const step = state.phaseState;
  if (step.phase !== 'setup' || step.setupStep.step !== 'character-draft') throw new Error('not in draft');
  const card = step.setupStep.draftState[idx].pool.find(c => c.definitionId === defId);
  if (!card) throw new Error(`draft card ${defId} not found for player ${idx}`);
  return card.instanceId;
}

/** Instance id of a card in player `idx`'s site deck. */
function siteInst(state: GameState, idx: number, defId: CardDefinitionId): CardInstanceId {
  const card = state.players[idx].siteDeck.find(c => c.definitionId === defId);
  if (!card) throw new Error(`site ${defId} not found for player ${idx}`);
  return card.instanceId;
}

/** Build a game paused mid-character-draft with Alice's Hidden Haven paired to Worthy Hills. */
function pairedHiddenHavenGame(): { state: GameState; hh: CardInstanceId; site: CardInstanceId } {
  const config: GameConfig = {
    players: [
      { id: ALICE, name: 'Alice', alignment: Alignment.FallenWizard,
        draftPool: [HIDDEN_HAVEN, BALIN], playDeck: [], siteDeck: [WORTHY_HILLS], sideboard: [] },
      // Bob keeps an extra pool card so his own draft pool stays non-empty after
      // his pick — otherwise the client's findSelfIndex (real-cards heuristic)
      // can't tell which side is his.
      { id: BOB, name: 'Bob', alignment: Alignment.Wizard,
        draftPool: [ARAGORN, BALIN], playDeck: [], siteDeck: [RIVENDELL], sideboard: [] },
    ],
    seed: 42,
  };
  let state = createGame(config, pool);
  const hh = draftInst(state, 0, HIDDEN_HAVEN);
  state = run(state, [
    { type: 'draft-pick', player: ALICE, characterInstanceId: hh },
    { type: 'draft-pick', player: BOB, characterInstanceId: draftInst(state, 1, ARAGORN) },
  ]);
  const site = siteInst(state, 0, WORTHY_HILLS);
  state = run(state, [{ type: 'select-stage-resource-site', player: ALICE, stageResourceInstanceId: hh, siteInstanceId: site }]);
  return { state, hh, site };
}

/** Find a site card by instance id in a projected (possibly redacted) site deck. */
function findSite(deck: readonly ViewCard[], id: CardInstanceId): ViewCard | undefined {
  return deck.find(c => c.instanceId === id);
}

describe('Hidden Haven draft reveal (CRF 22: site is brought out when revealed)', () => {
  test('the opponent sees the paired site identity in their view of the drafter site deck', () => {
    const { state, site } = pairedHiddenHavenGame();
    const bobView = projectPlayerView(state, BOB);
    // Alice (the drafter) is Bob's opponent. Her paired site must be revealed.
    const revealed = findSite(bobView.opponent.siteDeck, site);
    expect(revealed?.definitionId).toBe(WORTHY_HILLS);
  });

  test('the rest of the drafter site deck stays hidden to the opponent', () => {
    // Add an un-paired second site to Alice's deck; it must remain UNKNOWN_SITE.
    const config: GameConfig = {
      players: [
        { id: ALICE, name: 'Alice', alignment: Alignment.FallenWizard,
          draftPool: [HIDDEN_HAVEN, BALIN], playDeck: [], siteDeck: [WORTHY_HILLS, RIVENDELL], sideboard: [] },
        { id: BOB, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [ARAGORN, BALIN], playDeck: [], siteDeck: [RIVENDELL], sideboard: [] },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);
    const hh = draftInst(state, 0, HIDDEN_HAVEN);
    state = run(state, [
      { type: 'draft-pick', player: ALICE, characterInstanceId: hh },
      { type: 'draft-pick', player: BOB, characterInstanceId: draftInst(state, 1, ARAGORN) },
    ]);
    const paired = siteInst(state, 0, WORTHY_HILLS);
    const other = siteInst(state, 0, RIVENDELL);
    state = run(state, [{ type: 'select-stage-resource-site', player: ALICE, stageResourceInstanceId: hh, siteInstanceId: paired }]);

    const bobView = projectPlayerView(state, BOB);
    expect(findSite(bobView.opponent.siteDeck, paired)?.definitionId).toBe(WORTHY_HILLS);
    expect(findSite(bobView.opponent.siteDeck, other)?.definitionId).toBe(UNKNOWN_SITE);
  });

  test('the drafter still sees their own paired site (unchanged)', () => {
    const { state, site } = pairedHiddenHavenGame();
    const aliceView = projectPlayerView(state, ALICE);
    expect(findSite(aliceView.self.siteDeck, site)?.definitionId).toBe(WORTHY_HILLS);
  });

  test('spectators see the brought-out site for the drafter', () => {
    const { state, site } = pairedHiddenHavenGame();
    const spec = projectSpectatorView(state);
    // Alice is players[0], projected as the spectator "self".
    expect(findSite(spec.self.siteDeck, site)?.definitionId).toBe(WORTHY_HILLS);
  });

  test('before any pairing, no site is revealed to the opponent', () => {
    const config: GameConfig = {
      players: [
        { id: ALICE, name: 'Alice', alignment: Alignment.FallenWizard,
          draftPool: [HIDDEN_HAVEN, BALIN], playDeck: [], siteDeck: [WORTHY_HILLS], sideboard: [] },
        { id: BOB, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [ARAGORN, BALIN], playDeck: [], siteDeck: [RIVENDELL], sideboard: [] },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);
    const hh = draftInst(state, 0, HIDDEN_HAVEN);
    state = run(state, [{ type: 'draft-pick', player: ALICE, characterInstanceId: hh }]);
    const site = siteInst(state, 0, WORTHY_HILLS);
    const bobView = projectPlayerView(state, BOB);
    expect(findSite(bobView.opponent.siteDeck, site)?.definitionId).toBe(UNKNOWN_SITE);
  });
});

/**
 * A bare two-player game whose player 0 (Alice) holds a two-card hand: one card
 * recorded in `revealedInstances` (as a reveal effect such as Rolled down to
 * the Sea, wh-29, would leave it) and one that is not. The reveal itself is not
 * under test here — the projection's honouring of `revealedInstances` is.
 */
function gameWithPartlyRevealedAliceHand(): {
  state: GameState;
  known: CardInstanceId;
  secret: CardInstanceId;
} {
  const config: GameConfig = {
    players: [
      { id: ALICE, name: 'Alice', alignment: Alignment.Wizard,
        draftPool: [ARAGORN], playDeck: [], siteDeck: [RIVENDELL], sideboard: [] },
      { id: BOB, name: 'Bob', alignment: Alignment.Wizard,
        draftPool: [BALIN], playDeck: [], siteDeck: [RIVENDELL], sideboard: [] },
    ],
    seed: 42,
  };
  const base = createGame(config, pool);
  const known = 'p1-hand-known' as CardInstanceId;
  const secret = 'p1-hand-secret' as CardInstanceId;
  const state: GameState = {
    ...base,
    players: [
      { ...base.players[0], hand: [
        { instanceId: known, definitionId: ARAGORN },
        { instanceId: secret, definitionId: BALIN },
      ] },
      base.players[1],
    ],
    revealedInstances: { ...base.revealedInstances, [known]: ARAGORN },
    handRevealedInstances: { ...base.handRevealedInstances, [known]: ARAGORN },
  };
  return { state, known, secret };
}

describe('Revealed opponent hand cards (wh-29 Rolled down to the Sea)', () => {
  test('a hand card recorded as revealed is visible to the opponent; the rest stay hidden', () => {
    const { state, known, secret } = gameWithPartlyRevealedAliceHand();
    const bobView = projectPlayerView(state, BOB);
    const handById = (id: CardInstanceId): ViewCard | undefined =>
      bobView.opponent.hand.find(c => c.instanceId === id);
    expect(handById(known)?.definitionId).toBe(ARAGORN);
    expect(handById(secret)?.definitionId).toBe(UNKNOWN_CARD);
  });

  test("the drafter still sees their own full hand (unchanged)", () => {
    const { state, known, secret } = gameWithPartlyRevealedAliceHand();
    const aliceView = projectPlayerView(state, ALICE);
    const handById = (id: CardInstanceId): ViewCard | undefined =>
      aliceView.self.hand.find(c => c.instanceId === id);
    expect(handById(known)?.definitionId).toBe(ARAGORN);
    expect(handById(secret)?.definitionId).toBe(BALIN);
  });
});

/**
 * Regression for bug d28b5032a916311d (game msefhs53-znd4eu, seq 364):
 * Ill-favoured Fellow (wh-5) was played into a company — a public zone, so
 * `accrueRevealedInstances` recorded its identity in `revealedInstances` — and
 * later returned to Alice's hand by a CoE 2.II.8 general-influence-overflow
 * discard. Because `revealedInstances` is append-only, the stale entry
 * persisted, and `buildOpponentView` reused that same map for hand redaction,
 * so Bob's view kept showing the real card instead of `UNKNOWN_CARD` even
 * though the character was back in Alice's private hand. Unlike a genuine
 * hand-reveal effect, this instance was never explicitly revealed while
 * sitting in the hand, so it must not appear in `handRevealedInstances`.
 */
function gameWithCharacterReturnedToHandAfterOverflow(): {
  state: GameState;
  returned: CardInstanceId;
} {
  const config: GameConfig = {
    players: [
      { id: ALICE, name: 'Alice', alignment: Alignment.Wizard,
        draftPool: [ARAGORN], playDeck: [], siteDeck: [RIVENDELL], sideboard: [] },
      { id: BOB, name: 'Bob', alignment: Alignment.Wizard,
        draftPool: [BALIN], playDeck: [], siteDeck: [RIVENDELL], sideboard: [] },
    ],
    seed: 42,
  };
  const base = createGame(config, pool);
  const returned = 'p1-overflow-returned' as CardInstanceId;
  // Simulate the pre-overflow state: the character sits in `characters` (a
  // public zone), so accrual has already recorded it in `revealedInstances`.
  const inPlay: GameState = {
    ...base,
    players: [
      { ...base.players[0], characters: {
        [returned]: {
          instanceId: returned, definitionId: ARAGORN, status: CardStatus.Untapped,
          items: [], allies: [], hazards: [], followers: [], controlledBy: 'general',
          effectiveStats: { prowess: 4, body: 6, directInfluence: 0, corruptionPoints: 0 },
        },
      } },
      base.players[1],
    ],
  };
  const revealed = { ...inPlay, revealedInstances: { ...inPlay.revealedInstances, [returned]: ARAGORN } };
  // Now the influence-overflow-discard settles: the character leaves
  // `characters` and lands back in hand — `revealedInstances` is untouched
  // (append-only), and no explicit hand-reveal ever touched this instance.
  const state: GameState = {
    ...revealed,
    players: [
      { ...revealed.players[0], characters: {}, hand: [{ instanceId: returned, definitionId: ARAGORN }] },
      revealed.players[1],
    ],
  };
  return { state, returned };
}

describe('A character returned to hand by influence overflow stays hidden (CoE 2.II.8)', () => {
  test("the opponent's view redacts it even though it was once publicly in play", () => {
    const { state, returned } = gameWithCharacterReturnedToHandAfterOverflow();
    const bobView = projectPlayerView(state, BOB);
    const handById = (id: CardInstanceId): ViewCard | undefined =>
      bobView.opponent.hand.find(c => c.instanceId === id);
    expect(handById(returned)?.definitionId).toBe(UNKNOWN_CARD);
  });

  test("the owner still sees their own hand fully (unchanged)", () => {
    const { state, returned } = gameWithCharacterReturnedToHandAfterOverflow();
    const aliceView = projectPlayerView(state, ALICE);
    const handById = (id: CardInstanceId): ViewCard | undefined =>
      aliceView.self.hand.find(c => c.instanceId === id);
    expect(handById(returned)?.definitionId).toBe(ARAGORN);
  });
});

/**
 * A bare two-player game with Bob's discard pile holding two cards (an
 * earlier-discarded one, buried, and a most-recently-discarded one, on top).
 * Alice optionally controls Pallando (tw-175), whose CRF 22 errata reveals
 * only the top card of an opponent's discard pile.
 */
function gameWithBobDiscardPile(aliceControlsPallando: boolean): {
  state: GameState;
  buried: CardInstanceId;
  top: CardInstanceId;
} {
  const config: GameConfig = {
    players: [
      { id: ALICE, name: 'Alice', alignment: Alignment.Wizard,
        draftPool: [PALLANDO], playDeck: [], siteDeck: [RIVENDELL], sideboard: [] },
      { id: BOB, name: 'Bob', alignment: Alignment.Wizard,
        draftPool: [ARAGORN], playDeck: [], siteDeck: [RIVENDELL], sideboard: [] },
    ],
    seed: 42,
  };
  const base = createGame(config, pool);
  const buried = 'p2-discard-buried' as CardInstanceId;
  const top = 'p2-discard-top' as CardInstanceId;
  const pallandoInstance = 'p1-pallando' as CardInstanceId;
  const state: GameState = {
    ...base,
    players: [
      aliceControlsPallando
        ? {
          ...base.players[0],
          characters: {
            ...base.players[0].characters,
            [pallandoInstance]: {
              instanceId: pallandoInstance,
              definitionId: PALLANDO,
              status: CardStatus.Untapped,
              items: [],
              allies: [],
              hazards: [],
              followers: [],
              controlledBy: 'general',
            },
          },
        }
        : base.players[0],
      { ...base.players[1], discardPile: [
        { instanceId: buried, definitionId: ARAGORN },
        { instanceId: top, definitionId: BALIN },
      ] },
    ],
  };
  return { state, buried, top };
}

describe("Pallando reveals the top of an opponent's discard pile (CRF 22)", () => {
  test('controlling Pallando reveals only the most recently discarded card', () => {
    const { state, buried, top } = gameWithBobDiscardPile(true);
    const aliceView = projectPlayerView(state, ALICE);
    const pileById = (id: CardInstanceId): ViewCard | undefined =>
      aliceView.opponent.discardPile.find(c => c.instanceId === id);
    expect(pileById(top)?.definitionId).toBe(BALIN);
    expect(pileById(buried)?.definitionId).toBe(UNKNOWN_CARD);
  });

  test('without Pallando in play, the opponent discard pile stays fully hidden', () => {
    const { state, buried, top } = gameWithBobDiscardPile(false);
    const aliceView = projectPlayerView(state, ALICE);
    const pileById = (id: CardInstanceId): ViewCard | undefined =>
      aliceView.opponent.discardPile.find(c => c.instanceId === id);
    expect(pileById(top)?.definitionId).toBe(UNKNOWN_CARD);
    expect(pileById(buried)?.definitionId).toBe(UNKNOWN_CARD);
  });

  test("Bob still sees his own discard pile in full (unchanged)", () => {
    const { state, buried, top } = gameWithBobDiscardPile(true);
    const bobView = projectPlayerView(state, BOB);
    const pileById = (id: CardInstanceId): ViewCard | undefined =>
      bobView.self.discardPile.find(c => c.instanceId === id);
    expect(pileById(top)?.definitionId).toBe(BALIN);
    expect(pileById(buried)?.definitionId).toBe(ARAGORN);
  });
});

/**
 * Same fixture shape as {@link gameWithBobDiscardPile}, but Alice's reveal
 * source is The Great Hunt (wh-91) sitting in her `cardsInPlay` rather than
 * Pallando as a character. Unlike Pallando, Great Hunt's "thereafter, your
 * opponent discards face-up" applies to every discard, not just the most
 * recent — {@link sweepGreatHuntDiscards} records each newly discarded card
 * in `handRevealedInstances` as it happens, so the fixture stamps that map
 * directly to simulate cards the engine has (or hasn't) already swept.
 */
const GREAT_HUNT_DISCARD_BURIED = 'p2-discard-buried' as CardInstanceId;
const GREAT_HUNT_DISCARD_TOP = 'p2-discard-top' as CardInstanceId;

function gameWithBobDiscardPileAndGreatHunt(
  aliceControlsGreatHunt: boolean,
  swept: readonly CardInstanceId[] = [],
): {
  state: GameState;
  buried: CardInstanceId;
  top: CardInstanceId;
} {
  const config: GameConfig = {
    players: [
      { id: ALICE, name: 'Alice', alignment: Alignment.Wizard,
        draftPool: [], playDeck: [], siteDeck: [RIVENDELL], sideboard: [] },
      { id: BOB, name: 'Bob', alignment: Alignment.Wizard,
        draftPool: [ARAGORN], playDeck: [], siteDeck: [RIVENDELL], sideboard: [] },
    ],
    seed: 42,
  };
  const base = createGame(config, pool);
  const buried = GREAT_HUNT_DISCARD_BURIED;
  const top = GREAT_HUNT_DISCARD_TOP;
  const greatHuntInstance = 'p1-great-hunt' as CardInstanceId;
  const discardPile = [
    { instanceId: buried, definitionId: ARAGORN },
    { instanceId: top, definitionId: BALIN },
  ];
  const state: GameState = {
    ...base,
    handRevealedInstances: {
      ...base.handRevealedInstances,
      ...Object.fromEntries(
        discardPile.filter(c => swept.includes(c.instanceId)).map(c => [c.instanceId, c.definitionId]),
      ),
    },
    players: [
      aliceControlsGreatHunt
        ? {
          ...base.players[0],
          cardsInPlay: [
            ...base.players[0].cardsInPlay,
            { instanceId: greatHuntInstance, definitionId: THE_GREAT_HUNT, status: CardStatus.Untapped },
          ],
        }
        : base.players[0],
      { ...base.players[1], discardPile },
    ],
  };
  return { state, buried, top };
}

describe('The Great Hunt (wh-91) reveals every discard the engine has swept', () => {
  test('controlling The Great Hunt reveals every card the engine has swept, not just the top', () => {
    const { state, buried, top } = gameWithBobDiscardPileAndGreatHunt(true, [GREAT_HUNT_DISCARD_BURIED, GREAT_HUNT_DISCARD_TOP]);
    const aliceView = projectPlayerView(state, ALICE);
    const pileById = (id: CardInstanceId): ViewCard | undefined =>
      aliceView.opponent.discardPile.find(c => c.instanceId === id);
    expect(pileById(top)?.definitionId).toBe(BALIN);
    expect(pileById(buried)?.definitionId).toBe(ARAGORN);
  });

  test('a discard from before The Great Hunt entered play (never swept) stays hidden even while later discards are visible', () => {
    const { state, buried, top } = gameWithBobDiscardPileAndGreatHunt(true, [GREAT_HUNT_DISCARD_TOP]);
    const aliceView = projectPlayerView(state, ALICE);
    const pileById = (id: CardInstanceId): ViewCard | undefined =>
      aliceView.opponent.discardPile.find(c => c.instanceId === id);
    expect(pileById(top)?.definitionId).toBe(BALIN);
    expect(pileById(buried)?.definitionId).toBe(UNKNOWN_CARD);
  });

  test('without The Great Hunt in play, the opponent discard pile stays fully hidden', () => {
    const { state, buried, top } = gameWithBobDiscardPileAndGreatHunt(false);
    const aliceView = projectPlayerView(state, ALICE);
    const pileById = (id: CardInstanceId): ViewCard | undefined =>
      aliceView.opponent.discardPile.find(c => c.instanceId === id);
    expect(pileById(top)?.definitionId).toBe(UNKNOWN_CARD);
    expect(pileById(buried)?.definitionId).toBe(UNKNOWN_CARD);
  });
});

/**
 * A bare two-player game whose player 0 (Alice) has two cards sitting on top
 * of her play deck: one recorded in `revealedInstances` (as Revealed to all
 * Watchers, dm-85, leaves the set-aside cards it places back on the deck top
 * for the player to order) and one that is not.
 */
function gameWithPartlyRevealedAliceDeckTop(): {
  state: GameState;
  known: CardInstanceId;
  secret: CardInstanceId;
} {
  const config: GameConfig = {
    players: [
      { id: ALICE, name: 'Alice', alignment: Alignment.Wizard,
        draftPool: [ARAGORN], playDeck: [], siteDeck: [RIVENDELL], sideboard: [] },
      { id: BOB, name: 'Bob', alignment: Alignment.Wizard,
        draftPool: [BALIN], playDeck: [], siteDeck: [RIVENDELL], sideboard: [] },
    ],
    seed: 42,
  };
  const base = createGame(config, pool);
  const known = 'p1-deck-known' as CardInstanceId;
  const secret = 'p1-deck-secret' as CardInstanceId;
  const state: GameState = {
    ...base,
    players: [
      { ...base.players[0], playDeck: [
        { instanceId: known, definitionId: ARAGORN },
        { instanceId: secret, definitionId: BALIN },
      ] },
      base.players[1],
    ],
    revealedInstances: { ...base.revealedInstances, [known]: ARAGORN },
    handRevealedInstances: { ...base.handRevealedInstances, [known]: ARAGORN },
  };
  return { state, known, secret };
}

describe('Revealed play-deck-top cards (dm-85 Revealed to all Watchers)', () => {
  test('the deck owner sees the revealed top card so they can choose its order; the rest stay hidden', () => {
    const { state, known, secret } = gameWithPartlyRevealedAliceDeckTop();
    const aliceView = projectPlayerView(state, ALICE);
    const deckById = (id: CardInstanceId): ViewCard | undefined =>
      aliceView.self.playDeck.find(c => c.instanceId === id);
    expect(deckById(known)?.definitionId).toBe(ARAGORN);
    expect(deckById(secret)?.definitionId).toBe(UNKNOWN_CARD);
  });

  test('the opponent also sees the revealed top card (it was made public when revealed)', () => {
    const { state, known, secret } = gameWithPartlyRevealedAliceDeckTop();
    const bobView = projectPlayerView(state, BOB);
    const deckById = (id: CardInstanceId): ViewCard | undefined =>
      bobView.opponent.playDeck.find(c => c.instanceId === id);
    expect(deckById(known)?.definitionId).toBe(ARAGORN);
    expect(deckById(secret)?.definitionId).toBe(UNKNOWN_CARD);
  });
});

/**
 * Regression for bug report 21880899decf2c40 (game msyie3gw-umgdub): Mistress
 * Lobelia (dm-178) grants "Tap to search your discard pile or play deck for
 * any one item, ally, or faction playable at her current site." The
 * `enqueue-pending-fetch` grant-action apply queues a `fetch-to-deck` pending
 * effect with `deck` among its sources but never records the matching
 * candidate in any reveal ledger, so `buildSelfView`'s play-deck redaction
 * kept it as `UNKNOWN_CARD` — the pile browser then had nothing to
 * distinguish, so it fell back to rendering a non-interactive stack of card
 * backs. The player reported being unable to see or pick a card at all, only
 * able to "abort this situation" via the auto-generated decline.
 *
 * Builds a bare state with a `fetch-to-deck` pending effect (sources `deck`
 * and `discard-pile`, matching only `hero-resource-item`) directly active for
 * Alice, with one matching card (Glamdring) and one non-matching card (Balin,
 * a character) sitting in her play deck.
 */
function gameWithPendingDeckSearchFetch(): {
  state: GameState;
  matching: CardInstanceId;
  nonMatching: CardInstanceId;
} {
  const config: GameConfig = {
    players: [
      { id: ALICE, name: 'Alice', alignment: Alignment.Wizard,
        draftPool: [ARAGORN], playDeck: [], siteDeck: [RIVENDELL], sideboard: [] },
      { id: BOB, name: 'Bob', alignment: Alignment.Wizard,
        draftPool: [BALIN], playDeck: [], siteDeck: [RIVENDELL], sideboard: [] },
    ],
    seed: 42,
  };
  const base = createGame(config, pool);
  const matching = 'p1-deck-glamdring' as CardInstanceId;
  const nonMatching = 'p1-deck-balin' as CardInstanceId;
  const sourceCard = 'p1-lobelia' as CardInstanceId;
  const state: GameState = {
    ...base,
    activePlayer: ALICE,
    players: [
      { ...base.players[0], playDeck: [
        { instanceId: matching, definitionId: GLAMDRING },
        { instanceId: nonMatching, definitionId: BALIN },
      ] },
      base.players[1],
    ],
    pendingEffects: [
      {
        type: 'card-effect',
        cardInstanceId: sourceCard,
        effect: {
          type: 'fetch-to-deck',
          source: ['deck', 'discard-pile'],
          filter: { cardType: { $in: ['hero-resource-item'] } },
          count: 1,
          shuffle: true,
          to: 'hand',
        },
      },
    ],
  };
  return { state, matching, nonMatching };
}

describe('Mistress Lobelia-style grant-action deck fetch (bug 21880899decf2c40)', () => {
  test('the play-deck candidate a viable fetch-from-pile action targets is unmasked to its owner', () => {
    const { state, matching, nonMatching } = gameWithPendingDeckSearchFetch();
    const aliceView = projectPlayerView(state, ALICE);
    const deckById = (id: CardInstanceId): ViewCard | undefined =>
      aliceView.self.playDeck.find(c => c.instanceId === id);
    expect(deckById(matching)?.definitionId).toBe(GLAMDRING);
    expect(deckById(nonMatching)?.definitionId).toBe(UNKNOWN_CARD);
  });

  test('the offered fetch-from-pile action targets the unmasked candidate', () => {
    const { state, matching } = gameWithPendingDeckSearchFetch();
    const aliceView = projectPlayerView(state, ALICE);
    const offered = aliceView.legalActions.some(
      ea => ea.viable && ea.action.type === 'fetch-from-pile'
        && ea.action.cardInstanceId === matching && ea.action.source === 'deck',
    );
    expect(offered).toBe(true);
  });

  test("the opponent's view of their own irrelevant play deck is unaffected (unchanged)", () => {
    const { state } = gameWithPendingDeckSearchFetch();
    const bobView = projectPlayerView(state, BOB);
    expect(bobView.opponent.playDeck.every(c => c.definitionId === UNKNOWN_CARD)).toBe(true);
  });
});

describe('Game ID exposed in the player view (for locating a save when filing a bug report)', () => {
  const config: GameConfig = {
    players: [
      { id: ALICE, name: 'Alice', alignment: Alignment.FallenWizard,
        draftPool: [HIDDEN_HAVEN, BALIN], playDeck: [], siteDeck: [WORTHY_HILLS], sideboard: [] },
      { id: BOB, name: 'Bob', alignment: Alignment.Wizard,
        draftPool: [ARAGORN, BALIN], playDeck: [], siteDeck: [RIVENDELL], sideboard: [] },
    ],
    seed: 42,
  };
  const state = createGame(config, pool);

  test('a player view carries the same gameId as the underlying state', () => {
    const aliceView = projectPlayerView(state, ALICE);
    expect(aliceView.gameId).toBe(state.gameId);
  });

  test('a spectator view also carries the gameId', () => {
    const spectatorView = projectSpectatorView(state);
    expect(spectatorView.gameId).toBe(state.gameId);
  });
});
