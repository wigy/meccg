/**
 * @module le-344.test
 *
 * Card test: Shadow-cloak (le-344)
 * Type: minion-resource-item (subtype: minor), alignment ringwraith, non-unique.
 * Marshalling Points: 0. Corruption Points: 1.
 *
 * Card text: "Tap Shadow-cloak to cancel one hazard creature strike against
 * bearer keyed by type to a Shadow-land [{s}], Shadow-hold [{S}], Dark-domain
 * [{d}], or Dark-hold [{D}]. Cannot be duplicated on a given character."
 *
 * Rule coverage:
 *
 * | # | Rule                                                          | Mechanism                                                       |
 * |---|--------------------------------------------------------------|-----------------------------------------------------------------|
 * | 1 | Tap to cancel a strike from a creature keyed to {s}/{S}/{d}/{D}| cancel-strike cost {tap:self}, when on attack keying (new ctx)  |
 * | 2 | Applying the cancel taps the cloak (not bearer), strike gone  | handleCancelStrike                                              |
 * | 3 | No cancel when the creature is keyed elsewhere ({w}/{R} only) | when $or over attack.keying / attack.siteKeyingTypes fails      |
 * | 4 | A tapped Shadow-cloak cannot cancel                           | selfCancelStrikeActions requires untapped item                 |
 * | 5 | Only protects its own bearer (self-target)                   | cancel-strike target self — scan is over the struck char's items|
 * | 6 | Cannot be duplicated on a given character                    | duplication-limit scope:character max:1 (item play at site)     |
 *
 * The keying gate reuses the region/site keying already flattened onto the
 * combat state (`attackKeying` / `attackSiteKeyingTypes`), now surfaced to the
 * self-tap cancel-strike `when` context via `buildAttackKeyingCtx`. Orc-lieutenant
 * (tw-073) is keyed to {w}{s}{d}/{R}{S}{D}, so it satisfies the gate; Land-drake
 * (le-80) is keyed only to {w}/{R}, so it does not.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  Alignment, CardStatus,
  buildTestState, buildMinionSitePhaseState, resetMint, makeMHState,
  dispatch, resolveChain,
  findCharInstanceId, findHandCardId, getCharacter,
  handCardId, companyIdAt, actionAs,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase,
} from '../test-helpers.js';
import type { CharacterEntry } from '../test-helpers.js';
import { SiteType, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CancelStrikeAction } from '../../index.js';

const SHADOW_CLOAK = 'le-344' as CardDefinitionId;
const ORC_LIEUTENANT = 'tw-073' as CardDefinitionId; // keyed {w}{s}{d}/{R}{S}{D}, 1 strike, 7 prowess
const LAND_DRAKE = 'le-80' as CardDefinitionId;       // keyed {w}/{R} only, 1 strike, 8 prowess
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;      // minion warrior, non-unique
const LUITPRAND = 'le-23' as CardDefinitionId;        // minion scout, unique

const MORIA_MINION = 'le-392' as CardDefinitionId;    // minion shadow-hold [{S}]
const ETTENMOORS = 'le-373' as CardDefinitionId;      // minion ruins-and-lairs [{R}]

/**
 * Build a M/H-phase state with a single minion company (player 0) and the
 * hazard player (player 1) holding one creature. `site`/`siteType` describe the
 * destination the creature is keyed to.
 */
function mhWithCompany(opts: {
  site: CardDefinitionId;
  siteType: SiteType;
  siteName: string;
  characters: CharacterEntry[];
  hazardCreature: CardDefinitionId;
}) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: opts.site, characters: opts.characters }], hand: [], siteDeck: [] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [opts.hazardCreature], siteDeck: [] },
    ],
  });
  const mhState = makeMHState({
    resolvedSitePath: [],
    resolvedSitePathNames: [],
    destinationSiteType: opts.siteType,
    destinationSiteName: opts.siteName,
  });
  return { ...state, phaseState: mhState };
}

function playCreatureKeyed(state: ReturnType<typeof buildTestState>, keyValue: string) {
  const ltId = handCardId(state, HAZARD_PLAYER);
  const companyId = companyIdAt(state, RESOURCE_PLAYER);
  const afterPlay = dispatch(state, {
    type: 'play-hazard',
    player: PLAYER_2,
    cardInstanceId: ltId,
    targetCompanyId: companyId,
    keyedBy: { method: 'site-type' as const, value: keyValue },
  });
  return resolveChain(afterPlay);
}

