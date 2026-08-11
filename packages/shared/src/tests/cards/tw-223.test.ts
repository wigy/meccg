/**
 * @module tw-223.test
 *
 * Card test: Elf-song (tw-223)
 * Type: hero-resource-event (long)
 *
 * "When Elf-song comes into play, each character at a Haven [{H}] may
 *  immediately remove one corruption card. While Elf-song is in play, no
 *  character at a Haven may be discarded or returned to its owner's hand
 *  for any reason."
 *
 * Effects & engine support:
 * | # | Rule                                              | Mechanism                                                            |
 * |---|----------------------------------------------------|-----------------------------------------------------------------------|
 * | 1 | On entering play, each character at a Haven may     | on-event self-enters-play → offer-corruption-removal-at-site         |
 * |   |   immediately remove one corruption card            |   (siteTypes: ["haven"]); one `remove-corruption-offer` pending      |
 * |   |                                                      |   resolution per eligible character (bearing ≥1 corruption card)     |
 * | 2 | While in play, no character at a Haven may be       | removal-protection (siteTypes: ["haven"]); checked by                |
 * |   |   discarded or returned to hand for any reason      |   `isSiteRemovalProtected` alongside every central removal path      |
 *
 * Rule 2 is dynamic and location-gated (re-evaluated at removal time against
 * the character's *current* site, not a snapshot taken when Elf-song entered
 * play) and applies to either player's characters, matching the unqualified
 * "no character at a Haven" wording — mirrored by `isSkillSuppressedForCharacter`'s
 * scan-both-players pattern elsewhere in the engine.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase,
  ARAGORN, LEGOLAS, BILBO,
  RIVENDELL, LORIEN, MORIA,
  buildTestState, resetMint, makeMHState,
  playLongEventAndResolve, viableActions,
  findCharInstanceId, handCardId, dispatch, getCharacter,
  attachHazardToChar,
  expectCharInPlay, expectCharNotInPlay,
  LURE_OF_THE_SENSES,
} from '../test-helpers.js';
import type {
  GameState, CardDefinitionId, ResolutionId, PendingResolution,
} from '../../index.js';

const ELF_SONG = 'tw-223' as CardDefinitionId;

describe('Elf-song (tw-223)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: offer gating (Haven + corruption only) ────────────────────

  test('entering play offers corruption removal only to a Haven character bearing corruption', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN] }, // Haven + corruption → offered
            { site: LORIEN, characters: [LEGOLAS] }, // Haven, no corruption → not offered
            { site: MORIA, characters: [BILBO] }, // corruption, not a Haven → not offered
          ],
          hand: [ELF_SONG],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
      ],
    });
    state = attachHazardToChar(state, RESOURCE_PLAYER, ARAGORN, LURE_OF_THE_SENSES, HAZARD_PLAYER);
    state = attachHazardToChar(state, RESOURCE_PLAYER, BILBO, LURE_OF_THE_SENSES, HAZARD_PLAYER);

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const elfSongId = handCardId(state, RESOURCE_PLAYER);
    const s = playLongEventAndResolve(state, PLAYER_1, elfSongId);

    const offers = s.pendingResolutions.filter(r => r.kind.type === 'remove-corruption-offer');
    expect(offers).toHaveLength(1);
    expect(offers[0].kind.type === 'remove-corruption-offer' && offers[0].kind.characterId).toBe(aragornId);
  });

  // ── Rule 1: declining leaves the corruption card attached ─────────────

  test('declining the offer leaves the corruption card attached', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [ELF_SONG], siteDeck: [] },
        { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
      ],
    });
    state = attachHazardToChar(state, RESOURCE_PLAYER, ARAGORN, LURE_OF_THE_SENSES, HAZARD_PLAYER);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const elfSongId = handCardId(state, RESOURCE_PLAYER);

    let s = playLongEventAndResolve(state, PLAYER_1, elfSongId);
    expect(s.pendingResolutions.some(r => r.kind.type === 'remove-corruption-offer')).toBe(true);

    s = dispatch(s, { type: 'remove-corruption-offer', player: PLAYER_1 });

    expect(s.pendingResolutions.some(r => r.kind.type === 'remove-corruption-offer')).toBe(false);
    expect(getCharacter(s, RESOURCE_PLAYER, ARAGORN).hazards.some(h => h.definitionId === LURE_OF_THE_SENSES)).toBe(true);
    expect(s.players[RESOURCE_PLAYER].characters[aragornId].hazards.length).toBe(1);
  });

  // ── Rule 1: choosing removes the corruption card to its owner's discard pile ──

  test('choosing to remove sends the corruption card to its owner (hazard player)\'s discard pile', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [ELF_SONG], siteDeck: [] },
        { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
      ],
    });
    state = attachHazardToChar(state, RESOURCE_PLAYER, ARAGORN, LURE_OF_THE_SENSES, HAZARD_PLAYER);
    const elfSongId = handCardId(state, RESOURCE_PLAYER);

    const s = playLongEventAndResolve(state, PLAYER_1, elfSongId);
    const offer = s.pendingResolutions.find(r => r.kind.type === 'remove-corruption-offer');
    expect(offer).toBeDefined();
    const corruptionId = getCharacter(s, RESOURCE_PLAYER, ARAGORN).hazards[0].instanceId;

    // The legal-action menu offers exactly "decline" + "remove this corruption card".
    const actions = viableActions(s, PLAYER_1, 'remove-corruption-offer');
    expect(actions).toHaveLength(2);

    const after = dispatch(s, { type: 'remove-corruption-offer', player: PLAYER_1, corruptionInstanceId: corruptionId });

    expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).hazards).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === LURE_OF_THE_SENSES)).toBe(true);
    expect(after.pendingResolutions.some(r => r.kind.type === 'remove-corruption-offer')).toBe(false);
  });

  // ── Rule 2: removal protection at a Haven ──────────────────────────────

  test('while Elf-song is in play, a Haven character cannot be discarded (control: without Elf-song it is)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [ELF_SONG], siteDeck: [] },
        { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);

    const discardCheck: PendingResolution = {
      id: 'elfsong-discard-check' as ResolutionId,
      source: aragornId,
      actor: PLAYER_1,
      scope: { kind: 'phase-step', phase: Phase.MovementHazard, step: 'play-hazards' },
      kind: {
        type: 'dice-check',
        label: 'Discard check: Aragorn',
        modifiers: [],
        threshold: 11,
        comparison: 'gte',
        onFail: { type: 'discard-character' },
        continuation: { kind: 'dequeue-only' },
        requireTargetPresent: true,
        targetCharacterId: aragornId,
      },
    };

    // Control: with no Elf-song in play, a failing roll discards Aragorn.
    {
      let s: GameState = { ...base, phaseState: makeMHState(), pendingResolutions: [discardCheck], cheatRollTotal: 2 };
      const rollActions = viableActions(s, PLAYER_1, 'resolve-dice-check');
      expect(rollActions).toHaveLength(1);
      s = dispatch(s, rollActions[0].action);
      expectCharNotInPlay(s, RESOURCE_PLAYER, aragornId);
    }

    // Protected: with Elf-song in play and Aragorn still at Rivendell (a Haven),
    // the same failing roll leaves him in play.
    {
      const elfSongId = handCardId(base, RESOURCE_PLAYER);
      const withElfSong = playLongEventAndResolve(base, PLAYER_1, elfSongId);
      let s: GameState = {
        ...withElfSong,
        phaseState: makeMHState(),
        pendingResolutions: [discardCheck],
        cheatRollTotal: 2,
      };
      const rollActions = viableActions(s, PLAYER_1, 'resolve-dice-check');
      expect(rollActions).toHaveLength(1);
      s = dispatch(s, rollActions[0].action);
      expectCharInPlay(s, RESOURCE_PLAYER, aragornId);
    }
  });

  test('while Elf-song is in play, a Haven character cannot be returned to hand', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [ELF_SONG], siteDeck: [] },
        { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const elfSongId = handCardId(base, RESOURCE_PLAYER);
    const withElfSong = playLongEventAndResolve(base, PLAYER_1, elfSongId);

    const returnCheck: PendingResolution = {
      id: 'elfsong-return-check' as ResolutionId,
      source: aragornId,
      actor: PLAYER_1,
      scope: { kind: 'phase-step', phase: Phase.MovementHazard, step: 'play-hazards' },
      kind: {
        type: 'dice-check',
        label: 'Return check: Aragorn',
        modifiers: [],
        threshold: 11,
        comparison: 'gte',
        onFail: { type: 'return-character-to-hand' },
        continuation: { kind: 'dequeue-only' },
        requireTargetPresent: true,
        targetCharacterId: aragornId,
      },
    };

    let s: GameState = {
      ...withElfSong,
      phaseState: makeMHState(),
      pendingResolutions: [returnCheck],
      cheatRollTotal: 2,
    };
    const rollActions = viableActions(s, PLAYER_1, 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);
    s = dispatch(s, rollActions[0].action);

    expectCharInPlay(s, RESOURCE_PLAYER, aragornId);
    expect(s.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === ARAGORN)).toBe(false);
  });

  test('protection does not apply away from a Haven, even while Elf-song is in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [ELF_SONG], siteDeck: [] },
        { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const elfSongId = handCardId(base, RESOURCE_PLAYER);
    const withElfSong = playLongEventAndResolve(base, PLAYER_1, elfSongId);

    const discardCheck: PendingResolution = {
      id: 'elfsong-moria-discard-check' as ResolutionId,
      source: aragornId,
      actor: PLAYER_1,
      scope: { kind: 'phase-step', phase: Phase.MovementHazard, step: 'play-hazards' },
      kind: {
        type: 'dice-check',
        label: 'Discard check: Aragorn (Moria)',
        modifiers: [],
        threshold: 11,
        comparison: 'gte',
        onFail: { type: 'discard-character' },
        continuation: { kind: 'dequeue-only' },
        requireTargetPresent: true,
        targetCharacterId: aragornId,
      },
    };

    let s: GameState = {
      ...withElfSong,
      phaseState: makeMHState(),
      pendingResolutions: [discardCheck],
      cheatRollTotal: 2,
    };
    const rollActions = viableActions(s, PLAYER_1, 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);
    s = dispatch(s, rollActions[0].action);

    expectCharNotInPlay(s, RESOURCE_PLAYER, aragornId);
    expect(s.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === ARAGORN)).toBe(true);
  });
});
