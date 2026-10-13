import { CanvasTexture, ClampToEdgeWrapping, DataTexture, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace } from 'three';
import type { Texture } from 'three';
import { mulberry32 } from '../physics/math';
import { noise2 } from '../world/noise';

/** All textures are generated procedurally on canvases (no third-party image assets). */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, repeat = true, srgb = true): CanvasTexture {
  const t = new CanvasTexture(c);
  if (repeat) {
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
  } else {
    t.wrapS = ClampToEdgeWrapping;
    t.wrapT = ClampToEdgeWrapping;
  }
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

/** Grey-ish tiling detail noise multiplied over the terrain (centred on 0.5). */
export function detailNoiseTexture(size = 256): Texture {
  const [c, ctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const rnd = mulberry32(5);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Tileable by sampling noise on a torus-like wrap (periodic lattice of `size/16`).
      const p = 16;
      const n = 0.55 * noise2((x / size) * p, (y / size) * p, 3) + 0.3 * noise2((x / size) * p * 3, (y / size) * p * 3, 4);
      const g = rnd() * 0.18;
      const v = Math.max(0, Math.min(255, 128 + n * 46 + (g - 0.09) * 120));
      const i = (y * size + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Blend edges to hide the seam of the non-periodic noise.
  ctx.globalAlpha = 0.5;
  ctx.drawImage(c, size / 2, size / 2);
  ctx.drawImage(c, -size / 2, -size / 2);
  ctx.globalAlpha = 1;
  return toTexture(c, true, false);
}

/**
 * Grass tuft (alpha-tested crossed quads). Built as a DataTexture so fully transparent
 * texels keep a grass colour: canvas textures lose RGB under alpha 0, which makes the
 * mipmapped edges turn black.
 */
export function grassTuftTexture(): Texture {
  const [, ctx] = canvas(128, 128);
  const rnd = mulberry32(9);
  for (let i = 0; i < 26; i++) {
    const x = 20 + rnd() * 88;
    const h = 60 + rnd() * 60;
    const lean = (rnd() - 0.5) * 40;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3 + rnd() * 3;
    ctx.beginPath();
    ctx.moveTo(x, 128);
    ctx.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h);
    ctx.stroke();
  }
  const mask = ctx.getImageData(0, 0, 128, 128).data;
  const data = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const src = ((127 - y) * 128 + x) * 4;
      const dst = (y * 128 + x) * 4;
      const t = y / 127; // darker at the root, lighter at the tips
      data[dst] = 70 + t * 60;
      data[dst + 1] = 120 + t * 70;
      data[dst + 2] = 40 + t * 20;
      data[dst + 3] = mask[src + 3];
    }
  }
  const tex = new DataTexture(data, 128, 128, RGBAFormat);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Chain-link fence (diamond mesh) with alpha. */
export function chainLinkTexture(): Texture {
  const [c, ctx] = canvas(64, 64);
  ctx.strokeStyle = 'rgba(200,205,210,1)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(64, 64);
  ctx.moveTo(64, 0);
  ctx.lineTo(0, 64);
  ctx.moveTo(32, -32);
  ctx.lineTo(96, 32);
  ctx.moveTo(-32, 32);
  ctx.lineTo(32, 96);
  ctx.moveTo(32, 96);
  ctx.lineTo(96, 32);
  ctx.moveTo(-32, 32);
  ctx.lineTo(32, -32);
  ctx.stroke();
  return toTexture(c, true);
}

export function woodPlankTexture(): Texture {
  const [c, ctx] = canvas(256, 256);
  const rnd = mulberry32(21);
  const planks = 8;
  for (let i = 0; i < planks; i++) {
    const y = (i * 256) / planks;
    const base = 120 + Math.floor(rnd() * 40);
    ctx.fillStyle = `rgb(${base + 30},${base - 10},${base - 60})`;
    ctx.fillRect(0, y, 256, 256 / planks);
    for (let k = 0; k < 40; k++) {
      ctx.strokeStyle = `rgba(80,50,25,${0.1 + rnd() * 0.2})`;
      ctx.beginPath();
      const yy = y + rnd() * (256 / planks);
      ctx.moveTo(0, yy);
      ctx.bezierCurveTo(80, yy + rnd() * 4 - 2, 170, yy + rnd() * 4 - 2, 256, yy);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40,25,10,0.8)';
    ctx.fillRect(0, y, 256, 2);
  }
  return toTexture(c, true);
}

export function tireTreadTexture(): Texture {
  const [c, ctx] = canvas(64, 256);
  ctx.fillStyle = '#1c1c1c';
  ctx.fillRect(0, 0, 64, 256);
  ctx.fillStyle = '#0c0c0c';
  for (let y = 0; y < 256; y += 16) {
    ctx.fillRect(4, y, 24, 8);
    ctx.fillRect(36, y + 8, 24, 8);
  }
  return toTexture(c, true);
}

/** White hanging banner with bold dark lettering (start/route/finish banners). */
export function bannerTexture(text: string, accent = '#ffffff'): Texture {
  const [c, ctx] = canvas(1024, 192);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 1024, 192);
  if (text === 'BİTİŞ') {
    // Checkered edges for the finish.
    for (let x = 0; x < 1024; x += 32) {
      for (let y = 0; y < 192; y += 32) {
        if ((x / 32 + y / 32) % 2 === 0 && (x < 160 || x > 1024 - 160)) {
          ctx.fillStyle = '#111';
          ctx.fillRect(x, y, 32, 32);
        }
      }
    }
  }
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 1014, 182);
  ctx.fillStyle = '#2a2a2a';
  ctx.font = '900 120px "Lilita One", "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 512, 102);
  const t = toTexture(c, false);
  return t;
}

/** Wooden arrow board text. */
export function signBoardTexture(text: string): Texture {
  const [c, ctx] = canvas(512, 128);
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#a8743f');
  g.addColorStop(1, '#7a4f27');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#fff6e0';
  ctx.font = '900 76px "Lilita One", "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 68);
  return toTexture(c, false);
}

export function cloudTexture(seed: number): Texture {
  const [c, ctx] = canvas(256, 128);
  const rnd = mulberry32(seed);
  for (let i = 0; i < 14; i++) {
    const x = 50 + rnd() * 156;
    const y = 60 + rnd() * 30;
    const r = 22 + rnd() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.6, 'rgba(250,252,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c, false);
}

/** Soft round particle (dust, sparkles). */
export function softDotTexture(): Texture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c, false);
}

/** Canvas-to-texture helper for drawn content (traffic signs etc.). */
export function textureFromCanvas(c: HTMLCanvasElement): Texture {
  return toTexture(c, false);
}
