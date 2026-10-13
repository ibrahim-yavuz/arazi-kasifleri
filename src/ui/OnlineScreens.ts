import type { VehicleInfo } from '../data/vehicles';
import { MAX_NAME, MAX_PLAYERS, ROOM_CODE_LENGTH, normalizeRoomCode } from '../net/protocol';
import type { RoomInfo, RoomSummary } from '../net/protocol';
import { createLogo, el } from './dom';
import type { Nav, Screen } from './dom';

export interface OnlineMenuActions {
  setName(name: string): void;
  create(isPublic: boolean, fillAI: boolean): void;
  join(code: string): void;
  refresh(): void;
  back(): void;
}

/** "ÇOK OYUNCULU": player name, create a private/public room, join by code, public rooms. */
export class OnlineMenu implements Screen {
  readonly root: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly codeInput: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private readonly publicBox: HTMLInputElement;
  private readonly aiBox: HTMLInputElement;

  constructor(parent: HTMLElement, private readonly a: OnlineMenuActions) {
    this.root = el('div', 'screen grunge', undefined, parent);
    createLogo(this.root).classList.add('logo-small');
    const panel = el('div', 'panel online-panel', undefined, this.root);
    el('h2', 'heading', 'ÇOK OYUNCULU', panel);

    const nameRow = el('div', 'form-row', undefined, panel);
    el('label', '', 'Adın', nameRow);
    this.nameInput = el('input', 'text-input', undefined, nameRow);
    this.nameInput.maxLength = MAX_NAME;
    this.nameInput.placeholder = 'Kaşif';
    this.nameInput.onchange = () => a.setName(this.nameInput.value);

    const cols = el('div', 'online-cols', undefined, panel);
    const left = el('div', 'online-box', undefined, cols);
    el('h3', '', 'Oda kur', left);
    el('p', 'hint-left', 'Odayı kur, bağlantıyı arkadaşlarınla paylaş. En fazla 4 oyuncu.', left);
    const c1 = el('label', 'check', undefined, left);
    this.publicBox = el('input', '', undefined, c1);
    this.publicBox.type = 'checkbox';
    el('span', '', 'Herkese açık oda (listede görünsün)', c1);
    const c2 = el('label', 'check', undefined, left);
    this.aiBox = el('input', '', undefined, c2);
    this.aiBox.type = 'checkbox';
    this.aiBox.checked = true;
    el('span', '', 'Boş yerleri yapay zekâ doldursun', c2);
    const create = el('button', 'btn green', 'ODA KUR', left);
    create.onclick = () => {
      a.setName(this.nameInput.value);
      a.create(this.publicBox.checked, this.aiBox.checked);
    };

    const right = el('div', 'online-box', undefined, cols);
    el('h3', '', 'Odaya katıl', right);
    const codeRow = el('div', 'form-row', undefined, right);
    this.codeInput = el('input', 'text-input code-input', undefined, codeRow);
    this.codeInput.maxLength = ROOM_CODE_LENGTH + 2;
    this.codeInput.placeholder = 'KOD';
    this.codeInput.oninput = () => (this.codeInput.value = normalizeRoomCode(this.codeInput.value));
    const join = el('button', 'btn teal', 'KATIL', codeRow);
    join.onclick = () => this.joinTyped();
    this.codeInput.onkeydown = (e) => {
      if (e.key === 'Enter') this.joinTyped();
    };
    const lh = el('div', 'list-head', undefined, right);
    el('span', '', 'Açık odalar', lh);
    const ref = el('button', 'btn small', '↻', lh);
    ref.title = 'Yenile';
    ref.onclick = () => a.refresh();
    this.list = el('div', 'room-list', undefined, right);

    this.status = el('div', 'hint status-line', '', panel);
    const back = el('button', 'btn red', '« Ana Menü', panel);
    back.onclick = () => a.back();
    this.hide();
  }

  private joinTyped(): void {
    const code = normalizeRoomCode(this.codeInput.value);
    if (code.length !== ROOM_CODE_LENGTH) {
      this.setStatus(`Oda kodu ${ROOM_CODE_LENGTH} karakter olmalı.`, true);
      return;
    }
    this.a.setName(this.nameInput.value);
    this.a.join(code);
  }

