import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  MeshLambertMaterial,
  SRGBColorSpace,
} from 'three';
import type { Texture } from 'three';
import { Surface } from '../physics/Surfaces';
import { smoothstep } from '../physics/math';
import { detailNoiseTexture } from '../render/Textures';
import { noise2 } from './noise';
import type { TerrainData } from './TerrainData';

type RGB = [number, number, number];
const C: Record<string, RGB> = {
  dirtA: [196, 104, 54],
  dirtB: [168, 84, 44],
  grassA: [92, 150, 52],
  grassB: [134, 168, 62],
  grassC: [70, 122, 46],
  sandA: [226, 192, 124],
  sandB: [204, 166, 102],
  rockA: [140, 126, 112],
  rockB: [108, 96, 86],
  mud: [96, 64, 40],
};

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function groundColor(surf: Surface, n1: number, n2: number): RGB {
  switch (surf) {
    case Surface.Sand:
      return mix(C.sandA, C.sandB, 0.5 + 0.5 * n1);
    case Surface.Rock:
      return mix(C.rockA, C.rockB, 0.5 + 0.5 * n2);
    case Surface.Mud:
      return mix(C.mud, C.dirtB, 0.3 + 0.2 * n1);
    case Surface.Dirt:
      return mix(C.dirtA, C.dirtB, 0.5 + 0.5 * n1);
    default: {
      const g = mix(C.grassA, C.grassB, 0.5 + 0.5 * n1);
      return mix(g, C.grassC, Math.max(0, n2) * 0.6);
    }
  }
}

/**
 * Builds the colour (splat) texture for the whole terrain from the per-vertex surface types
 * and the bilinear road-edge distance field, with noisy, soft road edges.
 */
