'use client';

/* oxlint-disable nextjs/no-img-element -- Original paper figures are shared with the full-resolution lightbox. */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, FocusEvent, KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import ZoomableImage from './ZoomableImage';

const slides = [
  {
    label: 'Comparison',
    src: 'paper-figures/fig_qualitative_paired.png',
    width: 4200,
    height: 2384,
    title: '3DCodeBench vs. TreeStruct3D',
    description: 'Each pair compares the two methods before and after parent and child edits.',
    alt: 'Selected 3DCodeBench and TreeStruct3D outputs across four models, compared at default scale and after parent and child rescaling.',
  },
  ...[
    ['GPT-5.5', 'appendix-figure-6a-gpt-5-5.png'],
    ['GPT-5.6 Sol', 'appendix-figure-6b-gpt-5-6-sol.png'],
    ['Gemini 3.1 Pro', 'appendix-figure-6c-gemini-3-1-pro.png'],
    ['Gemini 3.5 Flash', 'appendix-figure-6d-gemini-3-5-flash.png'],
  ].map(([label, filename]) => ({
    label,
    src: `paper-figures/${filename}`,
    width: 4560,
    height: 2728,
    title: `${label} examples`,
    description: 'Four TreeStruct3D cases before and after independent parent and child edits.',
    alt: `Four TreeStruct3D examples generated with ${label}, showing the default model and parent and child edits at 0.4 and 1.6 times their original size.`,
  })),
];

export default function FigureCarousel() {
  const stageId = useId();
  const rootRef = useRef<HTMLElement>(null);
  // Keep turns unbounded so the last-to-first transition continues around the ring.
  const [position, setPosition] = useState(0);
  const active = ((position % slides.length) + slides.length) % slides.length;
  const [loaded, setLoaded] = useState<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const slide = slides[active];
  const markLoaded = useCallback(() => setLoaded(active), [active]);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const respectMotion = () => { if (motion.matches) setPlaying(false); };
    const updateVisibility = () => setPageVisible(!document.hidden);
    respectMotion();
    updateVisibility();
    motion.addEventListener('change', respectMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    const observer = new IntersectionObserver(([entry]) => {
      setInView(entry.isIntersecting && entry.intersectionRatio >= 0.15);
    }, { threshold: [0, 0.15] });
    if (rootRef.current) observer.observe(rootRef.current);
    return () => {
      observer.disconnect();
      motion.removeEventListener('change', respectMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (!playing || hovered || previewOpen || !inView || !pageVisible || loaded !== active) return;
    const timer = window.setTimeout(() => setPosition((value) => value + 1), 5000);
    return () => window.clearTimeout(timer);
  }, [active, loaded, playing, hovered, previewOpen, inView, pageVisible]);

  // Fetch the next original while the current figure is being read.
  useEffect(() => {
    if (!inView) return;
    const next = new Image();
    next.src = slides[(active + 1) % slides.length].src;
  }, [active, inView]);

  function move(offset: number) {
    setPosition((value) => value + offset);
  }

  function choose(index: number) {
    const forward = (index - active + slides.length) % slides.length;
    move(forward > slides.length / 2 ? forward - slides.length : forward);
  }

  function navigateWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      setPlaying(false);
      move(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  function pauseForKeyboard(event: FocusEvent<HTMLButtonElement>) {
    if (event.target.matches(':focus-visible')) setPlaying(false);
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Hover only pauses rotation; keyboard navigation and pause controls are buttons.
    <figure ref={rootRef} className="paper-figure figure-carousel" aria-label="Controlled editing examples"
      aria-roledescription="carousel"
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div id={stageId} className="carousel-stage">
        <div className="carousel-perspective">
          <div className="carousel-ring" style={{ '--carousel-turn': `${position * -360 / slides.length}deg` } as CSSProperties}>
            {slides.map((item, index) => (
              <div key={item.src} className={`carousel-card${index === active ? ' is-active' : ''}`}
                style={{ '--card-angle': `${index * 360 / slides.length}deg` } as CSSProperties}
                aria-hidden={index !== active}>
                {index === active ? (
                  <ZoomableImage {...item} label={item.title} onLoad={markLoaded}
                    onOpenChange={setPreviewOpen} onKeyboardFocus={() => setPlaying(false)} />
                ) : (
                  <button type="button" className="carousel-side-image" tabIndex={-1}
                    aria-label={`Show ${item.label}`} onClick={() => choose(index)}>
                    <img src={item.src} alt={item.alt} width={item.width} height={item.height}
                      loading={inView ? 'eager' : 'lazy'} decoding="async" draggable={false} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        <button type="button" className="carousel-arrow carousel-arrow-prev" aria-label="Previous figure"
          title="Previous figure" aria-controls={stageId} onFocus={pauseForKeyboard} onKeyDown={navigateWithKeyboard} onClick={() => move(-1)}>
          <ChevronLeft aria-hidden="true" />
        </button>
        <button type="button" className="carousel-arrow carousel-arrow-next" aria-label="Next figure"
          title="Next figure" aria-controls={stageId} onFocus={pauseForKeyboard} onKeyDown={navigateWithKeyboard} onClick={() => move(1)}>
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
      <div className="carousel-footer">
        <fieldset className="carousel-dots" aria-label="Choose a figure">
          {slides.map((item, index) => (
            <button key={item.src} type="button" className="carousel-dot" aria-pressed={index === active}
              aria-label={`Show ${item.label}`} title={item.label} aria-controls={stageId}
              onFocus={pauseForKeyboard} onKeyDown={navigateWithKeyboard} onClick={() => choose(index)}><span /></button>
          ))}
        </fieldset>
        <div className="carousel-playback">
          <span className="carousel-position" aria-live={playing ? 'off' : 'polite'}>{active + 1} / {slides.length}</span>
          <button type="button" aria-label={playing ? 'Pause slideshow' : 'Play slideshow'}
            title={playing ? 'Pause slideshow' : 'Play slideshow · every 5 seconds'} onFocus={pauseForKeyboard} onKeyDown={navigateWithKeyboard} onClick={() => setPlaying((value) => !value)}>
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </button>
        </div>
      </div>
      <figcaption>
        <span className="carousel-caption"><strong>{slide.title}.</strong> {slide.description}</span>
        The 0.4× and 1.6× edits exaggerate changes for visibility; quantitative tests use 0.8× and 1.2×.
        These selected examples illustrate the behavior and are not aggregate results.
      </figcaption>
    </figure>
  );
}
