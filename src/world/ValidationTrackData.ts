import { Surface } from '../physics/Surfaces';
import type { TrackDef } from './TrackTypes';

/**
 * Repeatable physics validation scene. Used by `npm run validate` (headless) and by the
 * in-browser test scene (`?scene=test`). Distances along each path are in metres.
 *
 *  strip    (x=0)    : flat dirt, 940 m: acceleration, top speed, braking.
 *  features (x=120)  : slope up/down, single bump, moguls, kicker ramp, rough landing
 *                      zone, side slope.
 *  lowgrip  (x=300)  : ice section (100–400 m) and mud section (450–550 m).
 *  circle   (−220,0) : flat dirt pad, radius 100 m, constant-radius turns.
 */
export const FEATURES_LAYOUT = {
  slopeStart: 80,
  slopeTop: 160,
  slopeHeight: 12,
  plateauEnd: 200,
  slopeBottom: 260,
  bumpAt: 300,
  mogulsFrom: 340,
  mogulsTo: 430,
  rampAt: 490,
  rampLength: 10,
  rampHeight: 1.6,
  roughFrom: 500,
  roughTo: 570,
  sideSlopeFrom: 620,
  sideSlopeTo: 700,
};

const L = FEATURES_LAYOUT;

export const VALIDATION_TRACK: TrackDef = {
  id: 'validation',
  name: 'Fizik Test Alanı',
  worldSize: 1000,
  segments: 500,
  natural: {
    baseHeight: 0,
    hillAmplitude: 0,
    hillScale: 100,
    detailAmplitude: 0,
    mountainStart: 1e6,
    mountainHeight: 0,
    seed: 1,
    sandThreshold: 1,
    flat: true,
  },
  paths: [
    {
      id: 'strip',
      route: 'start',
      points: [
        { x: 0, z: 470, y: 0 },
        { x: 0, z: 0, y: 0 },
        { x: 0, z: -470, y: 0 },
      ],
      width: 20,
      shoulder: 6,
      surface: Surface.Dirt,
    },
    {
      id: 'features',
      route: 'start',
      // Path starts at z=400 heading −Z; s ≈ 400 − z.
      points: [
        { x: 120, z: 400, y: 0 },
        { x: 120, z: 400 - L.slopeStart, y: 0 },
        { x: 120, z: 400 - (L.slopeStart + L.slopeTop) / 2, y: L.slopeHeight / 2 },
        { x: 120, z: 400 - L.slopeTop, y: L.slopeHeight },
        { x: 120, z: 400 - L.plateauEnd, y: L.slopeHeight },
        { x: 120, z: 400 - (L.plateauEnd + L.slopeBottom) / 2, y: L.slopeHeight / 2 },
        { x: 120, z: 400 - L.slopeBottom, y: 0 },
        { x: 120, z: 400 - 280, y: 0 },
        { x: 120, z: -380, y: 0 },
      ],
      width: 14,
      shoulder: 8,
      surface: Surface.Dirt,
      features: [
        { type: 'bump', at: L.bumpAt, length: 6, height: 0.45 },
        { type: 'moguls', from: L.mogulsFrom, to: L.mogulsTo, amplitude: 0.4, wavelength: 9 },
        { type: 'rough', from: L.roughFrom, to: L.roughTo, amplitude: 0.45, scale: 0.18 },
        { type: 'sideSlope', from: L.sideSlopeFrom, to: L.sideSlopeTo, angleDeg: 12 },
      ],
    },
    {
      id: 'lowgrip',
      route: 'start',
      points: [
        { x: 300, z: 300, y: 0 },
        { x: 300, z: -300, y: 0 },
      ],
      width: 20,
      shoulder: 6,
      surface: Surface.Dirt,
      features: [
        { type: 'surface', from: 100, to: 400, surface: Surface.Ice },
        { type: 'surface', from: 450, to: 550, surface: Surface.Mud },
      ],
    },
  ],
  plazas: [{ id: 'circle', x: -220, z: 0, y: 0, radius: 100, shoulder: 8, surface: Surface.Dirt }],
  ramps: [{ path: 'features', at: L.rampAt, length: L.rampLength, width: 8, height: L.rampHeight }],
  grid: [{ x: 0, z: 450, yaw: 0 }],
  startLine: { path: 'strip', at: 30 },
  legs: [],
  connectors: ['strip'],
  finishLine: { path: 'strip', at: 900 },
  collectibles: [],
  banners: [
    { path: 'strip', at: 30, text: 'İVMELENME' },
    { path: 'features', at: L.slopeStart, text: 'YOKUŞ' },
    { path: 'features', at: L.mogulsFrom, text: 'TÜMSEKLER' },
    { path: 'features', at: L.rampAt - 30, text: 'RAMPA' },
    { path: 'lowgrip', at: 90, text: 'BUZ' },
  ],
  signposts: [],
  scenery: { seed: 3, pineCount: 0, leafyCount: 0, rockCount: 0, grassCount: 0, colliderRange: 0 },
};
