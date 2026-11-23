/** What the Before chip does on each event, apart from rendering (unit-testable without a DOM). */

export interface BeforeSwitch {
  setBefore(on: boolean): void;
}

export function beforeChipHandlers(cp: BeforeSwitch) {
  return {
    hold: () => cp.setBefore(true),
    release: () => cp.setBefore(false),
    isActivation: (key: string) => key === ' ' || key === 'Enter',
  };
}
