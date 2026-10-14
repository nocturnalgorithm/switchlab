import assert from 'node:assert/strict';
import { beginCursorDrag, cursorPixel, cursorValue } from './cursorDrag.ts';

const x = {offset:62, length:800, range:[20, 40] as [number, number]};
const y = {offset:100, length:200, range:[-100, 100] as [number, number], reversed:true};
assert.equal(cursorPixel(30,x),462);
assert.equal(cursorValue(662,x),35,'Zoomed time axis maps a horizontal drag correctly');
assert.equal(cursorValue(-100,x),20,'Drag clamps to visible axis');
assert.equal(cursorPixel(50,y),150);
assert.equal(cursorValue(250,y),-50,'Vertical movement respects inverted screen Y');
assert.equal(cursorValue(cursorPixel(75,y),y),75);

class Handle extends EventTarget {
  captured: number | null = null;
  setPointerCapture(id:number){this.captured=id;}
  hasPointerCapture(id:number){return this.captured===id;}
  releasePointerCapture(id:number){if(this.captured===id)this.captured=null;}
}
function pointer(type:string,id=1,clientX=0){
  return Object.assign(new Event(type),{pointerId:id,clientX}) as PointerEvent;
}
const handle=new Handle();
const positions:number[]=[];
let cleanup=beginCursorDrag(handle as unknown as Element,pointer('pointerdown'),e=>positions.push(e.clientX));
assert.equal(handle.captured,1,'Drag captures immediately on first press');
handle.dispatchEvent(pointer('pointermove',2,10));
handle.dispatchEvent(pointer('pointermove',1,40));
handle.dispatchEvent(pointer('pointermove',1,900));
assert.deepEqual(positions,[40,900],'Captured motion continues beyond the initial line and ignores other pointers');
handle.dispatchEvent(pointer('pointerup',2));
assert.equal(handle.captured,1);
handle.dispatchEvent(pointer('pointerup'));
assert.equal(handle.captured,null);
handle.dispatchEvent(pointer('pointermove',1,1000));
assert.deepEqual(positions,[40,900],'No updates after release');
cleanup();
for(const reason of ['pointercancel','lostpointercapture']){
  cleanup=beginCursorDrag(handle as unknown as Element,pointer('pointerdown'),()=>assert.fail('Stale handler'));
  handle.dispatchEvent(pointer(reason));
  assert.equal(handle.captured,null);
  handle.dispatchEvent(pointer('pointermove'));
  cleanup();
}
cleanup=beginCursorDrag(handle as unknown as Element,pointer('pointerdown'),()=>assert.fail('Unmounted handler'));
cleanup();
handle.dispatchEvent(pointer('pointermove'));
assert.equal(handle.captured,null);
console.log('PASS cursor coordinate conversion, first-press drag, pointer capture, release, cancel and cleanup');