  setName(name: string): void {
    this.nameInput.value = name;
  }

  setStatus(text: string, error = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('error', error);
  }

  setRooms(rooms: RoomSummary[]): void {
    this.list.innerHTML = '';
    if (rooms.length === 0) {
      el('div', 'hint-left', 'Şu an açık oda yok. Sen bir tane kur!', this.list);
      return;
    }
    for (const r of rooms) {
      const row = el('div', 'room-row', undefined, this.list);
      el('span', 'room-code', r.code, row);
      el('span', '', `${r.hostName}`, row);
      el('span', '', `${r.players}/${MAX_PLAYERS}`, row);
      const b = el('button', 'btn small teal', 'Katıl', row);
      b.onclick = () => {
        this.a.setName(this.nameInput.value);
        this.a.join(r.code);
      };
    }
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  onNav(n: Nav): void {
    // Typing in the inputs must not trigger navigation; only Esc goes back.
    if (n === 'back' && document.activeElement !== this.nameInput && document.activeElement !== this.codeInput) this.a.back();
  }
}

export interface RoomScreenActions {
  vehicle(delta: number): void;
  toggleReady(): void;
  start(): void;
  options(isPublic: boolean, fillAI: boolean): void;
  rename(name: string): void;
  leave(): void;
}

/** Room lobby over the 3D garage: share link, players, car choice, ready/start. */
export class RoomScreen implements Screen {
  readonly root: HTMLElement;
  private readonly code: HTMLElement;
  private readonly link: HTMLInputElement;
  private readonly players: HTMLElement;
  private readonly carName: HTMLElement;
  private readonly readyBtn: HTMLButtonElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly hostOpts: HTMLElement;
  private readonly publicBox: HTMLInputElement;
  private readonly aiBox: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private room: RoomInfo | null = null;
  private myId = '';

  constructor(parent: HTMLElement, private readonly vehicles: VehicleInfo[], private readonly a: RoomScreenActions) {
    this.root = el('div', 'select-overlay', undefined, parent);
    const top = el('div', 'room-top panel', undefined, this.root);
    const codeLine = el('div', 'room-codeline', undefined, top);
    el('span', '', 'ODA KODU', codeLine);
    this.code = el('span', 'room-code big', '-----', codeLine);
    const linkRow = el('div', 'form-row', undefined, top);
    this.link = el('input', 'text-input link-input', undefined, linkRow);
    this.link.readOnly = true;
    const copy = el('button', 'btn teal small', 'Bağlantıyı kopyala', linkRow);
    copy.onclick = () => this.copyLink(copy);
    el('div', 'hint-left', 'Bu bağlantıyı arkadaşlarına gönder; tıklayan doğrudan odaya katılır.', top);

    const side = el('div', 'room-side panel', undefined, this.root);
    el('h3', 'room-title', 'Oyuncular', side);
    this.players = el('div', 'room-players', undefined, side);
    const nameRow = el('div', 'form-row', undefined, side);
    el('label', '', 'Adın', nameRow);
    this.nameInput = el('input', 'text-input', undefined, nameRow);
    this.nameInput.maxLength = MAX_NAME;
    this.nameInput.onchange = () => a.rename(this.nameInput.value);
    this.hostOpts = el('div', 'host-opts', undefined, side);
    const c1 = el('label', 'check', undefined, this.hostOpts);
    this.publicBox = el('input', '', undefined, c1);
    this.publicBox.type = 'checkbox';
    el('span', '', 'Herkese açık', c1);
    const c2 = el('label', 'check', undefined, this.hostOpts);
    this.aiBox = el('input', '', undefined, c2);
    this.aiBox.type = 'checkbox';
    el('span', '', 'Boş yerleri yapay zekâ doldursun', c2);
    const sendOpts = () => a.options(this.publicBox.checked, this.aiBox.checked);
    this.publicBox.onchange = sendOpts;
    this.aiBox.onchange = sendOpts;
    const btns = el('div', 'row', undefined, side);
    this.readyBtn = el('button', 'btn teal', 'HAZIRIM', btns);
    this.readyBtn.onclick = () => a.toggleReady();
    this.startBtn = el('button', 'btn green', 'YARIŞI BAŞLAT', btns);
    this.startBtn.onclick = () => a.start();
    const leave = el('button', 'btn red', 'Odadan ayrıl', btns);
    leave.onclick = () => a.leave();
    this.status = el('div', 'hint-left status-line', '', side);

    this.carName = el('div', 'select-name room-car', '', this.root);
    const l = el('button', 'arrow-btn left', '←', this.root);
    const r = el('button', 'arrow-btn right', '→', this.root);
    l.onclick = () => a.vehicle(-1);
    r.onclick = () => a.vehicle(1);
    el('div', 'select-prompt', '← → araç seç · Enter: hazır / başlat · Esc: odadan ayrıl', this.root);
    this.hide();
  }

