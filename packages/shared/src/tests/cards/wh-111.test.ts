/**
 * @module wh-111.test
 *
 * Card test: Glove of Radagast (wh-111)
 * Type: minion-resource-event (permanent), alignment: stage. Unique.
 *       Radagast specific. Stage points 2.
 *
 * Card text:
 *   "Unique. Radagast specific. Place this card on Radagast if he is in play.
 *    Any non-unique ally with 1 mind (a copy of which he does not already
 *    control) is considered playable with Radagast at his site. This ally may be
 *    taken from your discard pile or hand."
 *
 * Engine Support (see step-7 report):
 * | # | Rule                                                            | Status      |
 * |---|-----------------------------------------------------------------|-------------|
 * | 1 | Unique / Radagast specific (playable only if you are Radagast)  | IMPLEMENTED |
 * | 2 | Placed on Radagast (only offered on the Radagast character)     | IMPLEMENTED |
 * | 3 | Stage points (2) while in play                                  | IMPLEMENTED |
 * | 4 | Any non-unique 1-mind ally playable at Radagast's current site  | IMPLEMENTED |
 * | 5 | Grant excludes an ally the bearer already controls a copy of    | IMPLEMENTED |
 * | 6 | Granted ally may be sourced from the discard pile or the hand   | IMPLEMENTED |
 * | 7 | Playable bare when Radagast is NOT in play ("if he is in play") | IMPLEMENTED |
 * | 8 | Attaches to Radagast the moment he enters play                  | IMPLEMENTED |
 *
 * Modeling:
 *  - Rule 1: `radagast-specific` keyword gates play to a Radagast-avatar player
 *    (`wizardSpecificName`), and `unique`.
 *  - Rule 2: `play-target` `character` filter `{ target.name: "Radagast" }` — the
 *    card attaches to Radagast's `items`.
 *  - Rule 3: `stage-points` value 2.
 *  - Rules 4–6: a `grant-ally-play` effect (`filter` non-unique + 1-mind,
 *    `excludeBearerControlsCopy: true`, `fromDiscard: true`). The legal-action
 *    generator relaxes an ally's site-match at the bearer's company
 *    (`allyPlayGrantAllowsAlly`) and sources matching allies from the discard
 *    pile; the reducer removes a `fromDiscard` play from the discard pile.
 *  - Rules 7–8: "Place this card on Radagast **if he is in play**" — placement
 *    is conditional, not a play requirement. An untargeted `play-option` gated
 *    on `player.avatarInPlay: false` lets the card enter play bare in
 *    `cardsInPlay`, and an `on-event: avatar-enters-play` move (self →
 *    `in-play-on-character`) attaches it to Radagast the moment he is revealed
 *    — the wh-92 / wh-99 / Bade to Rule (le-167) pattern.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  buildTestState, makePlayDeck, resetMint,
  makeSitePhase,
  viableActions, viablePlayCharacterActions,
  findCharInstanceId, findHandCardId,
  playPermanentEventAndResolve,
  attachItemToChar, attachAllyToChar,
  getCharacter,
  dispatch,
  MORIA, RIVENDELL, EDORAS,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayHeroResourceAction } from '../../index.js';
import { Phase, Alignment, CardStatus } from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** Glove of Radagast — the card under test. */
const GLOVE = 'wh-111' as CardDefinitionId;
/** Radagast — the Fallen-wizard avatar this card is specific to. */
const RADAGAST = 'wh-8' as CardDefinitionId;
/** Saruman — a different Fallen-wizard avatar (negative control for "specific"). */
const SARUMAN = 'wh-9' as CardDefinitionId;
/** Boromir II — a hero warrior company-mate; negative control for "place on Radagast". */
const BOROMIR = 'tw-134' as CardDefinitionId;
/** Isengard — a Fallen-wizard Wizardhaven (haven site). */
const ISENGARD = 'wh-56' as CardDefinitionId;
/** Rhosgobel — Radagast's home site, so he can be revealed from hand. */
const RHOSGOBEL = 'wh-57' as CardDefinitionId;

