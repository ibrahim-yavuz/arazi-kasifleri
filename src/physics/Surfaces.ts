/** Ground surface types. Numeric values are stored per terrain vertex in a Uint8Array. */
export enum Surface {
  Dirt = 0,
  Grass = 1,
  Sand = 2,
  Mud = 3,
  Rock = 4,
  Wood = 5,
  Ice = 6,
}

export interface SurfaceProps {
  name: string;
  /** Multiplier on tyre friction coefficient. */
  grip: number;
  /** Rolling resistance coefficient (fraction of normal load). */
  rollingResistance: number;
  /** Extra speed-proportional drag per wheel in contact (N per m/s per kN of load), e.g. deep sand. */
  sinkDrag: number;
  /** Whether wheels throw dust/particles on this surface. */
  dust: boolean;
}

/**
 * Surface table. Values are design approximations:
 * dirt is the reference surface; grass and sand are slower and less grippy; mud/ice are
 * the low-grip cases used in the validation scene.
 */
export const SURFACES: Record<Surface, SurfaceProps> = {
  [Surface.Dirt]: { name: 'Toprak', grip: 1.0, rollingResistance: 0.018, sinkDrag: 0, dust: true },
  [Surface.Grass]: { name: 'Çimen', grip: 0.82, rollingResistance: 0.035, sinkDrag: 4, dust: false },
  [Surface.Sand]: { name: 'Kum', grip: 0.7, rollingResistance: 0.06, sinkDrag: 10, dust: true },
  [Surface.Mud]: { name: 'Çamur', grip: 0.45, rollingResistance: 0.07, sinkDrag: 14, dust: false },
  [Surface.Rock]: { name: 'Kaya', grip: 0.95, rollingResistance: 0.015, sinkDrag: 0, dust: false },
  [Surface.Wood]: { name: 'Tahta', grip: 0.9, rollingResistance: 0.015, sinkDrag: 0, dust: false },
  [Surface.Ice]: { name: 'Buz', grip: 0.2, rollingResistance: 0.01, sinkDrag: 0, dust: false },
};

/** Something the vehicle can ask for the surface under a world-space contact point. */
export interface SurfaceQuery {
  surfaceAt(x: number, z: number, colliderHandle: number): Surface;
}
