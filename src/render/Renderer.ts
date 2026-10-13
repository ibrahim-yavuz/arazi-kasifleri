import {
  ACESFilmicToneMapping,
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Object3D } from 'three';
import { mulberry32 } from '../physics/math';
import { cloudTexture } from './Textures';

export const SKY = {
  horizon: new Color(0xcfe6f5),
  zenith: new Color(0x3d8fd8),
  fogNear: 140,
  fogFar: 720,
};

const QUALITY = [
  { pixelRatio: 1, shadowMap: 1024, shadowRange: 45, antialias: false },
  { pixelRatio: 1.5, shadowMap: 2048, shadowRange: 60, antialias: true },
  { pixelRatio: 2, shadowMap: 4096, shadowRange: 70, antialias: true },
];

/**
 * Owns the WebGL renderer, the scene, lights, sky and fog. Rendering stays separate from
 * simulation: everything here reads interpolated state and never touches physics.
 */
export class Renderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  private readonly sky: Mesh;
  private readonly clouds: Sprite[] = [];
  private quality = 1;
  private readonly sunOffset = new Vector3(-60, 110, 45);

  constructor(private readonly container: HTMLElement, quality: 0 | 1 | 2) {
    this.quality = quality;
    this.renderer = new WebGLRenderer({ antialias: QUALITY[quality].antialias, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(60, 1, 0.1, 2400);
    this.scene.background = SKY.horizon.clone();
    this.scene.fog = new Fog(SKY.horizon.getHex(), SKY.fogNear, SKY.fogFar);

    this.hemi = new HemisphereLight(0xdff0ff, 0x6f5a3a, 1.15);
    this.scene.add(this.hemi);
    this.sun = new DirectionalLight(0xfff1d6, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.sky = this.createSky();
    this.scene.add(this.sky);
    this.createClouds();
    this.applyQuality(quality);
    this.resize();
  }

  private createSky(): Mesh {
    const mat = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        horizon: { value: SKY.horizon },
        zenith: { value: SKY.zenith },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 horizon;
        uniform vec3 zenith;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(horizon, zenith, pow(h, 0.55));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const m = new Mesh(new SphereGeometry(2000, 32, 16), mat);
    m.renderOrder = -10;
    m.frustumCulled = false;
    return m;
  }

  private createClouds(): void {
    const rnd = mulberry32(77);
    const textures = [cloudTexture(1), cloudTexture(2), cloudTexture(3)];
    for (let i = 0; i < 26; i++) {
      const mat = new SpriteMaterial({ map: textures[i % 3], fog: false, depthWrite: false, transparent: true, opacity: 0.9 });
      const s = new Sprite(mat);
      const a = rnd() * Math.PI * 2;
      const d = 900 + rnd() * 600;
      s.position.set(Math.cos(a) * d, 180 + rnd() * 260, Math.sin(a) * d);
      const sc = 260 + rnd() * 260;
      s.scale.set(sc, sc * 0.45, 1);
      s.renderOrder = -9;
      this.clouds.push(s);
      this.scene.add(s);
    }
  }

  applyQuality(q: 0 | 1 | 2): void {
    this.quality = q;
    const Q = QUALITY[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pixelRatio));
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== Q.shadowMap) {
      sh.mapSize.set(Q.shadowMap, Q.shadowMap);
      sh.map?.dispose();
      sh.map = null as never;
    }
    const cam = sh.camera;
    cam.left = -Q.shadowRange;
    cam.right = Q.shadowRange;
    cam.top = Q.shadowRange;
    cam.bottom = -Q.shadowRange;
    cam.near = 10;
    cam.far = 400;
    cam.updateProjectionMatrix();
  }

  get qualityLevel(): number {
    return this.quality;
  }

  /** Keeps the shadow frustum centred on the focus (player car), snapped to texels. */
  followShadows(focus: Vector3): void {
    const Q = QUALITY[this.quality];
    const texel = (Q.shadowRange * 2) / Q.shadowMap;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + this.sunOffset.x, focus.y + this.sunOffset.y, fz + this.sunOffset.z);
    this.sun.target.updateMatrixWorld();
    // Sky dome follows the camera so it never clips.
    this.sky.position.copy(this.camera.position);
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render(scene: Scene = this.scene, camera: PerspectiveCamera = this.camera): void {
    this.renderer.render(scene, camera);
  }

  add(o: Object3D): void {
    this.scene.add(o);
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
