import { useRef, useState, type PointerEvent } from "react";

/** Before/after slider: the result fills the frame; the original is revealed from the left up to the handle. */
export default function CompareSlider({
  before,
  after,
  alt,
}: {
  before: string;
  after: string;
  alt: string;
}) {
  const [pos, setPos] = useState(50);
  const frame = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  function update(e: PointerEvent<HTMLDivElement>) {
    const r = frame.current?.getBoundingClientRect();
    if (!r) return;
    setPos(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
  }

  return (
    <div
      ref={frame}
      className="compare"
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => dragging.current && update(e)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      role="slider"
      aria-label="Compare original and result"
      aria-valuenow={Math.round(pos)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - 5));
        if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + 5));
      }}
    >
      <img src={after} alt={alt} draggable={false} />
      <div className="compare-before" style={{ width: `${pos}%` }}>
        <img
          src={before}
          alt="Original"
          draggable={false}
          style={{ width: pos > 0 ? `${10000 / pos}%` : "100%" }}
        />
      </div>
      <div className="compare-handle" style={{ left: `${pos}%` }}>
        <span>Original</span>
        <span>AI</span>
      </div>
    </div>
  );
}
