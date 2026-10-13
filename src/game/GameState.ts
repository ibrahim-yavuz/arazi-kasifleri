/** Top-level game phases (the race itself has its own sub-phases in RaceSession). */
export type Phase =
  | 'loading'
  | 'menu'
  | 'online'
  | 'room'
  | 'options'
  | 'howto'
  | 'scores'
  | 'select'
  | 'intro'
  | 'race'
  | 'paused'
  | 'quiz'
  | 'results'
  | 'test'
  | 'error';

/** Phases that render the 3D race world. */
export const WORLD_PHASES: ReadonlySet<Phase> = new Set<Phase>(['intro', 'race', 'paused', 'quiz', 'results', 'test']);

/** Engine firing pulses per crank revolution (cylinders / 2), for the engine sound. */
export const ENGINE_PULSES: Record<string, number> = {
  panter: 4,
  orumcek: 2,
  boga: 4,
  akrep: 4,
};

export function isDevMode(): boolean {
  const q = new URLSearchParams(window.location.search);
  return import.meta.env.DEV || q.has('debug');
}
