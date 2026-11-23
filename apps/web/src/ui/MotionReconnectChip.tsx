/**
 * "Reconnect 3D mouse" (owner, 2026-11-23): Chrome forgets a 3D mouse that has no serial number
 * when the browser closes (its permission is session-only), so the device layer starts in
 * `disconnected` although the mouse is plugged in. A site cannot change that, but the way back is
 * one click here instead of a trip to Settings. Dismissing it is remembered until the next
 * successful pairing, so someone working without the mouse is not asked on every start.
 */

import { Button } from '@wren-cad/ui';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useMotionState } from '../app/motion';
import { useObservable } from '../app/observable';
import type { Workbench } from '../app/workbench';

export const MOTION_RECONNECT_DISMISSED_KEY = 'wren.motion.reconnectDismissed';

const read = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(MOTION_RECONNECT_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
};
const write = (v: boolean): void => {
  try {
    if (v) globalThis.localStorage?.setItem(MOTION_RECONNECT_DISMISSED_KEY, '1');
    else globalThis.localStorage?.removeItem(MOTION_RECONNECT_DISMISSED_KEY);
  } catch {
    // storage unavailable: the choice lasts for the session
  }
};

/** Whether the chip shows: a device was paired before, none is granted now, and not dismissed. */
export function showReconnect(state: string, dismissed: boolean): boolean {
  return state === 'disconnected' && !dismissed;
}

export function MotionReconnectChip({ wb, touch }: { wb: Workbench; touch: boolean }) {
  const input = useObservable(wb.motionInput);
  const state = useMotionState(input);
  const [dismissed, setDismissed] = useState(read);
  // A device is back: forget the dismissal, so a later restart offers the chip again.
  const connected = state.path === 'webhid';
  useEffect(() => {
    if (connected) {
      write(false);
      setDismissed(false);
    }
  }, [connected]);
  if (!input || !showReconnect(state.state, dismissed)) return null;
  const size = touch ? 'touch' : 'md';
  return (
    <div
      role="status"
      data-testid="motion-reconnect"
      className="w-panel pointer-events-auto flex items-center gap-1 rounded-[14px] py-1 pr-1 pl-3 text-ui text-fg"
    >
      <span>3D mouse not connected</span>
      <Button
        variant="secondary"
        size={size}
        data-testid="motion-reconnect-pair"
        onClick={() => void input.pair().catch(() => {})}
      >
        Reconnect
      </Button>
      <Button
        variant="ghost"
        size={size}
        aria-label="Don’t offer to reconnect the 3D mouse"
        data-testid="motion-reconnect-dismiss"
        onClick={() => {
          write(true);
          setDismissed(true);
        }}
      >
        <X className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
