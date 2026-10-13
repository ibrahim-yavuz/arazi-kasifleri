import { BufferAttribute, Color, CylinderGeometry, DoubleSide, Mesh, MeshBasicMaterial } from 'three';
import { fbm } from '../world/noise';

/**
 * Distant mountain ring outside the playable world (render only, no collision). Gives the
 * hazy mountain horizon without enlarging the heightfield.
 */
export function createMountainBackdrop(radius: number, haze: Color, seed = 5): Mesh {
  const segs = 160;
  const geo = new CylinderGeometry(radius, radius * 1.08, 1, segs, 4, true);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const t = pos.getY(i) + 0.5; // 0 bottom .. 1 top
    const a = Math.atan2(z, x);
    const h = 70 + 110 * Math.max(0, fbm(Math.cos(a) * 3 + 10, Math.sin(a) * 3 + 10, 4, seed) + 0.35);
    pos.setY(i, -20 + t * h);
    // Aerial perspective: distant slopes fade toward the sky haze, more so at the base.
    const k = 0.8 + 0.2 * t;
    const mixK = 0.62 - 0.12 * t;
    colors[i * 3] = 0.3 * k * (1 - mixK) + haze.r * mixK;
    colors[i * 3 + 1] = 0.44 * k * (1 - mixK) + haze.g * mixK;
    colors[i * 3 + 2] = 0.4 * k * (1 - mixK) + haze.b * mixK;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  const m = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: false }));
  m.frustumCulled = false;
  m.renderOrder = -5;
  return m;
}
