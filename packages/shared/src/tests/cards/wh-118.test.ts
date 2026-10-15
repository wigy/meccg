/**
 * @module wh-118.test
 *
 * Card test: Many-coloured Robes (wh-118)
 * Type: minion-resource-event (permanent), alignment: stage
 *
 * Text:
 *   "Unique. Saruman specific. Place this card on Saruman if he is in play.
 *    If on Saruman, he may tap during his end-of-turn phase to take Ringlore,
 *    Lordly Presence, or First of the Order from his discard pile to his hand."
 *
 * Canonical attributes (data/cards.json WH-118): 1 stage point, 1 corruption
 * point.
 *
 * Engine Support (see step-7 report):
 * | # | Rule                                                            | Status      |
 * |---|------------------------------------------------------------------|-------------|
 * | 1 | Unique / Saruman specific (playable only if you are Saruman)     | IMPLEMENTED |
 * | 2 | Placed on Saruman (only offered on the Saruman character)        | IMPLEMENTED |
 * | 3 | Stage points (1) and corruption points (1) while on Saruman      | IMPLEMENTED |
 * | 4 | Tap Saruman during end-of-turn to fetch one of 3 named cards     | IMPLEMENTED |
 * | 5 | Only the three named cards are fetchable; only end-of-turn       | IMPLEMENTED |
 * | 6 | Cost taps Saruman himself ("he may tap"), not the Robes          | IMPLEMENTED |
 * | 7 | Playable bare when Saruman is NOT in play ("if he is in play")   | IMPLEMENTED |
 * | 8 | Attaches to Saruman the moment he enters play                    | IMPLEMENTED |
 * | 9 | The fetch is unavailable while the card is not on Saruman        | IMPLEMENTED |
 *
 * Modeling: the Huntsman's Garb (wh-92) / Pocketed Robes (wh-113) shape, with
 * one difference — the English text says *he* (Saruman) taps, whereas the
 * other wizards' garments tap themselves. So the `grant-action`
 * `many-coloured-robes-fetch` uses `cost: { tap: "bearer" }`: the end-of-turn
 * scanner (`legal-actions/end-of-turn.ts`) requires the bearer untapped, and
 * `applyCost` taps the actor character. The Robes' own status is irrelevant.
 * Because Saruman's own end-of-turn spell fetch also taps him, the two are
 * mutually exclusive in a given turn.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  buildTestState, makePlayDeck, resetMint,
  viableActions, viablePlayCharacterActions,
  findCharInstanceId, findHandCardId,
  playPermanentEventAndResolve,
  addCardToDiscardPile,
  grantedActionsFor,
  getCharacter,
  dispatch,
} from '../test-helpers.js';
import type { CardDefinitionId, GameState, PlayerState } from '../../index.js';
import { Phase, Alignment, CardStatus, computeLegalActions } from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** Many-coloured Robes — the card under test. */
const ROBES = 'wh-118' as CardDefinitionId;
/** Saruman — the Fallen-wizard avatar this card is specific to. */
const SARUMAN = 'wh-9' as CardDefinitionId;
/** Radagast — a *different* Fallen-wizard avatar (negative control for
 *  "Saruman specific"). */
const RADAGAST = 'wh-8' as CardDefinitionId;
/** Boromir II — a hero warrior; negative control for "place on Saruman". */
const BOROMIR = 'tw-134' as CardDefinitionId;
/** Isengard — Saruman's Fallen-wizard Wizardhaven (haven site). */
const ISENGARD = 'wh-56' as CardDefinitionId;

/** The three cards the Robes let Saruman retrieve from the discard pile. */
const RINGLORE = 'tw-318' as CardDefinitionId;
const LORDLY_PRESENCE = 'tw-267' as CardDefinitionId;
const FIRST_OF_THE_ORDER = 'dm-131' as CardDefinitionId;
/** A hero resource NOT in the retrievable set — negative control. */
const DECOY = 'tw-188' as CardDefinitionId; // A Chance Meeting

const FETCH = 'many-coloured-robes-fetch';

// ── Builder ──────────────────────────────────────────────────────────────────

