import { Surface } from '../physics/Surfaces';
import type { CheckpointPlacement, CollectibleDef, PathDef, TrackDef } from './TrackTypes';

/**
 * The race course: start → fork 1 (HIZ left, BİLGİ centre, CESARET right) → merge →
 * connecting road → fork 2 (CESARET left, BİLGİ centre, HIZ right) → merge → finish.
 * A river crosses the first fork and a creek the second; every road that crosses water
 * gets a bridge. Cesaret is the hardest road but the best time (most direct, most
 * hourglasses); Hız is the easiest but longest; Bilgi sits between, with "?" signs that
 * feed the end-of-race quiz.
 *
 * World: 1600 × 1600 m, 2.5 m heightfield cells, driving direction is roughly −Z.
 */

const dirt = Surface.Dirt;
const smooth = (to: number) => ({ type: 'rough' as const, from: 0, to, amplitude: 0.03, scale: 0.1 });
const light = (to: number) => ({ type: 'rough' as const, from: 0, to, amplitude: 0.06, scale: 0.12 });

const START: PathDef = {
  id: 'start',
  route: 'start',
  points: [
    { x: 0, z: 705, y: 6 },
    { x: 0, z: 620, y: 6 },
    { x: 0, z: 560, y: 6 },
    { x: 0, z: 505, y: 6 },
  ],
  width: 24,
  shoulder: 12,
  surface: dirt,
  fenceOffset: 7,
  fenceRanges: [[0, 120]],
  features: [smooth(220)],
};

// ---------------------------------------------------------------- fork 1 (H · B · C)

/** HIZ 1: the easy road. Wide sweeping detour to the west, fenced. */
const HIZ1: PathDef = {
  id: 'hiz1',
  route: 'hiz',
  points: [
    { x: -25, z: 450, y: 6 },
    { x: -110, z: 425, y: 7 },
    { x: -225, z: 375, y: 9 },
    { x: -305, z: 295, y: 11 },
    { x: -330, z: 200, y: 11 },
    { x: -285, z: 115, y: 10 },
    { x: -185, z: 60, y: 8 },
    { x: -60, z: 40, y: 6 },
  ],
  width: 28,
  shoulder: 16,
  surface: dirt,
  fenceOffset: 6,
  fenceRanges: [[40, 700]],
  features: [smooth(760)],
};

/** BİLGİ 1: winding centre road. */
const BILGI1: PathDef = {
  id: 'bilgi1',
  route: 'bilgi',
  points: [
    { x: 0, z: 418, y: 6 },
    { x: 45, z: 368, y: 9 },
    { x: -20, z: 330, y: 13 },
    { x: -95, z: 290, y: 15 },
    { x: -70, z: 220, y: 14 },
    { x: 10, z: 185, y: 15 },
    { x: 70, z: 140, y: 13 },
    { x: 35, z: 92, y: 9 },
    { x: 0, z: 70, y: 6 },
  ],
  width: 20,
  shoulder: 13,
  surface: dirt,
  pebbles: 12,
  features: [light(620)],
};

/** CESARET 1: narrow, twisty, direct; crest, ramp and boulders. */
const CESARET1: PathDef = {
  id: 'cesaret1',
  route: 'cesaret',
  points: [
    { x: 25, z: 450, y: 6 },
    { x: 85, z: 422, y: 8 },
    { x: 118, z: 372, y: 11 },
    { x: 85, z: 328, y: 15 },
    { x: 105, z: 280, y: 19 },
    { x: 150, z: 245, y: 22 },
    { x: 140, z: 190, y: 17 },
    { x: 92, z: 155, y: 14 },
    { x: 100, z: 108, y: 10 },
    { x: 50, z: 62, y: 6 },
  ],
  width: 14,
  shoulder: 9,
  surface: dirt,
  pebbles: 20,
  features: [light(560), { type: 'boulders', from: 110, to: 480, spacing: 20 }],
};

/** Between the forks: merge clearing 1 → fork clearing 2. */
const MID: PathDef = {
  id: 'mid',
  route: 'mid',
  points: [
    { x: 0, z: 10, y: 6 },
    { x: 0, z: -40, y: 6 },
    { x: 0, z: -85, y: 6 },
  ],
  width: 24,
  shoulder: 12,
  surface: dirt,
  fenceOffset: 7,
  fenceRanges: [[0, 90]],
  features: [smooth(100)],
};

// ---------------------------------------------------------------- fork 2 (C · B · H)

/** CESARET 2: now on the west side; sand canyon, mud, second ramp. */
const CESARET2: PathDef = {
  id: 'cesaret2',
  route: 'cesaret',
  points: [
    { x: -25, z: -140, y: 6 },
    { x: -85, z: -165, y: 8 },
    { x: -118, z: -215, y: 11 },
    { x: -82, z: -262, y: 13 },
    { x: -100, z: -312, y: 12 },
    { x: -150, z: -350, y: 12 },
    { x: -138, z: -405, y: 11 },
    { x: -90, z: -440, y: 9 },
    { x: -98, z: -488, y: 8 },
    { x: -50, z: -532, y: 6 },
  ],
  width: 14,
  shoulder: 9,
  surface: dirt,
  pebbles: 20,
  features: [
    light(560),
    { type: 'boulders', from: 40, to: 220, spacing: 20 },
    { type: 'surface', from: 320, to: 420, surface: Surface.Sand },
    { type: 'canyon', from: 320, to: 420, wallHeight: 7, wallWidth: 9 },
    { type: 'surface', from: 440, to: 460, surface: Surface.Mud },
  ],
};