describe('Shadow-cloak (le-344)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1 & 2: cancel a strike from a creature keyed to a Shadow-hold ────

  test('bearer facing a creature keyed to a Shadow-hold may tap Shadow-cloak to cancel the strike', () => {
    const state = mhWithCompany({
      site: MORIA_MINION,
      siteType: SiteType.ShadowHold,
      siteName: 'Moria',
      characters: [{ defId: ORC_CAPTAIN, items: [SHADOW_CLOAK] }],
      hazardCreature: ORC_LIEUTENANT,
    });

    const afterChain = playCreatureKeyed(state, 'shadow-hold');
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);

    const bearerId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ORC_CAPTAIN);
    const cloakId = getCharacter(afterChain, RESOURCE_PLAYER, ORC_CAPTAIN).items[0].instanceId;

    const r2 = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: bearerId, tapped: false });
    expect(r2.combat!.phase).toBe('resolve-strike');

    const cancels = computeLegalActions(r2, PLAYER_1).filter(a => a.viable && a.action.type === 'cancel-strike');
    expect(cancels).toHaveLength(1);
    expect(actionAs<CancelStrikeAction>(cancels[0].action).cancellerInstanceId).toBe(cloakId);
    expect(actionAs<CancelStrikeAction>(cancels[0].action).targetCharacterId).toBe(bearerId);

    // Applying the cancel taps the cloak (not the bearer) and removes the strike.
    const r3 = dispatch(r2, cancels[0].action);
    const bearerAfter = r3.players[RESOURCE_PLAYER].characters[bearerId];
    const cloakAfter = bearerAfter.items.find(i => i.instanceId === cloakId)!;
    expect(cloakAfter.status).toBe(CardStatus.Tapped);
    expect(bearerAfter.status).toBe(CardStatus.Untapped);

    const strike = r3.combat === null
      ? undefined
      : r3.combat.strikeAssignments.find(sa => sa.characterId === bearerId);
    if (strike) {
      expect(strike.resolved).toBe(true);
      expect(strike.result).toBe('canceled');
    } else {
      // Sole strike canceled → combat ends outright.
      expect(r3.combat).toBeNull();
    }
  });

  // ── Rule 3: no cancel against a creature keyed only to {w}/{R} ────────────

  test('bearer facing a creature keyed only to Wilderness/Ruins & Lairs cannot cancel', () => {
    const state = mhWithCompany({
      site: ETTENMOORS,
      siteType: SiteType.RuinsAndLairs,
      siteName: 'Ettenmoors',
      characters: [{ defId: ORC_CAPTAIN, items: [SHADOW_CLOAK] }],
      hazardCreature: LAND_DRAKE,
    });

    const afterChain = playCreatureKeyed(state, 'ruins-and-lairs');
    expect(afterChain.combat).not.toBeNull();

    const bearerId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ORC_CAPTAIN);
    const r2 = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: bearerId, tapped: false });
    expect(r2.combat!.phase).toBe('resolve-strike');

    const cancels = computeLegalActions(r2, PLAYER_1).filter(a => a.viable && a.action.type === 'cancel-strike');
    expect(cancels).toHaveLength(0);
  });

  // ── Rule 4: a tapped Shadow-cloak cannot cancel ──────────────────────────

  test('a tapped Shadow-cloak offers no cancel even against a Shadow-hold-keyed creature', () => {
    const base = mhWithCompany({
      site: MORIA_MINION,
      siteType: SiteType.ShadowHold,
      siteName: 'Moria',
      characters: [{ defId: ORC_CAPTAIN, items: [SHADOW_CLOAK] }],
      hazardCreature: ORC_LIEUTENANT,
    });

    const bearerKey = findCharInstanceId(base, RESOURCE_PLAYER, ORC_CAPTAIN);
    const bearerChar = base.players[RESOURCE_PLAYER].characters[bearerKey];
    const tappedCloak = { ...bearerChar.items[0], status: CardStatus.Tapped };
    const state = {
      ...base,
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          characters: { ...base.players[RESOURCE_PLAYER].characters, [bearerKey]: { ...bearerChar, items: [tappedCloak] } },
        },
        base.players[HAZARD_PLAYER],
      ] as typeof base.players,
    };

    const afterChain = playCreatureKeyed(state, 'shadow-hold');
    const bearerId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ORC_CAPTAIN);
    const r2 = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: bearerId, tapped: false });

    const cancels = computeLegalActions(r2, PLAYER_1).filter(a => a.viable && a.action.type === 'cancel-strike');
    expect(cancels).toHaveLength(0);
  });

  // ── Rule 5: only protects its own bearer ─────────────────────────────────

  test('Shadow-cloak does not cancel a strike against a different character in the company', () => {
    const state = mhWithCompany({
      site: MORIA_MINION,
      siteType: SiteType.ShadowHold,
      siteName: 'Moria',
      characters: [{ defId: ORC_CAPTAIN, items: [SHADOW_CLOAK] }, LUITPRAND],
      hazardCreature: ORC_LIEUTENANT,
    });

    const afterChain = playCreatureKeyed(state, 'shadow-hold');
    const luitprandId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LUITPRAND);
    const r2 = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: luitprandId, tapped: false });
    expect(r2.combat!.phase).toBe('resolve-strike');

    const cancels = computeLegalActions(r2, PLAYER_1).filter(a => a.viable && a.action.type === 'cancel-strike');
    expect(cancels).toHaveLength(0);
  });

  // ── Rule 6: cannot be duplicated on a given character ─────────────────────

  test('a character already bearing Shadow-cloak may not receive a second; another may', () => {
    const state = buildMinionSitePhaseState({
      site: MORIA_MINION,
      characters: [{ defId: ORC_CAPTAIN, items: [SHADOW_CLOAK] }, LUITPRAND],
      hand: [SHADOW_CLOAK],
    });

    const cloakInHand = findHandCardId(state, RESOURCE_PLAYER, SHADOW_CLOAK);
    const orcId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const luitprandId = findCharInstanceId(state, RESOURCE_PLAYER, LUITPRAND);

    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (cloakInHand as string),
    );
    const targets = plays.map(ea => (ea.action as { attachToCharacterId?: string }).attachToCharacterId);

    // Not offered on the character that already bears one.
    expect(targets).not.toContain(orcId as string);
    // Offered on the character without one.
    expect(targets).toContain(luitprandId as string);
  });
});
