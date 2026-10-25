import { describe, expect, it } from 'vitest';
import { clearImageSelection, guardShelfDocumentSelection, ImageDragGesture, preventImageBrowserDrag } from './imageDrag';
import { ShelfPointerHold } from './shelfMotionControl';

const point = (pointerId: number, clientX: number, clientY: number, buttons = 1) => ({ pointerId, clientX, clientY, buttons });
function captureTarget(onRelease = (_id: number) => {}) {
  const captures = new Set<number>();
  return { captures, setPointerCapture: (id: number) => { captures.add(id); }, hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: (id: number) => { captures.delete(id); onRelease(id); } };
}

describe('shared image-to-native drag gesture', () => {
  it('captures on down and commits a fast first move outside the source exactly once', () => {
    const gesture = new ImageDragGesture(), target = captureTarget();
    gesture.begin('photo-from-library', point(3, 25, 35), target);
    expect(target.hasPointerCapture(3)).toBe(true);
    // No intermediate hover or in-bounds move is required.
    expect(gesture.commitMove(point(3, 920, 700))).toBe('photo-from-library');
    expect(gesture.commitMove(point(3, 960, 800))).toBeNull();
    gesture.releaseCapture();
    expect(target.captures.size).toBe(0);
  });
  it('does not let jitter, a different pointer, or a released button start a drag', () => {
    const gesture = new ImageDragGesture();
    gesture.begin('held', point(3, 20, 20), captureTarget());
    expect(gesture.commitMove(point(3, 22, 22))).toBeNull();
    expect(gesture.commitMove(point(4, 100, 100))).toBeNull();
    expect(gesture.commitMove(point(3, 100, 100, 0))).toBeNull();
    expect(gesture.active).toBe(true);
    expect(gesture.commitMove(point(3, 25, 20))).toBe('held');
  });
  it('locks the source before synchronous capture loss and releases before native dispatch', () => {
    const gesture = new ImageDragGesture();
    const events: string[] = [];
    const target = captureTarget(id => { events.push('capture-released'); gesture.cancel(id, 'held'); });
    gesture.begin('held', point(2, 0, 0), target);
    const id = gesture.commitMove(point(2, 40, 20));
    expect(gesture.active).toBe(false);
    gesture.releaseCapture();
    events.push(`native:${id}:captured=${target.hasPointerCapture(2)}`);
    expect(events).toEqual(['capture-released', 'native:held:captured=false']);
  });
  it('hands off once when App and the moving card share capture and loss calls onEnd synchronously', () => {
    const appGesture = new ImageDragGesture(), cardHold = new ShelfPointerHold();
    const delivered: string[] = [];
    let longPressPending = true, onEndCalls = 0;
    const target = captureTarget(pointerId => {
      if (cardHold.release(pointerId)) {
        onEndCalls++;
        // HangingCard's onEnd is scoped to its source. App already committed it.
        if (appGesture.cancel(undefined, 'moving-photo')) longPressPending = false;
      }
    });
    cardHold.begin(4, 12, 20, target);
    appGesture.begin('moving-photo', point(4, 12, 20), target);
    const id = appGesture.commitMove(point(4, 700, 500));
    if (id) {
      longPressPending = false;
      appGesture.releaseCapture(); // synchronously releases cardHold and calls onEnd
      cardHold.release(4); // subsequent beforeNativeDrag callback is idempotent
      expect(target.hasPointerCapture(4)).toBe(false);
      delivered.push(id);
    }
    const repeated = appGesture.commitMove(point(4, 720, 510));
    if (repeated) delivered.push(repeated);
    expect(delivered).toEqual(['moving-photo']);
    expect(onEndCalls).toBe(1);
    expect(longPressPending).toBe(false);
    expect(cardHold.active).toBe(false);
    expect(appGesture.active).toBe(false);
    expect(appGesture.captured).toBe(false);
  });
  it('cancels on blur/cancel and rejects stale loss from a previous image', () => {
    const gesture = new ImageDragGesture(), target = captureTarget();
    gesture.begin('old', point(1, 0, 0), target);
    expect(gesture.cancel()).toBe(true);
    expect(gesture.commitMove(point(1, 100, 100))).toBeNull();
    gesture.begin('new', point(1, 5, 5), target);
    expect(gesture.cancel(1, 'old')).toBe(false);
    expect(gesture.cancel(2, 'new')).toBe(false);
    expect(gesture.commitMove(point(1, 11, 5))).toBe('new');
  });
});

