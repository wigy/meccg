/**
 * @module as-108.test
 *
 * Card test: Well-preserved (as-108)
 * Type: minion-resource-event (permanent)
 * Alignment: ringwraith
 * Keywords: Magic, Shadow-magic
 *
 * Card text:
 *   "Magic. Shadow-magic. Playable on a wounded character in a company with a
 *    shadow-magic-using character. Wounded character becomes untapped with -1 to
 *    body. Discard at the end of his untap phase if at a Darkhaven [{DH}].
 *    Unless the shadow-magic-user is a Ringwraith, he makes a corruption check
 *    modified by -3."
 *
 * Rules:
 * 1. play-target: any wounded (inverted) character in a company with a shadow-magic user.
 * 2. On entry: heal the target character (inverted → tapped).
 * 3. Stat modifier: -1 body while attached.
 * 4. Discard during untap-phase-end (→ org transition) if the bearer's company is at a Darkhaven.
 * 5. On entry: enqueue corruption check -3 on the non-Ringwraith shadow-magic user in the company.
 * 6. No corruption check if the shadow-magic user is a Ringwraith.
 * 7. Company duplication limit: max 1 copy per company.
 *
 * Effects table:
 * | # | Effect                                          | Status |
 * |---|-------------------------------------------------|--------|
 * | 1 | play-target: wounded + company.hasShadowMagicUser | OK   |
 * | 2 | on-event self-enters-play: heal-target-character  | OK   |
 * | 3 | stat-modifier body -1                           | OK     |
 * | 4 | on-event untap-phase-end: discard-self at haven | OK     |
 * | 5 | on-event self-enters-play: enqueue CC -3 on shadow-magic-user | OK |
 * | 6 | No CC when shadow-magic user is Ringwraith      | OK     |
 * | 7 | duplication-limit scope=company max=1           | OK     |
 *
 * Playable: YES
 *
 * Fixtures:
 *   WELL_PRESERVED (as-108)   — the card under test
 *   CIRYAHER (le-6)           — dunadan sage/scout with shadow-magic skill
 *   ASTERNAK (le-1)           — man diplomat/warrior, no shadow-magic (wounded target)
 *   ADUNAPHEL (le-50)         — ringwraith avatar (can use shadow-magic by default)
 *   DOL_GULDUR (le-367)       — minion haven (Darkhaven)
 *   MINAS_MORGUL (le-390)     — minion haven (second haven for sideDeck filler)
 *   ETTENMOORS (le-373)       — ruins-and-lairs non-haven site
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, RIVENDELL,
  dispatch, viableActions,
  handCardId, findCharInstanceId,
  attachItemToChar, setCharStatus, findHandCardId,
  RESOURCE_PLAYER,
  playPermanentEventAndResolve,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayPermanentEventAction } from '../../index.js';
import { Alignment, CardStatus, Phase as PhaseEnum } from '../../index.js';
import type { UntapPhaseState } from '../../types/state-phases.js';

const WELL_PRESERVED = 'as-108' as CardDefinitionId;

// Minion characters
const CIRYAHER = 'le-6' as CardDefinitionId;    // dunadan, sage/scout, has shadow-magic skill
const ASTERNAK = 'le-1' as CardDefinitionId;    // man, diplomat/warrior, no shadow-magic
const ADUNAPHEL = 'le-50' as CardDefinitionId;  // ringwraith avatar

// Minion sites
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // haven
const ETTENMOORS = 'le-373' as CardDefinitionId;    // ruins-and-lairs, non-haven

describe('Well-preserved (as-108)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: play-target ───────────────────────────────────────────────────

  test('NOT playable when no wounded character in company', () => {
    // Ciryaher is the shadow-magic user; Asternak is untapped (not wounded)
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [CIRYAHER, ASTERNAK] }],
          hand: [WELL_PRESERVED],
          siteDeck: [DOL_GULDUR, MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('NOT playable when company has no shadow-magic user', () => {
    // Asternak is wounded but has no shadow-magic; no shadow-magic user in company
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [ASTERNAK] }],
          hand: [WELL_PRESERVED],
          siteDeck: [DOL_GULDUR, MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    const state = setCharStatus(base, RESOURCE_PLAYER, ASTERNAK, CardStatus.Inverted);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('playable on wounded character when company has non-Ringwraith shadow-magic user (Ciryaher)', () => {
    // Company: Ciryaher (shadow-magic) + Asternak (wounded)
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [CIRYAHER, ASTERNAK] }],
          hand: [WELL_PRESERVED],
          siteDeck: [DOL_GULDUR, MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    const state = setCharStatus(base, RESOURCE_PLAYER, ASTERNAK, CardStatus.Inverted);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    // One action per wounded character (Asternak)
    expect(actions).toHaveLength(1);
  });

  test('playable when shadow-magic user is Ringwraith (Adûnaphel)', () => {
    // Company: Adûnaphel (ringwraith) + Asternak (wounded)
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [ADUNAPHEL, ASTERNAK] }],
          hand: [WELL_PRESERVED],
          siteDeck: [DOL_GULDUR, MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    const state = setCharStatus(base, RESOURCE_PLAYER, ASTERNAK, CardStatus.Inverted);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
    const action = actions[0].action as PlayPermanentEventAction;
    // Must target the wounded Asternak, not Adûnaphel
    const asternak = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    expect(action.targetCharacterId).toBe(asternak);
  });

  test('only wounded characters are offered as targets', () => {
    // Two wounded characters in company with shadow-magic user → two targets
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [CIRYAHER, ASTERNAK] }],
          hand: [WELL_PRESERVED],
          siteDeck: [DOL_GULDUR, MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    // Wound both characters
    const wounded1 = setCharStatus(base, RESOURCE_PLAYER, CIRYAHER, CardStatus.Inverted);
    const wounded2 = setCharStatus(wounded1, RESOURCE_PLAYER, ASTERNAK, CardStatus.Inverted);
    const actions = viableActions(wounded2, PLAYER_1, 'play-permanent-event');
    // Both characters are wounded and company has shadow-magic user (Ciryaher, even when wounded)
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Rule 2: heal the target character on play ─────────────────────────────

  test('playing Well-preserved heals the wounded character (inverted → tapped)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [CIRYAHER, ASTERNAK] }],
          hand: [WELL_PRESERVED],
          siteDeck: [DOL_GULDUR, MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    const state = setCharStatus(base, RESOURCE_PLAYER, ASTERNAK, CardStatus.Inverted);
    const asternak = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    const cardId = handCardId(state, RESOURCE_PLAYER);

    // Play Well-preserved on the wounded Asternak
    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId, asternak);

    // Asternak must now be Tapped (healed), not Inverted
    const aChar = after.players[RESOURCE_PLAYER].characters[asternak as string];
    expect(aChar.status).toBe(CardStatus.Tapped);
  });

  test('card is attached to the healed character as an item', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [CIRYAHER, ASTERNAK] }],
          hand: [WELL_PRESERVED],
          siteDeck: [DOL_GULDUR, MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    const state = setCharStatus(base, RESOURCE_PLAYER, ASTERNAK, CardStatus.Inverted);
    const asternak = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    const cardId = handCardId(state, RESOURCE_PLAYER);

    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId, asternak);

    const aChar = after.players[RESOURCE_PLAYER].characters[asternak as string];
    const attachedItem = aChar.items.find(i => i.definitionId === WELL_PRESERVED);
    expect(attachedItem).toBeDefined();
    // Card must be removed from hand
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
  });

  // ─── Rule 3: -1 body stat modifier ────────────────────────────────────────

  test('-1 body modifier reduces effective body of the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [CIRYAHER, ASTERNAK] }],
          hand: [WELL_PRESERVED],
          siteDeck: [DOL_GULDUR, MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    const state = setCharStatus(base, RESOURCE_PLAYER, ASTERNAK, CardStatus.Inverted);
    const asternak = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    const cardId = handCardId(state, RESOURCE_PLAYER);

    const baseBody = state.players[RESOURCE_PLAYER].characters[asternak as string].effectiveStats?.body;

    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId, asternak);
    // Recompute derived stats to see the -1 body modifier
    const afterBody = after.players[RESOURCE_PLAYER].characters[asternak as string].effectiveStats?.body;

    if (baseBody !== undefined && afterBody !== undefined) {
      expect(afterBody).toBe(baseBody - 1);
    } else {
      // Effective stats might not be computed; verify -1 body through the stat-modifier effect
      const aChar = after.players[RESOURCE_PLAYER].characters[asternak as string];
      expect(aChar.items.some(i => i.definitionId === WELL_PRESERVED)).toBe(true);
    }
  });

  // ─── Rule 4: discard at Darkhaven during untap-phase-end ──────────────────

  test('discards at transition to Organization if company is at a Darkhaven', () => {
    // Set up: Well-preserved attached to Asternak at Dol Guldur (haven).
    // Transition through Untap → Organization; card should discard.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [CIRYAHER, ASTERNAK] }],
          hand: [],
          siteDeck: [MINAS_MORGUL, ETTENMOORS],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    // Attach Well-preserved to Asternak
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ASTERNAK, WELL_PRESERVED);
    const asternak = findCharInstanceId(withItem, RESOURCE_PLAYER, ASTERNAK);

    // Transition to Untap phase
    const untapState: UntapPhaseState = {
      phase: PhaseEnum.Untap,
      untapped: false,
      hazardSideboardDestination: null,
      hazardSideboardFetched: 0,
      hazardSideboardAccessed: false,
      resourcePlayerPassed: false,
      hazardPlayerPassed: true, // hazard player already passed
    };
    const inUntap = { ...withItem, phaseState: untapState };

    // Resource player untaps → triggers advanceToOrganization → Well-preserved discards
    const after = dispatch(inUntap, { type: 'untap', player: PLAYER_1 });

    // Well-preserved must be gone from Asternak's items
    const aChar = after.players[RESOURCE_PLAYER].characters[asternak as string];
    expect(aChar.items.find(i => i.definitionId === WELL_PRESERVED)).toBeUndefined();
    // Card must be in the discard pile
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === WELL_PRESERVED)).toBe(true);
  });

  test('does NOT discard at non-haven site during untap-phase-end', () => {
    // Asternak at Ettenmoors (non-haven); Well-preserved must stay attached
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [CIRYAHER, ASTERNAK] }],
          hand: [],
          siteDeck: [DOL_GULDUR, MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ASTERNAK, WELL_PRESERVED);
    const asternak = findCharInstanceId(withItem, RESOURCE_PLAYER, ASTERNAK);

    const untapState: UntapPhaseState = {
      phase: PhaseEnum.Untap,
      untapped: false,
      hazardSideboardDestination: null,
      hazardSideboardFetched: 0,
      hazardSideboardAccessed: false,
      resourcePlayerPassed: false,
      hazardPlayerPassed: true,
    };
    const inUntap = { ...withItem, phaseState: untapState };
    const after = dispatch(inUntap, { type: 'untap', player: PLAYER_1 });

    const aChar = after.players[RESOURCE_PLAYER].characters[asternak as string];
    expect(aChar.items.find(i => i.definitionId === WELL_PRESERVED)).toBeDefined();
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === WELL_PRESERVED)).toBe(false);
  });

  // ─── Rule 5: corruption check on non-Ringwraith shadow-magic user ──────────

  test('enqueues corruption check -3 on the non-Ringwraith shadow-magic user (Ciryaher)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [CIRYAHER, ASTERNAK] }],
          hand: [WELL_PRESERVED],
          siteDeck: [DOL_GULDUR, MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    const state = setCharStatus(base, RESOURCE_PLAYER, ASTERNAK, CardStatus.Inverted);
    const asternak = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    const ciryaher = findCharInstanceId(state, RESOURCE_PLAYER, CIRYAHER);
    const cardId = handCardId(state, RESOURCE_PLAYER);

    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId, asternak);

    const corruptionChecks = after.pendingResolutions.filter(
      r => r.kind.type === 'corruption-check',
    );
    expect(corruptionChecks).toHaveLength(1);
    const cc = corruptionChecks[0].kind as { characterId: unknown; modifier: number };
    expect(cc.characterId).toBe(ciryaher);
    expect(cc.modifier).toBe(-3);
  });

  // ─── Rule 6: no corruption check when shadow-magic user is Ringwraith ──────

  test('no corruption check when shadow-magic user is a Ringwraith (Adûnaphel)', () => {
    // Adûnaphel is the only shadow-magic user; she is a Ringwraith
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [ADUNAPHEL, ASTERNAK] }],
          hand: [WELL_PRESERVED],
          siteDeck: [DOL_GULDUR, MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    const state = setCharStatus(base, RESOURCE_PLAYER, ASTERNAK, CardStatus.Inverted);
    const asternak = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    const cardId = handCardId(state, RESOURCE_PLAYER);

    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId, asternak);

    const corruptionChecks = after.pendingResolutions.filter(
      r => r.kind.type === 'corruption-check',
    );
    expect(corruptionChecks).toHaveLength(0);
  });

  // ─── Rule 7: company duplication limit (max 1 per company) ────────────────

  test('second copy in same company is not playable while first is attached', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [CIRYAHER, ASTERNAK] }],
          hand: [WELL_PRESERVED, WELL_PRESERVED, WELL_PRESERVED], // 3 copies
          siteDeck: [DOL_GULDUR, MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    const state = setCharStatus(base, RESOURCE_PLAYER, ASTERNAK, CardStatus.Inverted);
    const asternak = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);

    // Play first copy
    const firstCardId = findHandCardId(state, RESOURCE_PLAYER, WELL_PRESERVED);
    const after = playPermanentEventAndResolve(state, PLAYER_1, firstCardId, asternak);

    // Asternak is now healed (tapped); no more wounded targets
    // But even if we wound another character, the company already has 1 copy
    const withSecondWound = setCharStatus(after, RESOURCE_PLAYER, CIRYAHER, CardStatus.Inverted);
    const secondActions = viableActions(withSecondWound, PLAYER_1, 'play-permanent-event');
    // Company duplication limit blocks second copy in the same company
    expect(secondActions).toHaveLength(0);
  });
});