/** Organization-phase state: FallenWizard P1 (avatar Saruman) with the Robes
 *  in hand at Isengard. `characters` allow the negative controls. */
function sarumanOrgState(opts?: {
  hand?: CardDefinitionId[];
  characters?: CardDefinitionId[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: ISENGARD, characters: opts?.characters ?? [SARUMAN, BOROMIR] }],
        hand: opts?.hand ?? [ROBES],
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

/** Attach the Robes to Saruman, seed the discard pile, and enter the
 *  end-of-turn discard step (the window in which the fetch is offered). */
function sarumanEotWithRobes(discard: CardDefinitionId[] = [RINGLORE, LORDLY_PRESENCE, FIRST_OF_THE_ORDER, DECOY]): GameState {
  const org = sarumanOrgState();
  const sarumanId = findCharInstanceId(org, RESOURCE_PLAYER, SARUMAN);
  const robesId = findHandCardId(org, RESOURCE_PLAYER, ROBES);
  let state = playPermanentEventAndResolve(org, PLAYER_1, robesId, sarumanId);
  for (const d of discard) state = addCardToDiscardPile(state, RESOURCE_PLAYER, d);
  return {
    ...state,
    phaseState: { phase: Phase.EndOfTurn, step: 'discard', discardDone: [false, false], resetHandDone: [false, false] },
  } as GameState;
}

/** Return a copy of `state` with the given P1 character's status changed. */
const withCharStatus = (state: GameState, charId: ReturnType<typeof findCharInstanceId>, status: CardStatus): GameState => ({
  ...state,
  players: state.players.map((p, i) =>
    i === RESOURCE_PLAYER
      ? { ...p, characters: { ...p.characters, [charId as string]: { ...p.characters[charId], status } } }
      : p) as unknown as GameState['players'],
});

/** Return a copy of `state` with the Robes item (on Saruman) set to `status`. */
const withRobesStatus = (state: GameState, sarumanId: ReturnType<typeof findCharInstanceId>, status: CardStatus): GameState => ({
  ...state,
  players: state.players.map((p, i) => {
    if (i !== RESOURCE_PLAYER) return p;
    const saruman = p.characters[sarumanId];
    return {
      ...p,
      characters: {
        ...p.characters,
        [sarumanId as string]: {
          ...saruman,
          items: saruman.items.map(it => it.definitionId === ROBES ? { ...it, status } : it),
        },
      },
    } as PlayerState;
  }) as unknown as GameState['players'],
});

const discardInstId = (state: GameState, defId: CardDefinitionId) =>
  state.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === defId)?.instanceId;

const handHas = (state: GameState, defId: CardDefinitionId) =>
  state.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === defId);

