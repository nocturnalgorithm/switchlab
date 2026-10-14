import assert from 'node:assert/strict';
import { simulate, defaultParams, migrateParams, type SimulationResult } from './solver.ts';

const TAU = 2 * Math.PI;
const near = (actual: number, expected: number, relativeTolerance: number, name: string) => {
  assert.ok(Math.abs(actual - expected) <= Math.max(1e-10, Math.abs(expected) * relativeTolerance), `${name}: ${actual} vs ${expected}`);
};
const tests: [string, () => void][] = [];
function test(name: string, run: () => void) { tests.push([name, run]); }

test('Single-phase capacitance reproduces single-phase Mvar', () => {
  const r = simulate();
  const c = r.metrics.capacitanceUF * 1e-6;
  near(TAU * defaultParams.frequencyHz * c * (defaultParams.sourceVoltageKV * 1e3) ** 2, defaultParams.bankMvar * 1e6, 1e-12, 'Reactive power');
  near(r.metrics.naturalFrequencyHz, 1 / (TAU * Math.sqrt(defaultParams.sourceInductanceMH * 1e-3 * c)), 1e-12, 'LC frequency');
  assert.ok(r.model.phases[0].id === 'A' && r.model.components.some(c => c.kind === 'breaker'));
});

test('Single-phase voltage and Mvar have no hidden three-phase scaling', () => {
  const r = simulate({sourceVoltageKV:10, bankMvar:1, frequencyHz:50, analysisMode:'closing'});
  near(r.metrics.phaseCrestKV,10*Math.sqrt(2),1e-12,'Single-phase RMS to crest');
  near(r.metrics.capacitanceUF,31.830988618379067,1e-12,'1 Mvar at 10 kV and 50 Hz');
  near(r.model.components.find(c=>c.kind==='voltage-source')!.valueSI,10000*Math.sqrt(2),1e-12,'Circuit model source');
});

test('Legacy saved cases retain their voltage, capacitance and waveform', () => {
  const legacy = {lineVoltageKV:145, bankMvar:40, analysisMode:'opening' as const, openingRule:'command-angle' as const, openingAngleDeg:45};
  const migrated = migrateParams(legacy);
  near(migrated.sourceVoltageKV,145/Math.sqrt(3),1e-12,'Converted RMS voltage');
  near(migrated.bankMvar,40/3,1e-12,'Converted bank rating');
  assert.ok(!('lineVoltageKV' in migrated));
  assert.deepEqual(migrateParams(migrated),migrated,'Migration is idempotent');
  const r=simulate(migrated);
  near(r.metrics.capacitanceUF,40*1e12/(TAU*50*(145000)**2),1e-12,'Original equivalent capacitance');
  assert.deepEqual(simulate(legacy).capacitorVoltage,r.capacitorVoltage,'Legacy API and saved-case migration agree');
});

/** Exact lossless sinusoidal-source solution after closing at a source crest. */
function losslessError(stepUs: number): { error: number; result: SimulationResult } {
  const r = simulate({ sourceResistanceOhm: 0, dischargeResistanceKOhm: 0, enableOpening: false, initialChargePu: 0, closingAngleDeg: 90, durationMs: 28, timeStepUs: stepUs });
  const c = r.metrics.capacitanceUF * 1e-6;
  const l = r.params.sourceInductanceMH * 1e-3;
  const omega = TAU * r.params.frequencyHz;
  const omega0 = 1 / Math.sqrt(l * c);
  const crest = r.metrics.phaseCrestKV * 1e3;
  const k = 1 / (1 - omega ** 2 * l * c);
  let error = 0;
  for (let j = 0; j < r.time.length; j++) {
    const elapsed = (r.time[j] - r.metrics.closingTimeMs) * 1e-3;
    if (elapsed < 0) continue;
    const expectedVoltage = k * crest * (Math.cos(omega * elapsed) - Math.cos(omega0 * elapsed));
    const expectedCurrent = c * k * crest * (-omega * Math.sin(omega * elapsed) + omega0 * Math.sin(omega0 * elapsed));
    error = Math.max(error, Math.abs(r.capacitorVoltage[j] * 1e3 - expectedVoltage) / crest);
    assert.ok(Math.abs(r.current[j] * 1e3 - expectedCurrent) / (crest * Math.sqrt(c / l)) < 0.02, 'Current tracks analytic AC making transient');
  }
  return { error, result: r };
}

