import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Fog,
  Group,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  SpotLight,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { Material } from 'three';
import type { VehicleInfo } from '../data/vehicles';
import { buildWheelLayout } from '../physics/VehicleConfig';
import { createVehicleModel } from './VehicleModels';
import type { VehicleModel } from './VehicleModels';

/** Dark garage with the cars on a semicircle; the selected car turns on a lit platform. */
export class GarageScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(50, 1, 0.1, 200);
  private readonly models: VehicleModel[] = [];
  private readonly slots: Group[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];
  private selected = 0;
  private turn = 0;
  private readonly spot: SpotLight;
  private camYaw = 0;

  constructor(vehicles: VehicleInfo[]) {
    const k = <T extends { dispose(): void }>(x: T) => (this.disposables.push(x), x);
    this.scene.fog = new Fog(0x0c0d0e, 14, 40);
    this.scene.background = null;
    this.scene.add(new AmbientLight(0x8890a0, 0.5));
    const floor = new Mesh(k(new PlaneGeometry(80, 80)), k(new MeshLambertMaterial({ color: 0x2a2b2d })));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const wallMat = k(new MeshLambertMaterial({ color: 0x3a3d40 }));
    const shutterMat = k(new MeshLambertMaterial({ color: 0x4d3a2a }));
    const back = new Mesh(k(new BoxGeometry(40, 9, 0.4)), wallMat);
    back.position.set(0, 4.5, -11);
    this.scene.add(back);
    for (const x of [-8, 8]) {
      const sh = new Mesh(k(new BoxGeometry(5, 4, 0.2)), shutterMat);
      sh.position.set(x, 2, -10.7);
      this.scene.add(sh);
    }
    const coneMat = k(new MeshLambertMaterial({ color: 0xff6a1a }));
    const coneGeo = k(new ConeGeometry(0.22, 0.6, 12));
    for (const [x, z] of [[-6, -2], [-5.4, 1], [6, -2], [5.5, 1], [-3, -7], [3, -7]]) {
      const c = new Mesh(coneGeo, coneMat);
      c.position.set(x, 0.3, z);
      this.scene.add(c);
    }
    const tyreGeo = k(new CylinderGeometry(0.45, 0.45, 0.3, 16));
    const tyreMat = k(new MeshLambertMaterial({ color: 0x151515 }));
    for (let i = 0; i < 3; i++) {
      const t = new Mesh(tyreGeo, tyreMat);
      t.position.set(9, 0.15 + i * 0.3, -6);
      this.scene.add(t);
    }

    const platMat = k(new MeshLambertMaterial({ color: 0x55585c, emissive: 0x15161a }));
    const platform = new Mesh(k(new CircleGeometry(3.4, 48)), platMat);
    platform.rotation.x = -Math.PI / 2;
    platform.position.set(0, 0.01, 2.5);
    this.scene.add(platform);

    this.spot = new SpotLight(0xfff2dd, 120, 30, 0.5, 0.5, 1.2);
    this.spot.position.set(0, 9, 5);
    this.spot.target.position.set(0, 0, 2.5);
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(1024, 1024);
    this.scene.add(this.spot, this.spot.target);
    const fill = new PointLight(0x99aacc, 25, 25);
    fill.position.set(-5, 4, 6);
    this.scene.add(fill);

    vehicles.forEach((v, i) => {
      const model = createVehicleModel(v, buildWheelLayout(v.config));
      this.models.push(model);
      const slot = new Group();
      slot.add(model.root);
      const c = v.config;
      const restLen = c.suspension.restLength - (c.chassis.mass * 9.81) / 4 / c.suspension.stiffness;
      model.root.position.y = c.geometry.wheelRadius + restLen - c.geometry.hardpointHeight;
      buildWheelLayout(c).forEach((w, wi) => model.wheelPivots[wi].position.set(w.hardpoint.x, w.hardpoint.y - restLen, w.hardpoint.z));
      model.root.traverse((o) => {
        if ((o as Mesh).isMesh) (o as Mesh).castShadow = true;
      });
      slot.add(this.nameLabel(v.name, k));
      this.slots.push(slot);
      this.scene.add(slot);
      void i;
    });
    this.layout(true);
  }

  private nameLabel(text: string, k: <T extends { dispose(): void }>(x: T) => T): Mesh {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.font = '900 92px "Lilita One", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8e8e8';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 6;
    const t = text.toLocaleUpperCase('tr-TR');
    ctx.strokeText(t, 256, 66);
    ctx.fillText(t, 256, 66);
    const tex = k(new CanvasTexture(c));
    tex.colorSpace = SRGBColorSpace;
    const mat: Material = k(new MeshLambertMaterial({ map: tex, transparent: true, emissive: 0x333333 }));
    const m = new Mesh(k(new PlaneGeometry(3.2, 0.8)), mat);
    m.position.set(0, 3.2, 0);
    return m;
  }

  /** Positions: selected car front-centre, others on a semicircle behind. */
  private layout(snap: boolean): void {
    const n = this.slots.length;
    this.slots.forEach((s, i) => {
      const rel = (i - this.selected + n) % n;
      let target: Vector3;
      if (rel === 0) target = new Vector3(0, 0, 2.5);
      else {
        const a = ((rel - (n - 1) / 2 - 0.5) / (n - 1)) * Math.PI * 0.9;
        target = new Vector3(Math.sin(a) * 7.5, 0, -4 + Math.cos(a) * 0.5 - 1.5);
      }
      if (snap) s.position.copy(target);
      s.userData.target = target;
    });
  }

  select(i: number): void {
    this.selected = i;
    this.turn = 0;
    this.layout(false);
  }

  update(dt: number): void {
    this.turn += dt * 0.5;
    this.slots.forEach((s, i) => {
      const t = s.userData.target as Vector3;
      s.position.lerp(t, Math.min(1, dt * 5));
      const label = s.children[1];
      // The selected car's name is shown by the HTML overlay instead.
      label.visible = i !== this.selected;
      if (i === this.selected) {
        s.rotation.y = 0.6 + this.turn;
        label.rotation.y = -s.rotation.y + this.camYaw;
      } else {
        s.rotation.y = Math.atan2(-s.position.x, 6 - s.position.z) + Math.PI;
        label.rotation.y = -s.rotation.y;
      }
    });
    this.camera.position.set(0, 4.6, 13.5);
    this.camera.lookAt(0, 1.1, -0.5);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    for (const m of this.models) m.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
