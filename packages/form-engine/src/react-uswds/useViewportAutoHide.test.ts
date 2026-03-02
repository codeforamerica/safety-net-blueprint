// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useViewportAutoHide,
  isNarrowOnMount,
  getStoredShowSource,
  setStoredShowSource,
  _resetStoredBaseline,
  NARROW_DELTA,
  DEBOUNCE_MS,
} from './useViewportAutoHide';
import type { RefObject } from 'react';

// ---------------------------------------------------------------------------
// ResizeObserver mock
// ---------------------------------------------------------------------------

type ROEntry = { contentRect: { width: number; height: number } };
type ROCallback = (entries: ROEntry[]) => void;

let roCallback: ROCallback | null = null;
const observeMock = vi.fn();
const disconnectMock = vi.fn();

class MockResizeObserver {
  constructor(cb: ROCallback) {
    roCallback = cb;
  }
  observe = observeMock;
  disconnect = disconnectMock;
  unobserve = vi.fn();
}

beforeEach(() => {
  vi.useFakeTimers();
  roCallback = null;
  observeMock.mockClear();
  disconnectMock.mockClear();
  _resetStoredBaseline();
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  vi.useRealTimers();
});

/** Simulate a ResizeObserver callback with the given dimensions. */
function fireResize(width: number, height: number) {
  act(() => { roCallback?.([{ contentRect: { width, height } }]); });
}

