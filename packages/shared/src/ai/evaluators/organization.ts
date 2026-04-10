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

import type { GameAction } from '../../types/actions.js';
import type { ActionEvaluator } from './types.js';
import type { AiContext } from '../strategy.js';
import { lookupDef, isCharacter, scoreDestinationSite, findSiteDef } from './common.js';

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
        const destDef = findSiteDef(view, pool, action.destinationSite);
        if (!destDef) return 1;
        return scoreDestinationSite(view, pool, destDef);
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

      case 'split-company':
        // Never split — the AI lacks the planning depth to evaluate whether
        // two separate travel plans justify the split. Aimless splits just
        // create weak companies that attract hazards without earning MP.
        return 0;

      case 'move-to-company':
        return 2;

      case 'move-to-influence':
        return 2;

      case 'transfer-item':
        return 2;

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
