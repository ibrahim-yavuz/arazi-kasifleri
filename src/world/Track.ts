import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Shape,
  ExtrudeGeometry,
  RepeatWrapping,
  Vector3,
} from 'three';
import type { Material } from 'three';
import { MeshPhongMaterial } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bannerTexture, chainLinkTexture, signBoardTexture, woodPlankTexture } from '../render/Textures';
import type { BuiltTrack, Gate } from './TrackBuilder';
import { CHOICE_ROUTES } from './TrackTypes';

/** Static track furniture: banners, signposts, ramps, fences, checkpoint flags. */
export class TrackVisuals {
  readonly group = new Group();
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(private readonly track: BuiltTrack) {
    this.buildBanners();
    this.buildSignposts();
    this.buildRamps();
    this.buildFences();
    this.buildCheckpointFlags();
    this.buildBridges();
    this.buildWater();
  }

  private keep<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private buildBanners(): void {
    const poleGeo = this.keep(new CylinderGeometry(0.12, 0.14, 7, 8));
    const poleMat = this.keep(new MeshLambertMaterial({ color: 0x9aa0a6 }));
    const sideMat = this.keep(new MeshLambertMaterial({ color: 0xf2f2f2 }));
    for (const b of this.track.def.banners) {
      const sp = this.track.paths.get(b.path);
      if (!sp) continue;
      const sm = sp.at(b.at);
      const half = sp.def.width / 2 + 1.2;
      const ground = (x: number, z: number) => this.track.terrain.heightAt(x, z);
      const g = new Group();
      for (const side of [-1, 1]) {
        const x = sm.x + sm.rx * half * side;
        const z = sm.z + sm.rz * half * side;
        const pole = new Mesh(poleGeo, poleMat);
        pole.position.set(x, ground(x, z) + 3.4, z);
        pole.castShadow = true;
        g.add(pole);
      }
      const tex = this.keep(bannerTexture(b.text, b.color ?? '#ffffff'));
      const face = this.keep(new MeshLambertMaterial({ map: tex }));
      const w = half * 2 - 0.3;
      const mats: Material[] = [sideMat, sideMat, sideMat, sideMat, face, face];
      const banner = new Mesh(this.keep(new BoxGeometry(w, w * 0.19, 0.08)), mats);
      const y = Math.max(ground(sm.x, sm.z), sm.y) + 5.6;
      banner.position.set(sm.x, y, sm.z);
      banner.rotation.y = Math.atan2(-sm.tx, -sm.tz);
      banner.castShadow = true;
      g.add(banner);
      this.group.add(g);
    }
  }

