/**
 * @module dice
 *
 * Animated 3D dice roller styled after the MECCG Lidless Eye dice set.
 * Die 1 is red with black pips; die 2 is black with red pips. The 1-face
 * on each die shows the Eye of Sauron instead of a single pip. The caller
 * provides predetermined results and the animation tumbles the dice with
 * physics-inspired easing before landing on those values.
 */

/**
 * Inline SVG for the Eye of Sauron, used on the 1-face of each die.
 * The fill color is set via CSS currentColor so it adapts to the die variant.
 */
const EYE_SVG = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="50" cy="50" rx="42" ry="28" fill="none" stroke="currentColor" stroke-width="4"/>
  <ellipse cx="50" cy="50" rx="30" ry="22" fill="currentColor" opacity="0.25"/>
  <ellipse cx="50" cy="50" rx="8" ry="22" fill="currentColor"/>
  <path d="M8 50 Q25 30 50 22 Q75 30 92 50" fill="none" stroke="currentColor" stroke-width="2.5" opacity="0.7"/>
  <path d="M8 50 Q25 70 50 78 Q75 70 92 50" fill="none" stroke="currentColor" stroke-width="2.5" opacity="0.7"/>
  <path d="M50 18 Q48 10 50 4 Q52 10 50 18" fill="currentColor" opacity="0.6"/>
  <path d="M50 82 Q48 90 50 96 Q52 90 50 82" fill="currentColor" opacity="0.6"/>
  <path d="M34 24 Q30 16 32 10 Q36 16 34 24" fill="currentColor" opacity="0.4"/>
  <path d="M66 24 Q70 16 68 10 Q64 16 66 24" fill="currentColor" opacity="0.4"/>
  <path d="M34 76 Q30 84 32 90 Q36 84 34 76" fill="currentColor" opacity="0.4"/>
  <path d="M66 76 Q70 84 68 90 Q64 84 66 76" fill="currentColor" opacity="0.4"/>
