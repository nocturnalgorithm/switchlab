import React, { useEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-basic-dist-min';
import type { SimulationResult } from './solver';
import GraphCursors from './GraphCursors';

export interface WaveformProps {
  result: SimulationResult;
  tab: 'overview' | 'current' | 'voltage' | 'breaker';
  focus: 'all' | 'close' | 'open';
  comparison?: SimulationResult | null;
  height?: number;
}

const signals = [
  { key: 'current', label: 'Breaker current', color: '#138c65', unit: 'kA', dash: 'solid' },
  { key: 'sourceVoltage', label: 'Source voltage', color: '#8191a9', unit: 'kV', dash: 'dash' },
  { key: 'capacitorVoltage', label: 'Capacitor voltage', color: '#4285e5', unit: 'kV', dash: 'solid' },
  { key: 'breakerVoltage', label: 'Across breaker', color: '#d69028', unit: 'kV', dash: 'solid' },
] as const;

/** Keep every solver sample. Plotly redraws projected line geometry on zoom;
 * a fixed, full-duration downsample hid detail even after reducing the solver step. */
function sampledIndices(result: SimulationResult): number[] {
  return Array.from({length:result.time.length},(_,i)=>i);
}

function visibleSignals(tab: WaveformProps['tab']) {
  return signals.filter(signal => tab === 'overview'
    || (tab === 'current' && signal.key === 'current')
    || (tab === 'voltage' && (signal.key === 'sourceVoltage' || signal.key === 'capacitorVoltage'))
    || (tab === 'breaker' && signal.key === 'breakerVoltage'));
}

function visibleRange(result: SimulationResult, focus: WaveformProps['focus'], comparison?: SimulationResult | null): [number, number] {
  const end = Math.max(result.time.at(-1) ?? result.params.durationMs, comparison?.time.at(-1) ?? 0);
  const period = 1000 / result.params.frequencyHz;
  if (focus === 'close') {
    const lcPeriod = 1000 / result.metrics.naturalFrequencyHz;
    const center = result.metrics.closingTimeMs;
    if (center === null || center >= end) return [0, end];
    return [Math.max(0, center - Math.min(period * 0.08, lcPeriod * 2)), Math.min(end, center + Math.min(period, Math.max(lcPeriod * 8, period * 0.2)))];
  }
  if (focus === 'open' && result.metrics.interruptionTimeMs !== null) {
    const center = result.metrics.interruptionTimeMs;
    return [Math.max(0, center - period * 0.12), Math.min(end, center + period * 0.75)];
  }
  return [0, end];
}

export default function Waveform({ result, tab, focus, comparison = null, height = 450 }: WaveformProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [plotRevision, setPlotRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(() => visibleSignals(tab), [tab]);
  const primaryIndices = useMemo(() => sampledIndices(result), [result]);
  const comparisonIndices = useMemo(() => comparison ? sampledIndices(comparison) : [], [comparison]);

  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    let disposed = false;
    const stacked = tab === 'overview';
    const range = visibleRange(result, focus, comparison);
    function focusedYRange(keys: (typeof signals[number]['key'])[]): Record<string, unknown> {
      if (focus === 'all') return {};
      let min = 0;
      let max = 0;
      for (const data of comparison ? [result, comparison] : [result]) {
        for (let i = 0; i < data.time.length; i++) {
          if (data.time[i] < range[0] || data.time[i] > range[1]) continue;
          for (const key of keys) {
            min = Math.min(min, data[key][i]);
            max = Math.max(max, data[key][i]);
          }
        }
      }
      const pad = Math.max((max - min) * 0.1, 0.01);
      return { range: [min - pad, max + pad], autorange: false };
    }
    const traces: Record<string, unknown>[] = [];
    function addTraces(data: SimulationResult, indices: number[], isComparison: boolean) {
      const x = indices.map(i => data.time[i]);
      for (const signal of selected) {
        traces.push({
          type: 'scatter',
          mode: 'lines',
          x,
          y: indices.map(i => data[signal.key][i]),
          xaxis: 'x',
          yaxis: stacked && signal.key !== 'current' ? 'y2' : 'y',
          name: `${signal.label}${isComparison ? ' · saved case' : ''}`,
          legendgroup: signal.key,
          line: { color: signal.color, width: isComparison ? 1.3 : signal.key === 'current' ? 1.7 : 1.5, dash: isComparison ? 'dot' : signal.dash, simplify: true },
          opacity: isComparison ? 0.48 : 1,
          hovertemplate: `%{y:.3f} ${signal.unit}<extra>${signal.label}${isComparison ? ' · saved case' : ''}</extra>`,
          connectgaps: false,
        });
      }
    }
    if (comparison) addTraces(comparison, comparisonIndices, true);
    addTraces(result, primaryIndices, false);
    const shapes: Record<string, unknown>[] = [];
    const annotations: Record<string, unknown>[] = [];
    for (const event of result.events) {
      
      if (event.type==='open-command' && result.params.openingRule==='command-angle') continue;
      if (event.timeMs < range[0] || event.timeMs > range[1]) continue;
      const close = event.type === 'close';
      const color = close ? '#5a789b' : '#a77c3e';
      shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: event.timeMs, x1: event.timeMs, y0: 0, y1: 1, line: { color, dash: 'dot', width: 1 }, opacity: 0.65, layer: 'above' });
      annotations.push({ xref: 'x', yref: 'paper', x: event.timeMs, y: event.type==='open-command'?1.14:1.035, text: close ? 'CLOSE' : event.type==='open-command'?'OPEN COMMAND':result.params.openingRule==='command-angle'?'OPEN':'CURRENT ZERO', showarrow: false, xanchor: 'left', yanchor: 'bottom', xshift: 5, font: { family: 'Inter, Segoe UI, sans-serif', size: 9, color } });
    }
    const axis = {
      showgrid: true,
      gridcolor: '#edf1f6',
      gridwidth: 1,
      zeroline: true,
      zerolinecolor: '#d4deea',
      zerolinewidth: 1,
      showline: false,
      fixedrange: false,
      ticks: '',
      tickfont: { size: 10, color: '#8a97aa' },
      automargin: true,
    };
    const layout: Record<string, unknown> = {
      autosize: true,
      height,
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: '#ffffff',
      margin: { l: 62, r: 25, t: 48, b: 48, pad: 0 },
      font: { family: 'Inter, Segoe UI, sans-serif', size: 11, color: '#63728b' },
      hovermode: 'x unified',
      hoversubplots: 'axis',
      hoverlabel: { bgcolor: '#ffffff', bordercolor: '#d8e1ed', font: { family: 'Inter, Segoe UI, sans-serif', size: 11, color: '#283c56' } },
      dragmode: 'zoom',
      showlegend: false,
      shapes,
      annotations,
      // Keep a user's zoom on harmless re-renders, reset for a new case or focus.
      uirevision: `${tab}:${focus}:${JSON.stringify(result.params)}:${comparison ? JSON.stringify(comparison.params) : ''}`,
      xaxis: {
        ...axis,
        range,
        anchor: stacked ? 'y2' : 'y',
        title: { text: 'Time (ms)', font: { size: 11, color: '#8390a4' }, standoff: 12 },
        ticksuffix: '',
        hoverformat: '.6f',
        showspikes: false,
        spikemode: 'across',
        spikethickness: 1,
        spikecolor: '#93a4ba',
        spikedash: 'dot',
        spikesnap: 'cursor',
      },
      yaxis: {
        ...axis,
        domain: stacked ? [0.64, 1] : [0, 1],
        title: { text: tab === 'overview' || tab === 'current' ? 'Current (kA)' : 'Voltage (kV)', font: { size: 10, color: '#8390a4' }, standoff: 12 },
        nticks: stacked ? 4 : 7,
        rangemode: 'tozero',
        ...focusedYRange(stacked ? ['current'] : selected.map(signal => signal.key)),
      },
      ...(stacked ? {
        yaxis2: {
          ...axis,
          domain: [0, 0.46],
          anchor: 'x',
          title: { text: 'Voltage (kV)', font: { size: 10, color: '#8390a4' }, standoff: 12 },
          nticks: 5,
          rangemode: 'tozero',
          ...focusedYRange(['sourceVoltage', 'capacitorVoltage', 'breakerVoltage']),
        },
      } : {}),
    };
    setError(null);
    Plotly.react(element, traces, layout, {
      responsive: true,
      displaylogo: false,
      displayModeBar: 'hover',
      scrollZoom: false,
      doubleClick: 'reset',
      modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d', 'toggleSpikelines'],
      toImageButtonOptions: { format: 'png', filename: 'switchlab-waveforms', width: 1600, height: 900, scale: 1.5 },
    }).then(() => {
      if (!disposed) setPlotRevision(revision => revision + 1);
    }).catch(() => {
      if (!disposed) setError('The waveform chart could not be displayed. Run the simulation again to retry.');
    });
    return () => { disposed = true; };
  }, [result, tab, focus, comparison, height, selected, primaryIndices, comparisonIndices]);

  useEffect(() => {
    const frame = frameRef.current;
    const element = plotRef.current;
    if (!frame || !element) return;
    let animation = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(animation);
      animation = requestAnimationFrame(() => {
        try {
          Promise.resolve(Plotly.Plots.resize(element)).catch(() => { /* Layout may be initializing. */ });
        } catch { /* A remount may be purging the previous graph. */ }
      });
    });
    observer.observe(frame);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(animation);
      Plotly.purge(element);
    };
  }, []);

  return <div ref={frameRef} className="waveform-component" style={{ minWidth: 0, width: '100%' }}>
    <GraphCursors plotRef={plotRef} revision={plotRevision} result={result} tab={tab}/>
    <div className="waveform-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 20px', alignItems: 'center', padding: '4px 24px 8px', fontSize: 11, color: '#66758b' }}>
      {selected.map(signal => <span key={signal.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
        <span aria-hidden="true" style={{ width: 18, height: 0, borderTop: `2px ${signal.dash === 'dash' ? 'dashed' : 'solid'} ${signal.color}` }} />
        {signal.label}
      </span>)}
      {comparison && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><span aria-hidden="true" style={{ width: 18, height: 0, borderTop: '2px dotted #9daabd' }} />Saved case overlay</span>}
    </div>
    {error && <div role="alert" style={{ padding: '18px 24px', color: '#a64034', fontSize: 12 }}>{error}</div>}
    <div ref={plotRef} role="region" aria-label="Interactive switching waveforms. Drag to zoom, use the toolbar to pan, and double-click to reset." style={{ width: '100%', height, position: 'relative' }} />
  </div>;
}
