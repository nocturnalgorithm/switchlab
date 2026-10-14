# SwitchLab

A React + TypeScript equipment-phenomena workspace. The first simulator studies isolated high-voltage capacitor bank switching using a single-phase circuit.

## Run locally

The accompanying `SwitchLab.html` file is a self-contained build: open it in a desktop web browser. It includes React, Plotly, the solver and styles, and does not require an installation or server. Browser rendering and UI interaction verification remain incomplete because this session could not access the preview.

With Node.js 24 and pnpm installed:

1. `pnpm install`
2. `pnpm build`
3. `pnpm dev` and open the printed local URL.

Run the analytical and numerical checks with `node src/solver.test.ts`. Run `pnpm exec tsc --noEmit` for type checks. The static deployment output is `dist/`.

## Implementation

- `src/solver.ts`: coupled trapezoidal integration of algebraically reduced MNA equations, event-time splitting, refined current-zero interruption, and analytical open-bank discharge.
- `src/Waveform.tsx`: Plotly waveforms, full-resolution solver samples retained for zooming, focused time windows and comparison overlays. Exported CSV contains all simulation samples.
- `src/main.tsx`: presets, component-linked controls, study settings, browser-local saved cases and CSV/JSON export.
- `src/solver.test.ts`: exact lossless AC energisation, quadratic convergence, current-zero interruption, discharge, recovery voltage, reactor and phase effects, and validation.

## Quantities and conventions

Input voltage is single-phase RMS; Mvar is the single-phase bank rating at that voltage. Capacitance is C = Q/(2*pi*f*V_RMS^2); source crest is sqrt(2)*V_RMS. Output waveforms are instantaneous single-phase kV and branch kA, with time in milliseconds. Old saved cases are automatically converted (voltage divided by sqrt(3), Mvar divided by 3), retaining their original equivalent circuit. Initial trapped voltage is specified at t=0 relative to source phase crest.

The source is Vcrest*sin(2*pi*f*t). Closing occurs after one complete source cycle plus the specified phase. Select CB closing for energisation only. Select CB opening to start with a closed breaker and an energised bank in sinusoidal steady state (phasor initialisation). In opening mode, commands occur at the first requested phase at or after the specified number of cycles from t=0. The interface defaults to forced ideal opening at the selected angle; current-zero interruption remains selectable.

Peak making current is the maximum absolute current in the first power-frequency cycle after closing. LC mode frequency is calculated from circuit parameters, not estimated from sampled peaks. Recovery voltage is source minus capacitor voltage after interruption. The recovery-slope metric measures its maximum smooth derivative in the available time window and excludes the ideal switching voltage step.

## Model scope

This educational model has linear lumped R/L/C elements and a selectable ideal switching law. Source stray capacitance, arc and dielectric recovery, chopping, restrikes, back-to-back banks, three-phase coupling and neutral displacement are not implemented. It does not perform equipment rating checks or IEEE compliance assessment. High-frequency TRV requires additional parasitic capacitances and breaker models. The displayed recovery slope is not a standardized RRRV envelope slope.

The phase/node/component data structure preserves terminals and SI values for future three-phase and topology extensions. The present solver intentionally uses a fixed topology rather than a general-purpose circuit editor.

References: [IEEE C37.012-2022 public scope](https://standards.ieee.org/ieee/C37.012/10874/) and [PSCAD capacitor-bank switching studies](https://www.pscad.com/knowledge-base/article/45). The full IEEE standard text was not available and no normative clauses or limits are reproduced.

## Storage

Saved cases remain in this browser's local storage. Use JSON export for a portable record of the last completed run. No simulation inputs are sent to a server.

## Resolution controls

Section 04, Simulation settings, contains Maximum step, Duration, Series reactor and Discharge resistor in one panel. Enter the desired maximum step directly. Click Apply & run simulation. The solver may reduce that maximum for fast circuit dynamics; the applied step is shown beneath the Run button. Every solver sample is passed to the chart, so horizontal zoom reveals the calculated detail. There is a 250,000-step limit; shorten duration for extremely fine time steps. Legacy combined-mode inputs are still supported by the solver API, but the interface exposes separate closing/opening analyses.

## Opening angle and residual voltage

In the current-zero option, the opening angle specifies a command, not forced interruption. Commands preceding the same current zero produce the same signed trapped voltage in this ideal model. The next current zero changes polarity; the magnitude remains approximately the steady-state capacitor voltage crest. The UI reports applied command angle, bank voltage at command, actual interruption angle and delay, voltage at interruption, and residual voltage at the end of the run separately. Pending inputs are highlighted and must be applied with Run.


## Angle-controlled ideal opening (default)

Choose CB opening and At selected angle · ideal switch. The circuit disconnects exactly at the selected source phase and retains the instantaneous capacitor voltage continuously. Hold trapped charge disables the discharge resistor so the voltage remains flat; disable it to use resistor discharge. This ideal forced-switch model discards inductor current and stored magnetic energy without resolving its release or voltage impulse. It is not a physical chopping or TRV model. Use At next current zero for the previous ideal AC circuit-breaker behavior. The API retains current-zero behavior when openingRule is omitted for backward compatibility.


## Measurement cursors

Vertical and horizontal cursor pairs can be enabled independently above the waveform plot. Drag a dashed line or enter a cursor position and press Enter. Vertical cursors measure time and absolute time difference. Horizontal cursors measure current or voltage level and absolute level difference; the combined view offers an axis selector. Center in view moves the cursors into the current zoom window. Switching event markers remain fixed. Cursors are disabled by default. TypeScript and production build checks pass; browser interaction verification remains unavailable in this session.


## Opening study presets

The Study scenario dropdown is available in both modes. Opening presets include 45° opening with held charge, 90° positive-crest opening, 225° opposite-polarity opening, 45° opening with a 20 kΩ discharge resistor and 400 ms window, and an explicitly labelled next-current-zero reference case. Each loads a complete study and a short explanation; click Apply & run simulation to update results. Editing an opening input changes the selection to Custom. All five presets were simulated successfully and the TypeScript and production build checks passed.


The main Apply & run simulation button is on the right of the Study scenario preset row. Pending-input status and any validation errors appear below that row.

Waveforms appear directly under the circuit diagram, before stress metrics. Measurement cursors use an independent SVG layer with wide drag targets, coloured handles, pointer capture and keyboard arrow controls. Zoom remains available between cursors. Run `node src/cursorDrag.test.ts` for coordinate conversion and pointer lifecycle checks.
