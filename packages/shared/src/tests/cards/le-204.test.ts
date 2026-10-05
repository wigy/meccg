/**
 * @module le-204.test
 *
 * Card test: Messenger of Mordor (le-204)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0. Keywords: Magic, Spirit-magic.
 *
 * Card text:
 *   "Magic. Spirit-magic. Playable on a spirit-magic-using character at a
 *    Darkhaven [{DH}], Shadow-hold [{S}], or Dark-hold [{D}]. Any items and
 *    resource events with his company that can be stored at a Darkhaven [{DH}]
 *    may now be so stored. Unless he is a Ringwraith, character makes a
 *    corruption check modified by -4. Cannot be included in a Fallen-wizard's
 *    deck."
 *
 * Effects:
 *   1. `play-target` character, filter `target.skills $includes spirit-magic`
 *      AND `company.siteType $in [haven, shadow-hold, dark-hold]` (a minion
 *      haven is a Darkhaven).
 *   2. `on-event self-enters-play` → `add-constraint storage-as-darkhaven`
 *      (scope turn) on the target's company, bound to the site it occupies.
 *      While the company stays there, `storeItemActions` treats the site as a
 *      Darkhaven, and the site phase offers `store-item` to that company
 *      ("may *now* be so stored" — storing is otherwise organization-only).
 *   3. `on-event self-enters-play` → `enqueue-corruption-check -4`, gated
 *      `$not target.race ringwraith`.
 *   4. `deck-restriction excluded-from-deck` for Fallen-wizard decks (rule
 *      1.18, enforced by the deck validator).
 *
 * Rule coverage:
 * | # | Rule                                                                  | Status      |
 * |---|-----------------------------------------------------------------------|-------------|
 * | 1 | Playable on a spirit-magic user at a Shadow-hold, Dark-hold, Darkhaven | IMPLEMENTED |
 * | 2 | NOT playable at a Border-hold or Ruins & Lairs                         | IMPLEMENTED |
 * | 3 | NOT playable on a character without spirit-magic                       | IMPLEMENTED |
 * | 4 | Org phase at a Shadow-hold: items become storable after play           | IMPLEMENTED |
 * | 5 | Resource events storable at a Darkhaven (That Ain't No Secret) too     | IMPLEMENTED |
 * | 6 | Site phase: storage offered "now" and the store resolves                | IMPLEMENTED |
 * | 7 | Allowance is bound to the site — lost once the company is elsewhere   | IMPLEMENTED |
 * | 8 | Ringwraith target makes no corruption check                            | IMPLEMENTED |
 * | 9 | Non-Ringwraith target makes a corruption check modified by -4           | IMPLEMENTED |
 * |10 | Cannot be included in a Fallen-wizard's deck                           | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeSitePhase,
  viableActions, findHandCardId, expectInDiscardPile, getCharacter,
  MINAS_TIRITH, PLAYER_1, PLAYER_2, Phase, RESOURCE_PLAYER, pool,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, PlayShortEventAction, StoreItemAction,
} from '../../index.js';
import { Alignment, validateDeck } from '../../index.js';
import type { DeckList } from '../../index.js';

const MESSENGER = 'le-204' as CardDefinitionId;
const ADUNAPHEL = 'le-50' as CardDefinitionId;   // Ringwraith, spirit-magic
const DWAR = 'le-52' as CardDefinitionId;        // Ringwraith, no spirit-magic
const BELEGORN = 'le-2' as CardDefinitionId;     // Dúnadan, spirit-magic (non-Ringwraith)
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId; // minion minor item
const THAT_AINT_NO_SECRET = 'le-240' as CardDefinitionId; // resource event storable at a Darkhaven
const MOUNT_GUNDABAD = 'le-395' as CardDefinitionId; // shadow-hold
const CIRITH_UNGOL = 'le-362' as CardDefinitionId;   // dark-hold
const DOL_GULDUR = 'le-367' as CardDefinitionId;     // Darkhaven
const VARIAG_CAMP = 'le-411' as CardDefinitionId;    // border-hold
const ETTENMOORS = 'le-373' as CardDefinitionId;     // ruins & lairs

type CharSpec = CardDefinitionId | { defId: CardDefinitionId; items: CardDefinitionId[] };

function buildState(opts: {
  phase: Phase.Organization | Phase.Site;
  site: CardDefinitionId;
  characters: CharSpec[];
  hand?: CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: opts.site, characters: opts.characters }],
        hand: opts.hand ?? [MESSENGER],
        playDeck: [MINAS_TIRITH],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: MINAS_TIRITH, characters: [] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
  if (opts.phase === Phase.Site) {
    return { ...state, phaseState: makeSitePhase({ activeCompanyIndex: 0 }) };
  }
  return state;
}

/** Viable Messenger plays on the given character. */
function messengerPlays(state: GameState, targetId: CardInstanceId): PlayShortEventAction[] {
  const inst = findHandCardId(state, RESOURCE_PLAYER, MESSENGER);
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .filter(a => a.cardInstanceId === inst && a.targetCharacterId === targetId);
}