/** BİLGİ 2: winding centre road. */
const BILGI2: PathDef = {
  id: 'bilgi2',
  route: 'bilgi',
  points: [
    { x: 0, z: -168, y: 6 },
    { x: -45, z: -218, y: 9 },
    { x: 20, z: -258, y: 12 },
    { x: 95, z: -298, y: 14 },
    { x: 72, z: -365, y: 13 },
    { x: -8, z: -400, y: 13 },
    { x: -70, z: -445, y: 11 },
    { x: -32, z: -495, y: 8 },
    { x: 0, z: -517, y: 6 },
  ],
  width: 20,
  shoulder: 13,
  surface: dirt,
  pebbles: 12,
  features: [light(620)],
};

/** HIZ 2: wide sweeping detour to the east, fenced. */
const HIZ2: PathDef = {
  id: 'hiz2',
  route: 'hiz',
  points: [
    { x: 25, z: -140, y: 6 },
    { x: 110, z: -165, y: 7 },
    { x: 225, z: -215, y: 9 },
    { x: 305, z: -295, y: 11 },
    { x: 330, z: -390, y: 11 },
    { x: 285, z: -475, y: 10 },
    { x: 185, z: -530, y: 8 },
    { x: 60, z: -552, y: 6 },
  ],
  width: 28,
  shoulder: 16,
  surface: dirt,
  fenceOffset: 6,
  fenceRanges: [[40, 700]],
  features: [smooth(760)],
};

const FINAL: PathDef = {
  id: 'final',
  route: 'final',
  points: [
    { x: 0, z: -585, y: 6 },
    { x: 0, z: -650, y: 6 },
    { x: 0, z: -735, y: 6 },
  ],
  width: 24,
  shoulder: 12,
  surface: dirt,
  fenceOffset: 7,
  fenceRanges: [[20, 150]],
  features: [smooth(160)],
};

const cp = (path: string, at: number, margin = 10): CheckpointPlacement => ({ path, at, margin });

const H = 'hourglass' as const;
const collectibles: CollectibleDef[] = [
  // Fork 1 ----------------------------------------------------------------------------
  { kind: 'turbo', path: 'hiz1', at: 150 },
  { kind: 'sign', path: 'hiz1', at: 450, offset: 5 },
  { kind: 'turbo', path: 'hiz1', at: 600 },
  { kind: 'question', path: 'bilgi1', at: 90 },
  { kind: 'question', path: 'bilgi1', at: 340 },
  { kind: 'question', path: 'bilgi1', at: 480, offset: 2 },
  { kind: 'sign', path: 'bilgi1', at: 520 },
  { kind: H, path: 'cesaret1', at: 74, height: 3 },
  { kind: H, path: 'cesaret1', at: 160, offset: 1.5 },
  { kind: H, path: 'cesaret1', at: 225 },
  { kind: H, path: 'cesaret1', at: 345 },
  { kind: H, path: 'cesaret1', at: 440 },
  { kind: 'sign', path: 'cesaret1', at: 500 },
  // Fork 2 ----------------------------------------------------------------------------
  { kind: H, path: 'cesaret2', at: 70 },
  { kind: H, path: 'cesaret2', at: 170, offset: -1.5 },
  { kind: H, path: 'cesaret2', at: 335 },
  { kind: H, path: 'cesaret2', at: 400 },
  { kind: H, path: 'cesaret2', at: 487, height: 3 },
  { kind: 'turbo', path: 'cesaret2', at: 520 },
  { kind: 'sign', path: 'bilgi2', at: 200 },
  { kind: 'question', path: 'bilgi2', at: 120 },
  { kind: 'question', path: 'bilgi2', at: 360, offset: -2 },
  { kind: 'turbo', path: 'hiz2', at: 150 },
  { kind: 'sign', path: 'hiz2', at: 300, offset: -5 },
  { kind: 'turbo', path: 'hiz2', at: 450 },
  { kind: H, path: 'hiz2', at: 600, offset: 6 },
  // Finish straight.
  { kind: 'sign', path: 'final', at: 40 },
];

