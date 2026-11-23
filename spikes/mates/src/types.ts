// Spike S1: the shapes the mate solver consumes and produces. These are the proposed contract
// shapes (see docs/spikes/mate-solver.md, "What the solver needs from the contract").

import type { Quat, Vec3 } from './math.ts';

/**
 * A mate frame in part coordinates, read from the per-part-version cache (no B-rep needed).
 * `z` is the primary direction (plane normal, axis direction); `x` is perpendicular to `z` and
 * fixes the rotation about it (used only by fasten, slider and angle values). y = z × x.
 */
export interface MateFrame {
  origin: Vec3;
  x: Vec3;
  z: Vec3;
}

export interface Pose {
  /** Unit quaternion [w, x, y, z]. */
  q: Quat;
  /** Position of the part origin in assembly coordinates (mm). */
  p: Vec3;
}

export interface Instance {
  id: string;
  name?: string;
  grounded?: boolean;
  /** Current (initial) pose; the solver starts here and moves as little as it can. */
  pose: Pose;
}

export type MateType = 'fasten' | 'revolute' | 'slider' | 'cylindrical' | 'planar' | 'ball';

export interface MateEnd {
  instance: string;
  frame: MateFrame;
}

export interface Mate {
  id: string;
  name?: string;
  type: MateType;
  a: MateEnd;
  b: MateEnd;
  /** Target frame is B rotated 180° about its x axis (z reversed): face-to-face, axes opposed. */
  flip?: boolean;
  /** Distance along B's z (mm): planar gap; ignored by slider and cylindrical (free along z). */
  offset?: number;
  /** Rotation about B's z (rad): used by fasten and slider (later: revolute angle value). */
  angle?: number;
  suppressed?: boolean;
}

export interface Assembly {
  instances: Instance[];
  mates: Mate[];
}

/** Equations each mate type removes (its nominal DOF count). */
export const MATE_EQUATIONS: Record<MateType, number> = {
  fasten: 6,
  revolute: 5,
  slider: 5,
  cylindrical: 4,
  planar: 3,
  ball: 3,
};

export type MateStatus = 'ok' | 'redundant' | 'conflict' | 'unsolved';

export interface MateReport {
  status: MateStatus;
  /** Equations implied by other mates (0 for an independent mate). */
  redundantEquations: number;
  /** Other mates involved in the redundancy or conflict (ids). */
  involved: string[];
  /** Remaining error at the reported pose: distance (mm) and angle (degrees). */
  positionError: number;
  angleError: number;
  message?: string;
}

export interface InstanceDof {
  /** Dimension of the motions of this instance the mates still allow (0..6). */
  total: number;
  /** How many of those include rotation; total - rotational are pure translations. */
  rotational: number;
  translational: number;
}

export interface ConflictSet {
  /** A minimal set: these mates cannot all hold; removing any one makes the rest solvable. */
  mates: string[];
  message: string;
}

export interface SolveReport {
  converged: boolean;
  iterations: number;
  poses: Record<string, Pose>;
  /** Remaining DOF of the assembly relative to the grounded instances. */
  dof: number;
  instanceDof: Record<string, InstanceDof>;
  mates: Record<string, MateReport>;
  conflicts: ConflictSet[];
  warnings: string[];
}

export interface DragRequest {
  instance: string;
  /** Grabbed point in the instance's part coordinates. */
  grab: Vec3;
  /** Where the pointer puts that point, in assembly coordinates. */
  target: Vec3;
}

export interface DragResult {
  converged: boolean;
  iterations: number;
  /** Distance from the grabbed point to the target after the step (mm). */
  miss: number;
  /** Instances whose pose changed (the dragged component only). */
  moved: string[];
}
