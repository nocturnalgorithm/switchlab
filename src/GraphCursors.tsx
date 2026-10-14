import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { beginCursorDrag, cursorPixel, cursorValue, type CursorScale } from './cursorDrag';
import type { SimulationResult } from './solver';

type Pair = [number, number];
type Axis = { range: [number, number]; _offset: number; _length: number };
type Geometry = { x: CursorScale; y: CursorScale; top: number; height: number }; 
type Graph = HTMLDivElement & {
  _fullLayout?: { xaxis: Axis; yaxis: Axis; yaxis2?: Axis; _size: { t: number; h: number } };
  layout?: { xaxis?: { range?: number[] }; yaxis?: { range?: number[] }; yaxis2?: { range?: number[] } };
  on?: (event: string, callback: (update: Record<string, unknown>) => void) => void;
  removeListener?: (event: string, callback: (update: Record<string, unknown>) => void) => void;
};
interface Props {
  plotRef: React.RefObject<HTMLDivElement | null>;
  revision: number;
  result: SimulationResult;
  tab: 'overview' | 'current' | 'voltage' | 'breaker';
}
const COLORS = ['#9655b2', '#cf6774'];
const numberText = (n: number) => Number(n.toFixed(6)).toString();
function CursorInput({label, value, unit, color, onCommit}: {label:string; value:number; unit:string; color:string; onCommit:(value:number)=>void}) {
  const [draft, setDraft] = useState(numberText(value));
  useEffect(() => { setDraft(numberText(value)); }, [value]);
  function commit() {
    const next = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(next)) onCommit(next);
    else setDraft(numberText(value));
  }
  return <label className="cursor-value"><span style={{color}}>{label}</span><input
    aria-label={`${label} cursor position in ${unit}`} title="Press Enter or leave the field to apply"
    type="number" step="any" value={draft} onChange={e=>setDraft(e.target.value)} onBlur={commit}
    onKeyDown={e=>{if(e.key==='Enter'){commit();e.currentTarget.blur();}if(e.key==='Escape'){setDraft(numberText(value));}}}/><small>{unit}</small></label>;
}
const placePair = (range?: number[]): Pair => {
  const low = range?.[0] ?? 0, high = range?.[1] ?? 1;
  return [low + (high - low) * 0.3, low + (high - low) * 0.7];
};