  private async copyLink(btn: HTMLButtonElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.link.value);
      btn.textContent = 'Kopyalandı!';
    } catch {
      this.link.select();
      btn.textContent = 'Seçildi, Ctrl+C ile kopyala';
    }
    setTimeout(() => (btn.textContent = 'Bağlantıyı kopyala'), 1800);
  }

  setStatus(text: string, error = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('error', error);
  }

  update(room: RoomInfo, myId: string): void {
    this.room = room;
    this.myId = myId;
    this.code.textContent = room.code;
    this.link.value = `${window.location.origin}${window.location.pathname}?oda=${room.code}`;
    const me = room.players.find((p) => p.id === myId);
    const isHost = !!me?.host;
    this.players.innerHTML = '';
    for (const p of room.players) {
      const v = this.vehicles.find((x) => x.id === p.vehicleId);
      const row = el('div', `player-row${p.id === myId ? ' me' : ''}`, undefined, this.players);
      el('span', 'pname', `${p.name}${p.id === myId ? ' (sen)' : ''}`, row);
      el('span', 'pcar', v?.name ?? p.vehicleId, row);
      el('span', `pstate ${p.host ? 'host' : p.ready ? 'ready' : ''}`, p.host ? 'Oda sahibi' : p.ready ? 'Hazır' : 'Bekliyor', row);
    }
    for (let i = room.players.length; i < MAX_PLAYERS; i++) {
      el('div', 'player-row empty', room.fillAI ? 'Yapay zekâ rakip' : 'Boş', this.players);
    }
    if (me) {
      const v = this.vehicles.find((x) => x.id === me.vehicleId);
      this.carName.textContent = (v?.name ?? '').toLocaleUpperCase('tr-TR');
      if (document.activeElement !== this.nameInput) this.nameInput.value = me.name;
    }
    this.hostOpts.hidden = !isHost;
    this.publicBox.checked = room.isPublic;
    this.aiBox.checked = room.fillAI;
    this.readyBtn.hidden = isHost;
    this.readyBtn.textContent = me?.ready ? 'HAZIR DEĞİLİM' : 'HAZIRIM';
    this.startBtn.hidden = !isHost;
    const waiting = room.players.filter((p) => !p.host && !p.ready).length;
    this.startBtn.disabled = waiting > 0;
    if (room.phase === 'racing') this.setStatus('Yarış başlıyor...');
    else if (isHost) this.setStatus(waiting > 0 ? `${waiting} oyuncunun hazır olması bekleniyor.` : 'Herkes hazır. Yarışı başlatabilirsin!');
    else this.setStatus(me?.ready ? 'Oda sahibinin yarışı başlatması bekleniyor.' : 'Aracını seç ve HAZIRIM de.');
  }

  get vehicleId(): string | null {
    return this.room?.players.find((p) => p.id === this.myId)?.vehicleId ?? null;
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  onNav(n: Nav): void {
    if (document.activeElement === this.nameInput) return;
    const isHost = !!this.room?.players.find((p) => p.id === this.myId)?.host;
    if (n === 'left') this.a.vehicle(-1);
    else if (n === 'right') this.a.vehicle(1);
    else if (n === 'confirm') {
      if (isHost) this.a.start();
      else this.a.toggleReady();
    } else if (n === 'back') this.a.leave();
  }
}