function storeActions(state: GameState): StoreItemAction[] {
  return viableActions(state, PLAYER_1, 'store-item').map(ea => ea.action as StoreItemAction);
}

/** Play Messenger of Mordor on the given character and return the resulting state. */
function playOn(state: GameState, charDef: CardDefinitionId): GameState {
  const targetId = getCharacter(state, RESOURCE_PLAYER, charDef).instanceId;
  const plays = messengerPlays(state, targetId);
  expect(plays).toHaveLength(1);
  return dispatch(state, plays[0]);
}

describe('Messenger of Mordor (le-204)', () => {
  beforeEach(() => resetMint());

  // ── Play restrictions ────────────────────────────────────────────────────

  test.each([
    ['Shadow-hold (Mount Gundabad)', MOUNT_GUNDABAD],
    ['Dark-hold (Cirith Ungol)', CIRITH_UNGOL],
    ['Darkhaven (Dol Guldur)', DOL_GULDUR],
  ])('playable on a spirit-magic user at a %s', (_label, site) => {
    const state = buildState({ phase: Phase.Organization, site, characters: [ADUNAPHEL] });
    const adunId = getCharacter(state, RESOURCE_PLAYER, ADUNAPHEL).instanceId;
    expect(messengerPlays(state, adunId)).toHaveLength(1);
  });

  test.each([
    ['Border-hold (Variag Camp)', VARIAG_CAMP],
    ['Ruins & Lairs (Ettenmoors)', ETTENMOORS],
  ])('NOT playable at a %s', (_label, site) => {
    const state = buildState({ phase: Phase.Organization, site, characters: [ADUNAPHEL] });
    const adunId = getCharacter(state, RESOURCE_PLAYER, ADUNAPHEL).instanceId;
    expect(messengerPlays(state, adunId)).toHaveLength(0);
  });

  test('NOT playable on a character without spirit-magic (Dwar — sorcery)', () => {
    const state = buildState({ phase: Phase.Organization, site: MOUNT_GUNDABAD, characters: [DWAR] });
    const dwarId = getCharacter(state, RESOURCE_PLAYER, DWAR).instanceId;
    expect(messengerPlays(state, dwarId)).toHaveLength(0);
  });

  // ── Storage at a Shadow-hold / Dark-hold ─────────────────────────────────

  test('organization phase at a Shadow-hold: an item becomes storable once played', () => {
    const state = buildState({
      phase: Phase.Organization,
      site: MOUNT_GUNDABAD,
      characters: [{ defId: ADUNAPHEL, items: [SAW_TOOTHED_BLADE] }],
    });
    expect(storeActions(state)).toHaveLength(0);

    const inst = findHandCardId(state, RESOURCE_PLAYER, MESSENGER);
    const after = playOn(state, ADUNAPHEL);
    expectInDiscardPile(after, RESOURCE_PLAYER, inst);

    const stores = storeActions(after);
    expect(stores).toHaveLength(1);
    const blade = getCharacter(after, RESOURCE_PLAYER, ADUNAPHEL).items[0];
    expect(stores[0].itemInstanceId).toBe(blade.instanceId);

    const stored = dispatch(after, stores[0]);
    expect(getCharacter(stored, RESOURCE_PLAYER, ADUNAPHEL).items).toHaveLength(0);
    expect(stored.players[0].killPile.some(c => c.instanceId === blade.instanceId)).toBe(true);
  });

  test('a resource event storable at a Darkhaven (That Ain\'t No Secret) becomes storable at a Dark-hold', () => {
    const state = buildState({
      phase: Phase.Organization,
      site: CIRITH_UNGOL,
      characters: [{ defId: ADUNAPHEL, items: [THAT_AINT_NO_SECRET] }],
    });
    expect(storeActions(state)).toHaveLength(0);

    const after = playOn(state, ADUNAPHEL);
    const stores = storeActions(after);
    expect(stores).toHaveLength(1);
    const stored = dispatch(after, stores[0]);
    expect(stored.players[0].killPile.some(c => c.definitionId === THAT_AINT_NO_SECRET)).toBe(true);
  });

  test('site phase: storing is offered "now" and resolves into the marshalling point pile', () => {
    const state = buildState({
      phase: Phase.Site,
      site: MOUNT_GUNDABAD,
      characters: [{ defId: ADUNAPHEL, items: [SAW_TOOTHED_BLADE] }],
    });
    // Storing is not normally possible during the site phase.
    expect(storeActions(state)).toHaveLength(0);

    const after = playOn(state, ADUNAPHEL);
    const stores = storeActions(after);
    expect(stores).toHaveLength(1);

    const stored = dispatch(after, stores[0]);
    expect(getCharacter(stored, RESOURCE_PLAYER, ADUNAPHEL).items).toHaveLength(0);
    expect(stored.players[0].killPile.some(c => c.definitionId === SAW_TOOTHED_BLADE)).toBe(true);
    // The bearer makes the usual storage corruption check.
    expect(stored.pendingResolutions.some(r => r.kind.type === 'corruption-check')).toBe(true);
  });

  test('site phase at a Darkhaven without Messenger offers no storage', () => {
    const state = buildState({
      phase: Phase.Site,
      site: DOL_GULDUR,
      characters: [{ defId: ADUNAPHEL, items: [SAW_TOOTHED_BLADE] }],
    });
    expect(storeActions(state)).toHaveLength(0);
    const after = playOn(state, ADUNAPHEL);
    expect(storeActions(after)).toHaveLength(1);
  });

  test('the allowance is bound to the site — a company now elsewhere cannot store there', () => {
    const state = buildState({
      phase: Phase.Organization,
      site: MOUNT_GUNDABAD,
      characters: [{ defId: ADUNAPHEL, items: [SAW_TOOTHED_BLADE] }],
    });
    const after = playOn(state, ADUNAPHEL);
    expect(storeActions(after)).toHaveLength(1);

    // Relocate the company to a different Shadow-hold-like non-haven site.
    const company = after.players[0].companies[0];
    const moved: GameState = {
      ...after,
      players: [
        {
          ...after.players[0],
          companies: [{
            ...company,
            currentSite: { ...company.currentSite!, definitionId: CIRITH_UNGOL },
          }],
        },
        after.players[1],
      ] as GameState['players'],
    };
    expect(storeActions(moved)).toHaveLength(0);
  });

  // ── Corruption check ─────────────────────────────────────────────────────

  test('a Ringwraith target makes no corruption check', () => {
    const state = buildState({ phase: Phase.Organization, site: MOUNT_GUNDABAD, characters: [ADUNAPHEL] });
    const after = playOn(state, ADUNAPHEL);
    expect(after.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  test('a non-Ringwraith target makes a corruption check modified by -4', () => {
    const state = buildState({ phase: Phase.Organization, site: MOUNT_GUNDABAD, characters: [BELEGORN] });
    const belegornId = getCharacter(state, RESOURCE_PLAYER, BELEGORN).instanceId;
    const after = playOn(state, BELEGORN);
    const checks = after.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(checks).toHaveLength(1);
    const kind = checks[0].kind as { characterId?: CardInstanceId; modifier?: number };
    expect(kind.characterId).toBe(belegornId);
    expect(kind.modifier).toBe(-4);
  });

  // ── Deck restriction ─────────────────────────────────────────────────────

  test.each([
    ['fallen-wizard', true],
    ['minion', false],
  ] as const)('deck validation for a %s deck flags it: %s', (alignment, banned) => {
    const deck: DeckList = {
      id: `test-${alignment}-messenger`,
      name: `${alignment} Messenger`,
      alignment,
      pool: [],
      sideboard: [],
      sites: [{ name: 'Dol Guldur', card: DOL_GULDUR, qty: 1 }],
      deck: {
        characters: [],
        hazards: [],
        resources: [{ name: 'Messenger of Mordor', card: MESSENGER, qty: 1 }],
      },
    };
    const bannedErrors = validateDeck(deck, pool)
      .filter(e => e.card === MESSENGER && e.message.includes('not allowed'));
    expect(bannedErrors.length > 0).toBe(banned);
  });
});
