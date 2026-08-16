/**
 * @module replay-transport
 *
 * The cursor arithmetic behind the replay transport bar, kept apart from the
 * DOM so the off-by-one-prone parts — which button lands on which frame, when
 * an end of the timeline disables one, when play wraps back to the start — can
 * be reasoned about and tested on their own.
 */

/** The transport buttons, in the order they appear on the bar. */
export type TransportAction = 'first' | 'prev' | 'play' | 'next' | 'last';

/** One recorded transition, as far as the bar's readout is concerned. */
export interface FrameLabelSource {
  readonly turn: number | null;
  readonly phase: string | null;
  readonly step: string | null;
}

/**
 * The frame a transport button moves to, or null when it would leave the
 * timeline. `play` is not a seek and is handled by the caller.
 */
export function targetFrame(action: TransportAction, cursor: number, total: number): number | null {
  if (total <= 0) return null;
  const target = action === 'first' ? 0
    : action === 'prev' ? cursor - 1
      : action === 'next' ? cursor + 1
        : action === 'last' ? total - 1
          : cursor;
  if (action === 'play') return null;
  return target >= 0 && target < total ? target : null;
}

/** Whether each transport button is inert at the current cursor. */
export function disabledActions(cursor: number, total: number): Record<TransportAction, boolean> {
  const atStart = cursor <= 0;
  const atEnd = cursor >= total - 1;
  return {
    first: atStart,
    prev: atStart,
    // Play is never disabled: at the end of the timeline it restarts from the
    // top rather than sitting dead on the last frame.
    play: total <= 1,
    next: atEnd,
    last: atEnd,
  };
}

/**
 * The frame playback advances to, or null when the timeline is finished.
 * Playing from the last frame restarts, so pressing play on a finished replay
 * watches it again instead of doing nothing.
 */
export function playFrom(cursor: number, total: number): number | null {
  if (total <= 0) return null;
  if (cursor >= total - 1) return 0;
  return cursor + 1;
}

/** The "Turn 4 · movement-hazard · site-arrival" readout for one frame. */
export function frameLabel(frame: FrameLabelSource): string {
  const turn = frame.turn != null ? `Turn ${frame.turn}` : null;
  return [turn, frame.phase, frame.step].filter(Boolean).join(' · ');
}
