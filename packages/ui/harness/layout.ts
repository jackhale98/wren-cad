import type { DeviceCapabilities, DeviceTier } from '@wren-cad/contracts';

/** Harness stand-in for the app's capability policy: the layout and density a tier gets. */
export const LAYOUT_FOR: Record<DeviceTier, Pick<DeviceCapabilities, 'layout' | 'density'>> = {
  desktop: { layout: 'full', density: 'compact' },
  tablet: { layout: 'full', density: 'touch' },
  phone: { layout: 'review', density: 'touch' },
};
