import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  MeshPhongMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { BufferGeometry, Material } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { VehicleInfo } from '../data/vehicles';
import type { WheelLayout } from '../physics/VehicleConfig';
import { tireTreadTexture } from '../render/Textures';

/** A visual suspension link (shock or arm) re-aimed every frame from a body mount to a hub. */
export interface Link {
  mesh: Mesh;
  mount: Vector3;
  wheel: number;
  /** Offset from the wheel centre where the link attaches (chassis-local). */
  hubOffset: Vector3;
}

export interface VehicleModel {
  root: Group;
  /** Per wheel: positioned at the wheel centre (chassis-local). */
  wheelPivots: Group[];
  /** Per wheel: rotates about Y for steering. */
  wheelSteer: Object3D[];
  /** Per wheel: rotates about X for rolling. */
  wheelSpin: Object3D[];
  steeringWheel: Object3D | null;
  brakeLights: MeshLambertMaterial;
  reverseLights: MeshLambertMaterial;
  links: Link[];
  dispose(): void;
}

class Builder {
  readonly root = new Group();
  readonly geos: BufferGeometry[] = [];
  readonly mats: Material[] = [];
  readonly links: Link[] = [];
  steeringWheel: Object3D | null = null;

  mat<T extends Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  geo<T extends BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  add(geo: BufferGeometry, mat: Material, x: number, y: number, z: number, parent: Object3D = this.root): Mesh {
    const m = new Mesh(this.geo(geo), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  box(w: number, h: number, d: number, mat: Material, x: number, y: number, z: number): Mesh {
    return this.add(new BoxGeometry(w, h, d), mat, x, y, z);
  }

  rbox(w: number, h: number, d: number, r: number, mat: Material, x: number, y: number, z: number): Mesh {
    return this.add(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)), mat, x, y, z);
  }

  /** Cylinder between two points. */
  tube(a: [number, number, number], b: [number, number, number], r: number, mat: Material, parent: Object3D = this.root): Mesh {
    const va = new Vector3(...a);
    const vb = new Vector3(...b);
    const len = va.distanceTo(vb);
    const m = this.add(new CylinderGeometry(r, r, 1, 8), mat, 0, 0, 0, parent);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.scale.y = len;
    m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), vb.sub(va).normalize());
    return m;
  }

  /** A link that is re-aimed per frame between a body mount and a wheel hub. */
  link(mount: [number, number, number], wheel: number, hubOffset: [number, number, number], r: number, mat: Material): void {
    const m = this.add(new CylinderGeometry(r, r, 1, 8), mat, 0, 0, 0);
    this.links.push({ mesh: m, mount: new Vector3(...mount), wheel, hubOffset: new Vector3(...hubOffset) });
  }

  steering(x: number, y: number, z: number, tilt: number, mat: Material): void {
    const g = new Group();
    g.position.set(x, y, z);
    g.rotation.x = tilt;
    const rim = new Mesh(this.geo(new TorusGeometry(0.17, 0.025, 6, 18)), mat);
    const spoke = new Mesh(this.geo(new BoxGeometry(0.32, 0.03, 0.02)), mat);
    const spoke2 = new Mesh(this.geo(new BoxGeometry(0.03, 0.17, 0.02)), mat);
    spoke2.position.y = -0.08;
    const inner = new Group();
    inner.add(rim, spoke, spoke2);
    g.add(inner);
    this.root.add(g);
    this.steeringWheel = inner;
  }
}

interface Palette {
  paint: Material;
  accent: Material;
  trim: Material;
  chrome: Material;
  glass: Material;
  head: Material;
  brake: MeshLambertMaterial;
  reverse: MeshLambertMaterial;
  rubber: Material;
}

