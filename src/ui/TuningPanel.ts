import GUI from 'lil-gui';
import type { FollowCamera } from '../camera/FollowCamera';
import type { VehiclePhysics } from '../physics/VehiclePhysics';
import { validateVehicleConfig } from '../physics/VehicleConfig';

/**
 * Runtime tuning panel (development tool). Edits the active vehicle's centralised config
 * object in place; mass/collider changes are re-applied to the Rapier body.
 */
export class TuningPanel {
  private gui: GUI | null = null;

  constructor(private readonly parent: HTMLElement) {}

  get visible(): boolean {
    return this.gui !== null;
  }

  toggle(vehicle: VehiclePhysics, camera: FollowCamera): void {
    if (this.gui) {
      this.close();
      return;
    }
    this.open(vehicle, camera);
  }

  open(v: VehiclePhysics, camera: FollowCamera): void {
    this.close();
    const cfg = v.cfg;
    const gui = new GUI({ title: `Ayar: ${cfg.name}`, container: this.parent, width: 320 });
    gui.domElement.classList.add('tuning-panel');
    const remass = () => v.applyMassProperties();

    const ch = gui.addFolder('Şasi');
    ch.add(cfg.chassis, 'mass', 400, 4000, 10).name('kütle (kg)').onChange(remass);
    ch.add(cfg.chassis.centerOfMass, 'y', -0.5, 1.0, 0.01).name('ağırlık merkezi y').onChange(remass);
    ch.add(cfg.chassis.centerOfMass, 'z', -1, 1, 0.01).name('ağırlık merkezi z').onChange(remass);
    ch.add(cfg.chassis.inertiaScale, 'x', 0.3, 3, 0.05).name('atalet (pitch) ×').onChange(remass);
    ch.add(cfg.chassis.inertiaScale, 'z', 0.3, 3, 0.05).name('atalet (roll) ×').onChange(remass);
    ch.add(cfg.chassis, 'angularDamping', 0, 2, 0.01).name('açısal sönüm').onChange(remass);

    const su = gui.addFolder('Süspansiyon');
    su.add(cfg.suspension, 'restLength', 0.2, 1.0, 0.01).name('serbest boy (m)');
    su.add(cfg.suspension, 'travel', 0.1, 0.8, 0.01).name('çalışma (m)');
    su.add(cfg.suspension, 'stiffness', 5000, 120000, 500).name('yay (N/m)');
    su.add(cfg.suspension, 'rearStiffnessScale', 0.5, 2, 0.01).name('arka yay ×');
    su.add(cfg.suspension, 'compressionDamping', 0, 15000, 50).name('sıkışma sönümü');
    su.add(cfg.suspension, 'reboundDamping', 0, 15000, 50).name('geri dönüş sönümü');
    su.add(cfg.suspension, 'antiRollFront', 0, 60000, 500).name('ön viraj demiri');
    su.add(cfg.suspension, 'antiRollRear', 0, 60000, 500).name('arka viraj demiri');
    su.add(cfg.suspension, 'rollInfluence', 0, 1, 0.01).name('yuvarlanma etkisi');

    const ti = gui.addFolder('Lastik / Tutuş');
    ti.add(cfg.tire, 'friction', 0.3, 2, 0.01).name('sürtünme μ');
    ti.add(cfg.tire, 'peakSlipRatio', 0.03, 0.4, 0.01).name('tepe kayma oranı');
    ti.add(cfg.tire, 'peakSlipAngleDeg', 2, 20, 0.5).name('tepe kayma açısı°');
    ti.add(cfg.tire, 'slideFriction', 0.3, 1, 0.01).name('kayma tutuşu');
    ti.add(cfg.tire, 'rearLateralScale', 0.5, 1.5, 0.01).name('arka yanal tutuş ×');
    ti.add(cfg.tire, 'loadSensitivity', 0, 0.5, 0.01).name('yük hassasiyeti');

    const st = gui.addFolder('Direksiyon');
    st.add(cfg.steering, 'maxAngleDeg', 10, 50, 0.5).name('azami açı°');
    st.add(cfg.steering, 'rateDegPerSec', 30, 500, 5).name('dönüş hızı°/s');
    st.add(cfg.steering, 'returnRateDegPerSec', 30, 600, 5).name('toplama hızı°/s');
    st.add(cfg.steering, 'highSpeedFactor', 0.1, 1, 0.01).name('yüksek hız oranı');
    st.add(cfg.steering, 'ackermann', 0, 1, 0.05).name('Ackermann');

    const en = gui.addFolder('Motor / Şanzıman');
    const torque = { scale: 1 };
    const baseCurve = cfg.engine.torqueCurve.map((p) => p.torque);
    en.add(torque, 'scale', 0.3, 3, 0.05).name('tork ×').onChange((k: number) => {
      cfg.engine.torqueCurve.forEach((p, i) => (p.torque = baseCurve[i] * k));
    });
    en.add(cfg.engine, 'maxRPM', 3000, 9000, 50).name('azami devir');
    en.add(cfg.engine, 'engineBrakeTorque', 0, 400, 5).name('motor freni');
    en.add(cfg.transmission, 'finalDrive', 2, 12, 0.05).name('son oran');
    en.add(cfg.transmission, 'layout', ['RWD', 'FWD', 'AWD']).name('çekiş').onChange(() => {
      v.wheels.forEach((w) => {
        const l = cfg.transmission.layout;
        w.layout.driven = l === 'AWD' || (l === 'FWD' ? w.layout.front : !w.layout.front);
      });
    });
    en.add(cfg.transmission, 'frontSplit', 0, 1, 0.01).name('ön tork payı');

    const br = gui.addFolder('Fren');
    br.add(cfg.brakes, 'maxTorque', 1000, 25000, 100).name('fren torku');
    br.add(cfg.brakes, 'frontBias', 0, 1, 0.01).name('ön dağılım');
    br.add(cfg.brakes, 'handbrakeTorque', 0, 8000, 50).name('el freni torku');
    br.add(cfg.brakes, 'handbrakeRearGrip', 0.1, 1, 0.01).name('el freni arka tutuş');
    br.add(cfg.brakes, 'abs').name('ABS');

    const ae = gui.addFolder('Aerodinamik / Yardımlar');
    ae.add(cfg.aero, 'dragFactor', 0, 4, 0.05).name('sürükleme');
    ae.add(cfg.assists, 'uprightTorque', 0, 20000, 100).name('doğrultma (kapalı=0)');
    ae.add(cfg.assists, 'airControlTorque', 0, 8000, 50).name('havada kontrol (0)');
    ae.add(cfg.assists, 'yawDamping', 0, 8000, 50).name('sapma sönümü (0)');
    ae.add(cfg.assists, 'tractionControl', 0, 1, 0.05).name('çekiş kontrolü');
    ae.add(cfg.assists, 'turnAssist', 0, 1, 0.05).name('dönüş yardımı');
    ae.add(cfg.assists, 'stability', 0, 1, 0.05).name('denge kontrolü');

    const cam = gui.addFolder('Kamera');
    cam.add(camera.tuning, 'fov', 40, 90, 1).name('görüş açısı');
    cam.add(camera.tuning, 'distance', 3, 15, 0.1).name('mesafe');
    cam.add(camera.tuning, 'height', 0.5, 8, 0.1).name('yükseklik');
    cam.add(camera.tuning, 'lookHeight', 0, 3, 0.05).name('bakış yüksekliği');
    cam.add(camera.tuning, 'lookAheadTime', 0, 0.5, 0.01).name('ileri bakış (s)');
    cam.add(camera.tuning, 'yawSharpness', 0.5, 20, 0.1).name('dönüş takibi');
    cam.add(camera.tuning, 'heightSharpness', 0.5, 20, 0.1).name('yükseklik takibi');

    gui.add(
      {
        copy: () => {
          const errs = validateVehicleConfig(cfg);
          const json = JSON.stringify(cfg, null, 2);
          console.info('[tuning] vehicle config', errs.length ? errs : 'valid', json);
          void navigator.clipboard?.writeText(json).catch(() => undefined);
        },
      },
      'copy',
    ).name('Ayarları JSON olarak kopyala');

    for (const f of gui.folders) f.close();
    this.gui = gui;
  }

  close(): void {
    this.gui?.destroy();
    this.gui = null;
  }
}
