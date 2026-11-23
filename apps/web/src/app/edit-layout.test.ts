import { describe, expect, it, vi } from 'vitest';
import { capabilitiesFor } from '../platform/tier-policy';
import { type LayoutHost, setFullEditor } from './edit-layout';
import { observable } from './observable';
import { initialUi, type UiState } from './state';

function host(tier: 'phone' | 'desktop', fullEditor: boolean, ui: Partial<UiState>) {
  const exit = vi.fn();
  const uiObs = observable<UiState>({ ...initialUi, ...ui });
  const wb: LayoutHost = {
    tier,
    fullEditor: observable(fullEditor),
    capabilities: observable(capabilitiesFor(tier, { fullEditor })),
    ui: uiObs,
    sketch: { exit },
    patchUi: (p) => uiObs.set({ ...uiObs.get(), ...p }),
  };
  return { wb, exit, uiObs };
}

const openSketch = { sketch: {} as unknown as NonNullable<UiState['sketch']> };

describe('leaving the full editor mid-edit (ADR-101, phase 2a)', () => {
  it('finishes an open sketch (kept, as Finish sketch does) before the review layout shows', () => {
    const { wb, exit } = host('phone', true, openSketch);
    setFullEditor(wb, false);
    expect(exit).toHaveBeenCalledWith(true);
    expect(wb.capabilities.get().layout).toBe('review');
    expect(wb.capabilities.get().editSketches).toBe(false);
  });

  it('closes an open feature edit and its pick', () => {
    const { wb, uiObs } = host('phone', true, {
      featureId: 'F1',
      picking: { featureId: 'F1', path: '/profile' },
    });
    setFullEditor(wb, false);
    expect(uiObs.get().featureId).toBeNull();
    expect(uiObs.get().picking).toBeNull();
  });

  it('finishes nothing when entering the full editor', () => {
    const { wb, exit } = host('phone', false, openSketch);
    setFullEditor(wb, true);
    expect(exit).not.toHaveBeenCalled();
    expect(wb.capabilities.get().editSketches).toBe(true);
  });

  it('a desktop (always full) keeps its sketch on a switch to the same layout', () => {
    const { wb, exit } = host('desktop', true, openSketch);
    setFullEditor(wb, true);
    expect(exit).not.toHaveBeenCalled();
  });
});