export const RACE_TRACK: TrackDef = {
  id: 'arazi',
  name: 'Kaşif Parkuru',
  worldSize: 1600,
  segments: 640,
  natural: {
    baseHeight: 5,
    hillAmplitude: 9,
    hillScale: 200,
    detailAmplitude: 0.6,
    mountainStart: 740,
    mountainHeight: 55,
    seed: 7,
    sandThreshold: 0.38,
    rivers: [
      {
        // River across fork 1: every road bridges it.
        points: [
          { x: -820, z: 255 }, { x: -520, z: 228 }, { x: -260, z: 268 }, { x: 0, z: 240 },
          { x: 250, z: 262 }, { x: 520, z: 230 }, { x: 820, z: 252 },
        ],
        width: 28,
        bedHeight: 0.5,
        waterHeight: 2.2,
      },
      {
        // Creek across fork 2.
        points: [
          { x: -820, z: -322 }, { x: -520, z: -352 }, { x: -260, z: -312 }, { x: 0, z: -338 },
          { x: 250, z: -316 }, { x: 520, z: -346 }, { x: 820, z: -326 },
        ],
        width: 24,
        bedHeight: 1.5,
        waterHeight: 3,
      },
    ],
  },
  paths: [START, HIZ1, BILGI1, CESARET1, MID, CESARET2, BILGI2, HIZ2, FINAL],
  plazas: [
    { id: 'startArea', x: 0, z: 676, y: 6, radius: 32, shoulder: 14, surface: Surface.Dirt },
    { id: 'fork', x: 0, z: 472, y: 6, radius: 52, shoulder: 16, surface: Surface.Dirt },
    { id: 'merge1', x: 0, z: 40, y: 6, radius: 48, shoulder: 16, surface: Surface.Dirt },
    { id: 'fork2', x: 0, z: -115, y: 6, radius: 52, shoulder: 16, surface: Surface.Dirt },
    { id: 'merge2', x: 0, z: -560, y: 6, radius: 48, shoulder: 16, surface: Surface.Dirt },
  ],
  ramps: [
    { path: 'cesaret1', at: 60, length: 10, width: 10, height: 1.4, profile: 1 },
    { path: 'cesaret2', at: 470, length: 9, width: 10, height: 1.3, profile: 1 },
  ],
  grid: [
    { x: -5, z: 683, yaw: 0 },
    { x: 5, z: 683, yaw: 0 },
    { x: -5, z: 670, yaw: 0 },
    { x: 5, z: 670, yaw: 0 },
  ],
  startLine: { path: 'start', at: 50, margin: 6 },
  legs: [
    {
      paths: { hiz: 'hiz1', bilgi: 'bilgi1', cesaret: 'cesaret1' },
      checkpoints: {
        hiz: [cp('hiz1', 20), cp('hiz1', 250), cp('hiz1', 500), cp('hiz1', 740)],
        bilgi: [cp('bilgi1', 20), cp('bilgi1', 200), cp('bilgi1', 420), cp('bilgi1', 560)],
        cesaret: [cp('cesaret1', 20), cp('cesaret1', 200), cp('cesaret1', 380), cp('cesaret1', 515)],
      },
      merge: cp('mid', 8, 8),
    },
    {
      paths: { hiz: 'hiz2', bilgi: 'bilgi2', cesaret: 'cesaret2' },
      checkpoints: {
        cesaret: [cp('cesaret2', 20), cp('cesaret2', 200), cp('cesaret2', 380), cp('cesaret2', 520)],
        bilgi: [cp('bilgi2', 20), cp('bilgi2', 200), cp('bilgi2', 420), cp('bilgi2', 560)],
        hiz: [cp('hiz2', 20), cp('hiz2', 250), cp('hiz2', 520), cp('hiz2', 740)],
      },
      merge: cp('final', 8, 8),
    },
  ],
  connectors: ['start', 'mid', 'final'],
  finishLine: { path: 'final', at: 90, margin: 6 },
  collectibles,
  banners: [
    { path: 'start', at: 50, text: 'BAŞLANGIÇ' },
    { path: 'hiz1', at: 12, text: 'HIZ' },
    { path: 'bilgi1', at: 12, text: 'BİLGİ' },
    { path: 'cesaret1', at: 12, text: 'CESARET' },
    { path: 'cesaret2', at: 12, text: 'CESARET' },
    { path: 'bilgi2', at: 12, text: 'BİLGİ' },
    { path: 'hiz2', at: 12, text: 'HIZ' },
    { path: 'final', at: 90, text: 'BİTİŞ', color: '#f2c218' },
  ],
  signposts: [
    { x: -16, z: 512, yaw: 0, arrows: [{ text: 'Hız', dir: 'left' }, { text: 'Bilgi', dir: 'right' }] },
    { x: 16, z: 512, yaw: 0, arrows: [{ text: 'Cesaret', dir: 'right' }, { text: 'Bilgi', dir: 'left' }] },
    { x: -16, z: -78, yaw: 0, arrows: [{ text: 'Cesaret', dir: 'left' }, { text: 'Bilgi', dir: 'right' }] },
    { x: 16, z: -78, yaw: 0, arrows: [{ text: 'Hız', dir: 'right' }, { text: 'Bilgi', dir: 'left' }] },
  ],
  scenery: { seed: 11, pineCount: 2800, leafyCount: 1100, rockCount: 850, grassCount: 24000, colliderRange: 16 },
};