</svg>`;

/** Pip positions for each face value (2–6) on a 0–1 coordinate grid. */
const PIP_LAYOUTS: Record<number, [number, number][]> = {
  2: [[0.25, 0.25], [0.75, 0.75]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.5], [0.75, 0.5], [0.25, 0.75], [0.75, 0.75]],
};

/** X/Y rotation angles that show each face value toward the viewer. */
const FACE_ROTATIONS: Record<number, [number, number]> = {
  1: [0, 0],
  2: [90, 0],
  3: [0, -90],
  4: [0, 90],
  5: [-90, 0],
  6: [0, 180],
};

/** Die color variant: red body with black pips, or black body with red pips. */
type DieVariant = 'red' | 'black';

/** Create the 1-face with the Eye of Sauron instead of a pip. */
function createEyeFace(faceClass: string): HTMLElement {
  const face = document.createElement('div');
  face.className = `dice-face ${faceClass}`;
  const eyeWrapper = document.createElement('div');
  eyeWrapper.className = 'dice-eye';
  eyeWrapper.innerHTML = EYE_SVG;
  face.appendChild(eyeWrapper);
  return face;
}

/** Create a die face element with pips for values 2–6. */
function createPipFace(value: number, faceClass: string): HTMLElement {
  const face = document.createElement('div');
  face.className = `dice-face ${faceClass}`;

  for (const [px, py] of PIP_LAYOUTS[value]) {
    const pip = document.createElement('div');
    pip.className = 'dice-pip';
    pip.style.left = `${px * 100}%`;
    pip.style.top = `${py * 100}%`;
    face.appendChild(pip);
  }

  return face;
}

/** Build a 3D die cube element with the given color variant. */
function createDie(variant: DieVariant): HTMLElement {
  const scene = document.createElement('div');
  scene.className = 'dice-scene';

  const cube = document.createElement('div');
  cube.className = `dice-cube dice-${variant}`;

  // Front=1 (Eye of Sauron), back=6, right=3, left=4, top=5, bottom=2
  cube.appendChild(createEyeFace('dice-front'));
  cube.appendChild(createPipFace(6, 'dice-back'));
  cube.appendChild(createPipFace(3, 'dice-right'));
  cube.appendChild(createPipFace(4, 'dice-left'));
  cube.appendChild(createPipFace(5, 'dice-top'));
  cube.appendChild(createPipFace(2, 'dice-bottom'));

  scene.appendChild(cube);
  return scene;
}

/** Animate a single die to land on a target value. */
function animateDie(scene: HTMLElement, target: number, delay: number): void {
  const cube = scene.querySelector('.dice-cube') as HTMLElement;
  const [endX, endY] = FACE_ROTATIONS[target];

  // Add extra full rotations for tumbling effect
  const spinsX = (2 + Math.floor(Math.random() * 2)) * 360;
  const spinsY = (2 + Math.floor(Math.random() * 2)) * 360;

  // Start with a random orientation
  const startX = Math.random() * 360;
  const startY = Math.random() * 360;
  cube.style.transform = `rotateX(${startX}deg) rotateY(${startY}deg)`;

  requestAnimationFrame(() => {
    setTimeout(() => {
      cube.style.transition = 'transform 1.4s cubic-bezier(0.25, 1, 0.3, 1)';
      cube.style.transform = `rotateX(${endX + spinsX}deg) rotateY(${endY + spinsY}deg)`;
    }, delay);
  });
}

const overlays: Record<string, HTMLElement> = {};
const lastRolls: Record<string, { die1: number; die2: number }> = {};

/** Resolves when the current dice animation has finished tumbling. */
let animationPromise: Promise<void> = Promise.resolve();

/**
 * Wait for any in-progress dice animation to finish before proceeding.
 * Resolves immediately if no animation is active.
 */
export function waitForDice(): Promise<void> {
  return animationPromise;
}

/** Remove all dice overlays, clear stored roll state, and empty dice trays. */
export function clearDice(): void {
  for (const key of Object.keys(overlays)) {
    overlays[key].remove();
    delete overlays[key];
  }
  for (const key of Object.keys(lastRolls)) {
    delete lastRolls[key];
  }
  for (const id of ['self-dice-tray', 'opponent-dice-tray']) {
    const tray = document.getElementById(id);
    if (tray) tray.innerHTML = '';
  }
}

/** Remove a specific dice overlay by variant. */
function dismiss(variant: string): void {
  const ov = overlays[variant];
  if (!ov) return;
  ov.classList.add('dice-fade-out');
  setTimeout(() => {
    ov.remove();
    if (overlays[variant] === ov) delete overlays[variant];
  }, 300);
}

/**
 * Show a dice roll animation overlay. Both dice use the same color
 * variant: black pair for self, red pair for opponent.
 *
 * @param die1 - Result for the first die (1–6).
 * @param die2 - Result for the second die (1–6).
 * @param variant - Color variant for both dice ('red' or 'black').
 */
export function rollDice(die1: number, die2: number, variant: 'red' | 'black' = 'red'): void {
  lastRolls[variant] = { die1, die2 };

  // Set up a promise that resolves when the tumbling animation completes.
  // State updates wait on this so the result isn't spoiled mid-roll.
  animationPromise = new Promise(resolve => {
    setTimeout(resolve, 1800);
  });

  // Remove existing overlay for this variant only
  if (overlays[variant]) {
    overlays[variant].remove();
    delete overlays[variant];
  }

  const overlay = document.createElement('div');
  overlay.className = 'dice-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismiss(variant);
  });
  overlays[variant] = overlay;

  const container = document.createElement('div');
  container.className = `dice-container dice-position-${variant}`;

  const diceRow = document.createElement('div');
  diceRow.className = 'dice-row';

  const dieEl1 = createDie(variant);
  const dieEl2 = createDie(variant);
  diceRow.appendChild(dieEl1);
  diceRow.appendChild(dieEl2);

  container.appendChild(diceRow);
  overlay.appendChild(container);
  document.body.appendChild(overlay);

  // Trigger animations with staggered starts
  animateDie(dieEl1, die1, 0);
  animateDie(dieEl2, die2, 100);

  // After roll animation, dismiss overlay and place dice in the tray
  setTimeout(() => {
    dismiss(variant);
    restoreDice();
  }, 1800);
}

/**
 * Restore previously rolled dice at their resting positions (no animation).
 * Called when switching back to visual mode.
 */
export function restoreDice(): void {
  for (const variant of ['red', 'black'] as const) {
    const roll = lastRolls[variant];
    const trayId = variant === 'black' ? 'self-dice-tray' : 'opponent-dice-tray';
    const tray = document.getElementById(trayId);
    if (!tray) continue;

    // Clear tray and skip if no roll
    if (!roll) { tray.innerHTML = ''; continue; }
    // Already populated
    if (tray.children.length > 0) continue;

    const dieEl1 = createDie(variant);
    const dieEl2 = createDie(variant);

    // Apply mini size
    dieEl1.classList.add('dice-mini');
    dieEl2.classList.add('dice-mini');

    // Set dice to their final values immediately
    const cube1 = dieEl1.querySelector('.dice-cube') as HTMLElement;
    const cube2 = dieEl2.querySelector('.dice-cube') as HTMLElement;
    const [x1, y1] = FACE_ROTATIONS[roll.die1];
    const [x2, y2] = FACE_ROTATIONS[roll.die2];
    cube1.style.transform = `rotateX(${x1}deg) rotateY(${y1}deg)`;
    cube2.style.transform = `rotateX(${x2}deg) rotateY(${y2}deg)`;

    tray.innerHTML = '';
    tray.appendChild(dieEl1);
    tray.appendChild(dieEl2);
  }
}

/**
 * Seed the dice animation state from the game view so that restoreDice()
 * can recreate the floating dice after a load or reconnect.
 */
export function seedDiceFromState(view: { self: { lastDiceRoll: { die1: number; die2: number } | null }; opponent: { lastDiceRoll: { die1: number; die2: number } | null } }): void {
  if (view.self.lastDiceRoll) {
    lastRolls['black'] = view.self.lastDiceRoll;
  } else {
    delete lastRolls['black'];
    if (overlays['black']) { overlays['black'].remove(); delete overlays['black']; }
  }
  if (view.opponent.lastDiceRoll) {
    lastRolls['red'] = view.opponent.lastDiceRoll;
  } else {
    delete lastRolls['red'];
    if (overlays['red']) { overlays['red'].remove(); delete overlays['red']; }
  }
}

/**
 * Create a small static die showing a specific face value, for inline display.
 * Returns a dice-scene element sized via CSS class `dice-mini`.
 */
export function createMiniDie(value: number, variant: DieVariant): HTMLElement {
  const scene = document.createElement('div');
  scene.className = 'dice-scene dice-mini';

  const cube = document.createElement('div');
  cube.className = `dice-cube dice-${variant}`;

  // Build all 6 faces (needed for the 3D cube structure)
  cube.appendChild(createEyeFace('dice-front'));
  cube.appendChild(createPipFace(6, 'dice-back'));
  cube.appendChild(createPipFace(3, 'dice-right'));
  cube.appendChild(createPipFace(4, 'dice-left'));
  cube.appendChild(createPipFace(5, 'dice-top'));
  cube.appendChild(createPipFace(2, 'dice-bottom'));

  // Rotate to show the target face
  const [rx, ry] = FACE_ROTATIONS[value];
  cube.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;

  scene.appendChild(cube);
  return scene;
}