/** Noble Steed — non-unique, 1 mind. Normally playable only in six named
 *  regions (Moria is not one) → the grant is what makes it playable there. */
const NOBLE_STEED = 'wh-33' as CardDefinitionId;
/** Noble Hound — non-unique, 1 mind, printed "playable at any tapped or
 *  untapped Border-hold" (`play-target` site `requireTapped: false`). Used to
 *  verify the discard-pile grant path honors that flag, not just the
 *  `playable-at-tapped-site` keyword. */
const NOBLE_HOUND = 'dm-179' as CardDefinitionId;
/** Goldberry — unique, 2 mind. Negative control for the grant's filter. */
const GOLDBERRY = 'tw-245' as CardDefinitionId;

// ── Builders ───────────────────────────────────────────────────────────────

/** Organization-phase state: FallenWizard P1 (avatar Radagast) with the Glove
 *  in hand at Isengard. `characters` allows the negative controls. */
function radagastOrgState(opts?: {
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
        companies: [{ site: ISENGARD, characters: opts?.characters ?? [RADAGAST, BOROMIR] }],
        hand: opts?.hand ?? [GLOVE],
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

/** Site-phase state: FallenWizard P1 (Radagast + Boromir) at Moria (a site where
 *  Noble Steed is NOT normally playable), with the given hand/discard cards. */
function radagastSiteAtMoria(opts?: {
  hand?: CardDefinitionId[];
  discard?: CardDefinitionId[];
}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: MORIA, characters: [RADAGAST, BOROMIR] }],
        hand: opts?.hand ?? [],
        siteDeck: [MORIA],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: RIVENDELL, characters: [] }],
        hand: [],
        siteDeck: [RIVENDELL],
        playDeck: makePlayDeck(),
      },
    ],
  });
  let state: GameState = { ...base, phaseState: makeSitePhase() };
  for (const d of opts?.discard ?? []) {
    const card = { instanceId: `${PLAYER_1}-disc-${d}` as CardInstanceId, definitionId: d };
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === RESOURCE_PLAYER ? { ...p, discardPile: [...p.discardPile, card] } : p,
      ) as unknown as GameState['players'],
    };
  }
  return state;
}

/** Instance IDs of every viable `play-hero-resource` action for `defId`. */
function playInstIdsFor(state: GameState, defId: CardDefinitionId, source: 'hand' | 'discard'): CardInstanceId[] {
  const pile = source === 'hand'
    ? state.players[RESOURCE_PLAYER].hand
    : state.players[RESOURCE_PLAYER].discardPile;
  const instIds = new Set(pile.filter(c => c.definitionId === defId).map(c => c.instanceId as string));
  return viableActions(state, PLAYER_1, 'play-hero-resource')
    .map(ea => ea.action as PlayHeroResourceAction)
    .filter(a => instIds.has(a.cardInstanceId as string))
    .filter(a => (source === 'discard' ? a.fromDiscard === true : a.fromDiscard !== true))
    .map(a => a.cardInstanceId);
}

