import type { BuiltTrack } from '../world/TrackBuilder';
import type { RouteId } from '../world/TrackTypes';
import { el } from './dom';

/** Road colours on the map (also used for the legend). */
export const ROUTE_MAP_COLORS: Record<RouteId, string> = {
  start: '#d9c79a',
  mid: '#d9c79a',
  final: '#d9c79a',
  hiz: '#ffcc33',
  bilgi: '#45b4ff',
  cesaret: '#ff5a3c',
};

export interface MapCar {
  x: number;
  z: number;
  /** Heading (rad), same convention as VehiclePhysics.heading. */
  heading: number;
  me: boolean;
  /** Another human player (online). */
  human: boolean;
}

export interface MapState {
  cars: MapCar[];
  /** Next gate to drive through (marker), if known. */
  next: { x: number; z: number } | null;
}

/** Track layer resolution (px per m). */
const LAYER_SCALE = 1;
/** Local mode: metres from the player to the top edge of the map. */
const LOCAL_RANGE = 230;

/**
 * HUD minimap. Local mode: heading-up, centred a little below the middle so more of the road
 * ahead is visible. Full mode (M key): the whole course, start at the bottom.
 * The roads are rendered once into an offscreen layer; each frame only transforms it.
 */
export class Minimap {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement | null = null;
  private bounds = { minX: 0, minZ: 0, maxX: 1, maxZ: 1 };
  private full = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud-minimap', undefined, parent);
    this.canvas = el('canvas', '', undefined, this.root);
    this.ctx = this.canvas.getContext('2d')!;
    const legend = el('div', 'minimap-legend', undefined, this.root);
    legend.innerHTML = `<span style="color:${ROUTE_MAP_COLORS.hiz}">■ Hız</span><span style="color:${ROUTE_MAP_COLORS.bilgi}">■ Bilgi</span><span style="color:${ROUTE_MAP_COLORS.cesaret}">■ Cesaret</span><span class="key">M</span>`;
  }

  get fullView(): boolean {
    return this.full;
  }

  toggle(): void {
    this.full = !this.full;
    this.root.classList.toggle('full', this.full);
  }

  /** Builds the road layer for a track (call when the race world changes). */
  setTrack(track: BuiltTrack): void {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const p of track.pathList) {
      for (const s of p.samples) {
        minX = Math.min(minX, s.x);
        maxX = Math.max(maxX, s.x);
        minZ = Math.min(minZ, s.z);
        maxZ = Math.max(maxZ, s.z);
      }
    }
    const pad = 60;
    this.bounds = { minX: minX - pad, minZ: minZ - pad, maxX: maxX + pad, maxZ: maxZ + pad };
    const b = this.bounds;
    const layer = document.createElement('canvas');
    layer.width = Math.ceil((b.maxX - b.minX) * LAYER_SCALE);
    layer.height = Math.ceil((b.maxZ - b.minZ) * LAYER_SCALE);
    const c = layer.getContext('2d')!;
    c.scale(LAYER_SCALE, LAYER_SCALE);
    c.translate(-b.minX, -b.minZ);
    c.lineCap = 'round';
    c.lineJoin = 'round';

    // Rivers.
    c.strokeStyle = '#2f7fb8';
    for (const r of track.def.natural.rivers ?? []) {
      c.lineWidth = r.width;
      c.beginPath();
      r.points.forEach((p, i) => (i ? c.lineTo(p.x, p.z) : c.moveTo(p.x, p.z)));
      c.stroke();
    }
    // Clearings.
    c.fillStyle = ROUTE_MAP_COLORS.start;
    for (const p of track.def.plazas) {
      c.beginPath();
      c.arc(p.x, p.z, p.radius, 0, Math.PI * 2);
      c.fill();
    }
    // Roads: dark outline first, then the coloured surface.
    const trace = (id: string) => {
      const p = track.paths.get(id)!;
      c.beginPath();
      p.samples.forEach((s, i) => (i ? c.lineTo(s.x, s.z) : c.moveTo(s.x, s.z)));
    };
    for (const p of track.pathList) {
      c.strokeStyle = 'rgba(0,0,0,0.55)';
      c.lineWidth = p.def.width + 8;
      trace(p.def.id);
      c.stroke();
    }
    for (const p of track.pathList) {
      c.strokeStyle = ROUTE_MAP_COLORS[p.def.route];
      c.lineWidth = Math.max(10, p.def.width);
      trace(p.def.id);
      c.stroke();
    }
    // Bridges.
    c.strokeStyle = '#7a4b25';
    for (const [id, spans] of track.bridgeSpans) {
      const p = track.paths.get(id)!;
      c.lineWidth = Math.max(10, p.def.width) * 0.6;
      for (const sp of spans) {
        c.beginPath();
        for (let s = sp.from; s <= sp.to; s += 4) {
          const q = p.at(s);
          if (s === sp.from) c.moveTo(q.x, q.z);
          else c.lineTo(q.x, q.z);
        }
        c.stroke();
      }
    }
    // Start and finish lines.
    const line = (g: { x: number; z: number; tx: number; tz: number; halfWidth: number }, color: string) => {
      c.strokeStyle = color;
      c.lineWidth = 7;
      c.beginPath();
      c.moveTo(g.x - g.tz * g.halfWidth, g.z + g.tx * g.halfWidth);
      c.lineTo(g.x + g.tz * g.halfWidth, g.z - g.tx * g.halfWidth);
      c.stroke();
    };
    line(track.startGate, '#ffffff');
    line(track.finishGate, '#111111');
    this.layer = layer;
  }

  draw(state: MapState): void {
    const layer = this.layer;
    if (!layer) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(38, 66, 34, 0.82)';
    c.fillRect(0, 0, w, h);

    const me = state.cars.find((x) => x.me);
    const b = this.bounds;
    // World → map transform.
    let scale: number;
    if (this.full || !me) {
      scale = Math.min(w / (b.maxX - b.minX), h / (b.maxZ - b.minZ));
      c.translate(w / 2, h / 2);
      c.scale(scale, scale);
      c.translate(-(b.minX + b.maxX) / 2, -(b.minZ + b.maxZ) / 2);
    } else {
      const cy = h * 0.64;
      scale = cy / LOCAL_RANGE;
      c.translate(w / 2, cy);
      c.rotate(me.heading);
      c.scale(scale, scale);
      c.translate(-me.x, -me.z);
    }
    c.imageSmoothingEnabled = true;
    c.drawImage(layer, b.minX, b.minZ, layer.width / LAYER_SCALE, layer.height / LAYER_SCALE);

    // Markers are drawn at a fixed screen size.
    const px = 1 / scale;
    if (state.next) {
      c.fillStyle = '#ffffff';
      c.strokeStyle = '#ff7a1a';
      c.lineWidth = 2.5 * px;
      c.beginPath();
      c.arc(state.next.x, state.next.z, 5 * px, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    const arrow = (car: MapCar, size: number, fill: string) => {
      c.save();
      c.translate(car.x, car.z);
      c.rotate(-car.heading);
      c.scale(px * size, px * size);
      c.beginPath();
      c.moveTo(0, -1.3);
      c.lineTo(0.9, 1);
      c.lineTo(0, 0.5);
      c.lineTo(-0.9, 1);
      c.closePath();
      c.fillStyle = fill;
      c.fill();
      c.lineWidth = 0.35;
      c.strokeStyle = '#111';
      c.stroke();
      c.restore();
    };
    for (const car of state.cars) {
      if (car.me) continue;
      arrow(car, 5.5, car.human ? '#4dff7a' : '#e8e8e8');
    }
    if (me) arrow(me, 8, '#ff3d7f');
  }
}