  private buildSignposts(): void {
    const postGeo = this.keep(new BoxGeometry(0.18, 3.2, 0.18));
    const wood = this.keep(new MeshLambertMaterial({ color: 0x6b4423 }));
    for (const sp of this.track.def.signposts) {
      const g = new Group();
      const gy = this.track.terrain.heightAt(sp.x, sp.z);
      const post = new Mesh(postGeo, wood);
      post.position.y = 1.6;
      post.castShadow = true;
      g.add(post);
      sp.arrows.forEach((a, i) => {
        const dir = a.dir === 'left' ? -1 : 1;
        const shape = new Shape();
        const L = 2.1;
        const H = 0.48;
        shape.moveTo(0, -H / 2);
        shape.lineTo(L - 0.35, -H / 2);
        shape.lineTo(L, 0);
        shape.lineTo(L - 0.35, H / 2);
        shape.lineTo(0, H / 2);
        shape.closePath();
        const geo = this.keep(new ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: false }));
        geo.translate(0, 0, -0.035);
        // Planar UVs so the text texture spans the board.
        const pos = geo.getAttribute('position');
        const uv = new Float32Array(pos.count * 2);
        for (let k = 0; k < pos.count; k++) {
          uv[k * 2] = pos.getX(k) / L;
          uv[k * 2 + 1] = (pos.getY(k) + H / 2) / H;
        }
        geo.setAttribute('uv', new BufferAttribute(uv, 2));
        const mat = this.keep(new MeshLambertMaterial({ map: this.keep(signBoardTexture(a.text)) }));
        const board = new Mesh(geo, mat);
        board.scale.x = dir;
        board.position.set(0.05 * dir, 2.7 - i * 0.62, 0);
        if (dir < 0) {
          // The board is mirrored with scale.x = −1; flip the texture back so text reads.
          mat.map!.wrapS = RepeatWrapping;
          mat.map!.repeat.x = -1;
          mat.map!.offset.x = 1;
        }
        board.castShadow = true;
        g.add(board);
      });
      g.position.set(sp.x, gy, sp.z);
      g.rotation.y = sp.yaw;
      this.group.add(g);
    }
  }

  private buildRamps(): void {
    if (this.track.ramps.length === 0) return;
    const tex = this.keep(woodPlankTexture());
    const mat = this.keep(new MeshLambertMaterial({ map: tex }));
    for (const r of this.track.ramps) {
      const geo = this.keep(new BufferGeometry());
      geo.setAttribute('position', new BufferAttribute(r.positions.slice(), 3));
      geo.setIndex(new BufferAttribute(r.indices.slice(), 1));
      const p = r.positions;
      const uv = new Float32Array((p.length / 3) * 2);
      for (let i = 0; i < p.length / 3; i++) {
        uv[i * 2] = p[i * 3] * 0.35 + p[i * 3 + 1] * 0.2;
        uv[i * 2 + 1] = p[i * 3 + 2] * 0.35;
      }
      geo.setAttribute('uv', new BufferAttribute(uv, 2));
      geo.computeVertexNormals();
      const m = new Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  private buildFences(): void {
    const f = this.track.fences;
    if (f.length === 0) return;
    const H = 1.7;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (const s of f) {
      const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
      const base = pos.length / 3;
      pos.push(s.ax, s.ay + 0.05, s.az, s.bx, s.by + 0.05, s.bz, s.bx, s.by + H, s.bz, s.ax, s.ay + H, s.az);
      uv.push(0, 0, len / 0.9, 0, len / 0.9, H / 0.9, 0, H / 0.9);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geo = this.keep(new BufferGeometry());
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = this.keep(new MeshLambertMaterial({ map: this.keep(chainLinkTexture()), alphaTest: 0.4, side: DoubleSide }));
    const panels = new Mesh(geo, mat);
    panels.castShadow = true;
    this.group.add(panels);

    const postGeo = this.keep(new CylinderGeometry(0.05, 0.05, H + 0.2, 6));
    const postMat = this.keep(new MeshLambertMaterial({ color: 0x8d949b }));
    const posts = new InstancedMesh(postGeo, postMat, f.length);
    const m = new Matrix4();
    f.forEach((s, i) => {
      m.makeTranslation(s.ax, s.ay + (H + 0.2) / 2, s.az);
      posts.setMatrixAt(i, m);
    });
    posts.castShadow = true;
    this.group.add(posts);
  }

  /** Small orange/white flags at the road edges of each intermediate checkpoint. */
  private buildCheckpointFlags(): void {
    const gates: Gate[] = [];
    for (const leg of this.track.legs) {
      for (const r of CHOICE_ROUTES) gates.push(...leg.routes[r].slice(1));
      gates.push(leg.merge);
    }
    const poleGeo = this.keep(new CylinderGeometry(0.06, 0.06, 2.4, 6));
    const flagGeo = this.keep(new BoxGeometry(0.02, 0.5, 0.8));
    const poleMat = this.keep(new MeshLambertMaterial({ color: 0xffffff }));
    const flagMat = this.keep(new MeshLambertMaterial({ color: 0xff7a1a, emissive: 0x401800 }));
    const polesMesh = new InstancedMesh(poleGeo, poleMat, gates.length * 2);
    const flagsMesh = new InstancedMesh(flagGeo, flagMat, gates.length * 2);
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const one = new Vector3(1, 1, 1);
    let k = 0;
    for (const g of gates) {
      const path = this.track.paths.get(g.path)!;
      const half = path.def.width / 2 + 1.0;
      q.setFromAxisAngle(up, Math.atan2(-g.tx, -g.tz));
      for (const side of [-1, 1]) {
        const x = g.x + -g.tz * half * side;
        const z = g.z + g.tx * half * side;
        const y = this.track.terrain.heightAt(x, z);
        m.compose(new Vector3(x, y + 1.2, z), q, one);
        polesMesh.setMatrixAt(k, m);
        m.compose(new Vector3(x - g.tx * 0.4, y + 2.15, z - g.tz * 0.4), q, one);
        flagsMesh.setMatrixAt(k, m);
        k++;
      }
    }
    polesMesh.castShadow = true;
    flagsMesh.castShadow = true;
    this.group.add(polesMesh, flagsMesh);
  }

  private buildBridges(): void {
    if (this.track.bridges.length === 0) return;
    const deckMat = this.keep(new MeshLambertMaterial({ map: this.keep(woodPlankTexture()) }));
    const railMat = this.keep(new MeshLambertMaterial({ color: 0x7a4b25 }));
    const stoneMat = this.keep(new MeshLambertMaterial({ color: 0x8a8378 }));
    const pillarGeo = this.keep(new CylinderGeometry(0.55, 0.7, 1, 10));
    const allPillars = this.track.bridges.flatMap((b) => b.pillars);
    const pillars = new InstancedMesh(pillarGeo, stoneMat, Math.max(1, allPillars.length));
    const m = new Matrix4();
    allPillars.forEach((p, i) => {
      const h = Math.max(0.5, p.top - p.bottom);
      m.makeScale(1, h, 1).setPosition(p.x, p.bottom + h / 2, p.z);
      pillars.setMatrixAt(i, m);
    });
    pillars.castShadow = true;
    pillars.receiveShadow = true;
    this.group.add(pillars);
    const railParts: BufferGeometry[] = [];
    for (const b of this.track.bridges) {
      const geo = this.keep(new BufferGeometry());
      geo.setAttribute('position', new BufferAttribute(b.positions.slice(), 3));
      geo.setIndex(new BufferAttribute(b.indices.slice(), 1));
      const p = b.positions;
      const uv = new Float32Array((p.length / 3) * 2);
      for (let i = 0; i < p.length / 3; i++) {
        uv[i * 2] = p[i * 3] * 0.25;
        uv[i * 2 + 1] = p[i * 3 + 2] * 0.25;
      }
      geo.setAttribute('uv', new BufferAttribute(uv, 2));
      geo.computeVertexNormals();
      const deck = new Mesh(geo, deckMat);
      deck.castShadow = true;
      deck.receiveShadow = true;
      this.group.add(deck);
      // Railing: a post at each segment start plus a top and a middle beam.
      for (const r of b.railings) {
        const len = Math.hypot(r.bx - r.ax, r.bz - r.az);
        const yaw = Math.atan2(r.bx - r.ax, r.bz - r.az);
        const mx = (r.ax + r.bx) / 2;
        const mz = (r.az + r.bz) / 2;
        const my = (r.ay + r.by) / 2;
        for (const [h, th] of [[1.0, 0.14], [0.55, 0.1]] as const) {
          railParts.push(new BoxGeometry(th, th, len).rotateY(yaw).translate(mx, my + h, mz));
        }
        railParts.push(new BoxGeometry(0.16, 1.1, 0.16).translate(r.ax, r.ay + 0.55, r.az));
      }
    }
    if (railParts.length) {
      const merged = this.keep(mergeGeometries(railParts)!);
      for (const g of railParts) g.dispose();
      const rails = new Mesh(merged, railMat);
      rails.castShadow = true;
      this.group.add(rails);
    }
  }

  /** Water ribbons along the rivers (render only). */
  private buildWater(): void {
    const rivers = this.track.def.natural.rivers ?? [];
    if (rivers.length === 0) return;
    const mat = this.keep(new MeshPhongMaterial({ color: 0x3f93c9, specular: 0xffffff, shininess: 90, transparent: true, opacity: 0.82, depthWrite: false }));
    for (const r of rivers) {
      const pos: number[] = [];
      const idx: number[] = [];
      const half = r.width / 2 + 7;
      // Resample the polyline so the ribbon follows it smoothly.
      const pts: Array<{ x: number; z: number }> = [];
      for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1];
        const b = r.points[i];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 6));
        for (let k = 0; k < n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
      }
      pts.push(r.points[r.points.length - 1]);
      pts.forEach((p, i) => {
        const q = pts[Math.min(pts.length - 1, i + 1)];
        const o = pts[Math.max(0, i - 1)];
        const tx = q.x - o.x;
        const tz = q.z - o.z;
        const tl = Math.hypot(tx, tz) || 1;
        const rx = -tz / tl;
        const rz = tx / tl;
        pos.push(p.x - rx * half, r.waterHeight, p.z - rz * half, p.x + rx * half, r.waterHeight, p.z + rz * half);
        if (i > 0) {
          const k = i * 2;
          idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
        }
      });
      const geo = this.keep(new BufferGeometry());
      geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      // Make sure the ribbon faces up regardless of winding.
      const nrm = geo.getAttribute('normal');
      for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
      const water = new Mesh(geo, mat);
      water.receiveShadow = true;
      water.renderOrder = 1;
      mat.side = DoubleSide;
      this.group.add(water);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