describe('Glove of Radagast (wh-111)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1–2: Radagast specific, placed on Radagast ───────────────────────

  test('offered only on the Radagast character, never on a company-mate', () => {
    const state = radagastOrgState({ characters: [RADAGAST, BOROMIR] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const targetIds = actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);

    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST);
    const boromirId = findCharInstanceId(state, RESOURCE_PLAYER, BOROMIR);

    expect(targetIds).toContain(radagastId);
    expect(targetIds).not.toContain(boromirId);
    expect(actions.length).toBe(1); // exactly Radagast
  });

  test('not playable when the player counts as a different Fallen-wizard (Saruman)', () => {
    const state = radagastOrgState({ characters: [SARUMAN, BOROMIR] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 3: contributes 2 stage points while attached ──────────────────────

  test('placing the card on Radagast adds it to his items and yields 2 stage points', () => {
    const base = radagastOrgState();
    const radagastId = findCharInstanceId(base, RESOURCE_PLAYER, RADAGAST);
    const gloveId = findHandCardId(base, RESOURCE_PLAYER, GLOVE);

    expect(base.players[RESOURCE_PLAYER].stagePoints).toBe(0);
    const after = playPermanentEventAndResolve(base, PLAYER_1, gloveId, radagastId);

    expect(getCharacter(after, RESOURCE_PLAYER, RADAGAST).items.some(i => i.definitionId === GLOVE)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(2);
  });

  // ── Rule 4: grant makes a non-unique 1-mind ally playable at Radagast's site ─

  test('baseline: Noble Steed is NOT playable at Moria without the Glove', () => {
    const state = radagastSiteAtMoria({ hand: [NOBLE_STEED] });
    expect(playInstIdsFor(state, NOBLE_STEED, 'hand')).toHaveLength(0);
  });

  test('with the Glove on Radagast, Noble Steed (hand) IS playable at Moria', () => {
    const base = radagastSiteAtMoria({ hand: [NOBLE_STEED] });
    const state = attachItemToChar(base, RESOURCE_PLAYER, RADAGAST, GLOVE);
    expect(playInstIdsFor(state, NOBLE_STEED, 'hand').length).toBeGreaterThanOrEqual(1);
  });

  test('the grant does not extend to a unique / non-1-mind ally (Goldberry)', () => {
    const base = radagastSiteAtMoria({ hand: [GOLDBERRY] });
    const state = attachItemToChar(base, RESOURCE_PLAYER, RADAGAST, GLOVE);
    expect(playInstIdsFor(state, GOLDBERRY, 'hand')).toHaveLength(0);
  });

  // ── Rule 5: grant excludes an ally the bearer already controls a copy of ────

  test('Noble Steed is NOT granted when Radagast already controls a copy', () => {
    const base = radagastSiteAtMoria({ hand: [NOBLE_STEED] });
    const withGlove = attachItemToChar(base, RESOURCE_PLAYER, RADAGAST, GLOVE);
    const withCopy = attachAllyToChar(withGlove, RESOURCE_PLAYER, RADAGAST, NOBLE_STEED);
    expect(playInstIdsFor(withCopy, NOBLE_STEED, 'hand')).toHaveLength(0);
  });

  // ── Rule 6: granted ally may be sourced from the discard pile ───────────────

  test('with the Glove, Noble Steed in the DISCARD pile is playable at Moria', () => {
    const base = radagastSiteAtMoria({ discard: [NOBLE_STEED] });
    const state = attachItemToChar(base, RESOURCE_PLAYER, RADAGAST, GLOVE);
    expect(playInstIdsFor(state, NOBLE_STEED, 'discard').length).toBeGreaterThanOrEqual(1);
  });

  test('baseline: a discard-pile ally is never offered without the Glove', () => {
    const state = radagastSiteAtMoria({ discard: [NOBLE_STEED] });
    expect(playInstIdsFor(state, NOBLE_STEED, 'discard')).toHaveLength(0);
  });

  test('playing the discard-sourced ally attaches it and removes it from the discard pile', () => {
    const base = radagastSiteAtMoria({ discard: [NOBLE_STEED] });
    const state = attachItemToChar(base, RESOURCE_PLAYER, RADAGAST, GLOVE);
    const boromirId = findCharInstanceId(state, RESOURCE_PLAYER, BOROMIR);

    const steedInstId = state.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === NOBLE_STEED)!.instanceId;
    const action = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction)
      .find(a => a.cardInstanceId === steedInstId && a.fromDiscard === true && a.attachToCharacterId === boromirId)!;
    expect(action).toBeDefined();

    const after = dispatch(state, action);

    // Noble Steed left the discard pile and is now a Boromir ally.
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === steedInstId)).toBe(false);
    expect(getCharacter(after, RESOURCE_PLAYER, BOROMIR).allies.some(a => a.definitionId === NOBLE_STEED)).toBe(true);
    // Playing an ally taps the site.
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
  });

  test('with the Glove, a discard ally printed "playable at tapped or untapped" (Noble Hound) IS playable when the site is tapped', () => {
    const base = radagastSiteAtMoria({ discard: [NOBLE_HOUND] });
    const withGlove = attachItemToChar(base, RESOURCE_PLAYER, RADAGAST, GLOVE);
    const state: GameState = {
      ...withGlove,
      players: withGlove.players.map((p, i) =>
        i === RESOURCE_PLAYER
          ? { ...p, companies: p.companies.map(c => ({ ...c, currentSite: { ...c.currentSite!, status: CardStatus.Tapped } })) }
          : p,
      ) as unknown as GameState['players'],
    };
    expect(playInstIdsFor(state, NOBLE_HOUND, 'discard').length).toBeGreaterThanOrEqual(1);
  });

  // ── The grant is company-scoped: only Radagast's company benefits ───────────

  test('a second company without Radagast does not gain the grant', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [
            { site: ISENGARD, characters: [RADAGAST] },
            { site: MORIA, characters: [BOROMIR] },
          ],
          hand: [NOBLE_STEED],
          siteDeck: [EDORAS],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [] }],
          hand: [],
          siteDeck: [RIVENDELL],
          playDeck: makePlayDeck(),
        },
      ],
    });
    const withGlove = attachItemToChar(base, RESOURCE_PLAYER, RADAGAST, GLOVE);
    // Active company is the Moria one (index 1), which lacks Radagast/the Glove.
    const state = { ...withGlove, phaseState: makeSitePhase({ activeCompanyIndex: 1 }) };
    expect(playInstIdsFor(state, NOBLE_STEED, 'hand')).toHaveLength(0);
  });

  // ── Rules 7–8: playable without Radagast, attaches when he is revealed ─────
  // "Place this card on Radagast if he is in play" makes the placement
  // conditional, not the play. Mirrors Huntsman's Garb (wh-92) / Give Welcome
  // to the Unexpected (wh-99).

  /** Organization-phase state with Radagast NOT in play: he sits in hand
   *  (still the declared avatar, so the radagast-specific gate passes) and his
   *  home site Rhosgobel heads the site deck so he can be revealed. */
  function radagastUnrevealedOrgState(): GameState {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [BOROMIR] }],
          hand: [GLOVE, RADAGAST],
          siteDeck: [RHOSGOBEL],
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

  test('playable bare during the organization phase when Radagast is not in play', () => {
    const state = radagastUnrevealedOrgState();
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    expect((actions[0].action as { targetCharacterId?: unknown }).targetCharacterId).toBeUndefined();

    const gloveId = findHandCardId(state, RESOURCE_PLAYER, GLOVE);
    const after = playPermanentEventAndResolve(state, PLAYER_1, gloveId);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === GLOVE)).toBe(true);
    // The stage points are earned whether or not the card sits on Radagast.
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(2);
  });

  test('attaches to Radagast the moment he enters play', () => {
    const org = radagastUnrevealedOrgState();
    const gloveId = findHandCardId(org, RESOURCE_PLAYER, GLOVE);
    const bare = playPermanentEventAndResolve(org, PLAYER_1, gloveId);

    // Reveal Radagast at his home site — the Glove leaves `cardsInPlay` for his items.
    const playRadagast = viablePlayCharacterActions(bare, PLAYER_1).find(a => a.characterInstanceId
      === findHandCardId(bare, RESOURCE_PLAYER, RADAGAST));
    expect(playRadagast).toBeDefined();
    const revealed = dispatch(bare, playRadagast!);

    expect(revealed.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === GLOVE)).toBe(false);
    expect(getCharacter(revealed, RESOURCE_PLAYER, RADAGAST).items.some(i => i.definitionId === GLOVE)).toBe(true);
  });
});
