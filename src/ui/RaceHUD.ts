import { Minimap } from './Minimap';
import { formatRaceTime } from '../gameplay/TimerSystem';
import { CONTROLS_HTML } from './MainMenu';
import { el } from './dom';
import type { Nav, Screen } from './dom';

export interface HUDState {
  time: number;
  speedKmh: number;
  rpm: number;
  maxRpm: number;
  gear: number;
  route: string;
  position: number;
  racers: number;
  collected: number;
  score: number;
  /** "?" signs collected (questions waiting at the finish). */
  questions: number;
  turbo: number;
  progress: number;
}

/** Analog speedometer (black dial, white ticks, red needle, km/h). */
class Speedometer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size = 190;

  constructor(parent: HTMLElement) {
    this.canvas = el('canvas', 'hud-speedo', undefined, parent);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = this.size * dpr;
    this.canvas.height = this.size * dpr;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
  }

  draw(kmh: number, rpm: number, maxRpm: number, gear: number): void {
    const c = this.ctx;
    const S = this.size;
    const cx = S / 2;
    const cy = S / 2;
    const R = S / 2 - 6;
    c.clearRect(0, 0, S, S);
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    const g = c.createRadialGradient(cx, cy - 20, 10, cx, cy, R);
    g.addColorStop(0, '#3a3a3a');
    g.addColorStop(1, '#0d0d0d');
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 5;
    c.strokeStyle = '#d8d8d8';
    c.stroke();
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    const maxKmh = 200;
    // RPM arc.
    const ra = a0 + (a1 - a0) * Math.min(1, rpm / maxRpm);
    c.beginPath();
    c.arc(cx, cy, R - 10, a0, ra);
    c.strokeStyle = rpm > maxRpm * 0.9 ? '#ff4d3a' : '#f6b31a';
    c.lineWidth = 4;
    c.stroke();
    c.fillStyle = '#fff';
    c.strokeStyle = '#fff';
    c.font = 'bold 12px Arial';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let v = 0; v <= maxKmh; v += 10) {
      const a = a0 + ((a1 - a0) * v) / maxKmh;
      const major = v % 20 === 0;
      c.lineWidth = major ? 2.5 : 1.2;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * (R - 18), cy + Math.sin(a) * (R - 18));
      c.lineTo(cx + Math.cos(a) * (R - (major ? 30 : 25)), cy + Math.sin(a) * (R - (major ? 30 : 25)));
      c.stroke();
      if (major) c.fillText(String(v), cx + Math.cos(a) * (R - 44), cy + Math.sin(a) * (R - 44));
    }
    c.font = 'bold 11px Arial';
    c.fillStyle = '#bbb';
    c.fillText('km/h', cx, cy + 26);
    c.font = 'bold 22px Consolas, monospace';
    c.fillStyle = '#fff';
    c.fillText(String(Math.round(kmh)), cx, cy + 50);
    c.font = 'bold 13px Arial';
    c.fillStyle = '#f6d13a';
    c.fillText(gear < 0 ? 'G' : `${gear}. vites`, cx, cy - 34);
    const a = a0 + ((a1 - a0) * Math.min(kmh, maxKmh)) / maxKmh;
    c.strokeStyle = '#ff3b1f';
    c.lineWidth = 4;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(cx - Math.cos(a) * 12, cy - Math.sin(a) * 12);
    c.lineTo(cx + Math.cos(a) * (R - 24), cy + Math.sin(a) * (R - 24));
    c.stroke();
    c.fillStyle = '#ddd';
    c.beginPath();
    c.arc(cx, cy, 8, 0, Math.PI * 2);
    c.fill();
  }
}

const BADGE_SVG = `<svg viewBox="0 0 32 32"><path d="M9 3h14v4c0 4-4 6-5 9 1 3 5 5 5 9v4H9v-4c0-4 4-6 5-9-1-3-5-5-5-9z" fill="#fff" stroke="#0d3f86" stroke-width="1.5"/><path d="M12 25c1-2 3-3 4-5 1 2 3 3 4 5z" fill="#ffb21a"/></svg>`;

