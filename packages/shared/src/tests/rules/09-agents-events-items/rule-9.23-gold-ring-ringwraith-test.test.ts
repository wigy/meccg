/**
 * @module rule-9.23-gold-ring-ringwraith-test
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.23: Gold Ring Auto-Test in Ringwraith/Balrog Company
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [MINION] Any gold ring item being borne by a character in a Ringwraith's company is automatically tested at the beginning of the end-of-turn phase, and gold ring items tested in a Ringwraith's company have a -2 modification to the ring test roll.
 * [MINION] A Ringwraith player's gold ring items at Barad-Dûr are automatically tested at the beginning of the end-of-turn phase, and a Ringwraith player's gold ring items tested at Barad-Dûr have a -3 modification to the ring test roll.
 * [FALLEN-WIZARD] A hero gold ring item tested by a Fallen-wizard player has an additional -1 modification to the ring test roll.
 * [FALLEN-WIZARD] A Fallen-wizard player may play special ring items of any alignment and regardless of the alignment of the gold ring item tested.
 * [BALROG] Any gold ring item being borne by a character in a Balrog's company is automatically tested at the beginning of the end-of-turn phase, and gold ring items tested in a Balrog's company have a -2 modification to the ring test roll.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase, Alignment } from '../../../index.js';
import type { CardDefinitionId } from '../../../index.js';
import {
  buildTestState, resetMint, dispatch, attachItemToChar,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, RIVENDELL, LORIEN,
  makeSitePhase, viableActions, findCharInstanceId,
} from '../../test-helpers.js';

// Minion character (ORC_CAPTAIN) and minion sites
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const BARAD_DUR_MINION = 'le-352' as CardDefinitionId;

// Ringwraith avatar (race: ringwraith) — the company must actually contain
// this to be "a Ringwraith's company" per rule 9.23.
const ADUNAPHEL = 'le-50' as CardDefinitionId;

// Gold ring item (The Least of Gold Rings — minion-aligned)
const LEAST_OF_GOLD_RINGS = 'le-315' as CardDefinitionId;

// Hero gold ring (Precious Gold Ring — used for hero-vs-minion comparison)
const PRECIOUS_GOLD_RING = 'tw-306' as CardDefinitionId;

describe('Rule 9.23 — Gold Ring Auto-Test in Ringwraith/Balrog Company', () => {
  beforeEach(() => resetMint());

  test('[MINION] Gold ring in Ringwraith company auto-tested at end of turn with -2; [MINION] at Barad-Dûr with -3; [BALROG] in Balrog company with -2', () => {
    // Case 1: Ringwraith player with gold ring at a non-Barad-Dûr site → -2 modifier
    {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        recompute: true,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Ringwraith,
            companies: [{ site: CARN_DUM, characters: [ADUNAPHEL, ORC_CAPTAIN] }],
            hand: [],
            siteDeck: [MINAS_MORGUL],
          },
          {
            id: PLAYER_2,
            alignment: Alignment.Wizard,
            companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
            hand: [],
            siteDeck: [LORIEN],
          },
        ],
      });

      const charId = findCharInstanceId(base, RESOURCE_PLAYER, ORC_CAPTAIN);
      const withRing = attachItemToChar(base, RESOURCE_PLAYER, ORC_CAPTAIN, LEAST_OF_GOLD_RINGS);
      const ringInstId = withRing.players[RESOURCE_PLAYER].characters[charId].items[0].instanceId;

      const stateInSite = { ...withRing, phaseState: makeSitePhase({ step: 'play-resources', activeCompanyIndex: 0 }) };
      const afterPass = dispatch(stateInSite, { type: 'pass', player: PLAYER_1 });

      // EOT phase entered
      expect(afterPass.phaseState.phase).toBe(Phase.EndOfTurn);

      // Gold-ring-test should be queued with -2 modifier
      const goldRingPending = afterPass.pendingResolutions.find(
        r => r.kind.type === 'gold-ring-test' && r.kind.goldRingInstanceId === ringInstId,
      );
      expect(goldRingPending).toBeDefined();
      expect((goldRingPending!.kind as { rollModifier: number }).rollModifier).toBe(-2);

      // The roll action should be offered
      const rollActions = viableActions(afterPass, PLAYER_1, 'gold-ring-test-roll');
      expect(rollActions.length).toBeGreaterThan(0);
    }

    // Case 2: Ringwraith player with gold ring at Barad-Dûr → -3 modifier
    {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        recompute: true,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Ringwraith,
            companies: [{ site: BARAD_DUR_MINION, characters: [ORC_CAPTAIN] }],
            hand: [],
            siteDeck: [MINAS_MORGUL],
          },
          {
            id: PLAYER_2,
            alignment: Alignment.Wizard,
            companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
            hand: [],
            siteDeck: [LORIEN],
          },
        ],
      });

      const charId = findCharInstanceId(base, RESOURCE_PLAYER, ORC_CAPTAIN);
      const withRing = attachItemToChar(base, RESOURCE_PLAYER, ORC_CAPTAIN, LEAST_OF_GOLD_RINGS);
      const ringInstId = withRing.players[RESOURCE_PLAYER].characters[charId].items[0].instanceId;

      const stateInSite = { ...withRing, phaseState: makeSitePhase({ step: 'play-resources', activeCompanyIndex: 0 }) };
      const afterPass = dispatch(stateInSite, { type: 'pass', player: PLAYER_1 });

      expect(afterPass.phaseState.phase).toBe(Phase.EndOfTurn);

      // At Barad-Dûr, modifier should be -3
      const goldRingPending = afterPass.pendingResolutions.find(
        r => r.kind.type === 'gold-ring-test' && r.kind.goldRingInstanceId === ringInstId,
      );
      expect(goldRingPending).toBeDefined();
      expect((goldRingPending!.kind as { rollModifier: number }).rollModifier).toBe(-3);
    }

    // Case 3: Hero player (Wizard) with gold ring → NO auto-test at EOT
    {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        recompute: true,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Wizard,
            companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
            hand: [],
            siteDeck: [LORIEN],
          },
          {
            id: PLAYER_2,
            alignment: Alignment.Ringwraith,
            companies: [{ site: CARN_DUM, characters: [ORC_CAPTAIN] }],
            hand: [],
            siteDeck: [MINAS_MORGUL],
          },
        ],
      });

      const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);

      const stateInSite = { ...withRing, phaseState: makeSitePhase({ step: 'play-resources', activeCompanyIndex: 0 }) };
      const afterPass = dispatch(stateInSite, { type: 'pass', player: PLAYER_1 });

      expect(afterPass.phaseState.phase).toBe(Phase.EndOfTurn);

      // Hero player: no auto-test queued
      const goldRingPending = afterPass.pendingResolutions.find(r => r.kind.type === 'gold-ring-test');
      expect(goldRingPending).toBeUndefined();
    }

    // Case 4: Ringwraith player's gold ring in a company WITHOUT a Ringwraith
    // (e.g. an agents-only company), away from Barad-Dûr → NO auto-test.
    // "A Ringwraith's company" (rule 9.23 / glossary) means the specific
    // company containing the Ringwraith avatar, not every company belonging
    // to a Ringwraith-aligned player.
    {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        recompute: true,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Ringwraith,
            companies: [{ site: CARN_DUM, characters: [ORC_CAPTAIN] }],
            hand: [],
            siteDeck: [MINAS_MORGUL],
          },
          {
            id: PLAYER_2,
            alignment: Alignment.Wizard,
            companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
            hand: [],
            siteDeck: [LORIEN],
          },
        ],
      });

      const withRing = attachItemToChar(base, RESOURCE_PLAYER, ORC_CAPTAIN, LEAST_OF_GOLD_RINGS);

      const stateInSite = { ...withRing, phaseState: makeSitePhase({ step: 'play-resources', activeCompanyIndex: 0 }) };
      const afterPass = dispatch(stateInSite, { type: 'pass', player: PLAYER_1 });

      expect(afterPass.phaseState.phase).toBe(Phase.EndOfTurn);

      // No Ringwraith in the Orc Captain's company: no auto-test queued.
      const goldRingPending = afterPass.pendingResolutions.find(r => r.kind.type === 'gold-ring-test');
      expect(goldRingPending).toBeUndefined();
    }
  });
});
