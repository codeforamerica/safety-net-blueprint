import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Minimum pixel drop from the initial size (in either dimension) to consider
 * the viewport "narrow" (i.e. a Storybook mobile/tablet preset was selected).
 */
export const NARROW_DELTA = 50;

/**
 * Debounce delay (ms).  When Storybook flips between device orientations it
 * may briefly pass through the default (full) size before settling on the new
 * device size.  The debounce prevents an intermediate "wide" flash.
 */
export const DEBOUNCE_MS = 150;

// ---------------------------------------------------------------------------
// Module-level state — survives across story remounts within the same
// Storybook session so the editor stays hidden when switching stories while
// a narrow viewport is active.
// ---------------------------------------------------------------------------

let storedBaselineWidth: number | null = null;
let storedBaselineHeight: number | null = null;
let storedIsNarrow = false;
let storedShowSource = true;

/** @internal Reset stored state between tests. */
export function _resetStoredBaseline() {
  storedBaselineWidth = null;
  storedBaselineHeight = null;
  storedIsNarrow = false;
  storedShowSource = true;
}

/**
 * Whether the viewport was narrow at the time of the last unmount.
 * Used by ContractPreview to initialise `showSource` so the editor
 * doesn't flash before the ResizeObserver fires on a remount.
 */
export function isNarrowOnMount(): boolean {
  return storedIsNarrow;
}

/** Persisted editor visibility — survives story remounts. */
export function getStoredShowSource(): boolean {
  return storedShowSource;
}

export function setStoredShowSource(show: boolean): void {
  storedShowSource = show;
}

/**
 * Observes the container element via ResizeObserver.  When either its width
 * OR height shrinks more than {@link NARROW_DELTA} pixels below the initial
 * size, calls `setShowSource(false)`.  When both dimensions recover, calls
 * `setShowSource(true)`.
 *
 * The baseline is stored at module level so it persists across story
 * remounts.  This prevents the editor from flashing at 50% when switching
 * stories while a narrow viewport is selected.
 *
 * Checking both dimensions catches landscape viewports (width may stay close
 * to initial, but height drops significantly).
 *
 * Narrow transitions fire immediately so the editor never flashes at 45%.
 * Wide (recovery) transitions are debounced to prevent false "wide" flashes
 * when Storybook transitions between device orientations.
 *
 * Only fires on narrow↔wide transitions so manual show/hide still works.
 *
 * Returns `true` when the viewport is currently in a narrow/device state.
 */
export function useViewportAutoHide(
  containerRef: RefObject<HTMLElement | null>,
  setShowSource: (show: boolean) => void,
): boolean {
  const [isNarrow, setIsNarrow] = useState(storedIsNarrow);
  const wasNarrow = useRef(storedIsNarrow);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Store latest observed dimensions so the debounce callback can recompute
  const latestWidth = useRef(0);
  const latestHeight = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      const width = rect?.width ?? el.clientWidth;
      const height = rect?.height ?? el.clientHeight;

      // Capture baseline on first ever observation
      if (storedBaselineWidth === null || storedBaselineHeight === null) {
        storedBaselineWidth = width;
        storedBaselineHeight = height;
        latestWidth.current = width;
        latestHeight.current = height;
        return;
      }

      latestWidth.current = width;
      latestHeight.current = height;

      const narrow =
        width < storedBaselineWidth - NARROW_DELTA ||
        height < storedBaselineHeight - NARROW_DELTA;

      if (narrow !== wasNarrow.current) {
        // Clear any pending recovery transition
        if (timerRef.current !== null) clearTimeout(timerRef.current);

        if (narrow) {
          // Going narrow — apply immediately so the editor never flashes at 45%
          wasNarrow.current = true;
          storedIsNarrow = true;
          setIsNarrow(true);
          setShowSource(false);
        } else {
          // Going wide — debounce to prevent false flash during orientation flips
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            // Recompute from latest dimensions (not stale closure)
            const currentNarrow =
              latestWidth.current < storedBaselineWidth! - NARROW_DELTA ||
              latestHeight.current < storedBaselineHeight! - NARROW_DELTA;
            if (!currentNarrow && wasNarrow.current) {
              wasNarrow.current = false;
              storedIsNarrow = false;
              setIsNarrow(false);
              setShowSource(true);
            }
          }, DEBOUNCE_MS);
        }
      }
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [containerRef, setShowSource]);

  return isNarrow;
}
