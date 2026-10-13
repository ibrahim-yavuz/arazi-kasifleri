import type { Settings, ScoreEntry } from '../game/Settings';
import { formatRaceTime } from '../gameplay/TimerSystem';
import { createLogo, el, keyCap, MenuNav } from './dom';
import type { Nav, Screen } from './dom';

export interface MainMenuActions {
  newGame(): void;
  online(): void;
  options(): void;
  howTo(): void;
  scores(): void;
  click(): void;
}

/** Main menu. */
export class MainMenu implements Screen {
  readonly root: HTMLElement;
  private readonly nav: MenuNav;

  constructor(parent: HTMLElement, a: MainMenuActions) {
    this.root = el('div', 'screen grunge', undefined, parent);
    createLogo(this.root);
    const menu = el('div', 'menu', undefined, this.root);
    const items = ['TEK OYUNCU', 'ÇOK OYUNCULU', 'SEÇENEKLER', 'NASIL OYNANIR?', 'SKOR TABLOSU'].map((t) => el('div', 'pill', t, menu));
    this.nav = new MenuNav(items, (i) => [a.newGame, a.online, a.options, a.howTo, a.scores][i](), a.click);
    el('div', 'hint', '↑ ↓ ile seç, Enter ile onayla', this.root).style.zIndex = '1';
    this.hide();
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  onNav(n: Nav): void {
    this.nav.nav(n);
  }
}

/** Options: quality and sound sliders with Onayla / İptal. */
export class OptionsMenu implements Screen {
  readonly root: HTMLElement;
  private draft!: Settings;
  private readonly qualityBar: HTMLDivElement;
  private readonly qualityLabel: HTMLSpanElement;
  private readonly volumeBar: HTMLDivElement;
  private readonly muteBox: HTMLInputElement;
  private focusRow = 0;
  private readonly rows: HTMLElement[] = [];

  constructor(
    parent: HTMLElement,
    private readonly get: () => Settings,
    private readonly apply: (s: Settings) => void,
    private readonly close: () => void,
  ) {
    this.root = el('div', 'screen grunge', undefined, parent);
    createLogo(this.root);
    const panel = el('div', 'panel', undefined, this.root);

    const q = el('div', 'option', undefined, panel);
    const ql = el('label', '', 'Görüntü Kalitesi ', q);
    this.qualityLabel = el('span', '', '', ql);
    const qr = el('div', 'slider-row', undefined, q);
    const qm = el('button', 'step-btn', '−', qr);
    this.qualityBar = el('div', '', undefined, el('div', 'bar', undefined, qr));
    const qp = el('button', 'step-btn plus', '+', qr);
    qm.onclick = () => this.stepQuality(-1);
    qp.onclick = () => this.stepQuality(1);

    const v = el('div', 'option', undefined, panel);
    el('label', '', 'Ses Seviyesi', v);
    const vr = el('div', 'slider-row', undefined, v);
    const vm = el('button', 'step-btn', '−', vr);
    this.volumeBar = el('div', '', undefined, el('div', 'bar', undefined, vr));
    const vp = el('button', 'step-btn plus', '+', vr);
    vm.onclick = () => this.stepVolume(-0.1);
    vp.onclick = () => this.stepVolume(0.1);

    const c1 = el('label', 'check', undefined, panel);
    this.muteBox = el('input', '', undefined, c1);
    this.muteBox.type = 'checkbox';
    el('span', '', 'Sesi kapat', c1);
    this.muteBox.onchange = () => (this.draft.muted = this.muteBox.checked);
    const btns = el('div', 'row', undefined, panel);
    btns.style.marginTop = '14px';
    const ok = el('button', 'btn green', 'Onayla', btns);
    const cancel = el('button', 'btn red', 'İptal', btns);
    ok.onclick = () => this.confirm();
    cancel.onclick = () => this.close();
    this.rows = [q, v, c1, ok];
    el('div', 'hint', '↑ ↓ satır, ← → değiştir, Enter onayla, Esc iptal', panel);
    this.hide();
  }

  private stepQuality(d: number): void {
    this.draft.quality = Math.max(0, Math.min(2, this.draft.quality + d)) as 0 | 1 | 2;
    this.refresh();
  }

  private stepVolume(d: number): void {
    this.draft.volume = Math.max(0, Math.min(1, Math.round((this.draft.volume + d) * 10) / 10));
    this.refresh();
  }

  private refresh(): void {
    this.qualityBar.style.width = `${((this.draft.quality + 1) / 3) * 100}%`;
    this.qualityLabel.textContent = `(${['Düşük', 'Orta', 'Yüksek'][this.draft.quality]})`;
    this.volumeBar.style.width = `${this.draft.volume * 100}%`;
    this.muteBox.checked = this.draft.muted;
    this.rows.forEach((r, i) => (r.style.outline = i === this.focusRow ? '2px dashed rgba(246,209,58,0.8)' : 'none'));
  }

  private confirm(): void {
    this.apply(this.draft);
    this.close();
  }

