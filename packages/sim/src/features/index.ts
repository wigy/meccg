/**
 * @module features
 *
 * The featurization layer of the AI training plan (P3): converts projected
 * player views and evaluated action candidates into versioned numeric
 * feature data shared by behavioral cloning, self-play RL, and search.
 * Everything here consumes only the {@link PlayerView} projection — never
 * the raw `GameState` — so the hidden-information boundary holds by
 * construction. Bump {@link FEATURE_SPEC_VERSION} on ANY change to vector
 * layouts, zone numbering, action-type ordering, or scaling.
 */

/**
 * Version of the feature layout. Exported training data records it, and
 * the learning side refuses mismatched data.
 */
export const FEATURE_SPEC_VERSION = 1;

export { buildCardVocab } from './vocab.js';
export type { CardVocab } from './vocab.js';

export { ACTION_TYPES, actionTypeIndex } from './action-types.js';

export {
  featurizeState,
  GLOBAL_FEATURE_NAMES,
  GLOBAL_FEATURE_WIDTH,
  ENTITY_FEATURE_NAMES,
  ENTITY_FEATURE_WIDTH,
  ENTITY_ZONES,
} from './state.js';
export type { StateFeatures } from './state.js';

export { featurizeActions, ACTION_FEATURE_NAMES, ACTION_FEATURE_WIDTH } from './action.js';
export type { ActionFeatures } from './action.js';
