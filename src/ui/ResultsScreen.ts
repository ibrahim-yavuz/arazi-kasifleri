import { formatRaceTime } from '../gameplay/TimerSystem';
import { el, MenuNav } from './dom';
import type { Nav, Screen } from './dom';

export interface RaceResult {
  totalTime: number;
  rawTime: number;
  bonus: number;
  penalty: number;
  route: string;
  vehicle: string;
  collected: number;
  hourglasses: number;
  signs: number;
  turbos: number;
  correct: number;
  wrong: number;
  score: number;
  rank: number;
  standings: Array<{ name: string; vehicle: string; route: string; time: number | null; me: boolean }>;
}

export class ResultsScreen implements Screen {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly nav: MenuNav;
  private readonly onlineNav: MenuNav;
  private readonly offlineRow: HTMLElement;
  private readonly onlineRow: HTMLElement;
  private readonly waiting: HTMLElement;
  private online = false;

  constructor(parent: HTMLElement, actions: { replay(): void; change(): void; menu(): void; backToRoom(): void; leaveRoom(): void }) {
    this.root = el('div', 'screen dim', undefined, parent);
    const panel = el('div', 'panel', undefined, this.root);
    el('h2', 'heading', 'YARIŞ SONUCU', panel);
    this.body = el('div', '', undefined, panel);
    this.waiting = el('div', 'hint', '', panel);
    this.offlineRow = el('div', 'row', undefined, panel);
    const b1 = el('button', 'btn green', 'Tekrar Oyna', this.offlineRow);
    const b2 = el('button', 'btn teal', 'Araç Değiştir', this.offlineRow);
    const b3 = el('button', 'btn red', 'Ana Menü', this.offlineRow);
    this.nav = new MenuNav([b1, b2, b3], (i) => [actions.replay, actions.change, actions.menu][i]());
    this.onlineRow = el('div', 'row', undefined, panel);
    const o1 = el('button', 'btn green', 'Odaya Dön', this.onlineRow);
    const o2 = el('button', 'btn red', 'Odadan Ayrıl', this.onlineRow);
    this.onlineNav = new MenuNav([o1, o2], (i) => [actions.backToRoom, actions.leaveRoom][i]());
    this.setOnline(false);
    this.hide();
  }

  setOnline(on: boolean): void {
    this.online = on;
    this.offlineRow.hidden = on;
    this.onlineRow.hidden = !on;
    this.waiting.hidden = !on;
  }

  /** Online: live standings from the server. */
  setStandings(rows: RaceResult['standings'], final: boolean): void {
    const t = this.body.querySelector('table.standings');
    if (t) t.innerHTML = this.standingsHtml(rows);
    this.waiting.textContent = final ? 'Yarış tamamlandı.' : 'Diğer yarışçıların bitirmesi bekleniyor...';
  }

  private standingsHtml(rows: RaceResult['standings']): string {
    return rows
      .map((s, i) => `<tr class="${s.me ? 'me' : ''}"><td>${i + 1}.</td><td>${escapeHtml(s.name)}</td><td>${s.vehicle}</td><td>${s.route}</td><td style="text-align:right">${s.time === null ? 'yarışta' : formatRaceTime(s.time)}</td></tr>`)
      .join('');
  }

  setResult(r: RaceResult): void {
    const standings = this.standingsHtml(r.standings);
    this.body.innerHTML = `
      <div class="results-time">${formatRaceTime(r.totalTime)}</div>
      <div class="hint">${r.vehicle} · ${r.route} yolu${r.rank > 0 ? ` · Skor tablosunda ${r.rank}. sıra!` : ''}</div>
      <div class="results-grid">
        <div>Sürüş süresi</div><div class="v">${formatRaceTime(r.rawTime)}</div>
        <div>Kazanılan süre (kum saati, doğru cevap)</div><div class="v">−${r.bonus.toFixed(2)} sn</div>
        <div>Ceza süresi (yanlış cevap)</div><div class="v">+${r.penalty.toFixed(2)} sn</div>
        <div>Kum saati / trafik işareti / turbo</div><div class="v">${r.hourglasses} / ${r.signs} / ${r.turbos}</div>
        <div>Sorular (doğru / yanlış)</div><div class="v">${r.correct} / ${r.wrong}</div>
        <div>Puan</div><div class="v">${r.score}</div>
      </div>
      <table class="standings">${standings}</table>`;
  }

  show(): void {
    this.root.hidden = false;
    this.nav.focus(0);
    this.onlineNav.focus(0);
  }

  hide(): void {
    this.root.hidden = true;
  }

  onNav(n: Nav): void {
    (this.online ? this.onlineNav : this.nav).nav(n);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export class PauseMenu implements Screen {
  readonly root: HTMLElement;
  private readonly nav: MenuNav;
  private readonly onlineNav: MenuNav;
  private readonly offline: HTMLElement;
  private readonly onlineMenu: HTMLElement;
  private readonly soundBtn: HTMLElement;
  private readonly soundBtn2: HTMLElement;
  private readonly title: HTMLElement;
  private online = false;

  constructor(parent: HTMLElement, private readonly a: { resume(): void; restart(): void; toggleSound(): boolean; menu(): void; leaveRoom(): void }) {
    this.root = el('div', 'screen dim', undefined, parent);
    const panel = el('div', 'panel', undefined, this.root);
    this.title = el('h2', 'heading', 'DURAKLATILDI', panel);
    this.offline = el('div', 'menu', undefined, panel);
    const items = ['DEVAM ET', 'YENİDEN BAŞLA', 'SES: AÇIK', 'ANA MENÜ'].map((t) => el('div', 'pill', t, this.offline));
    this.soundBtn = items[2];
    this.nav = new MenuNav(items, (i) => {
      if (i === 0) a.resume();
      if (i === 1) a.restart();
      if (i === 2) this.setSound(a.toggleSound());
      if (i === 3) a.menu();
    });
    this.onlineMenu = el('div', 'menu', undefined, panel);
    const oItems = ['YARIŞA DÖN', 'SES: AÇIK', 'ODADAN AYRIL'].map((t) => el('div', 'pill', t, this.onlineMenu));
    this.soundBtn2 = oItems[1];
    this.onlineNav = new MenuNav(oItems, (i) => {
      if (i === 0) a.resume();
      if (i === 1) this.setSound(a.toggleSound());
      if (i === 2) a.leaveRoom();
    });
    this.setOnline(false);
    this.hide();
  }

  /** Online the race keeps running while this menu is open. */
  setOnline(on: boolean): void {
    this.online = on;
    this.offline.hidden = on;
    this.onlineMenu.hidden = !on;
    this.title.textContent = on ? 'MENÜ (yarış sürüyor!)' : 'DURAKLATILDI';
  }

  setSound(on: boolean): void {
    this.soundBtn.textContent = on ? 'SES: AÇIK' : 'SES: KAPALI';
    this.soundBtn2.textContent = this.soundBtn.textContent;
  }

  show(): void {
    this.root.hidden = false;
    this.nav.focus(0);
    this.onlineNav.focus(0);
  }

  hide(): void {
    this.root.hidden = true;
  }

  onNav(n: Nav): void {
    if (n === 'back') return this.a.resume(); // Esc closes the menu
    (this.online ? this.onlineNav : this.nav).nav(n);
  }
}
