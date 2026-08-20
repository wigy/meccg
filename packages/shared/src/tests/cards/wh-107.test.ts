/**
 * @module wh-107.test
 *
 * Card test: Stave of Pallando (wh-107)
 * Type: minion-resource-event (permanent), alignment: stage
 *
 * Text:
 *   "Unique. Pallando specific. Place this card on Pallando if he is in play.
 *    If on Pallando, you may tap Stave of Pallando during your end-of-turn
 *    phase to take a faction from your discard pile to your hand."
 *
 * Printed attributes (data/cards.json WH-107): 2 stage points, 1 corruption
 * point.
 *
 * Engine Support (see step-7 report):
 * | # | Rule                                                          | Status      |
 * |---|---------------------------------------------------------------|-------------|
 * | 1 | Unique / Pallando specific (playable only if you are Pallando)| IMPLEMENTED |
 * | 2 | Placed on Pallando (only offered on the Pallando character)   | IMPLEMENTED |
 * | 3 | Stage points (2) while in play                                | IMPLEMENTED |
 * | 4 | Printed 1 corruption point borne by Pallando                  | IMPLEMENTED |
 * | 5 | Tap the Stave during end-of-turn to fetch a faction           | IMPLEMENTED |
 * | 6 | Only factions are fetchable; only during end-of-turn          | IMPLEMENTED |
 * | 7 | Cost taps the Stave itself (not Pallando)                     | IMPLEMENTED |
 * | 8 | Playable bare when Pallando is NOT in play ("if he is in play")| IMPLEMENTED |
 * | 9 | Attaches to Pallando the moment he enters play                | IMPLEMENTED |
 * | 10| The fetch is unavailable while the card is not on Pallando    | IMPLEMENTED |
 *
 * Modeling (identical shape to Pallando's Hood wh-105, with the fetch filter
 * keyed on card type instead of names):
 *  - Rule 1: the `pallando-specific` keyword gates playability to a player
 *    whose revealed avatar is Pallando (`wizardSpecificName`, MEWH), and
 *    `unique`.
 *  - Rule 2: `play-target` `character` filter `{ target.name: "Pallando" }` —
 *    the card attaches to Pallando's `items`.
 *  - Rule 3: `stage-points` value 2, summed from characters' items in
 *    `recompute-derived.ts`.
 *  - Rule 4: `stat-modifier` `corruption-points` +1 — collected from the
 *    attached card by `collectCharacterEffects` (`effects/resolver.ts`) and
 *    summed into Pallando's `effectiveStats.corruptionPoints`.
 *  - Rules 5-7: a `grant-action` `stave-of-pallando-fetch`, `cost: { tap:
 *    "self" }`, `endOfTurnOnly: true`, whose `apply` is a `move` (`select:
 *    target`, `from: discard`, `to: hand`) filtered to `cardType $in
 *    [hero-resource-faction, minion-resource-faction]` ("a faction" — a
 *    Fallen-wizard may hold both alignments' factions). Emitted only by the
 *    end-of-turn discard-pile fetch scanner (`legal-actions/end-of-turn.ts`),
 *    one activation per matching discard card. `tap: self` on an item-borne
 *    grant taps the *card* (via `applyCost` `tapAttachment`), so eligibility
 *    keys on the Stave's own status — not the bearer's — meaning the fetch
 *    works even while Pallando is tapped.
 *  - Rules 8–9: "Place this card on Pallando **if he is in play**" — placement
 *    is conditional, not a play requirement. An untargeted `play-option` gated
 *    on `player.avatarInPlay: false` lets the card enter play bare in
 *    `cardsInPlay`, and an `on-event: avatar-enters-play` move (self →
 *    `in-play-on-character`) attaches it to Pallando the moment he is revealed —
 *    the wh-99 / Bade to Rule (le-167) pattern.
 *  - Rule 10 falls out of the scanner: `endOfTurnGrantActions` walks characters
 *    and their attached items only, so a Stave sitting bare in `cardsInPlay`
 *    is never a grant source ("If on Pallando, you may tap…").
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

/** Stave of Pallando — the card under test. */
const STAVE = 'wh-107' as CardDefinitionId;
/** Pallando — the Fallen-wizard avatar this card is specific to. */
const PALLANDO = 'wh-7' as CardDefinitionId;
/** Saruman — a *different* Fallen-wizard avatar (negative control for
 *  "Pallando specific"). */