  show(): void {
    this.draft = { ...this.get() };
    this.focusRow = 0;
    this.refresh();
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  onNav(n: Nav): void {
    if (n === 'back') return this.close();
    if (n === 'up' || n === 'down') {
      this.focusRow = (this.focusRow + (n === 'up' ? -1 : 1) + this.rows.length) % this.rows.length;
    } else if (n === 'left' || n === 'right') {
      const d = n === 'left' ? -1 : 1;
      if (this.focusRow === 0) this.stepQuality(d);
      if (this.focusRow === 1) this.stepVolume(d * 0.1);
      if (this.focusRow === 2) this.draft.muted = !this.draft.muted;
    } else if (n === 'confirm') {
      if (this.focusRow === 2) this.draft.muted = !this.draft.muted;
      else return this.confirm();
    }
    this.refresh();
  }
}

export const CONTROLS_HTML = `
  <div class="keys">
    <div>${keyCap('W')}${keyCap('↑')}</div><div>Gaz (ileri)</div>
    <div>${keyCap('S')}${keyCap('↓')}</div><div>Fren / dururken basılı tut: geri vites</div>
    <div>${keyCap('A')}${keyCap('←')} ${keyCap('D')}${keyCap('→')}</div><div>Sola / sağa dönüş</div>
    <div>${keyCap('Boşluk')}</div><div>El freni</div>
    <div>${keyCap('A')}${keyCap('B')} / ${keyCap('1')}${keyCap('2')}</div><div>Bitişteki soruları cevapla (A veya B şıkkı)</div>
    <div>${keyCap('R')}</div><div>Aracı son kontrol noktasına geri koy</div>
    <div>${keyCap('C')}</div><div>Kamera görünümünü değiştir</div>
    <div>${keyCap('Esc')}</div><div>Duraklat / menü</div>
    <div>${keyCap('Enter')}</div><div>Seçim tuşu</div>
  </div>`;

export class HowToPlay implements Screen {
  readonly root: HTMLElement;

  constructor(parent: HTMLElement, private readonly close: () => void) {
    this.root = el('div', 'screen grunge', undefined, parent);
    const panel = el('div', 'panel', undefined, this.root);
    el('h2', 'heading', 'NASIL OYNANIR?', panel);
    const cols = el('div', 'howto-cols', undefined, panel);
    const left = el('div', '', undefined, cols);
    el('h3', '', 'Tuşlar', left);
    left.insertAdjacentHTML('beforeend', CONTROLS_HTML);
    const right = el('div', '', undefined, cols);
    el('h3', '', 'Yarış', right);
    right.insertAdjacentHTML(
      'beforeend',
      `<p>Parkurda <b>iki ayrım</b> var. 1. ayrımda yollar <b>HIZ</b> (sol), <b>BİLGİ</b> (orta), <b>CESARET</b> (sağ) sırasıyla ayrılır;
       yollar birleştikten sonraki 2. ayrımda sıra tersinedir: <b>CESARET</b> (sol), <b>BİLGİ</b> (orta), <b>HIZ</b> (sağ).
       Her ayrımda bir yol seç, o yolun bütün kontrol noktalarından geç ve bitiş çizgisine ulaş.</p>
       <ul>
         <li><b>Hız:</b> en kolay yol. Geniş ve düzgün ama uzun; süre kazandıran kum saati az.</li>
         <li><b>Bilgi:</b> yoldaki <b>?</b> işaretlerini topla. Bitişte topladığın her işaret için bir soru sorulur: doğru −3 sn, yanlış +3 sn.</li>
         <li><b>Cesaret:</b> en zorlu yol: dar, virajlı, köprülü ve rampalı. Ama en kestirme yol ve en çok kum saati burada: en iyi süre için!</li>
         <li>Kum saati −3 sn, trafik işareti +100 puan, turbo kısa süreli ekstra güç verir.</li>
       </ul>`,
    );
    const back = el('button', 'btn teal', '« Ana Menü', panel);
    back.style.marginTop = '14px';
    back.onclick = () => this.close();
    this.hide();
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  onNav(n: Nav): void {
    if (n === 'back' || n === 'confirm') this.close();
  }
}

export class ScoreBoard implements Screen {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;

  constructor(parent: HTMLElement, private readonly load: () => ScoreEntry[], private readonly close: () => void) {
    this.root = el('div', 'screen grunge', undefined, parent);
    const panel = el('div', 'panel', undefined, this.root);
    el('h2', 'heading', 'SKOR TABLOSU', panel);
    this.body = el('div', '', undefined, panel);
    const back = el('button', 'btn teal', '« Ana Menü', panel);
    back.style.marginTop = '14px';
    back.onclick = () => this.close();
    this.hide();
  }

  show(): void {
    const list = this.load();
    if (list.length === 0) {
      this.body.innerHTML = '<p class="hint">Henüz kayıtlı derece yok. İlk yarışını tamamla!</p>';
    } else {
      const rows = list
        .map((s, i) => `<tr><td>${i + 1}.</td><td>${formatRaceTime(s.time)}</td><td>${s.vehicle}</td><td>${s.route}</td><td>${s.collected}</td><td>${s.date}</td></tr>`)
        .join('');
      this.body.innerHTML = `<table class="scores"><tr><th>#</th><th>Süre</th><th>Araç</th><th>Yol</th><th>Toplanan</th><th>Tarih</th></tr>${rows}</table>`;
    }
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  onNav(n: Nav): void {
    if (n === 'back' || n === 'confirm') this.close();
  }
}
