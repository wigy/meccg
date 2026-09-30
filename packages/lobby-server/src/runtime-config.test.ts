/**
 * @module runtime-config.test
 * The operator-editable `~/.meccg/config.json`: which spec AI-Modular plays.
 */

import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meccg-config-'));
const file = path.join(dir, 'config.json');
let config: typeof import('./runtime-config.js');

beforeAll(async () => {
  process.env.MECCG_CONFIG = file;
  config = await import('./runtime-config.js');
});
afterAll(() => {
  delete process.env.MECCG_CONFIG;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the AI-Modular spec from the runtime config', () => {
  test('defaults to plain h2 without a config file', () => {
    fs.rmSync(file, { force: true });
    expect(config.modularAgentSpec()).toBe('h2');
  });

  test('reads an h2 spec with overrides, fresh on every call', () => {
    fs.writeFileSync(file, JSON.stringify({ modularAgentSpec: 'h2:all/cyclingCombatCap=3' }));
    expect(config.modularAgentSpec()).toBe('h2:all/cyclingCombatCap=3');
    fs.writeFileSync(file, JSON.stringify({ modularAgentSpec: 'h2:all/cyclingKeepAnswers=1' }));
    expect(config.modularAgentSpec()).toBe('h2:all/cyclingKeepAnswers=1');
  });

  test('ignores a spec that is not h2, and an unreadable file', () => {
    fs.writeFileSync(file, JSON.stringify({ modularAgentSpec: 'mc:ms=2000' }));
    expect(config.modularAgentSpec()).toBe('h2');
    fs.writeFileSync(file, '{ not json');
    expect(config.modularAgentSpec()).toBe('h2');
  });

  test('every h2 spec names the AI-Modular seat', () => {
    expect(config.isModularAgentSpec('h2')).toBe(true);
    expect(config.isModularAgentSpec('h2:all/cyclingCombatCap=3')).toBe(true);
    expect(config.isModularAgentSpec('heuristic')).toBe(false);
    expect(config.isModularAgentSpec(undefined)).toBe(false);
  });
});
