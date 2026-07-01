import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";

/**
 * Magnifier / loupe. While a polygon point is being placed (press-hold) or dragged,
 * the tool sets `item.loupePoint` (internal 0-100 coords) and this overlay renders a
 * zoomed, pixel-crisp preview of the image just above the touch/cursor so the point
 * can be positioned precisely — the finger/cursor itself no longer hides the target.
 *
 * Works for mouse, pen and touch: it is driven purely by `item.loupePoint`, which the
 * Polygon tool (press-hold placement) and PolygonPoint (drag) set/clear.
 *
 * The magnified content is drawn from a browser-cached copy of the source image at its
 * native resolution (not the on-screen canvas), so pixels stay crisp regardless of the
 * current zoom. We only `drawImage` it (never read pixels back), so a cross-origin
 * image tainting the canvas is harmless.
 */
const LOUPE_SIZE = 132; // diameter in CSS px
const LOUPE_SRC_PX = 32; // native image pixels shown across the loupe (=> ~4x magnification)
const GAP = 28; // px gap between the point and the loupe, so a fingertip clears it

export const Loupe = observer(({ item }) => {
  const canvasRef = useRef(null);
  const [img, setImg] = useState(null);

  const src = item.currentImageEntity?.currentSrc || item.currentSrc;
  const crossOrigin = item.imageCrossOrigin;

  // Eagerly load a (browser-cached) copy of the source image to magnify.
  useEffect(() => {
    if (!src) {
      setImg(null);
      return;
    }
    let cancelled = false;
    const image = new window.Image();

    if (crossOrigin) image.crossOrigin = crossOrigin;
    image.onload = () => {
      if (!cancelled) setImg(image);
    };
    image.onerror = () => {
      if (!cancelled) setImg(null);
    };
    image.src = src;

    return () => {
      cancelled = true;
    };
  }, [src, crossOrigin]);

  const lp = item.loupePoint;
  const active = !!lp && !!item.stageRef && !!item.currentImageEntity;

  // Geometry: where the point is on screen (to position the loupe) and where it is in
  // image pixels (to crop the magnified source). Computed each render; cheap.
  let style = null;
  let imgX = null;
  let imgY = null;

  if (active) {
    const rect = item.stageRef.container().getBoundingClientRect();
    const [sx, sy] = item.zoomOriginalCoords([item.internalToCanvasX(lp.x), item.internalToCanvasY(lp.y)]);

    imgX = item.internalToImageX(lp.x);
    imgY = item.internalToImageY(lp.y);

    // Page coords of the point (loupe uses fixed positioning to avoid parent-offset math).
    const px = rect.left + sx;
    const py = rect.top + sy;

    // Prefer above the point; flip below if there isn't room.
    let top = py - GAP - LOUPE_SIZE;

    if (top < rect.top + 4) top = py + GAP;
    // Center horizontally on the point, clamped to the image container.
    let left = px - LOUPE_SIZE / 2;

    left = Math.max(rect.left + 4, Math.min(left, rect.right - LOUPE_SIZE - 4));

    style = {
      position: "fixed",
      left,
      top,
      width: LOUPE_SIZE,
      height: LOUPE_SIZE,
      borderRadius: "50%",
      boxShadow: "0 2px 12px rgba(0,0,0,0.45)",
      zIndex: 9999,
      pointerEvents: "none",
    };
  }

  useEffect(() => {
    if (!active || !img || !canvasRef.current || imgX == null) return;

    const dpr = window.devicePixelRatio || 1;
    const canvas = canvasRef.current;

    canvas.width = LOUPE_SIZE * dpr;
    canvas.height = LOUPE_SIZE * dpr;

    const ctx = canvas.getContext("2d");

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);

    const c = LOUPE_SIZE / 2;
    const mag = LOUPE_SIZE / LOUPE_SRC_PX;
    const half = LOUPE_SRC_PX / 2;

    // Magnified crop, clipped to a circle.
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
    ctx.imageSmoothingEnabled = false; // crisp, square pixels
    ctx.drawImage(img, imgX - half, imgY - half, LOUPE_SRC_PX, LOUPE_SRC_PX, 0, 0, LOUPE_SIZE, LOUPE_SIZE);
    ctx.restore();

    // Exact target-pixel box.
    ctx.strokeStyle = "rgba(255,64,64,0.95)";
    ctx.lineWidth = 1;
    ctx.strokeRect(c - mag / 2, c - mag / 2, mag, mag);

    // Crosshair (leaves a gap around the target pixel).
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(c - 14, c);
    ctx.lineTo(c - mag / 2 - 1, c);
    ctx.moveTo(c + mag / 2 + 1, c);
    ctx.lineTo(c + 14, c);
    ctx.moveTo(c, c - 14);
    ctx.lineTo(c, c - mag / 2 - 1);
    ctx.moveTo(c, c + mag / 2 + 1);
    ctx.lineTo(c, c + 14);
    ctx.stroke();

    // Circular rim.
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c, c, c - 1, 0, Math.PI * 2);
    ctx.stroke();
  }, [active, img, imgX, imgY]);

  if (!active || !img) return null;

  return <canvas ref={canvasRef} style={style} width={LOUPE_SIZE} height={LOUPE_SIZE} />;
});