function palette(b: Builder, info: VehicleInfo): Palette {
  return {
    paint: b.mat(new MeshPhongMaterial({ color: info.color, shininess: 70, specular: 0x555555 })),
    accent: b.mat(new MeshPhongMaterial({ color: info.accent, shininess: 50, specular: 0x333333 })),
    trim: b.mat(new MeshLambertMaterial({ color: 0x26282b })),
    chrome: b.mat(new MeshPhongMaterial({ color: 0xc9ced4, shininess: 120, specular: 0xffffff })),
    glass: b.mat(new MeshPhongMaterial({ color: 0x1e2c3a, shininess: 110, specular: 0x9fb6cc })),
    head: b.mat(new MeshLambertMaterial({ color: 0xfff7d6, emissive: 0xfff2b0, emissiveIntensity: 0.6 })),
    brake: b.mat(new MeshLambertMaterial({ color: 0x8a0a0a, emissive: 0xff1a10, emissiveIntensity: 0.15 })),
    reverse: b.mat(new MeshLambertMaterial({ color: 0xdedede, emissive: 0xffffff, emissiveIntensity: 0 })),
    rubber: b.mat(new MeshLambertMaterial({ color: 0x1a1a1a })),
  };
}

// ---------------------------------------------------------------------------------------
// Bodies (chassis-local: +X right, +Y up, −Z forward; ground ≈ −(radius + rest − sag − hardpoint))
// ---------------------------------------------------------------------------------------

function buildPanter(b: Builder, p: Palette): void {
  b.rbox(1.86, 0.62, 4.25, 0.08, p.paint, 0, 0.42, 0);
  b.rbox(1.78, 0.2, 1.35, 0.06, p.paint, 0, 0.8, -1.38);
  b.rbox(1.74, 0.8, 2.35, 0.1, p.paint, 0, 1.12, 0.45);
  const ws = b.box(1.5, 0.56, 0.05, p.glass, 0, 1.17, -0.74);
  ws.rotation.x = -0.22;
  b.box(1.76, 0.44, 1.9, p.glass, 0, 1.2, 0.5).scale.set(1.002, 1, 1);
  b.box(1.42, 0.44, 0.04, p.glass, 0, 1.2, 1.64);
  b.box(1.3, 0.36, 0.06, p.trim, 0, 0.6, -2.14);
  for (let i = -2; i <= 2; i++) b.box(0.05, 0.3, 0.07, p.chrome, i * 0.22, 0.6, -2.16);
  for (const s of [-1, 1]) {
    const hl = b.add(new CylinderGeometry(0.13, 0.13, 0.06, 14), p.head, s * 0.66, 0.64, -2.15);
    hl.rotation.x = Math.PI / 2;
    b.box(0.16, 0.3, 0.05, p.brake, s * 0.82, 0.74, 2.14);
    b.box(0.12, 0.08, 0.05, p.reverse, s * 0.82, 0.52, 2.14);
    b.box(0.08, 0.14, 0.2, p.trim, s * 0.98, 1.02, -0.62);
    b.box(0.07, 0.07, 1.9, p.trim, s * 0.68, 1.57, 0.45);
  }
  for (const z of [-0.35, 0.45, 1.25]) b.box(1.42, 0.05, 0.07, p.trim, 0, 1.6, z);
  b.box(1.96, 0.22, 0.26, p.trim, 0, 0.28, -2.18);
  b.box(1.96, 0.22, 0.24, p.trim, 0, 0.28, 2.17);
  b.box(1.5, 0.5, 0.04, p.trim, 0, 0.62, 2.15);
  const spare = b.add(new CylinderGeometry(0.4, 0.4, 0.26, 18), p.rubber, 0, 1.0, 2.32);
  spare.rotation.x = Math.PI / 2;
  const hub = b.add(new CylinderGeometry(0.2, 0.2, 0.28, 12), p.chrome, 0, 1.0, 2.33);
  hub.rotation.x = Math.PI / 2;
  b.steering(-0.42, 1.02, -0.42, -0.45, p.trim);
}

