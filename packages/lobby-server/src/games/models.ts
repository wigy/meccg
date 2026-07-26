/**
 * @module games/models
 *
 * Trained Real-AI model discovery for the lobby. Models are the weights
 * JSON files the training pipeline drops into `~/.meccg/models` (see
 * `packages/sim/train/`); the lobby lists them for the "Play vs Real-AI"
 * picker and validates the client's selection against the listing so a
 * lobby message can never smuggle a filesystem path — only a bare file
 * name that actually exists in the models directory is accepted.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Directory the training pipeline publishes model weights into. */
export const MODELS_DIR = path.join(os.homedir(), '.meccg', 'models');

/** One selectable Real-AI model. */
export interface ModelInfo {
  /** Bare file name (the id the client sends back). */
  readonly file: string;
  /** Display label: file name without extension. */
  readonly label: string;
}

/**
 * Lists the model files available for Real-AI games, newest first.
 * Returns an empty list when the directory does not exist.
 */
export function listModels(): ModelInfo[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(MODELS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.json'))
    .map(e => ({
      name: e.name,
      mtime: fs.statSync(path.join(MODELS_DIR, e.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(e => ({ file: e.name, label: e.name.replace(/\.json$/, '') }));
}

/**
 * Resolves a client-supplied model file name to an absolute path, or null
 * when it is not exactly one of the listed files (path separators, `..`,
 * or unknown names are all rejected).
 */
export function resolveModelFile(name: string): string | null {
  if (name !== path.basename(name)) return null;
  if (!listModels().some(m => m.file === name)) return null;
  return path.join(MODELS_DIR, name);
}
