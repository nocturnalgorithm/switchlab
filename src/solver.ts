/**
 * Single-phase source and capacitor bank.
 * All integration uses SI units; returned waveforms use ms, kV and kA.
 *
 * Eliminating algebraic variables from MNA gives, while the breaker is closed:
 *   L di/dt = vSource - R i - vCap
 *   C dvCap/dt = i - G vCap
 * The two equations are integrated together with the trapezoidal rule.
 * When open, i = 0 and vCap decays analytically through its discharge resistor.
 * Opening can wait for a refined current zero, or force ideal disconnection at
 * the command angle. Forced opening omits inductive energy release/impulse and
 * is not a physical current-chopping or breaker-TRV model.
 * No stray capacitances / arc model are present, so recovery voltage and its
 * smooth derivative are model outputs, not a standardized HF TRV/RRRV rating.
 */

export interface SimulationParams {
  /** Omitted only when replaying a legacy combined switching case. */
  analysisMode?: 'closing' | 'opening';
  /** Command-angle disconnection is an ideal forced switch, not an arc/chopping model. */
  openingRule?: 'command-angle' | 'current-zero';
  /** Single-phase source voltage, RMS kV. */
  sourceVoltageKV: number;
  frequencyHz: number;
  /** Single-phase reactive rating at the source RMS voltage and frequency. */
  bankMvar: number;
  sourceResistanceOhm: number;
  sourceInductanceMH: number;
  reactorInductanceMH: number;
  /** Resistance across the capacitor. Zero disables the resistor. */
  dischargeResistanceKOhm: number;
  /** Initial phase capacitor voltage at simulation t=0 / source phase crest. */
  initialChargePu: number;
  closingAngleDeg: number;
  openingAngleDeg: number;
  openingAfterCycles: number;
  enableOpening: boolean;
  durationMs: number;
  timeStepUs: number;
}

export const defaultParams: SimulationParams = {
  sourceVoltageKV: 83.716,
  frequencyHz: 50,
  bankMvar: 13.333,
  sourceResistanceOhm: 0.6,
  sourceInductanceMH: 2,
  reactorInductanceMH: 0,
  dischargeResistanceKOhm: 1000,
  initialChargePu: 0,
  closingAngleDeg: 90,
  openingAngleDeg: 90,
  openingAfterCycles: 2,
  enableOpening: true,
  durationMs: 120,
  timeStepUs: 5,
};

/** Convert old saved studies without changing their equivalent circuit. */
export function migrateParams(input: Partial<SimulationParams> & { lineVoltageKV?: number }): SimulationParams {
  const { lineVoltageKV, ...singlePhase } = input;
  if (singlePhase.sourceVoltageKV === undefined && lineVoltageKV !== undefined) {
    return { ...defaultParams, ...singlePhase, sourceVoltageKV: lineVoltageKV / Math.sqrt(3), bankMvar: (input.bankMvar ?? 40) / 3 };
  }
  return { ...defaultParams, ...singlePhase };
}

export type PhaseId = 'A' | 'B' | 'C';
export interface CircuitNode { id: string; phase: PhaseId | null; label: string }
export interface CircuitComponent {
  id: string;
  kind: 'voltage-source' | 'resistor' | 'inductor' | 'capacitor' | 'breaker';
  phase: PhaseId;
  terminals: [string, string];
  valueSI: number;
  label: string;
}
/** Phase/node/component representation can be extended with B/C and coupling. */
export interface CircuitModel {
  version: 1;
  phases: { id: PhaseId; sourceAngleDeg: number }[];
  referenceNode: string;
  nodes: CircuitNode[];
  components: CircuitComponent[];
}

export interface SimulationEvent {
  type: 'close' | 'open-command' | 'interrupt';
  timeMs: number;
  label: string;
  currentKA: number;
  capacitorKV: number;
  breakerKV: number;
}

export interface SimulationMetrics {
  capacitanceUF: number;
  phaseCrestKV: number;
  naturalFrequencyHz: number;
  dampedFrequencyHz: number;
  /** Maximum |i| in the first power-frequency cycle after closing. */
  peakInrushKA: number;
  peakCurrentKA: number;
  peakCapacitorKV: number;
  peakCapacitorPu: number;
  peakBreakerKV: number;
  /** Maximum |v_breaker| only after current-zero interruption. */
  peakRecoveryKV: number | null;
  /** Maximum smooth |d(v_breaker)/dt| after interruption; excludes voltage step. */
  maxRRRVKVPerUs: number | null;
  preClosingBreakerKV: number | null;
  trappedVoltageKV: number | null;
  trappedChargePu: number | null;
  interruptionCurrentKA: number | null;
  recoveryVoltageStepKV: number | null;
  closingTimeMs: number | null;
  openingCommandTimeMs: number | null;
  interruptionTimeMs: number | null;
  actualTimeStepUs: number;
  sampleCount: number;
  recoveryWindowMs: number;
}

