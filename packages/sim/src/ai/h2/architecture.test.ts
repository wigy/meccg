/**
 * @module ai/h2/architecture.test
 *
 * Structural guards against the failure mode §9 of the plan calls "module
 * sprawl / hidden coupling".
 *
 * These are written before the modules exist deliberately. A rule that arrives
 * after the second module has already reached into the first is a rule nobody
 * can enforce without a refactor; a rule that is already failing the moment
 * the import is written costs one line to obey.
 */

import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ALL_MODULES } from './core/registry.js';

const H2_ROOT = __dirname;
const MODULES_DIR = path.join(H2_ROOT, 'modules');

/** Every `.ts` source file under a directory, tests excluded. */
function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** Import specifiers used by a source file. */
function importsOf(file: string): string[] {
  const source = fs.readFileSync(file, 'utf-8');
  return [...source.matchAll(/from\s+'([^']+)'/g)].map(m => m[1]);
}

/**
 * Which module a path belongs to, or `null` when it is outside `modules/`.
 * Works for both layouts — `modules/combat.ts` and `modules/combat/x.ts` —
 * so the guard does not quietly stop applying if the layout changes.
 */
function moduleOwning(target: string): string | null {
  const relative = path.relative(MODULES_DIR, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const [head] = relative.split(path.sep);
  return head.endsWith('.ts') ? head.slice(0, -'.ts'.length) : head.replace(/\.js$/, '');
}

describe('module boundaries', () => {
  test('no module imports another module directly', () => {
    // Cross-module access goes through a declared service on the module
    // context, which is what lets `combat` be tested against a stub `hand`
    // and lets a module be ablated in a gate without dragging its neighbours
    // along.
    const offenders: string[] = [];
    for (const file of sourceFiles(MODULES_DIR)) {
      const own = moduleOwning(file);
      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith('.')) continue;
        const target = moduleOwning(path.resolve(path.dirname(file), specifier));
        if (target !== null && target !== own) {
          offenders.push(`${path.relative(H2_ROOT, file)} → ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the ownership registry has no duplicate names or contested action types', () => {
    const names = ALL_MODULES.map(m => m.name);
    expect(new Set(names).size).toBe(names.length);

    const owner = new Map<string, string>();
    const contested: string[] = [];
    for (const module of ALL_MODULES) {
      for (const type of module.ownedActionTypes) {
        const existing = owner.get(type);
        if (existing) contested.push(`${type}: ${existing} and ${module.name}`);
        else owner.set(type, module.name);
      }
    }
    expect(contested).toEqual([]);
  });
});
