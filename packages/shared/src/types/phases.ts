import { Phase } from './state.js';
import type { GameAction } from './actions.js';

export const PHASE_ORDER: readonly Phase[] = [
  Phase.Untap,
  Phase.Organization,
  Phase.LongEvent,
  Phase.MovementHazard,
  Phase.Site,
  Phase.EndOfTurn,
];

export const LEGAL_ACTIONS_BY_PHASE: Readonly<Record<Phase, readonly GameAction['type'][]>> = {
  [Phase.CharacterDraft]: [
    'draft-pick',
    'draft-stop',
  ],

  [Phase.Untap]: ['pass'],

  [Phase.Organization]: [
    'play-character',
    'split-company',
    'merge-companies',
    'transfer-item',
    'plan-movement',
    'cancel-movement',
    'pass',
  ],

  [Phase.LongEvent]: ['pass'],

  [Phase.MovementHazard]: [
    'play-hazard',
    'assign-strike',
    'resolve-strike',
    'support-strike',
    'corruption-check',
    'pass',
  ],

  [Phase.Site]: [
    'play-hero-resource',
    'influence-attempt',
    'play-minor-item',
    'corruption-check',
    'pass',
  ],

  [Phase.EndOfTurn]: [
    'draw-cards',
    'discard-card',
    'call-free-council',
    'pass',
  ],

  [Phase.FreeCouncil]: [
    'corruption-check',
    'pass',
  ],

  [Phase.GameOver]: [],
};
