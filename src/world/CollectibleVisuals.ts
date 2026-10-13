import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  Shape,
  TorusGeometry,
} from 'three';
import type { Material, Texture } from 'three';
import type { CollectibleItem, CollectibleSystem } from '../gameplay/CollectibleSystem';
import { mulberry32 } from '../physics/math';
import { softDotTexture, textureFromCanvas } from '../render/Textures';
import { ALL_SIGNS, drawSign } from '../ui/TrafficSigns';

interface Burst {
  t: number;
  active: boolean;
  origin: [number, number, number];
  color: number;
}

const BURST_PARTICLES = 40;
const MAX_BURSTS = 6;

/**
 * Visual representation of collectibles. Geometry/materials are shared between items and
 * created once; visibility follows CollectibleSystem (the gameplay source of truth).
 */
export class CollectibleVisuals {
  readonly group = new Group();
  private readonly nodes = new Map<string, Group>();
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly burstPoints: Points;
  private readonly burstPos: Float32Array;
  private readonly burstVel: Float32Array;
  private readonly bursts: Burst[] = [];
  private readonly burstMat: PointsMaterial;

  constructor(items: CollectibleItem[]) {
    const k = <T extends { dispose(): void }>(x: T) => (this.disposables.push(x), x);
    // Hourglass: glass bulbs with glowing sand between two wooden caps.
    const glass = k(new MeshStandardMaterial({ color: 0xcfefff, transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0 }));
    const sand = k(new MeshLambertMaterial({ color: 0xffb21a, emissive: 0xc06800, emissiveIntensity: 0.8 }));
    const wood = k(new MeshLambertMaterial({ color: 0x8a5a2b }));
    const bulb = k(new ConeGeometry(0.55, 0.75, 16, 1, true));
    const sandTop = k(new ConeGeometry(0.36, 0.38, 12));
    const sandBot = k(new ConeGeometry(0.46, 0.4, 12));
    const cap = k(new CylinderGeometry(0.72, 0.72, 0.14, 16));
    const rod = k(new CylinderGeometry(0.05, 0.05, 1.6, 6));
    // Traffic sign token.
    const signRim = k(new CylinderGeometry(0.8, 0.8, 0.1, 28));
    const signMats = new Map<string, Material[]>();
    const rimMat = k(new MeshLambertMaterial({ color: 0xdddddd }));
    ALL_SIGNS.slice(0, 8).forEach((id) => {
      const tex: Texture = k(textureFromCanvas(drawSign(id)));
      const face = k(new MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.1 }));
      signMats.set(id, [rimMat, face, face]);
    });
    const signIds = [...signMats.keys()];
    // Turbo chevrons.
    const chev = new Shape();
    chev.moveTo(-0.7, -0.2);
    chev.lineTo(0, 0.45);
    chev.lineTo(0.7, -0.2);
    chev.lineTo(0.7, -0.55);
    chev.lineTo(0, 0.1);
    chev.lineTo(-0.7, -0.55);
    chev.closePath();
    const chevGeo = k(new ExtrudeGeometry(chev, { depth: 0.18, bevelEnabled: false }));
    chevGeo.translate(0, 0, -0.09);
    const turboMat = k(new MeshLambertMaterial({ color: 0x2ad4ff, emissive: 0x0a7cff, emissiveIntensity: 1.1 }));
    const ringGeo = k(new TorusGeometry(1.0, 0.06, 8, 32));
    const ringMat = k(new MeshLambertMaterial({ color: 0xffffff, emissive: 0x2a6cff, emissiveIntensity: 0.6 }));

    // "?" sign token (Bilgi road): blue board with a white question mark on a short post.
    const qc = document.createElement('canvas');
    qc.width = 128;
    qc.height = 128;
    const qctx = qc.getContext('2d')!;
    qctx.fillStyle = '#1d5fb8';
    qctx.fillRect(0, 0, 128, 128);
    qctx.strokeStyle = '#fff';
    qctx.lineWidth = 8;
    qctx.strokeRect(8, 8, 112, 112);
    qctx.fillStyle = '#fff';
    qctx.font = '900 92px Arial Black, Arial, sans-serif';
    qctx.textAlign = 'center';
    qctx.textBaseline = 'middle';
    qctx.fillText('?', 64, 70);
    const qFace = k(new MeshLambertMaterial({ map: k(textureFromCanvas(qc)), emissive: 0x0a2a66, emissiveIntensity: 0.5 }));
    const qEdge = k(new MeshLambertMaterial({ color: 0xffffff }));
    const qBoard = k(new BoxGeometry(1.5, 1.5, 0.12));
    const qPost = k(new CylinderGeometry(0.06, 0.06, 1.2, 8));

    const rnd = mulberry32(3);
    for (const it of items) {
      const g = new Group();
      if (it.kind === 'hourglass') {
        const top = new Mesh(bulb, glass);
        top.position.y = 0.38;
        top.rotation.x = Math.PI;
        const bot = new Mesh(bulb, glass);
        bot.position.y = -0.38;
        const st = new Mesh(sandTop, sand);
        st.position.y = 0.32;
        st.rotation.x = Math.PI;
        const sb = new Mesh(sandBot, sand);
        sb.position.y = -0.55;
        const c1 = new Mesh(cap, wood);
        c1.position.y = 0.8;
        const c2 = new Mesh(cap, wood);
        c2.position.y = -0.8;
        g.add(top, bot, st, sb, c1, c2);
        for (let i = 0; i < 3; i++) {
          const r = new Mesh(rod, wood);
          const a = (i / 3) * Math.PI * 2;
          r.position.set(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6);
          g.add(r);
        }
        g.scale.setScalar(1.15);
      } else if (it.kind === 'sign') {
        const id = signIds[Math.floor(rnd() * signIds.length)];
        const disc = new Mesh(signRim, signMats.get(id)!);
        disc.rotation.x = Math.PI / 2;
        g.add(disc);
      } else if (it.kind === 'question') {
        const board = new Mesh(qBoard, [qEdge, qEdge, qEdge, qEdge, qFace, qFace]);
        const post = new Mesh(qPost, qEdge);
        post.position.y = -1.2;
        g.add(board, post);
      } else {
        const a = new Mesh(chevGeo, turboMat);
        const b = new Mesh(chevGeo, turboMat);
        a.position.y = 0.25;
        b.position.y = -0.35;
        const ring = new Mesh(ringGeo, ringMat);
        g.add(a, b, ring);
      }
      g.traverse((o) => {
        if ((o as Mesh).isMesh) (o as Mesh).castShadow = true;
      });
      g.position.set(it.x, it.y, it.z);
      g.userData.phase = rnd() * Math.PI * 2;
      g.userData.baseY = it.y;
      g.userData.kind = it.kind;
      this.nodes.set(it.id, g);
      this.group.add(g);
    }

    // Pooled sparkle bursts for pickups.
    this.burstPos = new Float32Array(MAX_BURSTS * BURST_PARTICLES * 3);
    this.burstVel = new Float32Array(MAX_BURSTS * BURST_PARTICLES * 3);
    const geo = k(new BufferGeometry());
    geo.setAttribute('position', new BufferAttribute(this.burstPos, 3));
    this.burstMat = k(new PointsMaterial({ size: 0.45, map: k(softDotTexture()), transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xffe08a }));
    this.burstPoints = new Points(geo, this.burstMat);
    this.burstPoints.frustumCulled = false;
    this.group.add(this.burstPoints);
    for (let i = 0; i < MAX_BURSTS; i++) this.bursts.push({ t: 0, active: false, origin: [0, -999, 0], color: 0xffffff });
    this.burstPos.fill(-9999);
  }

  /** Spawns a sparkle burst at a collected item. */
  burst(it: CollectibleItem): void {
    const slot = this.bursts.findIndex((b) => !b.active);
    const i = slot >= 0 ? slot : 0;
    const b = this.bursts[i];
    b.active = true;
    b.t = 0;
    b.origin = [it.x, it.y, it.z];
    const rnd = mulberry32(Math.floor(it.x * 13 + it.z * 7));
    for (let p = 0; p < BURST_PARTICLES; p++) {
      const k = (i * BURST_PARTICLES + p) * 3;
      const th = rnd() * Math.PI * 2;
      const ph = Math.acos(rnd() * 2 - 1);
      const sp = 3 + rnd() * 5;
      this.burstVel[k] = Math.sin(ph) * Math.cos(th) * sp;
      this.burstVel[k + 1] = Math.abs(Math.cos(ph)) * sp + 2;
      this.burstVel[k + 2] = Math.sin(ph) * Math.sin(th) * sp;
      this.burstPos[k] = it.x;
      this.burstPos[k + 1] = it.y;
      this.burstPos[k + 2] = it.z;
    }
  }

  /** Per-frame animation (render time only, no gameplay effect). */
  update(time: number, dt: number, system: CollectibleSystem): void {
    for (const [id, g] of this.nodes) {
      const vis = !system.isCollected(id);
      g.visible = vis;
      if (!vis) continue;
      const ph = g.userData.phase as number;
      g.rotation.y = time * 1.6 + ph;
      g.position.y = (g.userData.baseY as number) + Math.sin(time * 2.2 + ph) * 0.18;
    }
    let any = false;
    for (let i = 0; i < MAX_BURSTS; i++) {
      const b = this.bursts[i];
      if (!b.active) continue;
      any = true;
      b.t += dt;
      for (let p = 0; p < BURST_PARTICLES; p++) {
        const k = (i * BURST_PARTICLES + p) * 3;
        this.burstVel[k + 1] -= 9 * dt;
        this.burstPos[k] += this.burstVel[k] * dt;
        this.burstPos[k + 1] += this.burstVel[k + 1] * dt;
        this.burstPos[k + 2] += this.burstVel[k + 2] * dt;
      }
      if (b.t > 0.9) {
        b.active = false;
        for (let p = 0; p < BURST_PARTICLES; p++) this.burstPos[(i * BURST_PARTICLES + p) * 3 + 1] = -9999;
      }
    }
    this.burstPoints.geometry.getAttribute('position').needsUpdate = true;
    this.burstMat.opacity = any ? 1 : 0;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
