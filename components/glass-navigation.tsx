'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { Battery, Home, Route, Settings2, Zap } from 'lucide-react';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createTabGesture } from '@/lib/tab-gesture';
const items = [
  { id: 'overview', label: '概览', icon: Home },
  { id: 'drives', label: '行程', icon: Route },
  { id: 'charges', label: '充电', icon: Zap },
  { id: 'battery', label: '电池', icon: Battery },
];
export function GlassNavigation({
  value,
  onNavigate,
  disabled = false,
}: {
  value: string;
  onNavigate: (value: string) => void;
  disabled?: boolean;
}) {
  const index = Math.max(
    0,
    items.findIndex((item) => item.id === value),
  );
  const [moving, setMoving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const previous = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [gesture] = useState(createTabGesture);
  const settle = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMoving(false), 380);
  }, []);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setMoving(value !== 'settings');
    settle();
  }, [value, settle]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function start(event: PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    gesture.start(event, {
      left: bounds.left + 6,
      width: bounds.width - 12,
    });
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const update = gesture.move(event);
    if (!update) return;
    if (update.capture) event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    if (timer.current) clearTimeout(timer.current);
    setDragIndex(update.position);
    setMoving(true);
  }
  function finish(
    event: PointerEvent<HTMLDivElement>,
    result: { index: number | null } | null,
  ) {
    if (!result) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setDragIndex(null);
    if (result.index === null) {
      setMoving(false);
      return;
    }
    const destination = result.index;
    onNavigate(items[destination].id);
    if (event.pointerType !== 'touch')
      buttons.current[destination]?.focus({ preventScroll: true });
    settle();
  }
  return (
    <TabsList className="glass-nav" aria-label="主要导航">
      <div
        className="glass-nav-capsule"
        data-dragging={dragIndex !== null}
        style={{ '--active-index': dragIndex ?? index } as CSSProperties}
        onPointerDownCapture={start}
        onPointerMoveCapture={move}
        onPointerUpCapture={(event) => finish(event, gesture.end(event))}
        onPointerCancelCapture={(event) =>
          finish(event, gesture.end(event, true))
        }
        onLostPointerCapture={(event) =>
          finish(event, gesture.captureLost(event))
        }
        onPointerLeave={(event) => gesture.leave(event.pointerId)}
        onClickCapture={(event) => {
          if (gesture.consumeClick(event.detail)) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <span
          className="glass-nav-lens"
          data-visible={
            !disabled && moving && (dragIndex !== null || value !== 'settings')
          }
          aria-hidden="true"
        />
        {items.map((item, i) => (
          <TabsTrigger
            key={item.id}
            value={item.id}
            className="glass-nav-tab"
            data-drag-over={dragIndex !== null && Math.round(dragIndex) === i}
            disabled={disabled}
            ref={(element) => {
              buttons.current[i] = element;
            }}
          >
            <item.icon strokeWidth={1.8} />
            <span>{item.label}</span>
          </TabsTrigger>
        ))}
      </div>
      <TabsTrigger
        value="settings"
        className="glass-nav-utility"
        aria-label="设置"
        title="设置"
      >
        <Settings2 strokeWidth={1.8} />
      </TabsTrigger>
    </TabsList>
  );
}