/** In-race HUD: timer top-right, collectible badge, route/position, analog speedometer. */
export class RaceHUD implements Screen {
  readonly root: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly count: HTMLElement;
  private readonly route: HTMLElement;
  private readonly score: HTMLElement;
  private readonly turbo: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly countdownEl: HTMLElement;
  private readonly finishEl: HTMLElement;
  private readonly speedo: Speedometer;
  readonly minimap: Minimap;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', undefined, parent);
    this.route = el('div', 'hud-route', '', this.root);
    this.timer = el('div', 'hud-timer', '00:00:00', this.root);
    const badge = el('div', 'hud-badge', undefined, this.root);
    badge.innerHTML = BADGE_SVG;
    this.count = el('div', 'count', '0', badge);
    this.score = el('div', 'hud-score', '', this.root);
    this.turbo = el('div', 'hud-turbo', '', this.root);
    this.speedo = new Speedometer(this.root);
    this.minimap = new Minimap(this.root);
    this.toasts = el('div', 'hud-toast', undefined, this.root);
    this.countdownEl = el('div', 'countdown', '', this.root);
    this.finishEl = el('div', 'finish-banner', 'BİTİŞ!', this.root);
    el('div', 'hud-help', 'R: geri koy · C: kamera · M: harita · Esc: duraklat', this.root);
    this.finishEl.hidden = true;
    this.countdownEl.hidden = true;
    this.hide();
  }

  update(s: HUDState): void {
    this.timer.textContent = formatRaceTime(s.time);
    this.count.textContent = String(s.collected);
    this.route.innerHTML = `Yol: ${s.route}<span class="pos">Sıra ${s.position}/${s.racers}</span>`;
    this.score.textContent = s.questions > 0 ? `Puan ${s.score} · ? × ${s.questions}` : `Puan ${s.score}`;
    this.turbo.textContent = s.turbo > 0 ? `TURBO ${s.turbo.toFixed(1)}` : '';
    this.speedo.draw(s.speedKmh, s.rpm, s.maxRpm, s.gear);
  }

  toast(text: string, kind: 'good' | 'bad' | 'info' = 'info'): void {
    const t = el('div', `toast ${kind}`, text, this.toasts);
    setTimeout(() => t.remove(), 1900);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
  }

  countdown(text: string | null): void {
    if (text === null) {
      this.countdownEl.hidden = true;
      return;
    }
    this.countdownEl.hidden = false;
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove('pop');
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add('pop');
  }

  showFinish(on: boolean): void {
    this.finishEl.hidden = !on;
  }

  clearToasts(): void {
    this.toasts.innerHTML = '';
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

/** Track introduction with the three routes (+ controls guide before the first race). */
export class TrackIntro implements Screen {
  readonly root: HTMLElement;
  private readonly controls: HTMLElement;

  constructor(parent: HTMLElement, private readonly onStart: () => void, private readonly onBack: () => void) {
    this.root = el('div', 'screen', undefined, parent);
    const panel = el('div', 'panel', undefined, this.root);
    el('h2', 'heading', 'ARAZİ PARKURU', panel);
    el('div', 'hint', 'Parkurda iki ayrım var. 1. ayrım: Hız (sol) · Bilgi (orta) · Cesaret (sağ). 2. ayrımda sıra tersine döner: Cesaret (sol) · Bilgi (orta) · Hız (sağ). Her ayrımda yolunu yeniden seç!', panel);
    const routes = el('div', 'intro-routes', undefined, panel);
    const card = (cls: string, title: string, text: string) => {
      const c = el('div', `route-card ${cls}`, undefined, routes);
      el('h3', '', title, c);
      el('p', '', text, c);
    };
    card('hiz', 'HIZ', 'Sürmesi en kolay ve en hızlı yol: geniş ve düzgün, turbolar var. Kum saati yoldan uzakta: almak için yoldan sap!');
    card('bilgi', 'BİLGİ', 'Kıvrımlı, tepeli yol. Her ayrımda 3 tane ? var: bitişte her biri için bir soru (doğru −2 sn, yanlış +2 sn). Bilgin süreni belirler!');
    card('cesaret', 'CESARET', 'En zorlu yol: dar ve virajlı, kayalar, rampa ve kum vadisi. Kum saatleri riskli yerlerde (rampanın üstünde havada!). Hata yapmazsan çok hızlı.');
    this.controls = el('div', '', undefined, panel);
    this.controls.innerHTML = `<h3 class="heading" style="font-size:24px">Kontroller</h3>${CONTROLS_HTML}`;
    const row = el('div', 'row', undefined, panel);
    row.style.marginTop = '14px';
    const go = el('button', 'btn green', 'Başla (Enter)', row);
    const back = el('button', 'btn red', 'Geri (Esc)', row);
    go.onclick = () => this.onStart();
    back.onclick = () => this.onBack();
    this.hide();
  }

  showControls(on: boolean): void {
    this.controls.hidden = !on;
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  onNav(n: Nav): void {
    if (n === 'confirm') this.onStart();
    else if (n === 'back') this.onBack();
  }
}
