/**
 * @module projection.test
 *
 * Regression tests for {@link projectPlayerView} — the redaction boundary that
 * turns the omniscient server state into a per-player view.
 */

import { describe, test, expect } from 'vitest';
import {
  createGame, reduce, loadCardPool, Alignment, UNKNOWN_SITE, UNKNOWN_CARD, CardStatus, PALLANDO,
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