test('Lossless making waveforms match exact AC solution and converge quadratically', () => {
  const coarse = losslessError(4);
  const fine = losslessError(2);
  assert.ok(coarse.error < 0.02);
  assert.ok(fine.error < coarse.error / 3.5, `Trapezoidal convergence: ${coarse.error} -> ${fine.error}`);
  const r = fine.result;
  const makingPeakEstimate = r.metrics.phaseCrestKV * Math.sqrt(r.metrics.capacitanceUF * 1e-6 / (r.params.sourceInductanceMH * 1e-3));
  const firstHalfWave = r.current.filter((_, index) => r.time[index] >= r.metrics.closingTimeMs && r.time[index] <= r.metrics.closingTimeMs + 500 / r.metrics.naturalFrequencyHz);
  near(Math.max(...firstHalfWave), makingPeakEstimate, 0.02, 'Initial making peak from frozen-source LC approximation');
});

test('Opening command waits for a refined physical current zero', () => {
  const r = simulate({ openingAngleDeg: 0, durationMs: 120 });
  const m = r.metrics;
  assert.ok(m.interruptionTimeMs !== null && m.openingCommandTimeMs !== null);
  assert.ok(m.interruptionTimeMs > m.openingCommandTimeMs + 0.01, 'Command must not chop nonzero current');
  assert.ok(Math.abs(m.interruptionCurrentKA!) < 1e-9, `Interrupted current = ${m.interruptionCurrentKA}`);
  const command = r.events.find(e => e.type === 'open-command')!;
  assert.ok(Math.abs(command.currentKA) > 0.01);
  assert.ok(r.current.every((i, index) => r.time[index] <= m.interruptionTimeMs! + 1e-9 || i === 0));
  assert.deepEqual(r.events.map(e => e.type), ['close', 'open-command', 'interrupt']);
});

test('Trapped capacitor charge decays analytically through discharge resistance', () => {
  const r = simulate({ dischargeResistanceKOhm: 20, durationMs: 120 });
  const tau = r.params.dischargeResistanceKOhm * 1e3 * r.metrics.capacitanceUF * 1e-6;
  const timeOpen = (r.time.at(-1)! - r.metrics.interruptionTimeMs!) * 1e-3;
  const expected = r.metrics.trappedVoltageKV! * Math.exp(-timeOpen / tau);
  near(r.capacitorVoltage.at(-1)!, expected, 1e-10, 'Exponential trapped-charge decay');
  const retained = simulate({ dischargeResistanceKOhm: 0 });
  near(retained.capacitorVoltage.at(-1)!, retained.metrics.trappedVoltageKV!, 1e-12, 'Charge retained without discharge resistor');
});

test('Idealized capacitive recovery approaches two source crests without artificial dV/dt spikes', () => {
  const r = simulate({ sourceResistanceOhm: 3, sourceInductanceMH: 0.5, dischargeResistanceKOhm: 0, openingAfterCycles: 3, durationMs: 130, timeStepUs: 2 });
  near(r.metrics.peakRecoveryKV!, 2 * r.metrics.phaseCrestKV, 0.015, 'Two-crest recovery');
  near(r.metrics.maxRRRVKVPerUs!, r.metrics.phaseCrestKV * TAU * r.params.frequencyHz / 1e6, 1e-5, 'Smooth recovery slope');
  const coarser = simulate({ ...r.params, timeStepUs: 4 });
  near(coarser.metrics.maxRRRVKVPerUs!, r.metrics.maxRRRVKVPerUs!, 1e-5, 'Slope independent of switching sample spacing');
});

