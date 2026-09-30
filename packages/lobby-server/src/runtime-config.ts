/**
 * @module runtime-config
 *
 * The operator-editable `~/.meccg/config.json`. Kept apart from `config`,
 * whose import loads (and rewrites) the secrets file, so reading this has no
 * side effects.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Path of the operator-editable runtime config. */
export const RUNTIME_CONFIG_PATH = process.env.MECCG_CONFIG ?? path.join(os.homedir(), '.meccg', 'config.json');

/** Default sim agent spec for the AI-Modular opponent. */
export const DEFAULT_MODULAR_AGENT_SPEC = 'h2';

/**
 * Settings an operator may change on the server without a release: the file
 * sits beside `secrets.json`, so it survives deploys, and it is read each time
 * it is needed, so an edit takes effect on the next game with no restart.
 *
 * - `modularAgentSpec`: the sim agent spec the AI-Modular opponent plays, e.g.
 *   `h2:all/cyclingCombatCap=3/cyclingKeepAnswers=1` to turn on tunables that
 *   are off by default. Must be an `h2` spec — anything else is ignored, since
 *   the name AI-Modular is the save and rejoin key of that agent.
 */
export interface RuntimeConfig {
  readonly modularAgentSpec?: string;
}

/** Read the runtime config; a missing or unreadable file means defaults. */
export function readRuntimeConfig(): RuntimeConfig {
  try {
    return JSON.parse(fs.readFileSync(RUNTIME_CONFIG_PATH, 'utf-8')) as RuntimeConfig;
  } catch {
    return {};
  }
}

/** Whether a spec names the modular agent (`h2`, with or without overrides). */
export function isModularAgentSpec(spec: string | undefined): boolean {
  return spec === 'h2' || (spec?.startsWith('h2:') ?? false);
}

/** The spec AI-Modular plays right now: the runtime config's, or the default. */
export function modularAgentSpec(): string {
  const configured = readRuntimeConfig().modularAgentSpec?.trim();
  return configured && isModularAgentSpec(configured) ? configured : DEFAULT_MODULAR_AGENT_SPEC;
}
