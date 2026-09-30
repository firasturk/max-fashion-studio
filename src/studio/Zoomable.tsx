import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Maximize2, X, ZoomIn } from "lucide-react";

/**
 * Image with a hover loupe (2.5x) and a full-screen viewer. In the viewer a click toggles
 * between fit-to-screen and 1:1 pixels; at 1:1 the image scrolls.
 */
export default function Zoomable({
  src,
  alt,
  overlay,
}: {
  src: string;
  alt: string;
  overlay?: React.ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [loupe, setLoupe] = useState<{ x: number; y: number; bx: number; by: number } | null>(null);
  const [full, setFull] = useState(false);
  const [actual, setActual] = useState(false);
  const ZOOM = 2.5;
  const SIZE = 180;

  function move(e: MouseEvent<HTMLDivElement>) {
    const img = frame.current?.querySelector("img");
    if (!img) return;
    const r = img.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) return setLoupe(null);
    setLoupe({ x, y, bx: (x / r.width) * 100, by: (y / r.height) * 100 });
  }

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  return (
    <>
      <div
        ref={frame}
        className="zoomable"
        onMouseMove={move}
        onMouseLeave={() => setLoupe(null)}
        onClick={() => setFull(true)}
        role="button"
        aria-label="Open full size"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setFull(true)}
      >
        <img src={src} alt={alt} draggable={false} />
        {overlay}
        {loupe && (
          <div
            className="loupe"
            style={{
              left: loupe.x - SIZE / 2,
              top: loupe.y - SIZE / 2,
              width: SIZE,
              height: SIZE,
              backgroundImage: `url("${src}")`,
              backgroundSize: `${ZOOM * 100}%`,
              backgroundPosition: `${loupe.bx}% ${loupe.by}%`,
            }}
          />
        )}
        <span className="zoom-hint">
          <ZoomIn size={14} /> Hover to magnify · click for full size
        </span>
      </div>
      {full && (
        <div className="lightbox" onClick={() => setFull(false)}>
          <button className="lightbox-close" aria-label="Close" onClick={() => setFull(false)}>
            <X size={20} />
          </button>
          <button
            className="lightbox-toggle"
            onClick={(e) => {
              e.stopPropagation();
              setActual((a) => !a);
            }}
          >
            <Maximize2 size={15} /> {actual ? "Fit to screen" : "Actual pixels (1:1)"}
          </button>
          <div
            className={`lightbox-scroll ${actual ? "actual" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <img src={src} alt={alt} onClick={() => setActual((a) => !a)} />
          </div>
        </div>
      )}
    </>
  );
}
