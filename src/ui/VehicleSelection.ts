import type { VehicleInfo } from '../data/vehicles';
import { el } from './dom';
import type { Nav, Screen } from './dom';

/**
 * Overlay for the 3D garage (dark garage, name floating above the car,
 * ← → buttons, "Seçimi yapmak için 'Giriş/Enter' tuşuna basınız.").
 */
export class VehicleSelection implements Screen {
  readonly root: HTMLElement;
  private readonly name: HTMLElement;
  private readonly desc: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly spec: HTMLElement;
  index = 0;

  constructor(
    parent: HTMLElement,
    private readonly vehicles: VehicleInfo[],
    private readonly onChange: (i: number) => void,
    private readonly onSelect: (i: number) => void,
    private readonly onBack: () => void,
  ) {
    this.root = el('div', 'select-overlay', undefined, parent);
    this.name = el('div', 'select-name', '', this.root);
    const info = el('div', 'select-info panel', undefined, this.root);
    this.desc = el('p', '', '', info);
    this.stats = el('div', '', undefined, info);
    this.spec = el('div', 'spec', '', info);
    const l = el('button', 'arrow-btn left', '←', this.root);
    const r = el('button', 'arrow-btn right', '→', this.root);
    l.onclick = () => this.step(-1);
    r.onclick = () => this.step(1);
    el('div', 'select-prompt', "Seçimi yapmak için 'Giriş/Enter' tuşuna basınız.", this.root);
    const back = el('button', 'btn teal back-btn', '« Ana Menü', this.root);
    back.onclick = () => this.onBack();
    this.hide();
  }

  private step(d: number): void {
    this.index = (this.index + d + this.vehicles.length) % this.vehicles.length;
    this.refresh();
    this.onChange(this.index);
  }

  private refresh(): void {
    const v = this.vehicles[this.index];
    const c = v.config;
    this.name.textContent = v.name.toLocaleUpperCase('tr-TR');
    this.desc.textContent = v.description;
    const bars: Array<[string, number]> = [
      ['Hız', v.stats.hiz],
      ['İvme', v.stats.ivme],
      ['Yol tutuş', v.stats.yolTutus],
      ['Dayanıklılık', v.stats.dayaniklilik],
    ];
    this.stats.innerHTML = bars
      .map(([n, k]) => `<div class="stat"><span>${n}</span><div class="track"><div class="fill" style="width:${Math.round(k * 100)}%"></div></div></div>`)
      .join('');
    const peak = Math.max(...c.engine.torqueCurve.map((p) => p.torque));
    this.spec.innerHTML = `Kütle ${c.chassis.mass} kg · ${c.transmission.layout === 'AWD' ? '4x4' : c.transmission.layout === 'RWD' ? 'Arkadan itiş' : 'Önden çekiş'} · ${c.transmission.gears.length} vites<br>
      Tork ${peak.toFixed(0)} Nm · Dingil mesafesi ${c.geometry.wheelbase.toFixed(2)} m · Süspansiyon yolu ${(c.suspension.travel * 100).toFixed(0)} cm<br>
      <i>Değerler bu yeniden yapım için tahminidir.</i>`;
  }

  show(): void {
    this.refresh();
    this.root.hidden = false;
    this.onChange(this.index);
  }

  hide(): void {
    this.root.hidden = true;
  }

  onNav(n: Nav): void {
    if (n === 'left') this.step(-1);
    else if (n === 'right') this.step(1);
    else if (n === 'confirm') this.onSelect(this.index);
    else if (n === 'back') this.onBack();
  }
}