function buildOrumcek(b: Builder, p: Palette, wheels: WheelLayout[]): void {
  const frame = p.accent;
  b.box(1.3, 0.08, 3.0, p.trim, 0, 0.12, 0.1);
  b.rbox(1.05, 0.36, 0.95, 0.12, p.paint, 0, 0.36, -1.5);
  b.rbox(0.9, 0.12, 0.7, 0.05, p.paint, 0, 0.58, -1.15);
  for (const s of [-1, 1]) b.rbox(0.24, 0.3, 1.6, 0.08, p.paint, s * 0.64, 0.32, 0.2);
  b.box(0.5, 0.18, 0.55, p.trim, 0, 0.3, 0.25);
  b.box(0.5, 0.6, 0.12, p.trim, 0, 0.66, 0.52);
  // Roll cage.
  const r = 0.045;
  for (const s of [-1, 1]) {
    b.tube([s * 0.62, 0.15, 0.6], [s * 0.55, 1.38, 0.52], r, frame);
    b.tube([s * 0.62, 0.3, -0.62], [s * 0.5, 1.28, -0.22], r, frame);
    b.tube([s * 0.5, 1.28, -0.22], [s * 0.55, 1.38, 0.52], r, frame);
    b.tube([s * 0.55, 1.38, 0.52], [s * 0.5, 0.55, 1.45], r, frame);
    b.tube([s * 0.62, 0.15, 0.6], [s * 0.5, 0.55, 1.45], r, frame);
    b.tube([s * 0.62, 0.3, -0.62], [s * 0.45, 0.28, -1.95], r, frame);
  }
  b.tube([-0.55, 1.38, 0.52], [0.55, 1.38, 0.52], r, frame);
  b.tube([-0.5, 1.28, -0.22], [0.5, 1.28, -0.22], r, frame);
  b.tube([-0.55, 1.38, 0.52], [0.5, 0.15, 0.6], r, frame);
  b.tube([-0.72, 0.25, -2.02], [0.72, 0.25, -2.02], 0.05, frame);
  b.tube([-0.5, 0.55, 1.45], [0.5, 0.55, 1.45], r, frame);
  // Engine and exhausts at the back.
  b.box(0.8, 0.5, 0.7, p.trim, 0, 0.55, 1.2);
  b.box(0.6, 0.12, 0.5, p.chrome, 0, 0.86, 1.2);
  for (const s of [-1, 1]) {
    const ex = b.add(new CylinderGeometry(0.06, 0.06, 0.7, 10), p.chrome, s * 0.25, 0.75, 1.65);
    ex.rotation.x = Math.PI / 2 - 0.4;
    // Round chrome lamps on the front hoop, as on the promo render.
    b.add(new SphereGeometry(0.14, 14, 10), p.chrome, s * 0.32, 1.38, -0.22);
    const lens = b.add(new CylinderGeometry(0.11, 0.11, 0.03, 14), p.head, s * 0.32, 1.38, -0.36);
    lens.rotation.x = Math.PI / 2;
    b.box(0.14, 0.1, 0.04, p.brake, s * 0.42, 0.45, 1.62);
    b.box(0.08, 0.06, 0.04, p.reverse, s * 0.25, 0.38, 1.62);
  }
  // Long-travel suspension: coil-over shocks and A-arms that follow the wheels.
  wheels.forEach((w, i) => {
    const s = w.left ? -1 : 1;
    const zf = w.hardpoint.z;
    b.link([s * 0.55, 0.85, zf + (w.front ? 0.1 : -0.1)], i, [-s * 0.12, 0.05, 0], 0.07, p.accent);
    b.link([s * 0.5, 0.18, zf - 0.28], i, [-s * 0.14, -0.05, 0], 0.035, p.trim);
    b.link([s * 0.5, 0.18, zf + 0.28], i, [-s * 0.14, -0.05, 0], 0.035, p.trim);
  });
  b.steering(0, 0.95, -0.25, -0.6, p.trim);
}