export default function GraphCursors({ plotRef, revision, result, tab }: Props) {
  const [vertical, setVertical] = useState(false);
  const [horizontal, setHorizontal] = useState(false);
  const [horizontalTarget, setHorizontalTarget] = useState<'current' | 'voltage'>('voltage');
  const [times, setTimes] = useState<Pair>([0, 1]);
  const [levels, setLevels] = useState<Pair>([0, 1]);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  const currentAxis = tab === 'current' || (tab === 'overview' && horizontalTarget === 'current');
  const yref = tab === 'overview' && !currentAxis ? 'y2' : 'y';
  const unit = currentAxis ? 'kA' : 'kV';

  function centerTimes() {
    const graph = plotRef.current as Graph | null;
    setTimes(placePair(graph?._fullLayout?.xaxis.range ?? graph?.layout?.xaxis?.range ?? [0, result.params.durationMs]));
  }
  function centerLevels() {
    const graph = plotRef.current as Graph | null;
    const axis = yref === 'y2' ? graph?._fullLayout?.yaxis2 : graph?._fullLayout?.yaxis;
    setLevels(placePair(axis?.range));
  }
  useEffect(() => {
    if (!revision) return;
    centerTimes();
    centerLevels();
  }, [revision, yref, currentAxis]);

  useEffect(() => {
    const graph = plotRef.current as Graph | null;
    if (!graph || !revision) return;
    const refresh = () => {
      const layout = graph._fullLayout;
      if (!layout) return;
      const y = yref === 'y2' ? layout.yaxis2 : layout.yaxis;
      if (!y) return;
      setGeometry({
        x: { offset: layout.xaxis._offset, length: layout.xaxis._length, range: [...layout.xaxis.range] },
        y: { offset: y._offset, length: y._length, range: [...y.range], reversed: true },
        top: layout._size.t, height: layout._size.h,
      });
    };
    refresh();
    graph.on?.('plotly_afterplot', refresh);
    graph.on?.('plotly_relayout', refresh);
    return () => {
      graph.removeListener?.('plotly_afterplot', refresh);
      graph.removeListener?.('plotly_relayout', refresh);
      stopDrag.current?.();
    };
  }, [revision, yref, plotRef]);

  function cursor(axis: 'x' | 'y', index: 0 | 1) {
    if (!geometry) return null;
    const scale = geometry[axis];
    const value = (axis === 'x' ? times : levels)[index];
    const pixel = cursorPixel(value, scale);
    if (!Number.isFinite(pixel) || pixel < scale.offset - 0.1 || pixel > scale.offset + scale.length + 0.1) return null;
    const label = (axis === 'x' ? 'T' : 'Y') + (index + 1);
    const commit = (next: number) => (axis === 'x' ? setTimes : setLevels)(old => index === 0 ? [next, old[1]] : [old[0], next]);
    const coordinates = axis === 'x'
      ? { x1: pixel, x2: pixel, y1: geometry.top, y2: geometry.top + geometry.height }
      : { x1: geometry.x.offset, x2: geometry.x.offset + geometry.x.length, y1: pixel, y2: pixel };
    const labelX = axis === 'x' ? pixel + 3 : geometry.x.offset + 3;
    const labelY = axis === 'x' ? geometry.top + 2 : pixel - 20;
    return <g key={label} className={'cursor-handle cursor-' + axis} role="slider" tabIndex={0}
      aria-label={label + ' ' + (axis === 'x' ? 'time cursor' : unit + ' level cursor')}
      aria-valuemin={Math.min(...scale.range)} aria-valuemax={Math.max(...scale.range)} aria-valuenow={value}
      onPointerDown={e => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        stopDrag.current?.();
        const start = axis === 'x' ? e.clientX : e.clientY;
        stopDrag.current = beginCursorDrag(e.currentTarget, e.nativeEvent, event => {
          const delta = (axis === 'x' ? event.clientX : event.clientY) - start;
          commit(cursorValue(pixel + delta, scale));
        });
      }}
      onKeyDown={e => {
        if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        const direction = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1;
        commit(value + direction * Math.abs(scale.range[1] - scale.range[0]) * (e.shiftKey ? 0.1 : 0.01));
      }}>
      <title>{label}: drag to move, or use arrow keys</title>
      <line {...coordinates} stroke="transparent" strokeWidth={18} className="cursor-hit"/>
      <line {...coordinates} stroke={COLORS[index]} strokeWidth={2} strokeDasharray={index ? '7 3 2 3' : '6 4'} pointerEvents="none"/>
      <rect x={labelX} y={labelY} width={25} height={18} rx={4} fill={COLORS[index]}/>
      <text x={labelX + 12.5} y={labelY + 12} fill="white" textAnchor="middle" fontSize={10}>{label}</text>
    </g>;
  }

  function positionInput(label: string, value: number, axis: 'x' | 'y', index: 0 | 1) {
    return <CursorInput key={label} label={label} value={value} unit={axis==='x'?'ms':unit} color={COLORS[index]}
      onCommit={next=>(axis==='x'?setTimes:setLevels)(old=>index===0?[next,old[1]]:[old[0],next])}/>;
  }

  return <div className="cursor-panel">
    {plotRef.current && geometry && createPortal(<svg className="cursor-overlay" aria-label="Draggable measurement cursors">{vertical && <>{cursor('x', 0)}{cursor('x', 1)}</>}{horizontal && <>{cursor('y', 0)}{cursor('y', 1)}</>}</svg>, plotRef.current)}
    <div className="cursor-toolbar"><span className="cursor-caption">MEASUREMENT CURSORS</span>
      <label><input type="checkbox" checked={vertical} onChange={e => { setVertical(e.target.checked); if(e.target.checked) centerTimes(); }}/>Vertical · time</label>
      <label><input type="checkbox" checked={horizontal} onChange={e => { setHorizontal(e.target.checked); if(e.target.checked) centerLevels(); }}/>Horizontal · level</label>
      {(vertical || horizontal) && <button onClick={() => { centerTimes(); centerLevels(); }}>Center in view</button>}
    </div>
    {(vertical || horizontal) && <div className="cursor-measurements">
      {vertical && <div className="cursor-row">{positionInput('T1', times[0], 'x', 0)}{positionInput('T2', times[1], 'x', 1)}<span className="cursor-delta">|Δt| = {numberText(Math.abs(times[1] - times[0]))} ms</span></div>}
      {horizontal && <div className="cursor-row">{tab === 'overview' && <select aria-label="Horizontal cursor axis" value={horizontalTarget} onChange={e => setHorizontalTarget(e.target.value as 'current' | 'voltage')}><option value="current">Current (kA)</option><option value="voltage">Voltage (kV)</option></select>}{positionInput('Y1', levels[0], 'y', 0)}{positionInput('Y2', levels[1], 'y', 1)}<span className="cursor-delta">|Δ{currentAxis ? 'I' : 'V'}| = {numberText(Math.abs(levels[1] - levels[0]))} {unit}</span></div>}
      <p>Drag a cursor line or its coloured label, or enter a position and press Enter. Drag elsewhere to zoom; use Center in view to reposition cursors after zooming.</p>
    </div>}
  </div>;
}
