import { Vector3 } from 'three';
import type { Object3D } from 'three';
import type { VehicleInfo } from '../data/vehicles';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { RAD2DEG } from '../physics/math';
import type { DustSystem } from '../vehicles/DustSystem';
import type { Vehicle } from '../vehicles/Vehicle';
import { createVehicle, groundSpawn } from '../vehicles/VehicleFactory';
import type { World } from '../world/World';
import type { InputState } from './InputManager';

interface Teleport {
  name: string;
  path?: string;
  at?: number;
  x?: number;
  z?: number;
}

const TELEPORTS: Teleport[] = [
  { name: 'Düz pist (ivmelenme / fren)', x: 0, z: 455 },
  { name: 'Yokuş', path: 'features', at: 20 },
  { name: 'Tek tümsek', path: 'features', at: 265 },
  { name: 'Tümsekler', path: 'features', at: 320 },
  { name: 'Rampa + bozuk iniş', path: 'features', at: 430 },
  { name: 'Yan eğim', path: 'features', at: 590 },
  { name: 'Buz / çamur', path: 'lowgrip', at: 60 },
  { name: 'Dönüş alanı (sabit yarıçap)', x: -220, z: 60 },
];

/**
 * In-browser physics validation scene (?scene=test): one car on the validation track,
 * teleports to each test feature and live measurements.
 */
export class TestScene {
  vehicle: Vehicle;
  private accelStart = -1;
  private t50 = NaN;
  private t100 = NaN;
  private brakeStart: { pos: Vector3; kmh: number; t: number } | null = null;
  private lastBrake = '';
  private air = 0;
  private maxAir = 0;
  private maxComp = 0;
  private time = 0;
  private current = 0;

  constructor(
    private readonly world: World,
    private readonly physics: PhysicsWorld,
    private readonly parent: Object3D,
    private readonly dust: DustSystem,
    info: VehicleInfo,
  ) {
    this.vehicle = this.spawn(info);
    this.teleport(0);
  }

  private spawn(info: VehicleInfo): Vehicle {
    const v = createVehicle(info, this.physics, this.world.collision, { position: { x: 0, y: 5, z: 455 }, yaw: 0 }, this.dust);
    this.parent.add(v.model.root);
    v.physics.inputEnabled = true;
    return v;
  }

  setVehicle(info: VehicleInfo): void {
    this.vehicle.dispose();
    this.vehicle = this.spawn(info);
    this.teleport(this.current);
  }

  teleport(i: number): void {
    const t = TELEPORTS[i];
    if (!t) return;
    this.current = i;
    let x = t.x ?? 0;
    let z = t.z ?? 0;
    let yaw = 0;
    if (t.path) {
      const sm = this.world.track.paths.get(t.path)!.at(t.at ?? 0);
      x = sm.x;
      z = sm.z;
      yaw = Math.atan2(-sm.tx, -sm.tz);
    }
    const h = (px: number, pz: number) => this.world.track.terrain.heightAt(px, pz);
    this.vehicle.physics.reset(groundSpawn(h, this.vehicle.info, x, z, yaw));
    this.accelStart = -1;
    this.brakeStart = null;
    this.maxAir = 0;
    this.maxComp = 0;
  }

  fixedStep(dt: number, input: InputState): void {
    const v = this.vehicle.physics;
    const d = input.driving();
    Object.assign(v.controls, d);
    this.physics.step();
    this.time += dt;
    const t = v.telemetry;
    const kmh = t.speedKmh;
    // 0–50 / 0–100 timing (starts when accelerating from rest).
    if (kmh < 0.5 && d.throttle > 0) {
      this.accelStart = this.time;
      this.t50 = NaN;
      this.t100 = NaN;
    }
    if (this.accelStart >= 0) {
      if (Number.isNaN(this.t50) && kmh >= 50) this.t50 = this.time - this.accelStart;
      if (Number.isNaN(this.t100) && kmh >= 100) this.t100 = this.time - this.accelStart;
    }
    // Braking distance (from the moment the brake is pressed above 40 km/h).
    if (!this.brakeStart && d.brake > 0 && t.gear > 0 && kmh > 40) {
      this.brakeStart = { pos: v.position.clone(), kmh, t: this.time };
    }
    if (this.brakeStart) {
      if (d.brake === 0) this.brakeStart = null;
      else if (kmh < 0.5) {
        const dist = v.position.distanceTo(this.brakeStart.pos);
        this.lastBrake = `${this.brakeStart.kmh.toFixed(0)}→0 km/h: ${dist.toFixed(1)} m, ${(this.time - this.brakeStart.t).toFixed(2)} s`;
        this.brakeStart = null;
      }
    }
    this.air = t.airborne ? this.air + dt : 0;
    this.maxAir = Math.max(this.maxAir, this.air);
    for (const w of v.wheels) this.maxComp = Math.max(this.maxComp, w.compression);
  }

  readout(): string {
    const v = this.vehicle.physics;
    const t = v.telemetry;
    const av = v.angularVelocity(new Vector3());
    const yawRate = Math.abs(av.y);
    const radius = yawRate > 0.05 && t.speed > 2 ? (t.speed / yawRate).toFixed(1) + ' m' : '-';
    const tp = TELEPORTS.map((x, i) => `${i + 1}: ${x.name}`).join('<br>');
    return `<b>Fizik test alanı — ${this.vehicle.info.name}</b> (V: araç değiştir)<br>
      0–50: ${Number.isNaN(this.t50) ? '-' : this.t50.toFixed(2) + ' s'} · 0–100: ${Number.isNaN(this.t100) ? '-' : this.t100.toFixed(2) + ' s'}<br>
      Fren: ${this.lastBrake || '-'}<br>
      Dönüş yarıçapı (anlık): ${radius} · sapma hızı ${(yawRate * RAD2DEG).toFixed(1)}°/s<br>
      En uzun havada kalma: ${this.maxAir.toFixed(2)} s · en fazla sıkışma: ${(this.maxComp * 100).toFixed(1)} cm<br>
      <br>${tp}<br>F3: hata ayıklama çizgileri · F4: ayar paneli · Esc: menü`;
  }

  dispose(): void {
    this.vehicle.dispose();
  }
}
