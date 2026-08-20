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
 * | 7 | Playable bare if Radagast not in play; auto-attaches on his entry | IMPLEMENTED |
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
 *    pile; the reducer removes a `fromDiscard` play from the discard pile. Note
 *    `findAllyPlayGrant` scans only characters' attached `items`, so the grant
 *    is inert while the Glove sits bare in `cardsInPlay` (rule 7) — it only
 *    takes effect once actually attached to Radagast, matching the card text
 *    ("with Radagast at his site").
 *  - Rule 7: an `untargeted: true` `play-option` (`when: player.avatarInPlay:
 *    false`) lets the card be played with no target while Radagast is not yet
 *    in play (bug fix: it was previously rejected as "has no valid target"
 *    whenever Radagast wasn't in play, even during Organization phase). An
 *    `on-event: avatar-enters-play` → `move self-location → in-play-on-character`
 *    then attaches the bare card to Radagast the instant he enters play.
 *    Mirrors Give Welcome to the Unexpected (wh-99) / Grey Embassy (wh-100)'s
 *    identical Gandalf-specific fix and Bade to Rule (le-167).
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
  attachItemToChar, attachAllyToChar, addCardToHand,
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
/** Rhosgobel — Radagast's exact homesite (Fallen-wizard avatars are
 *  home-site-only; no extra-haven entry like Wizard/Ringwraith avatars). */
const RHOSGOBEL = 'wh-57' as CardDefinitionId;

/** Noble Steed — non-unique, 1 mind. Normally playable only in six named
 *  regions (Moria is not one) → the grant is what makes it playable there. */
const NOBLE_STEED = 'wh-33' as CardDefinitionId;
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

  // ── Playable bare (Radagast not yet in play), attaches to him on entry ─────
  // Bug report: Glove of Radagast was marked `not-playable` ("has no valid
  // target") during the organization phase whenever Radagast was not yet in
  // play — even as a plain stage resource. "Place this card on Radagast if he
  // is in play" means the card is always playable; it just sits bare in
  // `cardsInPlay` (contributing its stage points) until Radagast enters play,
  // at which point it auto-attaches. Mirrors Give Welcome to the Unexpected
  // (wh-99) / Grey Embassy (wh-100)'s identical Gandalf-specific fix, which in
  // turn mirrors Bade to Rule (le-167)'s untargeted `play-option` +
  // `on-event: avatar-enters-play` auto-attach.

  test('alternative mode: playable during the organization phase if Radagast is not in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [BOROMIR] }],
          hand: [GLOVE, RADAGAST],
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

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const action = actions[0].action as { targetCharacterId?: unknown };
    expect(action.targetCharacterId).toBeUndefined();

    const cardId = findHandCardId(state, RESOURCE_PLAYER, GLOVE);
    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === GLOVE)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(2);
  });

  test('when played bare, attaches to Radagast the moment he enters play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          // Rhosgobel is Radagast's exact homesite — Fallen-wizard avatars are
          // home-site-only (no extra-haven entry), so this is required for the
          // subsequent play-character action to be legal.
          companies: [{ site: RHOSGOBEL, characters: [] }],
          hand: [GLOVE, RADAGAST],
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

    const cardId = findHandCardId(state, RESOURCE_PLAYER, GLOVE);
    const bare = playPermanentEventAndResolve(state, PLAYER_1, cardId);
    expect(bare.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === GLOVE)).toBe(true);

    // A second copy must not be offered while the first sits bare in play.
    const secondCopyActions = viableActions(addCardToHand(bare, RESOURCE_PLAYER, GLOVE), PLAYER_1, 'play-permanent-event');
    expect(secondCopyActions.length).toBe(0);

    // Bring Radagast into play — the card should attach to him and leave `cardsInPlay`.
    const playRadagast = viablePlayCharacterActions(bare, PLAYER_1).find(a => a.characterInstanceId
      === findHandCardId(bare, RESOURCE_PLAYER, RADAGAST));
    expect(playRadagast).toBeDefined();
    const withRadagast = dispatch(bare, playRadagast!);

    expect(withRadagast.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === GLOVE)).toBe(false);
    const radagast = getCharacter(withRadagast, RESOURCE_PLAYER, RADAGAST);
    expect(radagast.items.some(i => i.definitionId === GLOVE)).toBe(true);
    // 2 from the Glove + 1 from Rhosgobel's own "you receive the stage point
    // if any of your companies are at this site" (wh-57) — Radagast's company
    // is now occupying his homesite.
    expect(withRadagast.players[RESOURCE_PLAYER].stagePoints).toBe(3);
  });
});
