/**
 * @module ai/evaluators/organization
 *
 * Heuristic scoring for the Organization phase: untap, character recruiting,
 * company management, movement planning, permanent events.
 *
 * Strategy: prefer playing characters with high MP / prowess / DI; only plan
 * movement when there are hand cards playable at the destination; merge tiny
 * companies; never split (the AI lacks planning depth to justify it).
 */

import type { GameAction } from '@meccg/shared';
import type { ActionEvaluator } from './types.js';
import type { AiContext } from '../strategy.js';
import {
  lookupDef,
  isCharacter,
  scoreDestinationSite,
  findSiteDef,
  isWounded,
  woundedCharactersInCompany,
  isHealingSite,
  hasHealingAvailable,
} from './common.js';

export const organizationEvaluator: ActionEvaluator = {
  phases: ['organization', 'untap'],

  score(action: GameAction, context: AiContext): number | null {
    const view = context.view;
    const pool = context.cardPool;

    switch (action.type) {
      case 'untap':
        return 100;

      case 'play-character': {
        const card = view.self.hand.find(c => c.instanceId === action.characterInstanceId);
        if (!card) return 1;
        const def = lookupDef(pool, card.definitionId);
        if (!isCharacter(def)) return 1;
        const score = def.marshallingPoints * 5 + def.prowess + def.directInfluence * 2;
        // Penalize heavy minds when influence pool is already strained.
        const mind = def.mind ?? 0;
        const giUsed = view.self.generalInfluenceUsed;
        const headroom = 20 - giUsed - mind;
        const penalty = headroom < 0 ? 50 : (headroom < 3 ? 5 : 0);
        return Math.max(1, score - penalty);
      }

      case 'play-permanent-event': {
        // Permanent events are typically free MPs / utility — strongly preferred.
        return 30;
      }

      case 'plan-movement': {
        // Score the destination by how many of our hand cards become playable
        // there, the resource-draw box on the site card, minus a danger
        // penalty for the site type and traversed regions. Only move when
        // there is a concrete payoff — aimless travel wastes turns and
        // exposes the company to hazards for no gain.
        //
        // Wounded-routing: if the moving company carries a wounded
        // character and has no healing item/spell available, steer the
        // company toward a healing site (haven or heal-during-untap
        // location). Prefer healing destinations; penalize non-healing
        // ones to nudge the AI home before the wound compounds into a
        // body-check loss.
        const destDef = findSiteDef(view, pool, action.destinationSite);
        if (!destDef) return 1;
        const base = scoreDestinationSite(view, pool, destDef);
        const company = view.self.companies.find(c => c.id === action.companyId);
        if (!company) return base;
        const wounded = woundedCharactersInCompany(view, company);
        if (wounded.length === 0) return base;
        if (hasHealingAvailable(view, pool, company)) return base;
        if (isHealingSite(destDef)) {
          return Math.max(base, 30) + wounded.length * 20;
        }
        return Math.max(1, Math.floor(base / 2));
      }

      case 'cancel-movement':
        // Cancel a previously planned movement only when there is nothing
        // worth visiting — the dispatcher's normalization will handle that.
        return 1;

      case 'merge-companies': {
        // Merging is conservative — small bonus.
        const source = view.self.companies.find(c => c.id === action.sourceCompanyId);
        const target = view.self.companies.find(c => c.id === action.targetCompanyId);
        if (!source || !target) return 2;
        // Merging two singletons is good. Merging into a giant is bad (hazard limit).
        if (source.characters.length === 1 && target.characters.length <= 2) return 8;
        return 2;
      }

      case 'split-company': {
        // Default: don't split — the AI lacks the planning depth to
        // evaluate whether two separate travel plans justify the split.
        //
        // Exception: when the source company has wounded and healthy
        // characters mixed, splitting lets the wounded group head to a
        // haven for healing while the healthy group keeps earning MPs.
        // Only enable the split if no in-company healing item/spell is
        // already available (that path is strictly cheaper).
        const source = view.self.companies.find(c => c.id === action.sourceCompanyId);
        if (!source) return 0;
        const wounded = woundedCharactersInCompany(view, source);
        if (wounded.length === 0 || wounded.length === source.characters.length) return 0;
        if (hasHealingAvailable(view, pool, source)) return 0;
        const movingChar = view.self.characters[action.characterId];
        if (!movingChar) return 0;
        // Score proportional to how many wounded characters are being
        // isolated from how many healthy ones. Only score the candidate
        // actions that actually cleave the two groups — moving a solo
        // wounded into a new company is the canonical heal-split.
        const movingIsWounded = isWounded(movingChar);
        const staying = source.characters.length - 1;
        if (staying <= 0) return 0;
        return movingIsWounded ? 15 : 10;
      }

      case 'move-to-company':
        return 2;

      case 'move-to-influence':
        return 2;

      case 'transfer-item':
        // Never shuffle items around — the AI lacks the tactical depth to
        // know when a transfer is beneficial, and random transfers just
        // waste actions.
        return 0;

      case 'activate-granted-action':
        // Removing attached hazards is high value when likely to succeed.
        return 8;

      case 'pass':
        // Pass at a moderate weight: lower than a good play (which scores
        // 20+) but higher than mediocre busy-work, so the AI advances the
        // phase rather than thrashing on low-value moves.
        return 5;

      default:
        return null;
    }
  },
};
