import { defaultParams, type SimulationParams } from './solver.ts';

interface OpeningPreset {
  name: string;
  note: string;
  params: SimulationParams;
}
const base: SimulationParams = {
  ...defaultParams,
  analysisMode: 'opening',
  enableOpening: true,
  openingRule: 'command-angle',
  openingAfterCycles: 2,
  initialChargePu: 0,
  dischargeResistanceKOhm: 0,
};

export const openingPresets: Record<string, OpeningPreset> = {
  open_45: {
    name: 'Partial voltage · 45° opening',
    note: 'Ideal opening at 45° with discharge disabled: hold the instantaneous capacitor voltage below its crest.',
    params: { ...base, openingAngleDeg: 45 },
  },
  open_crest: {
    name: 'Positive crest · 90° opening',
    note: 'Ideal opening at 90° with discharge disabled: retain a positive voltage near the capacitor crest.',
    params: { ...base, openingAngleDeg: 90 },
  },
  open_negative: {
    name: 'Opposite polarity · 225° opening',
    note: 'Ideal opening at 225°: compare negative trapped voltage with the 45° case.',
    params: { ...base, openingAngleDeg: 225 },
  },
  open_discharge: {
    name: 'Discharge resistor · 45° opening',
    note: 'Open at 45°, then discharge through 20 kΩ. The 400 ms window makes the exponential decay visible.',
    params: { ...base, openingAngleDeg: 45, dischargeResistanceKOhm: 20, durationMs: 400 },
  },
  open_current_zero: {
    name: 'Reference · next current zero',
    note: 'Comparison case only: issue a command at 45° and wait for the next current zero instead of opening immediately.',
    params: { ...base, openingAngleDeg: 45, openingRule: 'current-zero' },
  },
};
