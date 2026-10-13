import type { SignId } from '../data/questions';

/**
 * Procedurally drawn Turkish-style traffic signs (Canvas 2D). Used both for the question
 * panel (as an <img>) and as textures on the 3D sign collectibles.
 */

type Ctx = CanvasRenderingContext2D;
const RED = '#d0191f';
const BLUE = '#1d5fb8';
const S = 256;
const CX = S / 2;
const CY = S / 2;

function prohibition(ctx: Ctx, fill = '#ffffff'): void {
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.arc(CX, CY, 120, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(CX, CY, 94, 0, Math.PI * 2);
  ctx.fill();
}

function warning(ctx: Ctx): void {
  const tri = (r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(CX, CY - r);
    ctx.lineTo(CX + r * 0.94, CY + r * 0.64);
    ctx.lineTo(CX - r * 0.94, CY + r * 0.64);
    ctx.closePath();
    ctx.fill();
  };
  ctx.lineJoin = 'round';
  tri(124, RED);
  tri(92, '#ffffff');
}

function mandatory(ctx: Ctx): void {
  ctx.fillStyle = BLUE;
  ctx.beginPath();
  ctx.arc(CX, CY, 120, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(CX, CY, 112, 0, Math.PI * 2);
  ctx.stroke();
}

function infoSquare(ctx: Ctx): void {
  ctx.fillStyle = BLUE;
  ctx.fillRect(16, 16, S - 32, S - 32);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 6;
  ctx.strokeRect(24, 24, S - 48, S - 48);
}

function slash(ctx: Ctx): void {
  ctx.strokeStyle = RED;
  ctx.lineWidth = 20;
  ctx.beginPath();
  ctx.moveTo(CX - 66, CY - 66);
  ctx.lineTo(CX + 66, CY + 66);
  ctx.stroke();
}

function person(ctx: Ctx, x: number, y: number, s: number, color = '#111'): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = 9 * s;
  ctx.beginPath();
  ctx.arc(x, y - 44 * s, 11 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y - 30 * s);
  ctx.lineTo(x - 2 * s, y + 4 * s);
  ctx.moveTo(x - 2 * s, y + 4 * s);
  ctx.lineTo(x - 18 * s, y + 38 * s);
  ctx.moveTo(x - 2 * s, y + 4 * s);
  ctx.lineTo(x + 16 * s, y + 38 * s);
  ctx.moveTo(x, y - 22 * s);
  ctx.lineTo(x - 20 * s, y - 2 * s);
  ctx.moveTo(x, y - 22 * s);
  ctx.lineTo(x + 20 * s, y - 8 * s);
  ctx.stroke();
}

function arrow(ctx: Ctx, angle: number, color: string, len = 70, width = 18): void {
  ctx.save();
  ctx.translate(CX, CY);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.fillRect(-width / 2, -len / 2 + 22, width, len - 10);
  ctx.beginPath();
  ctx.moveTo(0, -len / 2 - 14);
  ctx.lineTo(32, -len / 2 + 26);
  ctx.lineTo(-32, -len / 2 + 26);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function turnArrow(ctx: Ctx, right: boolean): void {
  const d = right ? 1 : -1;
  ctx.strokeStyle = '#111';
  ctx.fillStyle = '#111';
  ctx.lineWidth = 18;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(CX - 20 * d, CY + 70);
  ctx.lineTo(CX - 20 * d, CY - 10);
  ctx.quadraticCurveTo(CX - 20 * d, CY - 30, CX + 4 * d, CY - 30);
  ctx.lineTo(CX + 18 * d, CY - 30);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(CX + 50 * d, CY - 30);
  ctx.lineTo(CX + 14 * d, CY - 60);
  ctx.lineTo(CX + 14 * d, CY);
  ctx.closePath();
  ctx.fill();
}

function truck(ctx: Ctx): void {
  ctx.fillStyle = '#111';
  ctx.fillRect(CX - 70, CY - 32, 86, 52);
  ctx.fillRect(CX + 20, CY - 14, 42, 34);
  ctx.fillStyle = '#fff';
  ctx.fillRect(CX + 30, CY - 8, 18, 12);
  ctx.fillStyle = '#111';
  for (const x of [CX - 48, CX - 18, CX + 44]) {
    ctx.beginPath();
    ctx.arc(x, CY + 26, 12, 0, Math.PI * 2);
    ctx.fill();
  }
}

function car(ctx: Ctx, x: number, y: number, s: number): void {
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.moveTo(x - 40 * s, y + 10 * s);
  ctx.lineTo(x - 36 * s, y - 8 * s);
  ctx.lineTo(x - 18 * s, y - 24 * s);
  ctx.lineTo(x + 18 * s, y - 24 * s);
  ctx.lineTo(x + 34 * s, y - 8 * s);
  ctx.lineTo(x + 40 * s, y + 10 * s);
  ctx.closePath();
  ctx.fill();
  for (const dx of [-24, 24]) {
    ctx.beginPath();
    ctx.arc(x + dx * s, y + 12 * s, 9 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function text(ctx: Ctx, t: string, size: number, color: string, y = CY + 4): void {
  ctx.fillStyle = color;
  ctx.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(t, CX, y);
}

const DRAW: Record<SignId, (ctx: Ctx) => void> = {
  girilmez: (ctx) => {
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.arc(CX, CY, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(CX - 82, CY - 20, 164, 40);
  },
  dur: (ctx) => {
    ctx.fillStyle = RED;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      ctx.lineTo(CX + Math.cos(a) * 122, CY + Math.sin(a) * 122);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 6;
    ctx.stroke();
    text(ctx, 'DUR', 74, '#fff');
  },
  yolVer: (ctx) => {
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.moveTo(CX - 120, CY - 80);
    ctx.lineTo(CX + 120, CY - 80);
    ctx.lineTo(CX, CY + 120);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(CX - 84, CY - 60);
    ctx.lineTo(CX + 84, CY - 60);
    ctx.lineTo(CX, CY + 82);
    ctx.closePath();
    ctx.fill();
  },
  yayaGecidi: (ctx) => {
    warning(ctx);
    person(ctx, CX, CY + 12, 0.95);
    ctx.fillStyle = '#111';
    for (let i = 0; i < 4; i++) ctx.fillRect(CX - 56 + i * 30, CY + 58, 18, 8);
  },
  okulGecidi: (ctx) => {
    warning(ctx);
    person(ctx, CX - 22, CY + 18, 0.85);
    person(ctx, CX + 24, CY + 26, 0.7);
  },
  kamyonGiremez: (ctx) => {
    prohibition(ctx);
    truck(ctx);
  },
  hizSiniri50: (ctx) => {
    prohibition(ctx);
    text(ctx, '50', 96, '#111', CY + 6);
  },
  solaDonulmez: (ctx) => {
    prohibition(ctx);
    turnArrow(ctx, false);
    slash(ctx);
  },
  sagaDonulmez: (ctx) => {
    prohibition(ctx);
    turnArrow(ctx, true);
    slash(ctx);
  },
  parkYasak: (ctx) => {
    prohibition(ctx, BLUE);
    ctx.strokeStyle = RED;
    ctx.lineWidth = 20;
    ctx.beginPath();
    ctx.moveTo(CX - 66, CY - 66);
    ctx.lineTo(CX + 66, CY + 66);
    ctx.stroke();
  },
  kayganYol: (ctx) => {
    warning(ctx);
    car(ctx, CX, CY + 4, 0.8);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 6;
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(CX + d * 14, CY + 30);
      ctx.bezierCurveTo(CX + d * 30, CY + 44, CX + d * 0, CY + 54, CX + d * 22, CY + 70);
      ctx.stroke();
    }
  },
  trafikIsigi: (ctx) => {
    warning(ctx);
    ctx.fillStyle = '#111';
    ctx.fillRect(CX - 22, CY - 40, 44, 104);
    for (const [y, c] of [[CY - 22, '#e02020'], [CY + 12, '#f0c020'], [CY + 46, '#20b040']] as const) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(CX, y, 13, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  bisikletYolu: (ctx) => {
    mandatory(ctx);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 9;
    for (const x of [CX - 42, CX + 42]) {
      ctx.beginPath();
      ctx.arc(x, CY + 26, 30, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(CX - 42, CY + 26);
    ctx.lineTo(CX - 8, CY - 18);
    ctx.lineTo(CX + 30, CY - 18);
    ctx.lineTo(CX + 42, CY + 26);
    ctx.moveTo(CX - 8, CY - 18);
    ctx.lineTo(CX + 4, CY + 26);
    ctx.lineTo(CX + 30, CY - 18);
    ctx.moveTo(CX - 14, CY - 30);
    ctx.lineTo(CX + 4, CY - 30);
    ctx.stroke();
  },
  tasitTrafiginKapali: (ctx) => {
    prohibition(ctx);
  },
  ileriMecburi: (ctx) => {
    mandatory(ctx);
    arrow(ctx, 0, '#fff', 120, 24);
  },
  vahsiHayvan: (ctx) => {
    warning(ctx);
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.ellipse(CX, CY + 20, 46, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(CX - 38, CY + 26, 9, 40);
    ctx.fillRect(CX + 28, CY + 26, 9, 40);
    ctx.beginPath();
    ctx.moveTo(CX + 36, CY + 10);
    ctx.lineTo(CX + 58, CY - 30);
    ctx.lineTo(CX + 70, CY - 24);
    ctx.lineTo(CX + 50, CY + 14);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#111';
    ctx.beginPath();
    ctx.moveTo(CX + 60, CY - 30);
    ctx.lineTo(CX + 52, CY - 54);
    ctx.moveTo(CX + 62, CY - 32);
    ctx.lineTo(CX + 78, CY - 52);
    ctx.stroke();
  },
  sagaTehlikeliViraj: (ctx) => {
    warning(ctx);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(CX - 18, CY + 66);
    ctx.lineTo(CX - 18, CY - 4);
    ctx.quadraticCurveTo(CX - 18, CY - 28, CX + 14, CY - 28);
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.moveTo(CX + 44, CY - 28);
    ctx.lineTo(CX + 10, CY - 52);
    ctx.lineTo(CX + 10, CY - 4);
    ctx.closePath();
    ctx.fill();
  },
  kavsak: (ctx) => {
    warning(ctx);
    ctx.fillStyle = '#111';
    ctx.fillRect(CX - 10, CY - 46, 20, 116);
    ctx.fillRect(CX - 52, CY + 6, 104, 20);
  },
  yolCalismasi: (ctx) => {
    warning(ctx);
    person(ctx, CX - 6, CY + 18, 0.85);
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.moveTo(CX + 20, CY + 60);
    ctx.lineTo(CX + 60, CY + 60);
    ctx.lineTo(CX + 48, CY + 40);
    ctx.closePath();
    ctx.fill();
  },
  otobusDuragi: (ctx) => {
    infoSquare(ctx);
    ctx.fillStyle = '#fff';
    ctx.fillRect(CX - 62, CY - 52, 124, 84);
    ctx.fillStyle = BLUE;
    for (let i = 0; i < 3; i++) ctx.fillRect(CX - 52 + i * 36, CY - 42, 28, 26);
    ctx.fillStyle = '#fff';
    for (const x of [CX - 36, CX + 36]) {
      ctx.beginPath();
      ctx.arc(x, CY + 40, 13, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

const cache = new Map<SignId, HTMLCanvasElement>();

/** Returns a 256×256 canvas with the sign drawn on a transparent background. */
export function drawSign(id: SignId): HTMLCanvasElement {
  const hit = cache.get(id);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  DRAW[id](ctx);
  cache.set(id, c);
  return c;
}

export function signDataUrl(id: SignId): string {
  return drawSign(id).toDataURL('image/png');
}

export const ALL_SIGNS = Object.keys(DRAW) as SignId[];
