/** A point of the hand that can hit things. Pure type, shared with the server playtest. */
export type Handedness = 'left' | 'right';

export interface Tip {
  hand: Handedness;
  /** WebXR joint name, or 'palm'. Kept as string so this file needs no WebXR types. */
  joint: string;
  /** Whether this tip was tracked this frame. */
  active: boolean;
  /** World position (metres). */
  x: number; y: number; z: number;
  /** Smoothed world velocity (m/s). */
  vx: number; vy: number; vz: number;
  /** Collision radius (metres). */
  radius: number;
}
