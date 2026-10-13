import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../physics/math';
import { grassTuftTexture } from '../render/Textures';
import type { BuiltScenery, SceneryInstance } from './TrackBuilder';

function colored(geo: BufferGeometry, color: number, jitter = 0, seed = 1): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  const c = new Color(color);
  const rnd = mulberry32(seed);
  for (let i = 0; i < n; i += 3) {
    const k = 1 + (rnd() - 0.5) * jitter;
    for (let v = 0; v < 3 && i + v < n; v++) {
      arr[(i + v) * 3] = c.r * k;
      arr[(i + v) * 3 + 1] = c.g * k;
      arr[(i + v) * 3 + 2] = c.b * k;
    }
  }
  g.setAttribute('color', new BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

function pineGeometry(): BufferGeometry {
  const parts = [colored(new CylinderGeometry(0.18, 0.28, 2.2, 6).translate(0, 1.1, 0), 0x5b3b22, 0.1, 1)];
  const tiers = [
    [2.6, 3.4, 2.4],
    [2.1, 3.0, 4.0],
    [1.5, 2.6, 5.5],
    [0.9, 2.0, 6.8],
  ];
  tiers.forEach(([r, h, y], i) => parts.push(colored(new ConeGeometry(r, h, 8).translate(0, y, 0), i % 2 ? 0x2f6b34 : 0x285e2e, 0.25, 10 + i)));
  return mergeGeometries(parts)!;
}

function leafyGeometry(): BufferGeometry {
  const parts = [colored(new CylinderGeometry(0.2, 0.32, 2.6, 6).translate(0, 1.3, 0), 0x6a4528, 0.1, 2)];
  const blobs: Array<[number, number, number, number]> = [
    [0, 3.9, 0, 2.0],
    [0.9, 3.4, 0.4, 1.4],
    [-0.8, 3.5, -0.3, 1.5],
    [0.1, 4.8, -0.4, 1.3],
  ];
  blobs.forEach(([x, y, z, r], i) => parts.push(colored(new IcosahedronGeometry(r, 1).translate(x, y, z), i % 2 ? 0x5a9a3a : 0x4c8a34, 0.3, 20 + i)));
  return mergeGeometries(parts)!;
}

function rockGeometry(): BufferGeometry {
  const g = new DodecahedronGeometry(0.9, 1);
  const p = g.getAttribute('position');
  const rnd = mulberry32(4);
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 0.8 + rnd() * 0.35;
    v.multiplyScalar(k);
    v.y *= 0.65;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return colored(g, 0x8a7d70, 0.25, 7);
}

function grassGeometry(): BufferGeometry {
  const a = new PlaneGeometry(1.4, 0.9).translate(0, 0.42, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const c = a.clone().rotateY(Math.PI / 4);
  const one = mergeGeometries([a, b, c])!;
  // Explicit back faces (reversed winding) instead of DoubleSide: DoubleSide flips the
  // normal on back faces, which would turn the up-facing tuft normals downward (black).
  const back = one.clone();
  const idx = back.getIndex()!;
  for (let i = 0; i < idx.count; i += 3) {
    const t = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, t);
  }
  const g = mergeGeometries([one, back])!;
  // Point all normals up so tufts are lit like the ground beneath them.
  const n = g.getAttribute('normal');
  const up = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) up[i * 3 + 1] = 1;
  g.setAttribute('normal', new Float32BufferAttribute(up, 3));
  return g;
}

/** Instanced trees, rocks and grass tufts (a handful of draw calls for thousands of props). */
export class Scenery {
  readonly group = new Group();
  private readonly meshes: InstancedMesh[] = [];
  /** Region size (m) used to bucket instances for culling. */
  static readonly REGION = 200;

  /** Hides regions farther than `range` from the camera (they are inside the fog). */
  cull(camX: number, camZ: number, range: number): void {
    for (const m of this.meshes) {
      const s = m.boundingSphere;
      if (!s) continue;
      const d = Math.hypot(s.center.x - camX, s.center.z - camZ) - s.radius;
      m.visible = d < range;
    }
  }

  constructor(sc: BuiltScenery, quality: number) {
    const lambertVC = new MeshLambertMaterial({ vertexColors: true });
    this.addInstanced(pineGeometry(), lambertVC, sc.pines, true, 0);
    this.addInstanced(leafyGeometry(), lambertVC, sc.leafy, true, 1);
    this.addInstanced(rockGeometry(), lambertVC, sc.rocks, true, 2);
    this.addInstanced(rockGeometry(), lambertVC, sc.pebbles, false, 4);
    const grassMat = new MeshLambertMaterial({ map: grassTuftTexture(), alphaTest: 0.45, transparent: false });
    const grassCount = quality === 0 ? Math.floor(sc.grass.length * 0.4) : quality === 1 ? Math.floor(sc.grass.length * 0.75) : sc.grass.length;
    this.addInstanced(grassGeometry(), grassMat, sc.grass.slice(0, grassCount), false, 3);
  }

  /**
   * Splits the instances into square regions, one InstancedMesh each, so that frustum
   * culling and the distance cull (beyond the fog) skip whole regions.
   */
  private addInstanced(geo: BufferGeometry, mat: MeshLambertMaterial, list: SceneryInstance[], castShadow: boolean, seed: number): void {
    if (list.length === 0) return;
    const cells = new Map<string, SceneryInstance[]>();
    for (const it of list) {
      const key = `${Math.floor(it.x / Scenery.REGION)},${Math.floor(it.z / Scenery.REGION)}`;
      const arr = cells.get(key) ?? [];
      arr.push(it);
      cells.set(key, arr);
    }
    for (const items of cells.values()) {
      this.addRegion(geo, mat, items, castShadow, seed++);
    }
  }

  private addRegion(geo: BufferGeometry, mat: MeshLambertMaterial, list: SceneryInstance[], castShadow: boolean, seed: number): void {
    const mesh = new InstancedMesh(geo, mat, list.length);
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const p = new Vector3();
    const up = new Vector3(0, 1, 0);
    const col = new Color();
    const rnd = mulberry32(100 + seed);
    list.forEach((it, i) => {
      q.setFromAxisAngle(up, it.rot);
      s.setScalar(it.scale);
      p.set(it.x, it.y - 0.15, it.z);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      const k = 0.85 + rnd() * 0.3;
      mesh.setColorAt(i, col.setRGB(k, k, k * (0.9 + rnd() * 0.15)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    this.meshes.push(mesh);
    this.group.add(mesh);
  }

  dispose(): void {
    const mats = new Set<MeshLambertMaterial>();
    const geos = new Set<BufferGeometry>();
    for (const m of this.meshes) {
      geos.add(m.geometry);
      mats.add(m.material as MeshLambertMaterial);
      m.dispose();
    }
    for (const g of geos) g.dispose();
    for (const m of mats) {
      m.map?.dispose();
      m.dispose();
    }
  }
}