export function buildSplatTexture(t: TerrainData, size: number): Texture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const scale = t.size / size;
  for (let py = 0; py < size; py++) {
    const z = -t.half + (py + 0.5) * scale;
    for (let px = 0; px < size; px++) {
      const x = -t.half + (px + 0.5) * scale;
      const n1 = noise2(x * 0.045, z * 0.045, 11);
      const n2 = noise2(x * 0.35, z * 0.35, 12);
      const e = t.roadEdgeAt(x, z);
      const jx = x + n2 * 1.6;
      const jz = z + n1 * 1.6;
      const surf = t.surfaceAt(jx, jz);
      let col: RGB;
      if (e < 3.5) {
        // On or near a road: the road surface type (dirt/sand/mud) blended into the verge.
        const roadSurf = surf === Surface.Grass || surf === Surface.Rock ? Surface.Dirt : surf;
        const road = groundColor(roadSurf, n1, n2);
        // Gravel speckle and darker worn patches make the dirt look rugged.
        const n3 = noise2(x * 1.7, z * 1.7, 13);
        const g = n3 > 0.45 ? 0.72 : n3 < -0.5 ? 1.12 : 0.94 + 0.08 * n3;
        road[0] *= g;
        road[1] *= g;
        road[2] *= g;
        // Darker wheel ruts in the middle of dirt roads.
        const verge = groundColor(surf === Surface.Rock ? Surface.Rock : Surface.Grass, n1, n2);
        const mask = 1 - smoothstep(-0.8, 1.8, e + n2 * 1.1 + n1 * 0.6);
        col = mix(verge, road, mask);
      } else {
        col = groundColor(surf, n1, n2);
        // Occasional bare patches in grass.
        if (surf === Surface.Grass && n1 > 0.55) col = mix(col, C.dirtB, (n1 - 0.55) * 1.2);
      }
      const shade = 0.93 + 0.07 * n2;
      const i = (py * size + px) * 4;
      d[i] = col[0] * shade;
      d[i + 1] = col[1] * shade;
      d[i + 2] = col[2] * shade;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.flipY = false;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Terrain render mesh, split into chunks for frustum culling. Vertices are exactly the
 * heightfield vertices and each cell is split along the same diagonal as Rapier's collider.
 */
export class TerrainMesh {
  readonly group = new Group();
  readonly material: MeshLambertMaterial;
  private readonly splat: Texture;
  private readonly detail: Texture;

  constructor(private readonly terrain: TerrainData, splatSize: number, chunkCells = 50) {
    this.splat = buildSplatTexture(terrain, splatSize);
    this.detail = detailNoiseTexture();
    this.material = new MeshLambertMaterial({ map: this.splat });
    const detail = this.detail;
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.detailMap = { value: detail };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vDetailUv;\nvarying vec2 vDetailUv2;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvec4 dWorld = modelMatrix * vec4(transformed, 1.0);\nvDetailUv = dWorld.xz * 0.22;\nvDetailUv2 = dWorld.xz * 0.031;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nvarying vec2 vDetailUv;\nvarying vec2 vDetailUv2;')
        .replace(
          '#include <map_fragment>',
          '#include <map_fragment>\nfloat dA = texture2D(detailMap, vDetailUv).r;\nfloat dB = texture2D(detailMap, vDetailUv2).r;\ndiffuseColor.rgb *= (0.55 + dA * 0.9) * (0.75 + dB * 0.5);',
        );
    };
    this.build(chunkCells);
  }

  private build(chunkCells: number): void {
    const t = this.terrain;
    const n = t.segments;
    const nrm = { x: 0, y: 1, z: 0 };
    for (let cz = 0; cz < n; cz += chunkCells) {
      for (let cx = 0; cx < n; cx += chunkCells) {
        const w = Math.min(chunkCells, n - cx);
        const h = Math.min(chunkCells, n - cz);
        const vw = w + 1;
        const vh = h + 1;
        const pos = new Float32Array(vw * vh * 3);
        const nor = new Float32Array(vw * vh * 3);
        const uv = new Float32Array(vw * vh * 2);
        for (let j = 0; j < vh; j++) {
          for (let i = 0; i < vw; i++) {
            const ix = cx + i;
            const iz = cz + j;
            const x = t.vertexX(ix);
            const z = t.vertexZ(iz);
            const k = j * vw + i;
            pos[k * 3] = x;
            pos[k * 3 + 1] = t.heights[t.index(ix, iz)];
            pos[k * 3 + 2] = z;
            t.normalAt(x, z, nrm);
            nor[k * 3] = nrm.x;
            nor[k * 3 + 1] = nrm.y;
            nor[k * 3 + 2] = nrm.z;
            uv[k * 2] = ix / n;
            uv[k * 2 + 1] = iz / n;
          }
        }
        const idx = new Uint32Array(w * h * 6);
        let p = 0;
        for (let j = 0; j < h; j++) {
          for (let i = 0; i < w; i++) {
            const v00 = j * vw + i;
            const v10 = v00 + 1;
            const v01 = v00 + vw;
            const v11 = v01 + 1;
            // Same split as Rapier: diagonal (x+,z−)–(x−,z+), counter-clockwise from above.
            idx[p++] = v00;
            idx[p++] = v01;
            idx[p++] = v10;
            idx[p++] = v10;
            idx[p++] = v01;
            idx[p++] = v11;
          }
        }
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(pos, 3));
        geo.setAttribute('normal', new BufferAttribute(nor, 3));
        geo.setAttribute('uv', new BufferAttribute(uv, 2));
        geo.setIndex(new BufferAttribute(idx, 1));
        geo.computeBoundingSphere();
        geo.computeBoundingBox();
        const mesh = new Mesh(geo, this.material);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
      }
    }
  }

  /** Hides chunks farther than `range` from the camera (fully inside the fog). */
  cull(camX: number, camZ: number, range: number): void {
    for (const c of this.group.children) {
      const s = (c as Mesh).geometry.boundingSphere;
      if (!s) continue;
      c.visible = Math.hypot(s.center.x - camX, s.center.z - camZ) - s.radius < range;
    }
  }

  dispose(): void {
    for (const c of this.group.children) (c as Mesh).geometry.dispose();
    this.material.dispose();
    this.splat.dispose();
    this.detail.dispose();
  }
}