test('Closing phase, opposite trapped charge and a series reactor change making stress', () => {
  const crest = simulate({ enableOpening: false, durationMs: 50, dischargeResistanceKOhm: 0, initialChargePu: 0 });
  const zero = simulate({ ...crest.params, closingAngleDeg: 0 });
  const opposite = simulate({ ...crest.params, initialChargePu: -1 });
  const reactor = simulate({ ...crest.params, reactorInductanceMH: 6 });
  assert.ok(zero.metrics.peakInrushKA < crest.metrics.peakInrushKA * 0.2);
  assert.ok(opposite.metrics.peakInrushKA > crest.metrics.peakInrushKA * 1.8);
  assert.ok(reactor.metrics.peakInrushKA < crest.metrics.peakInrushKA * 0.6);
  near(opposite.metrics.preClosingBreakerKV!, 2 * opposite.metrics.phaseCrestKV, 1e-10, 'Opposing initial charge doubles preclose voltage');
  near(reactor.metrics.naturalFrequencyHz, crest.metrics.naturalFrequencyHz / 2, 1e-12, 'Added reactor lowers LC frequency');
});

test('Validation and short windows remain finite and honest', () => {
  assert.throws(() => simulate({ bankMvar: 0 }), /greater than zero/);
  assert.throws(() => simulate({ sourceInductanceMH: 0, reactorInductanceMH: 0 }), /inductance/);
  assert.throws(() => simulate({ initialChargePu: NaN }), /finite/);
  const short = simulate({ durationMs: 10 });
  assert.ok(short.warnings.some(w => w.includes('before the scheduled closing')));
  assert.equal(short.metrics.peakInrushKA, 0);
  assert.equal(short.metrics.trappedChargePu, null);
  assert.ok(short.time.every(Number.isFinite) && short.capacitorVoltage.every(Number.isFinite));
});

test('Opening-only mode begins at analytical steady state, without energisation', () => {
  const r = simulate({analysisMode:'opening',openingAngleDeg:0,openingAfterCycles:1,durationMs:50,timeStepUs:1,dischargeResistanceKOhm:0});
  assert.deepEqual(r.events.map(e=>e.type),['open-command','interrupt']);
  assert.equal(r.metrics.closingTimeMs,null);
  assert.equal(r.metrics.peakInrushKA,0);
  assert.ok(Math.abs(r.metrics.interruptionCurrentKA!)<1e-9);
  const omega=TAU*r.params.frequencyHz;
  const c=r.metrics.capacitanceUF*1e-6;
  const l=r.params.sourceInductanceMH*1e-3;
  const dr=1-omega*omega*l*c, di=omega*r.params.sourceResistanceOhm*c;
  const vr=r.metrics.phaseCrestKV*dr/(dr*dr+di*di), vi=-r.metrics.phaseCrestKV*di/(dr*dr+di*di);
  for(let i=0;i<r.time.length&&r.time[i]<r.metrics.openingCommandTimeMs!;i++){
    const t=r.time[i]/1000;
    assert.ok(Math.abs(r.capacitorVoltage[i]-(vr*Math.sin(omega*t)+vi*Math.cos(omega*t)))<0.001);
    assert.equal(r.breakerVoltage[i],0);
  }
  const changed=simulate({...r.params,initialChargePu:-1,closingAngleDeg:270});
  assert.deepEqual(changed.capacitorVoltage,r.capacitorVoltage,'Closing settings do not affect opening mode');
  near(r.metrics.peakRecoveryKV!,2*r.metrics.phaseCrestKV,0.01,'Steady-state capacitive recovery');
});

test('Closing-only mode does not interrupt, and finer time steps produce more data', () => {
  const r=simulate({analysisMode:'closing',enableOpening:true,timeStepUs:5,durationMs:40});
  assert.deepEqual(r.events.map(e=>e.type),['close']);
  assert.equal(r.metrics.interruptionTimeMs,null);
  const fine=simulate({...r.params,timeStepUs:1});
  assert.ok(fine.metrics.sampleCount>r.metrics.sampleCount*4.9);
  near(fine.metrics.actualTimeStepUs,1,1e-12,'Requested fine step is applied');
  near(fine.metrics.peakInrushKA,r.metrics.peakInrushKA,0.002,'Making peak converges');
});

