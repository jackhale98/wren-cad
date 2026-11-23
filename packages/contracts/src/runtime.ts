/**
 * Runtime environment & device tier (PLAN §8.3, §8.4). Lead-owned.
 */

import type { KernelVariant } from './kernel';
import type { RenderBackend } from './viewport';

export type DeviceTier = 'desktop' | 'tablet' | 'phone';

/**
 * What a device may do, independent of what it is called (ADR-101). The app derives this once from
 * the tier and the user's settings (`apps/web/src/platform/tier-policy.ts`); code asks a
 * capability, never `tier === 'phone'`. Additive: a new capability is a new optional field whose
 * absence means "no".
 */
export interface DeviceCapabilities {
  /**
   * `full`: the desktop structure (top bar, side panels, command bar). `review`: viewer first,
   * with a bottom sheet (PLAN §9.1 Phone).
   */
  layout: 'full' | 'review';
  /** Control size: `touch` = 44 px targets. */
  density: 'compact' | 'touch';
  /** Create and edit sketches. */
  editSketches: boolean;
  /** Create, delete, reorder, rename and edit features and folders; the full tree actions. */
  editFeatures: boolean;
  /** Change existing values inline (parameters, feature values), switch configuration. */
  editValues: boolean;
  /** Edit drawings (views, dimensions, annotations); false = drawings are review-only. */
  editDrawings: boolean;
}

export interface RuntimeDiagnostics {
  tier: DeviceTier;
  crossOriginIsolated: boolean;
  kernelVariant: KernelVariant | null;
  renderBackend: RenderBackend | null;
  hardwareConcurrency: number;
  /** GiB, where `navigator.deviceMemory` exists. */
  deviceMemory?: number;
  primaryPointer: 'fine' | 'coarse' | 'none';
  serviceWorker: 'unsupported' | 'installing' | 'active' | 'none';
  /** App version string, e.g. `0.1.0+<git sha>`. */
  appVersion: string;
}

/**
 * Global hook the app exposes for E2E/perf tests (`window.__wren`). Only test-facing; not an
 * extension API.
 */
export interface WrenTestHooks {
  diagnostics(): RuntimeDiagnostics;
  /** Resolves once the first body has been rendered. Includes timing marks (ms since navigationStart). */
  firstBodyRendered(): Promise<{
    shellInteractiveMs: number;
    kernelReadyMs: number;
    firstBodyMs: number;
  }>;
}
