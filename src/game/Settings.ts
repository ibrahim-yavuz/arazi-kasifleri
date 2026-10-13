/** Player-facing options (persisted per browser; the game works if storage is unavailable). */
export interface Settings {
  /** 0 = Düşük, 1 = Orta, 2 = Yüksek. */
  quality: 0 | 1 | 2;
  /** Master volume 0..1. */
  volume: number;
  muted: boolean;
  /** 0 = yakın takip, 1 = uzak takip, 2 = kaput. */
  cameraMode: number;
  /** The controls guide is shown before the first race only. */
  seenControls: boolean;
  /** Name shown to other players online. */
  playerName: string;
}

const KEY = 'arazi-kasifleri-settings-v1';

export const DEFAULT_SETTINGS: Settings = {
  quality: 1,
  volume: 0.7,
  muted: false,
  cameraMode: 0,
  seenControls: false,
  playerName: '',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* storage unavailable: use defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export interface ScoreEntry {
  time: number;
  vehicle: string;
  route: string;
  collected: number;
  date: string;
}

const SCORE_KEY = 'arazi-kasifleri-scores-v1';

export function loadScores(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(SCORE_KEY);
    if (raw) return (JSON.parse(raw) as ScoreEntry[]).slice(0, 10);
  } catch {
    /* ignore */
  }
  return [];
}

/** Adds a score, keeps the best 10. Returns the 1-based rank or 0 if not in the table. */
export function addScore(entry: ScoreEntry): number {
  const list = loadScores();
  list.push(entry);
  list.sort((a, b) => a.time - b.time);
  const top = list.slice(0, 10);
  try {
    localStorage.setItem(SCORE_KEY, JSON.stringify(top));
  } catch {
    /* ignore */
  }
  const idx = top.indexOf(entry);
  return idx >= 0 ? idx + 1 : 0;
}
