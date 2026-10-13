/** Logical game actions. Several physical keys can map to one action. */
export type Action =
  | 'accelerate'
  | 'brake'
  | 'left'
  | 'right'
  | 'handbrake'
  | 'reset'
  | 'pause'
  | 'camera'
  | 'answerA'
  | 'answerB'
  | 'confirm'
  | 'debug'
  | 'tuning';

export const KEY_BINDINGS: Record<Action, string[]> = {
  accelerate: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  reset: ['KeyR'],
  pause: ['Escape', 'KeyP'],
  camera: ['KeyC'],
  answerA: ['KeyA', 'Digit1', 'Numpad1'],
  answerB: ['KeyB', 'Digit2', 'Numpad2'],
  confirm: ['Enter', 'NumpadEnter'],
  debug: ['F3', 'Backquote'],
  tuning: ['F4'],
};

const PREVENT_DEFAULT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'F3', 'F4']);

/**
 * Pure keyboard state (no DOM): which keys are held, and which were pressed since the last
 * `endFrame()`. Driving reads held state continuously every fixed step; menu/one-shot
 * actions read the edge-triggered pressed set.
 */
export class InputState {
  private held = new Set<string>();
  private pressed = new Set<string>();

  keyDown(code: string, repeat = false): void {
    if (!repeat && !this.held.has(code)) this.pressed.add(code);
    this.held.add(code);
  }

  keyUp(code: string): void {
    this.held.delete(code);
  }

  /** Releases everything (window blur / tab hidden), so no key gets stuck. */
  clear(): void {
    this.held.clear();
    this.pressed.clear();
  }

  isDown(action: Action): boolean {
    return KEY_BINDINGS[action].some((k) => this.held.has(k));
  }

  wasPressed(action: Action): boolean {
    return KEY_BINDINGS[action].some((k) => this.pressed.has(k));
  }

  /** Consumes an edge-triggered press so it is handled once. */
  consume(action: Action): boolean {
    let hit = false;
    for (const k of KEY_BINDINGS[action]) {
      if (this.pressed.delete(k)) hit = true;
    }
    return hit;
  }

  /** Consumes a press of one specific physical key. */
  consumeCode(code: string): boolean {
    return this.pressed.delete(code);
  }

  endFrame(): void {
    this.pressed.clear();
  }

  /** Continuous driving axes. */
  driving(): { throttle: number; brake: number; steer: number; handbrake: boolean } {
    const steer = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    return {
      throttle: this.isDown('accelerate') ? 1 : 0,
      brake: this.isDown('brake') ? 1 : 0,
      steer,
      handbrake: this.isDown('handbrake'),
    };
  }
}

/** Binds an InputState to window keyboard/focus events. */
export class InputManager {
  readonly state = new InputState();
  private readonly onDown = (e: KeyboardEvent) => {
    if (PREVENT_DEFAULT.has(e.code) && !(e.target instanceof HTMLInputElement)) e.preventDefault();
    this.state.keyDown(e.code, e.repeat);
  };
  private readonly onUp = (e: KeyboardEvent) => this.state.keyUp(e.code);
  private readonly onBlur = () => this.state.clear();

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