export interface SimulationResult {
  params: SimulationParams;
  time: number[];
  sourceVoltage: number[];
  capacitorVoltage: number[];
  breakerVoltage: number[];
  current: number[];
  events: SimulationEvent[];
  metrics: SimulationMetrics;
  warnings: string[];
  model: CircuitModel;
}

type State = { i: number; v: number };
const TAU = 2 * Math.PI;
const normalizedAngle = (angle: number) => ((angle % 360) + 360) % 360;

function validate(p: SimulationParams): void {
  for (const [name, value] of Object.entries(p)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`${name} must be a finite number.`);
    }
  }
  for (const key of ['sourceVoltageKV', 'frequencyHz', 'bankMvar', 'durationMs', 'timeStepUs'] as const) {
    if (!(p[key] > 0)) throw new Error(`${key} must be greater than zero.`);
  }
  for (const key of ['sourceResistanceOhm', 'sourceInductanceMH', 'reactorInductanceMH', 'dischargeResistanceKOhm', 'openingAfterCycles'] as const) {
    if (!(p[key] >= 0)) throw new Error(`${key} cannot be negative.`);
  }
  if (p.sourceInductanceMH + p.reactorInductanceMH <= 0) {
    throw new Error('Total series inductance must be greater than zero.');
  }
}

export function buildCircuitModel(p: SimulationParams): CircuitModel {
  const c = p.bankMvar * 1e6 / (TAU * p.frequencyHz * (p.sourceVoltageKV * 1e3) ** 2);
  const components: CircuitComponent[] = [
    { id: 'source-A', kind: 'voltage-source', phase: 'A', terminals: ['source-A', 'ground'], valueSI: p.sourceVoltageKV * 1e3 * Math.sqrt(2), label: 'Phase source crest (V)' },
    { id: 'source-R-A', kind: 'resistor', phase: 'A', terminals: ['source-A', 'r-A'], valueSI: p.sourceResistanceOhm, label: 'Source R' },
    { id: 'source-L-A', kind: 'inductor', phase: 'A', terminals: ['r-A', 'line-A'], valueSI: p.sourceInductanceMH * 1e-3, label: 'Source L' },
    { id: 'breaker-A', kind: 'breaker', phase: 'A', terminals: ['line-A', 'reactor-A'], valueSI: 0, label: 'Circuit breaker' },
    { id: 'reactor-L-A', kind: 'inductor', phase: 'A', terminals: ['reactor-A', 'bank-A'], valueSI: p.reactorInductanceMH * 1e-3, label: 'Series reactor' },
    { id: 'bank-C-A', kind: 'capacitor', phase: 'A', terminals: ['bank-A', 'ground'], valueSI: c, label: 'Bank capacitance' },
  ];
  if (p.dischargeResistanceKOhm > 0) components.push({ id: 'discharge-R-A', kind: 'resistor', phase: 'A', terminals: ['bank-A', 'ground'], valueSI: p.dischargeResistanceKOhm * 1e3, label: 'Discharge R' });
  return {
    version: 1,
    phases: [{ id: 'A', sourceAngleDeg: 0 }],
    referenceNode: 'ground',
    nodes: [
      { id: 'ground', phase: null, label: 'Ground / neutral' },
      ...['source-A', 'r-A', 'line-A', 'reactor-A', 'bank-A'].map(id => ({ id, phase: 'A' as const, label: id })),
    ],
    components,
  };
}

