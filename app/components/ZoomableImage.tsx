'use client';

/* oxlint-disable nextjs/no-img-element -- Paper figures are original static assets shared by the thumbnail and full-resolution preview. */
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut } from 'lucide-react';

const subscribeToHydration = () => () => {};

type ZoomableImageProps = {
  src: string;
  alt: string;
  label: string;
  width: number;
  height: number;
  priority?: boolean;
  onLoad?: () => void;
  onOpenChange?: (open: boolean) => void;
  onKeyboardFocus?: () => void;
};

export default function ZoomableImage({ src, alt, label, width, height, priority = false, onLoad, onOpenChange, onKeyboardFocus }: ZoomableImageProps) {
  const dialogId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [zoomed, setZoomed] = useState(false);
  const mounted = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const zoomLabel = zoomed ? 'Fit image to window' : 'Zoom to original size';

  useEffect(() => {
    // A cached or server-rendered image can finish before React attaches onLoad.
    if (imageRef.current?.complete && imageRef.current.naturalWidth > 0) onLoad?.();
  }, [src, onLoad]);

  function open() {
    if (!dialogRef.current) return;
    dialogRef.current.showModal();
    onOpenChange?.(true);
    closeRef.current?.focus({ preventScroll: true });
    viewportRef.current?.scrollTo(0, 0);
  }

  function close() {
    dialogRef.current?.close();
  }

  function toggleZoom() {
    setZoomed((value) => !value);
    viewportRef.current?.scrollTo(0, 0);
  }

  return (
    <>
      <button ref={triggerRef} type="button" className="figure-zoom-trigger" aria-haspopup="dialog"
        onFocus={(event) => { if (event.target.matches(':focus-visible')) onKeyboardFocus?.(); }}
        aria-controls={dialogId} aria-label={`Enlarge: ${label}`} onClick={open}>
        <img ref={imageRef} src={src} alt={alt} width={width} height={height}
          onLoad={onLoad}
          loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} />
      </button>
      {mounted && createPortal(<dialog ref={dialogRef} id={dialogId} className="figure-lightbox" aria-label={label}
        onClose={() => {
          onOpenChange?.(false);
          setZoomed(false);
          triggerRef.current?.focus({ preventScroll: true });
        }}>
        <button type="button" className="lightbox-dismiss" tabIndex={-1} aria-label="Close image preview" onClick={close} />
        <div className="lightbox-panel">
          <div className="lightbox-toolbar">
            <span>{label}</span>
            <div className="lightbox-controls">
              <button type="button" aria-label={zoomLabel} title={zoomLabel} aria-pressed={zoomed} onClick={toggleZoom}>
                {zoomed ? <ZoomOut aria-hidden="true" /> : <ZoomIn aria-hidden="true" />}
              </button>
              <button ref={closeRef} type="button" aria-label="Close image preview" title="Close (Esc)" onClick={close}>
                <X aria-hidden="true" />
              </button>
            </div>
          </div>
          <div ref={viewportRef} className="lightbox-viewport">
            <button type="button" className={`lightbox-image-button${zoomed ? ' is-zoomed' : ''}`}
              style={{ width: zoomed ? width : '100%' }} aria-label={zoomLabel} aria-pressed={zoomed} onClick={toggleZoom}>
              <img src={src} alt={alt} width={width} height={height} loading="lazy" draggable={false} />
            </button>
          </div>
        </div>
      </dialog>, document.body)}
    </>
  );
}