describe('Many-coloured Robes (wh-118)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1–2: Saruman specific, placed on Saruman ─────────────────────────

  test('offered only on the Saruman character, never on a company-mate', () => {
    const state = sarumanOrgState({ characters: [SARUMAN, BOROMIR] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const targetIds = actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);

    expect(targetIds).toContain(findCharInstanceId(state, RESOURCE_PLAYER, SARUMAN));
    expect(targetIds).not.toContain(findCharInstanceId(state, RESOURCE_PLAYER, BOROMIR));
    expect(actions.length).toBe(1);
  });

  test('not playable when the player counts as a different Fallen-wizard (Radagast)', () => {
    const state = sarumanOrgState({ characters: [RADAGAST, BOROMIR] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 3: 1 stage point and 1 corruption point while attached ────────────

  test('placing the card on Saruman adds it to his items and yields 1 stage point and 1 corruption point', () => {
    const base = sarumanOrgState();
    const sarumanId = findCharInstanceId(base, RESOURCE_PLAYER, SARUMAN);
    const robesId = findHandCardId(base, RESOURCE_PLAYER, ROBES);

    const spBefore = base.players[RESOURCE_PLAYER].stagePoints;
    const cpBefore = getCharacter(base, RESOURCE_PLAYER, SARUMAN).effectiveStats.corruptionPoints;
    const after = playPermanentEventAndResolve(base, PLAYER_1, robesId, sarumanId);

    expect(getCharacter(after, RESOURCE_PLAYER, SARUMAN).items.some(i => i.definitionId === ROBES)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(spBefore + 1);
    expect(getCharacter(after, RESOURCE_PLAYER, SARUMAN).effectiveStats.corruptionPoints).toBe(cpBefore + 1);
  });

  // ── Rules 4–5: end-of-turn fetch of the three named cards ──────────────────

  test('during end-of-turn, offers one fetch per named card in the discard pile, and no others', () => {
    const state = sarumanEotWithRobes();
    const sarumanId = findCharInstanceId(state, RESOURCE_PLAYER, SARUMAN);

    const targets = grantedActionsFor(state, sarumanId, FETCH, PLAYER_1).map(a => a.targetCardId);

    expect(targets).toContain(discardInstId(state, RINGLORE));
    expect(targets).toContain(discardInstId(state, LORDLY_PRESENCE));
    expect(targets).toContain(discardInstId(state, FIRST_OF_THE_ORDER));
    expect(targets).not.toContain(discardInstId(state, DECOY));
    expect(targets.length).toBe(3);
  });

  test('no fetch is offered when none of the three named cards is in the discard pile', () => {
    const state = sarumanEotWithRobes([DECOY]);
    const sarumanId = findCharInstanceId(state, RESOURCE_PLAYER, SARUMAN);
    expect(grantedActionsFor(state, sarumanId, FETCH, PLAYER_1).length).toBe(0);
  });

  // ── Rule 6: Saruman is what taps ───────────────────────────────────────────

  test('activating the fetch moves the chosen card to hand and taps Saruman, not the Robes', () => {
    const state = sarumanEotWithRobes();
    const sarumanId = findCharInstanceId(state, RESOURCE_PLAYER, SARUMAN);

    expect(handHas(state, LORDLY_PRESENCE)).toBe(false);
    const grant = grantedActionsFor(state, sarumanId, FETCH, PLAYER_1)
      .find(a => a.targetCardId === discardInstId(state, LORDLY_PRESENCE))!;
    const after = dispatch(state, grant);

    expect(handHas(after, LORDLY_PRESENCE)).toBe(true);
    expect(discardInstId(after, LORDLY_PRESENCE)).toBeUndefined();
    expect(getCharacter(after, RESOURCE_PLAYER, SARUMAN).status).toBe(CardStatus.Tapped);
    const robes = getCharacter(after, RESOURCE_PLAYER, SARUMAN).items.find(i => i.definitionId === ROBES)!;
    expect(robes.status).toBe(CardStatus.Untapped);

    // Saruman is now tapped, so no second fetch is offered this turn.
    expect(grantedActionsFor(after, sarumanId, FETCH, PLAYER_1).length).toBe(0);
  });

  test('the fetch is NOT offered while Saruman is tapped', () => {
    const base = sarumanEotWithRobes();
    const sarumanId = findCharInstanceId(base, RESOURCE_PLAYER, SARUMAN);
    const state = withCharStatus(base, sarumanId, CardStatus.Tapped);
    expect(grantedActionsFor(state, sarumanId, FETCH, PLAYER_1).length).toBe(0);
  });

  test('the Robes\' own status does not matter — tapped Robes on untapped Saruman still fetch', () => {
    const base = sarumanEotWithRobes();
    const sarumanId = findCharInstanceId(base, RESOURCE_PLAYER, SARUMAN);
    const state = withRobesStatus(base, sarumanId, CardStatus.Tapped);
    expect(grantedActionsFor(state, sarumanId, FETCH, PLAYER_1).length).toBe(3);
  });

  // ── Rule 4 timing: end-of-turn only ────────────────────────────────────────

  // CRF 22: "Cards may be played during the End-of-Turn phase after hand size
  // has been reconciled" — the fetch is also offered during signal-end.
  test('the fetch is also offered during signal-end, after hand size has been reconciled (CRF 22)', () => {
    const signalEnd = {
      ...sarumanEotWithRobes(),
      phaseState: { phase: Phase.EndOfTurn, step: 'signal-end', discardDone: [true, true], resetHandDone: [true, true] },
    } as GameState;
    const sarumanId = findCharInstanceId(signalEnd, RESOURCE_PLAYER, SARUMAN);
    expect(grantedActionsFor(signalEnd, sarumanId, FETCH, PLAYER_1).length).toBe(3);
  });

  test('the fetch is not offered during reset-hand (a locked mandatory draw/discard step)', () => {
    const resetHand = {
      ...sarumanEotWithRobes(),
      phaseState: { phase: Phase.EndOfTurn, step: 'reset-hand', discardDone: [true, true], resetHandDone: [false, false] },
    } as GameState;
    const sarumanId = findCharInstanceId(resetHand, RESOURCE_PLAYER, SARUMAN);
    expect(grantedActionsFor(resetHand, sarumanId, FETCH, PLAYER_1).length).toBe(0);
  });

  test('the fetch is not offered outside the end-of-turn phase (organization)', () => {
    const org = {
      ...sarumanEotWithRobes(),
      phaseState: { phase: Phase.Organization, characterPlayedThisTurn: false, sideboardFetchedThisTurn: 0, sideboardFetchDestination: null },
    } as GameState;
    const sarumanId = findCharInstanceId(org, RESOURCE_PLAYER, SARUMAN);
    expect(grantedActionsFor(org, sarumanId, FETCH, PLAYER_1).length).toBe(0);
  });

  // ── Rules 7–9: playable without Saruman, not usable without Saruman ────────

  /** Organization-phase state with Saruman NOT in play: he sits in hand (still
   *  the declared avatar) and Isengard heads the site deck. */
  function sarumanUnrevealedOrgState(): GameState {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [BOROMIR] }],
          hand: [ROBES, SARUMAN],
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

  /** Every viable fetch offer, regardless of the character it is keyed on. */
  const allFetchOffers = (state: GameState) =>
    computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable)
      .map(ea => ea.action)
      .filter(a => a.type === 'activate-granted-action'
        && (a as { actionId?: string }).actionId === FETCH);

  const toEot = (state: GameState): GameState => ({
    ...state,
    phaseState: { phase: Phase.EndOfTurn, step: 'discard', discardDone: [false, false], resetHandDone: [false, false] },
  } as GameState);

  test('playable bare during the organization phase when Saruman is not in play', () => {
    const state = sarumanUnrevealedOrgState();
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    expect((actions[0].action as { targetCharacterId?: unknown }).targetCharacterId).toBeUndefined();

    const baseline = state.players[RESOURCE_PLAYER].stagePoints;
    const after = playPermanentEventAndResolve(state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, ROBES));
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === ROBES)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(baseline + 1);
  });

  test('the fetch is NOT offered while the Robes sit in play unattached', () => {
    const org = sarumanUnrevealedOrgState();
    let state = playPermanentEventAndResolve(org, PLAYER_1, findHandCardId(org, RESOURCE_PLAYER, ROBES));
    for (const d of [RINGLORE, LORDLY_PRESENCE, FIRST_OF_THE_ORDER]) state = addCardToDiscardPile(state, RESOURCE_PLAYER, d);
    expect(allFetchOffers(toEot(state)).length).toBe(0);
  });

  test('attaches to Saruman the moment he enters play, and the fetch works from then on', () => {
    const org = sarumanUnrevealedOrgState();
    const bare = playPermanentEventAndResolve(org, PLAYER_1, findHandCardId(org, RESOURCE_PLAYER, ROBES));

    const playSaruman = viablePlayCharacterActions(bare, PLAYER_1).find(a => a.characterInstanceId
      === findHandCardId(bare, RESOURCE_PLAYER, SARUMAN));
    expect(playSaruman).toBeDefined();
    const revealed = dispatch(bare, playSaruman!);

    expect(revealed.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === ROBES)).toBe(false);
    expect(getCharacter(revealed, RESOURCE_PLAYER, SARUMAN).items.some(i => i.definitionId === ROBES)).toBe(true);

    let seeded = revealed;
    for (const d of [RINGLORE, LORDLY_PRESENCE, FIRST_OF_THE_ORDER]) seeded = addCardToDiscardPile(seeded, RESOURCE_PLAYER, d);
    expect(allFetchOffers(toEot(seeded)).length).toBe(3);
  });
});