function textNode(editable = false) {
  const element = { nodeType: 1, closest: () => editable ? element : null };
  return { nodeType: 3, parentElement: element } as unknown as Node;
}

describe('photo selection and browser drag ownership', () => {
  it('clears the old multi-photo blue selection only when both endpoints belong to the image area', () => {
    const first = textNode(), last = textNode(), outside = textNode();
    const nodes = new Set([first, last]);
    const surface = { contains: (node: Node | null) => !!node && nodes.has(node) };
    let cleared = 0;
    const selection = { anchorNode: first, focusNode: last, removeAllRanges: () => { cleared++; } };
    clearImageSelection(surface, selection);
    expect(cleared).toBe(1);
    clearImageSelection(surface, { ...selection, focusNode: outside });
    expect(cleared).toBe(1);
  });
  it('blocks HTML photo/selection drag while preserving editable text and its selection', () => {
    const photoText = textNode(), editableText = textNode(true);
    let blocked = 0, cleared = 0;
    preventImageBrowserDrag({ target: photoText, preventDefault: () => { blocked++; } });
    preventImageBrowserDrag({ target: editableText, preventDefault: () => { blocked++; } });
    expect(blocked).toBe(1);
    clearImageSelection({ contains: () => true }, { anchorNode: editableText, focusNode: editableText, removeAllRanges: () => { cleared++; } });
    expect(cleared).toBe(0);
  });
});

describe('dedicated shelf document selection', () => {
  const documentNode = { nodeType: 9, parentElement: null } as unknown as Document;
  const bodyNode = { nodeType: 1, closest: () => null } as unknown as Element;
  it('blocks Ctrl+A with Document focus and clears an existing body-owned range', () => {
    let prevented = 0, cleared = 0;
    const selection = { anchorNode: bodyNode, focusNode: bodyNode, removeAllRanges: () => { cleared++; } };
    guardShelfDocumentSelection({ type: 'keydown', target: documentNode, key: 'a', ctrlKey: true, preventDefault: () => { prevented++; } }, selection, bodyNode);
    expect(prevented).toBe(1);
    expect(cleared).toBe(1);
  });
  it('clears a lingering body range on non-editable pointerdown without cancelling the pointer action', () => {
    let prevented = 0, cleared = 0;
    guardShelfDocumentSelection({ type: 'pointerdown', target: textNode(), preventDefault: () => { prevented++; } }, { anchorNode: bodyNode, focusNode: bodyNode, removeAllRanges: () => { cleared++; } }, bodyNode);
    expect(cleared).toBe(1);
    expect(prevented).toBe(0);
  });
  it('preserves editable targets, focused editors, editable ranges and unrelated shortcuts', () => {
    const editorText = textNode(true), editor = editorText.parentElement;
    let changed = 0;
    const selection = { anchorNode: bodyNode, focusNode: bodyNode, removeAllRanges: () => { changed++; } };
    const shortcut = { type: 'keydown', target: documentNode, key: 'a', ctrlKey: true, preventDefault: () => { changed++; } };
    guardShelfDocumentSelection({ ...shortcut, target: editorText }, selection, bodyNode);
    guardShelfDocumentSelection(shortcut, selection, editor);
    guardShelfDocumentSelection({ ...shortcut, key: 'c' }, selection, bodyNode);
    guardShelfDocumentSelection({ ...shortcut, ctrlKey: false }, selection, bodyNode);
    guardShelfDocumentSelection({ ...shortcut, altKey: true }, selection, bodyNode);
    guardShelfDocumentSelection({ type: 'pointerdown', target: editorText, preventDefault: () => { changed++; } }, selection, editor);
    guardShelfDocumentSelection({ type: 'pointerdown', target: bodyNode, preventDefault: () => { changed++; } }, { ...selection, anchorNode: editorText, focusNode: editorText }, bodyNode);
    expect(changed).toBe(0);
  });
});
