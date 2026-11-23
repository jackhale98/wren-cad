/**
 * What each device tier means for the app (PLAN §8.4, §10 memory budget). Pure data + functions so
 * the app consults one place: regen cache size, mesh quality, and when the kernel boots.
 */

import type { DeviceCapabilities, DeviceTier, MeshQuality } from '@wren-cad/contracts';

/** When the kernel worker should be started. */
export type KernelBoot = 'eager' | 'onEdit';

export interface TierPolicy {
  tier: DeviceTier;
  /**
   * `configureRegen({ maxSpareResults })` / `createKernelClient({ regen: { maxSpareResults } })`.
   * `undefined` = keep the regen engine's default (128, or three earlier states of a large part;
   * ADR-084).
   */
  regenMaxSpareResults: number | undefined;
  /** Mesh quality the document settles at. Phones stay coarse (viewer-first, memory). */
  meshQuality: MeshQuality;
  /**
   * `eager`: boot the kernel while the shell paints. `onEdit`: phones are viewer-first; the
   * cached meshes render without a kernel and the Wasm (several MB) loads when an edit starts.
   */
  kernelBoot: KernelBoot;
  /** The user may opt into the full editor (Settings and the command palette offer it). */
  fullEditorOptional: boolean;
  /** Touch hardware: the Pencil draws or selects and never orbits (a pointer fact, not a layout). */
  penDraws: boolean;
  /** Per-configuration timeout of a configuration export: a slower device waits longer (hardware). */
  exportTimeoutMs: number;
}

const POLICIES: Record<DeviceTier, TierPolicy> = {
  desktop: {
    tier: 'desktop',
    regenMaxSpareResults: undefined,
    meshQuality: 'fine',
    kernelBoot: 'eager',
    fullEditorOptional: false,
    penDraws: false,
    exportTimeoutMs: 60_000,
  },
  tablet: {
    tier: 'tablet',
    regenMaxSpareResults: 4,
    meshQuality: 'fine',
    kernelBoot: 'eager',
    fullEditorOptional: false,
    penDraws: true,
    exportTimeoutMs: 90_000,
  },
  phone: {
    tier: 'phone',
    regenMaxSpareResults: 2,
    meshQuality: 'coarse',
    kernelBoot: 'onEdit',
    fullEditorOptional: true,
    penDraws: true,
    exportTimeoutMs: 120_000,
  },
};

export function policyFor(tier: DeviceTier): TierPolicy {
  return POLICIES[tier];
}

export function regenBudgetFor(tier: DeviceTier): number | undefined {
  return POLICIES[tier].regenMaxSpareResults;
}

export function meshQualityFor(tier: DeviceTier): MeshQuality {
  return POLICIES[tier].meshQuality;
}

/** "Phone loads the kernel lazily": consult before `bootKernel()`. */
export function kernelBootFor(tier: DeviceTier): KernelBoot {
  return POLICIES[tier].kernelBoot;
}

/**
 * Whether to start the kernel now. `editStarted` is true once the user begins an edit (or opens
 * something that has no cached mesh and so cannot render without the kernel).
 */
export function shouldBootKernel(
  tier: DeviceTier,
  state: { editStarted: boolean; needsKernelToRender?: boolean },
): boolean {
  if (kernelBootFor(tier) === 'eager') return true;
  return state.editStarted || state.needsKernelToRender === true;
}

/** User settings that change what a device may do (ADR-101 amendment). */
export interface CapabilitySettings {
  /** Phone only: use the full editor (desktop structure at touch density) instead of review. */
  fullEditor: boolean;
}

/**
 * What the device may do (ADR-101): the one place a tier name turns into capabilities. Memory,
 * mesh and kernel-boot policy stay keyed by tier (hardware); everything the UI branches on comes
 * from here.
 */
export function capabilitiesFor(
  tier: DeviceTier,
  settings: CapabilitySettings,
): DeviceCapabilities {
  const all = { editSketches: true, editFeatures: true, editValues: true, editDrawings: true };
  if (tier === 'desktop') return { layout: 'full', density: 'compact', ...all };
  if (tier === 'tablet' || settings.fullEditor) return { layout: 'full', density: 'touch', ...all };
  return {
    layout: 'review',
    density: 'touch',
    editSketches: false,
    editFeatures: false,
    editValues: true, // phase 2c: change numbers, switch configuration; nothing structural
    editDrawings: false,
  };
}