test('Opening angle selects the next current zero and changes trapped-charge polarity', () => {
  const a=simulate({analysisMode:'opening',openingAngleDeg:0});
  const b=simulate({analysisMode:'opening',openingAngleDeg:45});
  const c=simulate({analysisMode:'opening',openingAngleDeg:135});
  assert.ok(b.metrics.openingCommandTimeMs!>a.metrics.openingCommandTimeMs!);
  near(a.metrics.interruptionTimeMs!,b.metrics.interruptionTimeMs!,1e-10,'Commands before the same zero share an interruption');
  near(a.metrics.trappedVoltageKV!,b.metrics.trappedVoltageKV!,1e-10,'Same-zero trapped voltage');
  assert.ok(Math.abs(a.events[0].capacitorKV-b.events[0].capacitorKV)>50,'Bank voltage at command changes with command phase');
  assert.ok(a.metrics.trappedVoltageKV!>0&&c.metrics.trappedVoltageKV!<0,'Next half-cycle reverses trapped polarity');
  near(c.metrics.interruptionTimeMs!-a.metrics.interruptionTimeMs!,500/a.params.frequencyHz,1e-8,'Next zero is half a cycle later');
  near(Math.abs(c.metrics.trappedVoltageKV!),a.metrics.trappedVoltageKV!,1e-8,'Steady-state crest magnitudes agree');
});

test('Forced opening at 45 degrees holds the instantaneous capacitor voltage', () => {
  const r=simulate({analysisMode:'opening',openingRule:'command-angle',openingAngleDeg:45,dischargeResistanceKOhm:0,timeStepUs:1});
  assert.equal(r.metrics.interruptionTimeMs,r.metrics.openingCommandTimeMs);
  near(r.metrics.interruptionTimeMs!,42.5,1e-12,'Exact 45-degree opening time');
  assert.ok(Math.abs(r.metrics.interruptionCurrentKA!)>0.01,'This deliberately forces nonzero current to zero');
  assert.equal(r.metrics.trappedVoltageKV,r.events.find(e=>e.type==='open-command')!.capacitorKV);
  for(let i=0;i<r.time.length;i++)if(r.time[i]>r.metrics.interruptionTimeMs!){
    assert.equal(r.capacitorVoltage[i],r.metrics.trappedVoltageKV,'Blue curve remains exactly flat');
    assert.equal(r.current[i],0);
  }
  const crest=simulate({...r.params,openingAngleDeg:90});
  assert.ok(r.metrics.trappedVoltageKV!<0.72*crest.metrics.trappedVoltageKV!);
  const negative=simulate({...r.params,openingAngleDeg:225});
  near(negative.metrics.trappedVoltageKV!,-r.metrics.trappedVoltageKV!,1e-8,'225-degree opening traps opposite voltage');
  const omega=TAU*r.params.frequencyHz, c=r.metrics.capacitanceUF*1e-6, l=r.params.sourceInductanceMH*1e-3;
  const dr=1-omega*omega*l*c,di=omega*r.params.sourceResistanceOhm*c;
  const expected=r.metrics.phaseCrestKV*(dr-di)/Math.sqrt(2)/(dr*dr+di*di);
  near(r.metrics.trappedVoltageKV!,expected,1e-6,'Held voltage equals analytical steady-state voltage at 45 degrees');
});

test('Forced-opening residual voltage decays only when a discharge resistor is enabled', () => {
  const r=simulate({analysisMode:'opening',openingRule:'command-angle',openingAngleDeg:45,dischargeResistanceKOhm:20});
  const tau=r.params.dischargeResistanceKOhm*1e3*r.metrics.capacitanceUF*1e-6;
  const expected=r.metrics.trappedVoltageKV!*Math.exp(-(r.params.durationMs-r.metrics.interruptionTimeMs!)*1e-3/tau);
  near(r.capacitorVoltage.at(-1)!,expected,1e-10,'Analytical post-opening discharge');
});

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`${tests.length} solver verification tests passed.`);
