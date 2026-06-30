/**
 * @module test-helpers
 *
 * Shared test utilities for creating game configs, building states, dispatching
 * actions and asserting outcomes. This module is a thin re-export barrel over
 * the split test-helpers-* modules (constants, queries, assertions, dispatch,
 * core, builders) so test files keep importing everything from `test-helpers.js`
 * unchanged.
 */

import { autoMergeNonHavenCompanies as _autoMergeNonHavenCompanies } from '../engine/reducer-utils.js';

export * from './test-helpers-constants.js';
export * from './test-helpers-queries.js';
export * from './test-helpers-assertions.js';
export * from './test-helpers-dispatch.js';
export * from './test-helpers-core.js';
export * from './test-helpers-builders.js';

/**
 * Rule 2.IV.6 primitive: auto-join companies at the same non-haven site at the
 * end of all movement/hazard phases. Re-exported here so rules tests for that
 * transition can invoke it without reaching into internal engine modules.
 */
export const autoMergeNonHavenCompanies = _autoMergeNonHavenCompanies;
