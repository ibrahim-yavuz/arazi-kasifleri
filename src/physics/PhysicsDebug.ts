import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, Vector3 } from 'three';
import type { Scene } from 'three';
import { SURFACES } from './Surfaces';
import type { VehiclePhysics } from './VehiclePhysics';
import { RAD2DEG } from './math';

const MAX_SEGMENTS = 256;
const tmp = new Vector3();
const tmp2 = new Vector3();

/**
 * Development-only physics visualisation: wheel raycasts, suspension, contact points and
 * normals, tyre force vectors, centre of mass and velocity. Uses one preallocated
 * LineSegments buffer (no per-frame allocation) plus a text panel.
 */
export class PhysicsDebug {
  enabled = false;
  private readonly lines: LineSegments;
  private readonly pos = new Float32Array(MAX_SEGMENTS * 6);
  private readonly col = new Float32Array(MAX_SEGMENTS * 6);
  private n = 0;
  private readonly panel: HTMLDivElement;

  constructor(scene: Scene, parent: HTMLElement) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new BufferAttribute(this.col, 3));
    this.lines = new LineSegments(geo, new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 999;
    this.lines.visible = false;
    scene.add(this.lines);
    this.panel = document.createElement('div');
    this.panel.className = 'debug-panel';
    this.panel.hidden = true;
    parent.appendChild(this.panel);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.lines.visible = on;
    this.panel.hidden = !on;
  }

  private seg(a: Vector3, b: Vector3, r: number, g: number, bl: number): void {
    if (this.n >= MAX_SEGMENTS) return;
    const i = this.n * 6;
    this.pos[i] = a.x;
    this.pos[i + 1] = a.y;
    this.pos[i + 2] = a.z;
    this.pos[i + 3] = b.x;
    this.pos[i + 4] = b.y;
    this.pos[i + 5] = b.z;
    for (let k = 0; k < 2; k++) {
      this.col[i + k * 3] = r;
      this.col[i + k * 3 + 1] = g;
      this.col[i + k * 3 + 2] = bl;
    }
    this.n++;
  }

  private cross(p: Vector3, s: number, r: number, g: number, b: number): void {
    this.seg(tmp.set(p.x - s, p.y, p.z), tmp2.set(p.x + s, p.y, p.z), r, g, b);
    this.seg(tmp.set(p.x, p.y - s, p.z), tmp2.set(p.x, p.y + s, p.z), r, g, b);
    this.seg(tmp.set(p.x, p.y, p.z - s), tmp2.set(p.x, p.y, p.z + s), r, g, b);
  }

  update(vehicles: VehiclePhysics[], fps: number): void {
    if (!this.enabled) return;
    this.n = 0;
    const up = new Vector3();
    const a = new Vector3();
    const b = new Vector3();
    for (const v of vehicles) {
      v.upVector(up);
      const travel = v.cfg.suspension.travel;
      for (const w of v.wheels) {
        const rest = v.cfg.suspension.restLength + w.layout.radius;
        // Full ray (grey), spring (green→red by compression), contact cross, normal (blue).
        a.copy(w.hardpointWorld);
        b.copy(w.hardpointWorld).addScaledVector(up, -rest);
        this.seg(a, b, 0.5, 0.5, 0.5);
        const c = Math.min(1, w.compression / travel);
        b.copy(w.hardpointWorld).addScaledVector(up, -w.suspensionLength);
        this.seg(a, b, c, 1 - c, 0.1);
        if (w.inContact) {
          this.cross(w.contactPoint, 0.15, 1, 1, 0);
          b.copy(w.contactPoint).addScaledVector(w.contactNormal, 0.8);
          this.seg(w.contactPoint, b, 0.2, 0.5, 1);
          // Tyre force (impulse/dt) scaled 1 m per 5 kN.
          b.copy(w.tyreImpulse).multiplyScalar(60 / 5000).add(w.contactPoint);
          this.seg(w.contactPoint, b, 1, 0.3, 1);
        }
      }
      const com = v.centerOfMass(new Vector3());
      this.cross(com, 0.35, 1, 1, 1);
      b.copy(v.linearVelocity(new Vector3())).multiplyScalar(0.3).add(com);
      this.seg(com, b, 0, 1, 1);
    }
    for (let i = this.n * 6; i < this.pos.length; i++) this.pos[i] = 0;
    const g = this.lines.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('color').needsUpdate = true;
    g.setDrawRange(0, this.n * 2);

    const v = vehicles[0];
    if (!v) return;
    const t = v.telemetry;
    const av = v.angularVelocity(new Vector3());
    const rows = v.wheels.map((w, i) => {
      const nm = ['FL', 'FR', 'RL', 'RR'][i];
      return `${nm} ${w.inContact ? '●' : '○'} sıkış ${(w.compression * 100).toFixed(1).padStart(5)}cm  yük ${(w.load / 1000).toFixed(2).padStart(5)}kN  κ ${w.slipRatio.toFixed(2).padStart(5)}  α ${(w.slipAngle * RAD2DEG).toFixed(1).padStart(5)}°  ${SURFACES[w.surface].name}`;
    });
    this.panel.textContent = [
      `FPS ${fps.toFixed(0)}  hız ${t.speedKmh.toFixed(1)} km/h  vites ${t.gear}  devir ${t.rpm.toFixed(0)}`,
      `açısal hız (x,y,z) ${av.x.toFixed(2)}, ${av.y.toFixed(2)}, ${av.z.toFixed(2)} rad/s   teker temas ${t.wheelsInContact}/4  havada ${t.airTime.toFixed(2)}s`,
      `direksiyon ${(t.steerAngle * RAD2DEG).toFixed(1)}°  gaz ${t.throttle.toFixed(2)}  fren ${t.brake.toFixed(2)}  çarpma ${t.impact.toFixed(2)} m/s`,
      ...rows,
      'Gri: ışın  Yeşil→Kırmızı: yay  Sarı: temas  Mavi: normal  Mor: lastik kuvveti  Camgöbeği: hız',
    ].join('\n');
  }

  dispose(): void {
    this.lines.removeFromParent();
    this.lines.geometry.dispose();
    (this.lines.material as LineBasicMaterial).dispose();
    this.panel.remove();
  }
}
