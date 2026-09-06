import { gestureIntent, lensPosition } from './navigation-motion.ts';

type Sample = { pointerId: number; clientX: number; clientY: number };
type Start = Sample & { isPrimary: boolean; button: number };
type CaptureLoss = Sample & { target: unknown; currentTarget: unknown };
type Bounds = { left: number; width: number };

// Shared by React handlers and event-sequence tests, without a browser dependency.
export function createTabGesture() {
  let current: (Sample & Bounds & { dragging: boolean }) | null = null;
  let suppressClick = false;

  function end(event: Sample, cancelled = false) {
    if (!current || current.pointerId !== event.pointerId) return null;
    const previous = current;
    current = null; // A subsequent lostpointercapture must not commit twice.
    if (!previous.dragging) return null;
    suppressClick = true;
    return {
      index: cancelled
        ? null
        : Math.round(
            lensPosition(event.clientX, previous.left, previous.width),
          ),
    };
  }

  return {
    start(event: Start, bounds: Bounds) {
      if (!event.isPrimary || event.button !== 0) return false;
      suppressClick = false;
      current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        ...bounds,
        dragging: false,
      };
      return true;
    },
    move(event: Sample) {
      if (!current || current.pointerId !== event.pointerId) return null;
      const capture = !current.dragging;
      if (capture) {
        const intent = gestureIntent(
          event.clientX - current.clientX,
          event.clientY - current.clientY,
        );
        if (intent === 'pending') return null;
        if (intent === 'scroll') {
          current = null;
          return null;
        }
        current.dragging = true;
      }
      return {
        position: lensPosition(event.clientX, current.left, current.width),
        capture,
      };
    },
    end,
    captureLost(event: CaptureLoss) {
      // Touch initially captures the child button. Moving capture to the capsule
      // fires a BUBBLING loss event from that child, not cancellation of our drag.
      // https://www.w3.org/TR/pointerevents3/#process-pending-pointer-capture
      if (event.target !== event.currentTarget) return null;
      return end(event, true);
    },
    leave(pointerId: number) {
      if (current?.pointerId === pointerId && !current.dragging) current = null;
    },
    consumeClick(detail: number) {
      if (detail === 0 || !suppressClick) return false;
      suppressClick = false;
      return true;
    },
  };
}
