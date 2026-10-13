import { BufferAttribute, BufferGeometry, Color, NormalBlending, Points, ShaderMaterial } from 'three';
import type { Texture } from 'three';
import { softDotTexture } from '../render/Textures';

const MAX = 600;

/** Pooled dust/sand particles thrown up by the wheels (render-only). */
export class DustSystem {
  readonly points: Points;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly col = new Float32Array(MAX * 3);
  private readonly size = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly life = new Float32Array(MAX);
  private readonly maxLife = new Float32Array(MAX);
  private cursor = 0;
  private readonly tex: Texture;
  private readonly material: ShaderMaterial;

  constructor() {
    this.tex = softDotTexture();
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new BufferAttribute(this.col, 3));
    geo.setAttribute('size', new BufferAttribute(this.size, 1));
    geo.setAttribute('alpha', new BufferAttribute(this.alpha, 1));
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      uniforms: { map: { value: this.tex }, scale: { value: 600 } },
      vertexShader: `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        varying float vAlpha;
        varying vec3 vColor;
        uniform float scale;
        void main() {
          vAlpha = alpha;
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a * vAlpha);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
    this.alpha.fill(0);
  }

  setViewportHeight(h: number): void {
    this.material.uniforms.scale.value = h * 0.75;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: Color, size: number, life: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r;
    this.col[i * 3 + 1] = color.g;
    this.col[i * 3 + 2] = color.b;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  update(dt: number): void {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3] *= 1 - 1.5 * dt;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * (1 - 1.5 * dt) + 0.6 * dt;
      this.vel[i * 3 + 2] *= 1 - 1.5 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += dt * 2.2;
      this.alpha[i] = 0.55 * k * Math.min(1, (1 - k) * 8);
    }
    const g = this.points.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('size').needsUpdate = true;
    g.getAttribute('alpha').needsUpdate = true;
    g.getAttribute('color').needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    this.tex.dispose();
  }
}
