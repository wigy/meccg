/**
 * @module ask-ai.test
 *
 * The Ask AI control's decisions (`specs/2026-08-17-ask-ai-observer.md`): when
 * the toolbar icon shows, and what the panel says for every answer the server
 * can send — including the refusals, which have to tell the reader what to do
 * rather than just that something went wrong.
 */

import { describe, test, expect } from 'vitest';
import type { AiExplanationMessage, PlayerId } from '@meccg/shared';
import { askAiButtonState, askAiPendingText, formatAskAiPanel } from './ask-ai.js';

describe('askAiButtonState', () => {
  test('is hidden with no observer attached', () => {
    expect(askAiButtonState({ attached: false, agent: null })).toEqual({ visible: false, title: '' });
  });

  test('names the agent, because the answer differs per agent', () => {
    expect(askAiButtonState({ attached: true, agent: 'mc:ms=2000/turns=2' })).toEqual({
      visible: true,
      title: 'Ask AI (mc:ms=2000/turns=2)',
    });
  });

  test('shows even for an attached observer that did not name its agent', () => {
    expect(askAiButtonState({ attached: true, agent: null })).toEqual({
      visible: true,
      title: 'Ask AI',
    });
  });

  test('does not depend on being seated or on dev mode', () => {
    // Availability is decided by attachment alone: a spectator watching an AI
    // game is one of the readers this exists for, and nothing here can alter
    // the game, so there is nothing for a dev gate to protect.
    const attached = askAiButtonState({ attached: true, agent: 'h2' });
    expect(attached.visible).toBe(true);
  });
});

describe('formatAskAiPanel', () => {
  const base = { type: 'ai-explanation', requestId: 'ask-1' } as const;

  test('renders the explanation with the seat and the time it took', () => {
    const text = formatAskAiPanel({
      ...base,
      status: 'ok',
      agent: 'h2',
      forPlayer: 'p1' as PlayerId,
      stateSeq: 140,
      lines: ['PICK  Pass', '', 'RANKING  2 candidates'],
      elapsedMs: 1_450,
    });
    expect(text.heading).toBe('h2 — p1 (1.4s)');
    expect(text.body).toBe('PICK  Pass\n\nRANKING  2 candidates');
  });

  test('an answer without a timing still gets a clean heading', () => {
    const text = formatAskAiPanel({
      ...base, status: 'ok', agent: 'heuristic', forPlayer: 'p2' as PlayerId, lines: ['x'],
    });
    expect(text.heading).toBe('heuristic — p2');
  });

  test('"no observer" says how to start one', () => {
    const text = formatAskAiPanel({
      ...base, status: 'unavailable', agent: null, message: 'No observer is attached.',
    });
    expect(text.heading).toBe('No observer attached');
    expect(text.body).toContain('bin/observe --agent h2');
  });

  test('a timeout names the agent and suggests a cheaper one', () => {
    const text = formatAskAiPanel({
      ...base, status: 'timeout', agent: 'mc:ms=120000', message: 'The observer did not answer within 90s.',
    });
    expect(text.heading).toContain('mc:ms=120000');
    expect(text.body).toContain('90s');
    expect(text.body).toContain('h2');
  });

  test('an error shows the reason the observer gave', () => {
    const text = formatAskAiPanel({
      ...base, status: 'error', agent: 'h2', message: 'game log unreadable',
    });
    expect(text.heading).toBe('h2 could not answer');
    expect(text.body).toBe('game log unreadable');
  });

  test('a reasonless error still says something', () => {
    const text = formatAskAiPanel({ ...base, status: 'error', agent: null } as AiExplanationMessage);
    expect(text.heading).toBe('the AI could not answer');
    expect(text.body.length).toBeGreaterThan(0);
  });
});

describe('askAiPendingText', () => {
  test('names the agent being asked, so a slow answer is explicable', () => {
    expect(askAiPendingText({ attached: true, agent: 'mc:ms=2000' }).heading)
      .toBe('Asking mc:ms=2000…');
  });
});
