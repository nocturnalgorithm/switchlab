export type CursorScale = { offset: number; length: number; range: [number, number]; reversed?: boolean };
export function cursorPixel(value: number, scale: CursorScale): number {
  const fraction = (value - scale.range[0]) / (scale.range[1] - scale.range[0]);
  return scale.offset + scale.length * (scale.reversed ? 1 - fraction : fraction);
}
export function cursorValue(pixel: number, scale: CursorScale): number {
  const fraction = Math.max(0, Math.min(1, (pixel - scale.offset) / scale.length));
  return scale.range[0] + (scale.reversed ? 1 - fraction : fraction) * (scale.range[1] - scale.range[0]);
}

/** Pointer capture keeps dragging active when the pointer leaves the thin line. */
export function beginCursorDrag(element: Element, start: PointerEvent, move: (event: PointerEvent) => void): () => void {
  const onMove = (event: Event) => {
    const pointer = event as PointerEvent;
    if (pointer.pointerId === start.pointerId) move(pointer);
  };
  const finish = (event?: Event) => {
    if (event && (event as PointerEvent).pointerId !== start.pointerId) return;
    element.removeEventListener('pointermove', onMove);
    element.removeEventListener('pointerup', finish);
    element.removeEventListener('pointercancel', finish);
    element.removeEventListener('lostpointercapture', finish);
    if (element.hasPointerCapture(start.pointerId)) element.releasePointerCapture(start.pointerId);
  };
  element.setPointerCapture(start.pointerId);
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', finish);
  element.addEventListener('lostpointercapture', finish);
  return finish;
}