function buildBoga(b: Builder, p: Palette): void {
  b.rbox(1.95, 0.62, 4.9, 0.08, p.paint, 0, 0.46, 0);
  b.rbox(1.82, 0.86, 1.75, 0.12, p.paint, 0, 1.18, -0.35);
  b.rbox(1.86, 0.24, 1.55, 0.06, p.paint, 0, 0.86, -1.72);
  const ws = b.box(1.6, 0.58, 0.05, p.glass, 0, 1.24, -1.2);
  ws.rotation.x = -0.28;
  b.box(1.84, 0.46, 1.1, p.glass, 0, 1.28, -0.3);
  b.box(1.5, 0.42, 0.04, p.glass, 0, 1.28, 0.54);
  for (const s of [-1, 1]) {
    b.box(0.08, 0.46, 1.75, p.paint, s * 0.93, 0.98, 1.55);
    b.box(0.22, 0.2, 0.18, p.head, s * 0.66, 0.66, -2.46);
    b.box(0.16, 0.34, 0.05, p.brake, s * 0.84, 0.82, 2.46);
    b.box(0.1, 0.08, 0.05, p.reverse, s * 0.84, 0.56, 2.46);
    b.box(0.08, 0.16, 0.22, p.trim, s * 1.0, 1.12, -1.0);
    b.tube([s * 0.5, 0.25, -2.62], [s * 0.5, 1.02, -2.56], 0.05, p.trim);
  }
  b.box(1.84, 0.46, 0.08, p.paint, 0, 0.98, 2.43);
  b.box(1.2, 0.36, 0.06, p.trim, 0, 0.62, -2.46);
  b.tube([-0.75, 1.02, -2.56], [0.75, 1.02, -2.56], 0.05, p.trim);
  b.tube([-0.85, 0.32, -2.64], [0.85, 0.32, -2.64], 0.06, p.trim);
  b.box(2.0, 0.22, 0.24, p.trim, 0, 0.26, 2.47);
  // Roof light bar.
  b.box(1.5, 0.12, 0.2, p.trim, 0, 1.68, -0.72);
  const amber = b.mat(new MeshLambertMaterial({ color: 0xffd27a, emissive: 0xffb020, emissiveIntensity: 0.5 }));
  for (let i = -2; i <= 2; i++) b.box(0.2, 0.09, 0.05, amber, i * 0.28, 1.68, -0.83);
  b.steering(-0.45, 1.06, -0.8, -0.45, p.trim);
}

function buildAkrep(b: Builder, p: Palette): void {
  b.rbox(1.8, 0.55, 4.6, 0.2, p.paint, 0, 0.42, 0.05);
  b.rbox(1.62, 0.32, 1.95, 0.16, p.paint, 0, 0.76, -1.22);
  b.rbox(0.5, 0.16, 0.8, 0.06, p.trim, 0, 0.98, -1.25);
  b.rbox(1.6, 0.62, 1.3, 0.24, p.paint, 0, 1.08, 0.35);
  const ws = b.box(1.4, 0.44, 0.05, p.glass, 0, 1.12, -0.32);
  ws.rotation.x = -0.45;
  b.box(1.62, 0.32, 0.9, p.glass, 0, 1.16, 0.4);
  b.rbox(1.7, 0.3, 1.25, 0.12, p.paint, 0, 0.8, 1.62);
  // Red racing stripes.
  for (const s of [-1, 1]) {
    b.box(0.18, 0.02, 1.95, p.accent, s * 0.16, 0.93, -1.22);
    b.box(0.18, 0.02, 1.0, p.accent, s * 0.16, 1.4, 0.35);
    b.box(0.18, 0.02, 1.25, p.accent, s * 0.16, 0.96, 1.62);
    b.box(0.04, 0.12, 3.6, p.accent, s * 0.905, 0.5, 0.1);
    const hl = b.add(new CylinderGeometry(0.14, 0.14, 0.06, 14), p.head, s * 0.6, 0.58, -2.2);
    hl.rotation.x = Math.PI / 2;
    b.box(0.22, 0.12, 0.05, p.brake, s * 0.62, 0.66, 2.36);
    b.box(0.1, 0.06, 0.05, p.reverse, s * 0.35, 0.66, 2.36);
    const pipe = b.add(new CylinderGeometry(0.07, 0.07, 2.2, 10), p.chrome, s * 0.97, 0.18, 0.1);
    pipe.rotation.x = Math.PI / 2;
    // Scorpion-tail spoiler.
    b.tube([s * 0.6, 0.95, 2.15], [s * 0.6, 1.5, 2.45], 0.05, p.accent);
    b.tube([s * 0.6, 1.5, 2.45], [s * 0.6, 1.82, 2.1], 0.05, p.accent);
  }
  b.box(1.6, 0.06, 0.42, p.accent, 0, 1.85, 2.05);
  b.box(1.9, 0.18, 0.2, p.chrome, 0, 0.24, -2.3);
  b.box(1.9, 0.18, 0.2, p.chrome, 0, 0.24, 2.4);
  b.steering(-0.38, 0.98, -0.12, -0.5, p.trim);
}

// ---------------------------------------------------------------------------------------

