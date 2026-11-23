/**
 * The active-configuration pill in the top bar (M3.7, research P0 3). Lazy chunk, like the
 * project bar: it is not on the first screen.
 *
 * Shown on desktop and tablet always, so "New configuration…" is one tap away from a part that
 * has none; on the phone only when the part has a configuration (the chip switches, nothing more:
 * configurations are created and managed on desktop and tablet).
 */

import type { DeviceCapabilities } from '@wren-cad/contracts';
import { ConfigurationPill } from '@wren-cad/ui';
import type { Workbench } from '../app/workbench';
import { useConfigurationView } from './config-view';

export default function ConfigurationBar({
  wb,
  caps,
}: {
  wb: Workbench;
  caps: DeviceCapabilities;
}) {
  const v = useConfigurationView(wb);
  const phone = caps.layout === 'review';
  if (phone && v.count === 0 && !v.missing) return null;
  return (
    <ConfigurationPill
      variant={phone ? 'chip' : 'bar'}
      size={caps.density === 'compact' ? 'md' : 'touch'}
      configurations={v.summaries}
      activeId={v.activeId}
      defaultStatus={v.defaultStatus}
      {...(v.defaultMessage ? { defaultStatusMessage: v.defaultMessage } : {})}
      onSwitch={(id) => wb.config.setActive(id)}
      {...(phone
        ? {}
        : {
            onCreate: (input: { name: string; from: 'default' | 'active' }) =>
              void wb.config.create(input.name, input.from),
            onManage: () => wb.config.openPanel(true),
          })}
    />
  );
}