/** Advance past the debounce window so pending recovery transitions fire. */
function flush() {
  act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 1); });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useViewportAutoHide', () => {
  let setShowSource: ReturnType<typeof vi.fn<(show: boolean) => void>>;
  let containerRef: RefObject<HTMLDivElement>;
  let el: HTMLDivElement;

  beforeEach(() => {
    setShowSource = vi.fn<(show: boolean) => void>();
    el = document.createElement('div');
    document.body.appendChild(el);
    containerRef = { current: el };
  });

  afterEach(() => {
    document.body.removeChild(el);
    vi.restoreAllMocks();
  });

  // ── Setup ──────────────────────────────────────────────────────────────

  it('observes the container element', () => {
    renderHook(() => useViewportAutoHide(containerRef, setShowSource));
    expect(observeMock).toHaveBeenCalledWith(el);
  });

  it('does not call setShowSource on first observation (captures baseline)', () => {
    renderHook(() => useViewportAutoHide(containerRef, setShowSource));
    fireResize(1200, 800);
    flush();
    expect(setShowSource).not.toHaveBeenCalled();
  });

  // ── Narrow transitions (immediate, no debounce) ───────────────────────

  it('hides immediately when width shrinks below the delta threshold', () => {
    renderHook(() => useViewportAutoHide(containerRef, setShowSource));
    fireResize(1200, 800);
    fireResize(375, 800);
    // No flush needed — narrow transitions are immediate
    expect(setShowSource).toHaveBeenCalledWith(false);
  });

  it('hides immediately when height shrinks below the delta threshold', () => {
    renderHook(() => useViewportAutoHide(containerRef, setShowSource));
    fireResize(1200, 800);
    fireResize(1180, 375);
    expect(setShowSource).toHaveBeenCalledWith(false);
  });

  it('hides immediately when both dimensions shrink', () => {
    renderHook(() => useViewportAutoHide(containerRef, setShowSource));
    fireResize(1200, 800);
    fireResize(375, 667);
    expect(setShowSource).toHaveBeenCalledWith(false);
  });

  it('sets isNarrow to true immediately (not after debounce)', () => {
    const { result } = renderHook(() => useViewportAutoHide(containerRef, setShowSource));
    fireResize(1200, 800);
    fireResize(375, 667);
    // isNarrow is true before any debounce flush
    expect(result.current).toBe(true);
  });

  it('does not hide for small width fluctuations', () => {
    renderHook(() => useViewportAutoHide(containerRef, setShowSource));
    fireResize(1200, 800);
    fireResize(1200 - NARROW_DELTA + 1, 800);
    flush();
    expect(setShowSource).not.toHaveBeenCalled();
  });

  it('does not hide for small height fluctuations', () => {
    renderHook(() => useViewportAutoHide(containerRef, setShowSource));
    fireResize(1200, 800);
    fireResize(1200, 800 - NARROW_DELTA + 1);
    flush();
    expect(setShowSource).not.toHaveBeenCalled();
  });

  // ── Recovery (debounced) ──────────────────────────────────────────────

  it('shows when dimensions reset back to original size', () => {
    renderHook(() => useViewportAutoHide(containerRef, setShowSource));
    fireResize(1200, 800);
    fireResize(375, 667);
    setShowSource.mockClear();

    fireResize(1200, 800);
    flush();
    expect(setShowSource).toHaveBeenCalledWith(true);
  });

  it('shows when recovering from landscape (height restores)', () => {
    renderHook(() => useViewportAutoHide(containerRef, setShowSource));
    fireResize(1200, 800);
    fireResize(1180, 375);
    setShowSource.mockClear();

    fireResize(1200, 800);
    flush();
    expect(setShowSource).toHaveBeenCalledWith(true);
  });

  // ── Transition-only firing ─────────────────────────────────────────────

  it('only fires on transitions, not repeated observations at the same state', () => {
    renderHook(() => useViewportAutoHide(containerRef, setShowSource));
    fireResize(1200, 800);
    fireResize(375, 667);
    expect(setShowSource).toHaveBeenCalledTimes(1);

    fireResize(320, 568);
    flush();
    expect(setShowSource).toHaveBeenCalledTimes(1);
  });

  it('allows manual toggle between transitions (no interference)', () => {
    renderHook(() => useViewportAutoHide(containerRef, setShowSource));
    fireResize(1200, 800);
    fireResize(768, 800);
    expect(setShowSource).toHaveBeenCalledWith(false);
    setShowSource.mockClear();

    fireResize(768, 800);
    flush();
    expect(setShowSource).not.toHaveBeenCalled();
  });

  // ── Debounce: orientation flip ─────────────────────────────────────────

  it('does not flash wide when flipping between narrow orientations', () => {
    renderHook(() => useViewportAutoHide(containerRef, setShowSource));
    fireResize(1200, 800); // baseline
    fireResize(667, 375);  // landscape phone — narrow (immediate)
    expect(setShowSource).toHaveBeenCalledWith(false);
    setShowSource.mockClear();

    // Storybook briefly passes through full size then settles on portrait
    fireResize(1200, 800); // intermediate full size (would be "wide") — debounce starts
    fireResize(375, 667);  // portrait phone — still narrow, wasNarrow is still true
    flush();

    // Should NOT have called setShowSource(true) for the intermediate state
    expect(setShowSource).not.toHaveBeenCalled();
  });

  it('cancels pending wide transition if narrow arrives before debounce', () => {
    renderHook(() => useViewportAutoHide(containerRef, setShowSource));
    fireResize(1200, 800); // baseline
    fireResize(375, 667);  // narrow (immediate)
    setShowSource.mockClear();

    // Brief wide, then narrow again before debounce fires
    fireResize(1200, 800);
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS / 2); }); // halfway
    fireResize(375, 667);  // narrow again — wasNarrow is still true, no transition
    flush();

    expect(setShowSource).not.toHaveBeenCalled();
  });

  // ── Return value (isNarrow) ────────────────────────────────────────────

  it('returns false initially', () => {
    const { result } = renderHook(() => useViewportAutoHide(containerRef, setShowSource));
    expect(result.current).toBe(false);
  });

  it('returns true when viewport becomes narrow', () => {
    const { result } = renderHook(() => useViewportAutoHide(containerRef, setShowSource));
    fireResize(1200, 800);
    fireResize(375, 667);
    expect(result.current).toBe(true);
  });

  it('returns false when viewport recovers', () => {
    const { result } = renderHook(() => useViewportAutoHide(containerRef, setShowSource));
    fireResize(1200, 800);
    fireResize(375, 667);
    expect(result.current).toBe(true);
    fireResize(1200, 800);
    flush();
    expect(result.current).toBe(false);
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────

  it('disconnects observer on unmount', () => {
    const { unmount } = renderHook(() => useViewportAutoHide(containerRef, setShowSource));
    unmount();
    expect(disconnectMock).toHaveBeenCalled();
  });

  // ── Cross-mount persistence (story navigation) ────────────────────────

  describe('cross-mount persistence (story navigation)', () => {
    it('returns narrow immediately on remount without waiting for resize', () => {
      const { unmount } = renderHook(() =>
        useViewportAutoHide(containerRef, setShowSource));

      fireResize(1200, 800); // baseline
      fireResize(375, 667);  // narrow (immediate)
      expect(setShowSource).toHaveBeenCalledWith(false);

      unmount();

      // Simulate remount (new story loaded)
      const el2 = document.createElement('div');
      document.body.appendChild(el2);
      const containerRef2: RefObject<HTMLDivElement> = { current: el2 };
      const setShowSource2 = vi.fn<(show: boolean) => void>();

      const { result: result2 } = renderHook(() =>
        useViewportAutoHide(containerRef2, setShowSource2));

      // isNarrow should be true immediately, before any resize fires
      expect(result2.current).toBe(true);

      // No setShowSource call — stored showSource handles visibility
      expect(setShowSource2).not.toHaveBeenCalled();

      document.body.removeChild(el2);
    });

    it('does not call setShowSource on remount when narrow persists', () => {
      const { unmount } = renderHook(() =>
        useViewportAutoHide(containerRef, setShowSource));

      fireResize(1200, 800);
      fireResize(375, 667);

      unmount();

      const el2 = document.createElement('div');
      document.body.appendChild(el2);
      const containerRef2: RefObject<HTMLDivElement> = { current: el2 };
      const setShowSource2 = vi.fn<(show: boolean) => void>();

      renderHook(() => useViewportAutoHide(containerRef2, setShowSource2));

      // No calls — stored showSource handles initial state
      expect(setShowSource2).not.toHaveBeenCalled();

      // Continued narrow observations also don't fire (no transition)
      fireResize(375, 667);
      flush();
      expect(setShowSource2).not.toHaveBeenCalled();

      document.body.removeChild(el2);
    });

    it('starts wide on remount when viewport recovered before unmount', () => {
      const { unmount } = renderHook(() =>
        useViewportAutoHide(containerRef, setShowSource));

      fireResize(1200, 800);
      fireResize(375, 667);
      fireResize(1200, 800); // recover
      flush();

      unmount();

      const el2 = document.createElement('div');
      document.body.appendChild(el2);
      const containerRef2: RefObject<HTMLDivElement> = { current: el2 };
      const setShowSource2 = vi.fn<(show: boolean) => void>();

      const { result: result2 } = renderHook(() =>
        useViewportAutoHide(containerRef2, setShowSource2));

      // Was wide at unmount → should start wide
      expect(result2.current).toBe(false);
      expect(setShowSource2).not.toHaveBeenCalled();

      document.body.removeChild(el2);
    });

    it('uses stored baseline on remount — detects narrow even for first observation', () => {
      // Mount 1: establish baseline at full size, then unmount (no narrow transition)
      const { unmount } = renderHook(() =>
        useViewportAutoHide(containerRef, setShowSource));
      fireResize(1200, 800); // captures baseline
      unmount();

      // Mount 2: first observation is at narrow size — immediate transition
      const el2 = document.createElement('div');
      document.body.appendChild(el2);
      const containerRef2: RefObject<HTMLDivElement> = { current: el2 };
      const setShowSource2 = vi.fn<(show: boolean) => void>();

      renderHook(() => useViewportAutoHide(containerRef2, setShowSource2));
      fireResize(375, 667); // narrow relative to stored baseline
      expect(setShowSource2).toHaveBeenCalledWith(false);

      document.body.removeChild(el2);
    });
  });

  // ── isNarrowOnMount ────────────────────────────────────────────────────

  describe('isNarrowOnMount', () => {
    it('returns false on fresh session', () => {
      expect(isNarrowOnMount()).toBe(false);
    });

    it('returns true after viewport becomes narrow', () => {
      renderHook(() => useViewportAutoHide(containerRef, setShowSource));
      fireResize(1200, 800);
      fireResize(375, 667);
      expect(isNarrowOnMount()).toBe(true);
    });

    it('returns false after viewport recovers', () => {
      renderHook(() => useViewportAutoHide(containerRef, setShowSource));
      fireResize(1200, 800);
      fireResize(375, 667);
      fireResize(1200, 800);
      flush();
      expect(isNarrowOnMount()).toBe(false);
    });
  });

  // ── storedShowSource ──────────────────────────────────────────────────

  describe('storedShowSource', () => {
    it('defaults to true', () => {
      expect(getStoredShowSource()).toBe(true);
    });

    it('persists value via setStoredShowSource', () => {
      setStoredShowSource(false);
      expect(getStoredShowSource()).toBe(false);
    });

    it('resets to true via _resetStoredBaseline', () => {
      setStoredShowSource(false);
      _resetStoredBaseline();
      expect(getStoredShowSource()).toBe(true);
    });
  });
});