function buildWheel(b: Builder, p: Palette, radius: number, width: number, left: boolean, treadMat: Material): { pivot: Group; steer: Group; spin: Group } {
  const pivot = new Group();
  const steer = new Group();
  const spin = new Group();
  pivot.add(steer);
  steer.add(spin);
  const tire = new Mesh(b.geo(new CylinderGeometry(radius, radius, width, 26, 1)), [treadMat, p.rubber, p.rubber]);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  spin.add(tire);
  const side = left ? -1 : 1;
  const rim = new Mesh(b.geo(new CylinderGeometry(radius * 0.6, radius * 0.6, width * 0.6, 18)), p.chrome);
  rim.rotation.z = Math.PI / 2;
  rim.position.x = side * width * 0.22;
  spin.add(rim);
  const hubCap = new Mesh(b.geo(new CylinderGeometry(radius * 0.18, radius * 0.18, width * 0.1, 10)), p.trim);
  hubCap.rotation.z = Math.PI / 2;
  hubCap.position.x = side * width * 0.53;
  spin.add(hubCap);
  // Spokes make the spin visible.
  for (let i = 0; i < 5; i++) {
    const sp = new Mesh(b.geo(new BoxGeometry(0.04, radius * 1.05, 0.07)), p.trim);
    sp.position.x = side * width * 0.52;
    sp.rotation.x = (i / 5) * Math.PI;
    spin.add(sp);
  }
  return { pivot, steer, spin };
}

/**
 * Merges the static body meshes (direct children of the root, excluding animated links)
 * into one mesh per material: ~10 draw calls per car instead of ~80.
 */
function mergeStaticParts(b: Builder): void {
  const linkMeshes = new Set(b.links.map((l) => l.mesh));
  const byMat = new Map<Material, BufferGeometry[]>();
  const remove: Mesh[] = [];
  for (const child of b.root.children) {
    const m = child as Mesh;
    if (!m.isMesh || linkMeshes.has(m) || Array.isArray(m.material)) continue;
    m.updateMatrix();
    let g = m.geometry.clone().applyMatrix4(m.matrix);
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    const list = byMat.get(m.material as Material) ?? [];
    list.push(g);
    byMat.set(m.material as Material, list);
    remove.push(m);
  }
  for (const m of remove) b.root.remove(m);
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    b.geos.push(merged);
    const mesh = new Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    b.root.add(mesh);
  }
}

export function createVehicleModel(info: VehicleInfo, layout: WheelLayout[]): VehicleModel {
  const b = new Builder();
  const p = palette(b, info);
  switch (info.id) {
    case 'panter':
      buildPanter(b, p);
      break;
    case 'orumcek':
      buildOrumcek(b, p, layout);
      break;
    case 'boga':
      buildBoga(b, p);
      break;
    default:
      buildAkrep(b, p);
  }
  mergeStaticParts(b);
  const tread = tireTreadTexture();
  tread.repeat.set(1, 3);
  const treadMat = b.mat(new MeshLambertMaterial({ map: tread }));
  const g = info.config.geometry;
  const wheelPivots: Group[] = [];
  const wheelSteer: Object3D[] = [];
  const wheelSpin: Object3D[] = [];
  for (const w of layout) {
    const parts = buildWheel(b, p, w.radius, g.wheelWidth, w.left, treadMat);
    b.root.add(parts.pivot);
    wheelPivots.push(parts.pivot);
    wheelSteer.push(parts.steer);
    wheelSpin.push(parts.spin);
  }
  return {
    root: b.root,
    wheelPivots,
    wheelSteer,
    wheelSpin,
    steeringWheel: b.steeringWheel,
    brakeLights: p.brake,
    reverseLights: p.reverse,
    links: b.links,
    dispose() {
      for (const x of b.geos) x.dispose();
      for (const m of b.mats) m.dispose();
      tread.dispose();
    },
  };
}

const tmpA = new Vector3();
const tmpB = new Vector3();
const UP = new Vector3(0, 1, 0);
const tmpQ = new Quaternion();

/** Re-aims suspension links after the wheel pivots moved. */
export function updateLinks(model: VehicleModel): void {
  for (const l of model.links) {
    const hub = tmpB.copy(model.wheelPivots[l.wheel].position).add(l.hubOffset);
    const a = tmpA.copy(l.mount);
    const len = a.distanceTo(hub);
    l.mesh.position.copy(a).add(hub).multiplyScalar(0.5);
    l.mesh.scale.set(1, len, 1);
    l.mesh.quaternion.copy(tmpQ.setFromUnitVectors(UP, hub.sub(a).normalize()));
  }
}
