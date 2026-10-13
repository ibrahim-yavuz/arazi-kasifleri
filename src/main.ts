import './styles/main.css';
import { Game } from './game/Game';

const app = document.getElementById('app')!;
const ui = document.getElementById('ui')!;
const loading = document.getElementById('loading')!;
const loadingSub = document.getElementById('loading-sub')!;

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  if (!webglAvailable()) {
    loadingSub.textContent = 'Bu tarayıcı WebGL desteklemiyor. Lütfen güncel bir masaüstü tarayıcı kullanın.';
    return;
  }
  const game = new Game(app, ui);
  try {
    await game.start((t) => (loadingSub.textContent = t));
    loading.remove();
  } catch (e) {
    console.error(e);
    loadingSub.textContent = `Oyun başlatılamadı: ${(e as Error).message}`;
  }
  window.addEventListener('beforeunload', () => game.dispose());
  // Development hook for automated browser testing (not present in production builds).
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
  if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());
}

void boot();