export function simulate(input: Partial<SimulationParams> & { lineVoltageKV?: number } = {}): SimulationResult {
  const params = migrateParams(input);
  if (params.analysisMode) params.enableOpening = params.analysisMode === 'opening';
  validate(params);
  const p = params;
  const omega = TAU * p.frequencyHz;
  const period = 1 / p.frequencyHz;
  const crest = p.sourceVoltageKV * 1e3 * Math.sqrt(2);
  const C = p.bankMvar * 1e6 / (omega * (p.sourceVoltageKV * 1e3) ** 2);
  const L = (p.sourceInductanceMH + p.reactorInductanceMH) * 1e-3;
  const R = p.sourceResistanceOhm;
  const G = p.dischargeResistanceKOhm > 0 ? 1 / (p.dischargeResistanceKOhm * 1e3) : 0;
  const decayRate = G / C;
  const naturalFrequency = 1 / (TAU * Math.sqrt(L * C));
  const alpha = (R / L + G / C) / 2;
  const wd2 = (1 + R * G) / (L * C) - alpha ** 2;
  // At least 120 points per LC period and 720 per source cycle.
  // Also resolve any fast real decay mode to avoid trapezoidal ringing.
  const step = Math.min(p.timeStepUs * 1e-6, 1 / (120 * naturalFrequency), period / 720, 0.1 / Math.max(R / L, decayRate, 1));
  const end = p.durationMs * 1e-3;
  if (Math.ceil(end / step) > 250_000) throw new Error('This case needs more than 250,000 steps. Shorten the duration or reduce the fastest circuit dynamics.');
  const openingMode = p.analysisMode === 'opening';
  const closeAt = openingMode ? Infinity : (1 + normalizedAngle(p.closingAngleDeg) / 360) * period;
  const openingPhase = normalizedAngle(p.openingAngleDeg) / 360;
  const earliestCommandCycles = openingMode ? p.openingAfterCycles : closeAt / period + p.openingAfterCycles;
  const commandAt = p.enableOpening
    ? (Math.ceil(earliestCommandCycles - openingPhase - 1e-10) + openingPhase) * period
    : Infinity;
  const source = (t: number) => crest * Math.sin(omega * t);
  const warnings: string[] = [];
  if (step < p.timeStepUs * 1e-6 * (1 - 1e-10)) warnings.push(`Time step reduced to ${(step * 1e6).toPrecision(4)} µs to resolve circuit dynamics.`);

  // Solve the 2x2 trapezoidal MNA companion system, rather than updating i/v sequentially.
  function advanceClosed(s: State, t: number, h: number): State {
    const a = 1 + h * R / (2 * L);
    const b = h / (2 * L);
    const c = -h / (2 * C);
    const d = 1 + h * G / (2 * C);
    const u = (1 - h * R / (2 * L)) * s.i - b * s.v + b * (source(t) + source(t + h));
    const v = -c * s.i + (1 - h * G / (2 * C)) * s.v;
    const determinant = a * d - b * c;
    return { i: (d * u - b * v) / determinant, v: (a * v - c * u) / determinant };
  }

  const result: SimulationResult = {
    params, time: [], sourceVoltage: [], capacitorVoltage: [], breakerVoltage: [], current: [], events: [], warnings,
    model: buildCircuitModel(p),
    metrics: {
      capacitanceUF: C * 1e6,
      phaseCrestKV: crest / 1e3,
      naturalFrequencyHz: naturalFrequency,
      dampedFrequencyHz: Math.sqrt(Math.max(0, wd2)) / TAU,
      peakInrushKA: 0, peakCurrentKA: 0, peakCapacitorKV: 0, peakCapacitorPu: 0, peakBreakerKV: 0,
      peakRecoveryKV: null, maxRRRVKVPerUs: null, preClosingBreakerKV: null,
      trappedVoltageKV: null, trappedChargePu: null, interruptionCurrentKA: null,
      recoveryVoltageStepKV: null,
      closingTimeMs: openingMode ? null : closeAt * 1e3,
      openingCommandTimeMs: p.enableOpening ? commandAt * 1e3 : null,
      interruptionTimeMs: null,
      actualTimeStepUs: step * 1e6,
      sampleCount: 0,
      recoveryWindowMs: 0,
    },
  };
  const m = result.metrics;
  let t = 0;
  let state: State = { i: 0, v: p.initialChargePu * crest };
  if (openingMode) {
    // Sinusoidal steady state: Vc = Vs / (1 + (R+jωL)(G+jωC)).
    // With a sine-reference source, initial values are imaginary phasor parts.
    const dr = 1 + R * G - omega * omega * L * C;
    const di = omega * (R * C + L * G);
    const denominator = dr * dr + di * di;
    if (denominator < 1e-20) throw new Error('No finite steady state at this undamped resonance. Add resistance or change L/C.');
    const vr = crest * dr / denominator;
    const vi = -crest * di / denominator;
    state = { v: vi, i: G * vi + omega * C * vr };
  }
  let closed = openingMode;
  let hasClosed = openingMode;
  let openingRequested = false;
  let interrupted = false;
  const currentTolerance = Math.max(1e-9, crest * Math.sqrt(C / L) * 1e-10);
  const eventTolerance = 1e-13;

  function record(): void {
    const vs = source(t);
    const vb = closed ? 0 : vs - state.v;
    result.time.push(t * 1e3);
    result.sourceVoltage.push(vs / 1e3);
    result.capacitorVoltage.push(state.v / 1e3);
    result.breakerVoltage.push(vb / 1e3);
    result.current.push(state.i / 1e3);
    m.peakCurrentKA = Math.max(m.peakCurrentKA, Math.abs(state.i) / 1e3);
    m.peakCapacitorKV = Math.max(m.peakCapacitorKV, Math.abs(state.v) / 1e3);
    m.peakBreakerKV = Math.max(m.peakBreakerKV, Math.abs(vb) / 1e3);
    if (!openingMode && hasClosed && t <= closeAt + period + eventTolerance) m.peakInrushKA = Math.max(m.peakInrushKA, Math.abs(state.i) / 1e3);
    if (interrupted) {
      m.peakRecoveryKV = Math.max(m.peakRecoveryKV ?? 0, Math.abs(vb) / 1e3);
      // Analytic open-interval derivative excludes the ideal topology voltage step.
      const derivative = crest * omega * Math.cos(omega * t) + decayRate * state.v;
      m.maxRRRVKVPerUs = Math.max(m.maxRRRVKVPerUs ?? 0, Math.abs(derivative) / 1e9);
    }
  }
  function addEvent(type: SimulationEvent['type'], label: string): void {
    result.events.push({ type, label, timeMs: t * 1e3, currentKA: state.i / 1e3, capacitorKV: state.v / 1e3, breakerKV: (closed ? 0 : source(t) - state.v) / 1e3 });
  }
  function interrupt(): void {
    m.interruptionCurrentKA = state.i / 1e3;
    m.interruptionTimeMs = t * 1e3;
    m.trappedVoltageKV = state.v / 1e3;
    m.trappedChargePu = state.v / crest;
    m.recoveryVoltageStepKV = (source(t) - state.v) / 1e3;
    closed = false;
    interrupted = true;
    state.i = 0;
    addEvent('interrupt', p.openingRule === 'command-angle' ? 'Ideal forced opening at command angle' : 'Current-zero interruption');
    record();
  }

  record();
  while (true) {
    // Events have duplicate timestamps so discontinuous breaker voltage is drawn
    // vertically while capacitor voltage and inductor current remain continuous.
    if (!hasClosed && t >= closeAt - eventTolerance) {
      m.preClosingBreakerKV = (source(t) - state.v) / 1e3;
      closed = true;
      hasClosed = true;
      addEvent('close', 'Breaker closes');
      record();
    }
    if (closed && !openingRequested && t >= commandAt - eventTolerance) {
      openingRequested = true;
      addEvent('open-command', 'Opening command / contacts part');
      // Forced opening retains vC continuously and sets branch current to zero.
      // The discarded inductor energy and associated voltage impulse are NOT
      // represented: use this rule for ideal isolation/charge retention only.
      if (p.openingRule === 'command-angle' || Math.abs(state.i) <= currentTolerance) interrupt();
    }
    if (t >= end - eventTolerance) break;
    let next = Math.min(t + step, end);
    if (!hasClosed) next = Math.min(next, closeAt);
    if (closed && !openingRequested) next = Math.min(next, commandAt);
    const h = next - t;
    if (h <= 0) throw new Error('Unable to advance the simulation clock.');
    if (!closed) {
      state = { i: 0, v: state.v * Math.exp(-decayRate * h) };
      t = next;
      record();
      continue;
    }
    const proposed = advanceClosed(state, t, h);
    if (openingRequested && state.i * proposed.i <= 0 && Math.abs(state.i) > currentTolerance) {
      // Locate the first root inside this well-resolved integration step.
      let low = 0;
      let high = h;
      for (let iteration = 0; iteration < 48; iteration++) {
        const mid = (low + high) / 2;
        if (state.i * advanceClosed(state, t, mid).i > 0) low = mid;
        else high = mid;
      }
      const root = (low + high) / 2;
      state = advanceClosed(state, t, root);
      t += root;
      record();
      interrupt();
    } else {
      state = proposed;
      t = next;
      record();
    }
  }
  m.peakCapacitorPu = m.peakCapacitorKV / m.phaseCrestKV;
  m.sampleCount = result.time.length;
  m.recoveryWindowMs = m.interruptionTimeMs === null ? 0 : Math.max(0, p.durationMs - m.interruptionTimeMs);
  if (!hasClosed) warnings.push('The simulation ends before the scheduled closing event.');
  if (p.enableOpening && !interrupted) warnings.push('No interruption occurred within this simulation window.');
  if (interrupted && m.recoveryWindowMs < period * 1e3 / 2) warnings.push('The recovery window is shorter than half a power-frequency cycle; its peak may lie outside the plot.');
  if (naturalFrequency < p.frequencyHz * 3) warnings.push('The LC frequency is close to the supply frequency; strong resonant amplification is possible.');
  return result;
}