const SARUMAN = 'wh-9' as CardDefinitionId;
/** Boromir II — a hero warrior; negative control for "place on Pallando" (the
 *  card must never be offered on a character other than Pallando). */
const BOROMIR = 'tw-134' as CardDefinitionId;
/** Isengard — a Fallen-wizard Wizardhaven (haven site). */
const ISENGARD = 'wh-56' as CardDefinitionId;
/** The White Towers — Pallando's printed home site, so he can be revealed
 *  there from hand. */
const THE_WHITE_TOWERS = 'tw-430' as CardDefinitionId;

/** A hero faction — fetchable ("a faction", either alignment). */
const WOOD_ELVES = 'tw-367' as CardDefinitionId;
/** A minion faction — fetchable ("a faction", either alignment). */
const ORCS_OF_MORIA = 'le-278' as CardDefinitionId;
/** A non-faction resource — negative control for the fetch filter. */
const DECOY = 'tw-188' as CardDefinitionId; // A Chance Meeting

const FETCH = 'stave-of-pallando-fetch';

// ── Builder ──────────────────────────────────────────────────────────────────

/** Organization-phase state: FallenWizard P1 (avatar Pallando) with the Stave
 *  in hand at Isengard. `characters` allows the negative controls. */
function pallandoOrgState(opts?: {
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
        companies: [{ site: ISENGARD, characters: opts?.characters ?? [PALLANDO, BOROMIR] }],
        hand: opts?.hand ?? [STAVE],
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

/** Attach the Stave to Pallando, seed the discard pile, and enter the
 *  end-of-turn discard step (the window in which the fetch is offered). */
function pallandoEotWithStave(discard: CardDefinitionId[] = [WOOD_ELVES, ORCS_OF_MORIA, DECOY]): GameState {
  const org = pallandoOrgState();
  const pallandoId = findCharInstanceId(org, RESOURCE_PLAYER, PALLANDO);
  const staveId = findHandCardId(org, RESOURCE_PLAYER, STAVE);
  let state = playPermanentEventAndResolve(org, PLAYER_1, staveId, pallandoId);
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

/** Return a copy of `state` with the Stave (on Pallando) set to `status`. */
const withStaveStatus = (state: GameState, pallandoId: ReturnType<typeof findCharInstanceId>, status: CardStatus): GameState => ({
  ...state,
  players: state.players.map((p, i) => {
    if (i !== RESOURCE_PLAYER) return p;
    const pallando = p.characters[pallandoId];
    return {
      ...p,
      characters: {
        ...p.characters,
        [pallandoId as string]: {
          ...pallando,
          items: pallando.items.map(it => it.definitionId === STAVE ? { ...it, status } : it),
        },
      },
    } as PlayerState;
  }) as unknown as GameState['players'],
});

const discardInstId = (state: GameState, defId: CardDefinitionId) =>
  state.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === defId)?.instanceId;

const handHas = (state: GameState, defId: CardDefinitionId) =>
  state.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === defId);

describe('Stave of Pallando (wh-107)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1–2: Pallando specific, placed on Pallando ───────────────────────

  test('offered only on the Pallando character, never on a company-mate', () => {
    const state = pallandoOrgState({ characters: [PALLANDO, BOROMIR] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const targetIds = actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);

    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);
    const boromirId = findCharInstanceId(state, RESOURCE_PLAYER, BOROMIR);

    expect(targetIds).toContain(pallandoId);
    expect(targetIds).not.toContain(boromirId);
    expect(actions.length).toBe(1); // exactly Pallando
  });

  test('not playable when the player counts as a different Fallen-wizard (Saruman)', () => {
    // No Pallando in the company → the pallando-specific keyword gate fails,
    // and the play-target { name: "Pallando" } has no match either.
    const state = pallandoOrgState({ characters: [SARUMAN, BOROMIR] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rules 3–4: 2 stage points and 1 corruption point while attached ────────

  test('placing the card on Pallando adds it to his items, yields 2 stage points and 1 corruption point', () => {
    const base = pallandoOrgState();
    const pallandoId = findCharInstanceId(base, RESOURCE_PLAYER, PALLANDO);
    const staveId = findHandCardId(base, RESOURCE_PLAYER, STAVE);
    const cpBefore = getCharacter(base, RESOURCE_PLAYER, PALLANDO).effectiveStats.corruptionPoints;

    expect(base.players[RESOURCE_PLAYER].stagePoints).toBe(0);
    const after = playPermanentEventAndResolve(base, PLAYER_1, staveId, pallandoId);

    expect(getCharacter(after, RESOURCE_PLAYER, PALLANDO).items.some(i => i.definitionId === STAVE)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(2);
    expect(getCharacter(after, RESOURCE_PLAYER, PALLANDO).effectiveStats.corruptionPoints).toBe(cpBefore + 1);
  });

  // ── Rules 5–6: end-of-turn fetch of any faction ────────────────────────────

  test('during end-of-turn, offers one fetch per faction in the discard pile (both alignments), and no others', () => {
    const state = pallandoEotWithStave();
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);

    const grants = grantedActionsFor(state, pallandoId, FETCH, PLAYER_1);
    const targets = grants.map(a => a.targetCardId);

    expect(targets).toContain(discardInstId(state, WOOD_ELVES));
    expect(targets).toContain(discardInstId(state, ORCS_OF_MORIA));
    expect(targets).not.toContain(discardInstId(state, DECOY));
    expect(grants.length).toBe(2);
  });

  test('no fetch is offered when the discard pile holds no faction', () => {
    const state = pallandoEotWithStave([DECOY]);
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);
    expect(grantedActionsFor(state, pallandoId, FETCH, PLAYER_1).length).toBe(0);
  });

  test('activating the fetch moves the chosen faction from discard to hand and taps the Stave', () => {
    const state = pallandoEotWithStave();
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);

    expect(handHas(state, ORCS_OF_MORIA)).toBe(false);
    const grant = grantedActionsFor(state, pallandoId, FETCH, PLAYER_1)
      .find(a => a.targetCardId === discardInstId(state, ORCS_OF_MORIA))!;
    const after = dispatch(state, grant);

    // Orcs of Moria is now in hand and no longer in the discard pile.
    expect(handHas(after, ORCS_OF_MORIA)).toBe(true);
    expect(discardInstId(after, ORCS_OF_MORIA)).toBeUndefined();
    // The Stave (on Pallando) is now tapped.
    const stave = getCharacter(after, RESOURCE_PLAYER, PALLANDO).items.find(i => i.definitionId === STAVE)!;
    expect(stave.status).toBe(CardStatus.Tapped);
    // Pallando himself was NOT tapped — the cost taps the Stave, not the bearer.
    expect(getCharacter(after, RESOURCE_PLAYER, PALLANDO).status).toBe(CardStatus.Untapped);
  });

  // ── Rule 7: cost keys on the Stave's status, not Pallando's ────────────────

  test('the fetch is still offered while Pallando is tapped (the Stave is what taps)', () => {
    const base = pallandoEotWithStave();
    const pallandoId = findCharInstanceId(base, RESOURCE_PLAYER, PALLANDO);
    const state = withCharStatus(base, pallandoId, CardStatus.Tapped);
    expect(grantedActionsFor(state, pallandoId, FETCH, PLAYER_1).length).toBe(2);
  });

  test('the fetch is NOT offered once the Stave itself is tapped', () => {
    const base = pallandoEotWithStave();
    const pallandoId = findCharInstanceId(base, RESOURCE_PLAYER, PALLANDO);
    const state = withStaveStatus(base, pallandoId, CardStatus.Tapped);
    expect(grantedActionsFor(state, pallandoId, FETCH, PLAYER_1).length).toBe(0);
  });

  // ── Rule 5 timing: end-of-turn only ────────────────────────────────────────

  test('the fetch is not offered outside the end-of-turn phase (organization)', () => {
    const eot = pallandoEotWithStave();
    const pallandoId = findCharInstanceId(eot, RESOURCE_PLAYER, PALLANDO);
    // Same attached state, but back in the organization phase.
    const org = {
      ...eot,
      phaseState: { phase: Phase.Organization, characterPlayedThisTurn: false, sideboardFetchedThisTurn: 0, sideboardFetchDestination: null },
    } as GameState;
    expect(grantedActionsFor(org, pallandoId, FETCH, PLAYER_1).length).toBe(0);
  });

  // ── Rules 8–10: playable without Pallando, not usable without Pallando ─────
  // "Place this card on Pallando if he is in play" makes the placement
  // conditional, not the play; the fetch clause is "If on Pallando". Mirrors
  // Huntsman's Garb (wh-92) / Give Welcome to the Unexpected (wh-99).

  /** Organization-phase state with Pallando NOT in play: he sits in hand
   *  (still the declared avatar, so the pallando-specific gate passes) and his
   *  home site heads the site deck so he can be revealed. */
  function pallandoUnrevealedOrgState(): GameState {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [BOROMIR] }],
          hand: [STAVE, PALLANDO],
          siteDeck: [THE_WHITE_TOWERS],
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

  /** Every viable end-of-turn fetch offer, regardless of which character it is
   *  keyed on — a bare Stave has no bearer to ask `grantedActionsFor` about. */
  const allFetchOffers = (state: GameState) =>
    computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable)
      .map(ea => ea.action)
      .filter(a => a.type === 'activate-granted-action'
        && (a as { actionId?: string }).actionId === FETCH);

  test('playable bare during the organization phase when Pallando is not in play', () => {
    const state = pallandoUnrevealedOrgState();
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    expect((actions[0].action as { targetCharacterId?: unknown }).targetCharacterId).toBeUndefined();

    const staveId = findHandCardId(state, RESOURCE_PLAYER, STAVE);
    const after = playPermanentEventAndResolve(state, PLAYER_1, staveId);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === STAVE)).toBe(true);
    // The stage points are earned whether or not the card sits on Pallando.
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(2);
  });

  test('the fetch is NOT offered while the Stave sits in play unattached', () => {
    const org = pallandoUnrevealedOrgState();
    const staveId = findHandCardId(org, RESOURCE_PLAYER, STAVE);
    let state = playPermanentEventAndResolve(org, PLAYER_1, staveId);
    for (const d of [WOOD_ELVES, ORCS_OF_MORIA]) state = addCardToDiscardPile(state, RESOURCE_PLAYER, d);
    const eot = {
      ...state,
      phaseState: { phase: Phase.EndOfTurn, step: 'discard', discardDone: [false, false], resetHandDone: [false, false] },
    } as GameState;

    // Two fetchable factions in the discard pile, and still no offer: only a
    // Stave *on* Pallando can be tapped.
    expect(allFetchOffers(eot).length).toBe(0);
  });

  test('attaches to Pallando the moment he enters play, and the fetch works from then on', () => {
    const org = pallandoUnrevealedOrgState();
    const staveId = findHandCardId(org, RESOURCE_PLAYER, STAVE);
    const bare = playPermanentEventAndResolve(org, PLAYER_1, staveId);

    // Reveal Pallando at his home site — the Stave leaves `cardsInPlay` for his items.
    const playPallando = viablePlayCharacterActions(bare, PLAYER_1).find(a => a.characterInstanceId
      === findHandCardId(bare, RESOURCE_PLAYER, PALLANDO));
    expect(playPallando).toBeDefined();
    const revealed = dispatch(bare, playPallando!);

    expect(revealed.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === STAVE)).toBe(false);
    expect(getCharacter(revealed, RESOURCE_PLAYER, PALLANDO).items.some(i => i.definitionId === STAVE)).toBe(true);
    expect(revealed.players[RESOURCE_PLAYER].stagePoints).toBe(2);

    // With the Stave on Pallando, the end-of-turn fetch is offered again.
    let seeded = revealed;
    for (const d of [WOOD_ELVES, ORCS_OF_MORIA]) seeded = addCardToDiscardPile(seeded, RESOURCE_PLAYER, d);
    const eot = {
      ...seeded,
      phaseState: { phase: Phase.EndOfTurn, step: 'discard', discardDone: [false, false], resetHandDone: [false, false] },
    } as GameState;
    expect(allFetchOffers(eot).length).toBe(2);
  });
});
