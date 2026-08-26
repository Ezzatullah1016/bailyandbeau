'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { SurfaceCaps } from './dockToolsets';

/**
 * The one drawable thing the dock is pointing at.
 *
 * The room has two canvases with nothing in common but their purpose. The
 * reading room layers `AnnotationCanvas` over the book — Fabric objects behind
 * an imperative handle, synced as JSON. An activity draws on its pane's own
 * canvas — an array of `Line` objects in React state, synced through
 * `patchCurrent`. A single ref cannot drive both, and the client's mockups put
 * the same Pen, Eraser, Undo and Redo in the dock on *both* kinds of screen.
 *
 * So the dock talks to this interface instead, and each canvas supplies one. The
 * dock stops knowing which surface is live, which is the whole point: the tools
 * were previously gated on "are we in an activity", which is a question about the
 * room rather than about whether there is anything to draw on.
 */

export type SurfaceTool = 'select' | 'pen' | 'highlight' | 'eraser' | 'fill' | 'shapes';

export interface DrawingSurface {
  /**
   * What this surface can service. The dock hides a tool whose capability is
   * false rather than rendering one that would no-op.
   */
  caps: SurfaceCaps;
  tool: SurfaceTool;
  setTool(tool: SurfaceTool): void;
  undo(): void;
  redo(): void;
  clear(): void;
  /** How much there is to undo and redo, so those buttons can disable honestly. */
  depth: { undo: number; redo: number };
  /**
   * Brush widths, when the surface has authored ones.
   *
   * Colour deliberately stays with the pane: an activity's palette is authored,
   * and the dock's own swatches are a fixed six with spoken names. Width has no
   * such constraint, so the dock's pen popover owns it.
   */
  brush?: { sizes: number[]; value: number; set(n: number): void };
}

type Registry = {
  /** Publish a surface. Returns the matching unregister. */
  register: (surface: DrawingSurface) => () => void;
};

/**
 * Split from the surface itself, and stable for the lifetime of the provider.
 *
 * A pane registers from an effect. If the context value changed identity on
 * every surface update, that effect would re-run and re-register in a loop — the
 * same hazard the dock's CTA plumbing already guards against with an identity
 * check. Keeping the registry constant means a pane's effect depends only on its
 * own state.
 */
const RegistryContext = createContext<Registry | null>(null);

/** Only the observable parts; the functions are read off the ref at call time. */
function sameShape(a: DrawingSurface | null, b: DrawingSurface | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.tool === b.tool &&
    a.depth.undo === b.depth.undo &&
    a.depth.redo === b.depth.redo &&
    a.caps.pen === b.caps.pen &&
    a.caps.eraser === b.caps.eraser &&
    a.caps.fill === b.caps.fill &&
    a.caps.shapes === b.caps.shapes &&
    a.caps.undoRedo === b.caps.undoRedo &&
    a.brush?.value === b.brush?.value &&
    a.brush?.sizes.length === b.brush?.sizes.length
  );
}

export function DrawingSurfaceProvider({ children }: { children: React.ReactNode }) {
  const [surface, setSurface] = useState<DrawingSurface | null>(null);
  const currentRef = useRef<DrawingSurface | null>(null);

  const register = useCallback((next: DrawingSurface) => {
    currentRef.current = next;
    // Re-render only when something the dock draws from actually moved. Panes
    // republish on every state change, and an unconditional setState here would
    // loop against the pane's own render.
    setSurface((prev) => (sameShape(prev, next) ? prev : next));
    return () => {
      /*
       * Identity-guarded. On an activity switch the incoming pane can register
       * before the outgoing one's cleanup runs, and an unguarded `= null` would
       * then wipe the new registration and leave the dock pointing at nothing.
       */
      if (currentRef.current !== next) return;
      currentRef.current = null;
      setSurface((prev) => (prev === next ? null : prev));
    };
  }, []);

  const registry = useMemo<Registry>(() => ({ register }), [register]);
  const value = useMemo(() => ({ surface }), [surface]);

  return (
    <RegistryContext.Provider value={registry}>
      <SurfaceContext.Provider value={value}>{children}</SurfaceContext.Provider>
    </RegistryContext.Provider>
  );
}

const SurfaceContext = createContext<{ surface: DrawingSurface | null }>({ surface: null });

/**
 * Publish this pane as the room's drawing surface.
 *
 * `deps` are the pane's own observable values — its tool, its stack depths, its
 * capability flags. The surface object is rebuilt whenever they change, which is
 * what lets the dock's buttons track the pane's state.
 */
export function useRegisterDrawingSurface(
  build: () => DrawingSurface,
  deps: React.DependencyList,
) {
  const registry = useContext(RegistryContext);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const surface = useMemo(build, deps);

  useEffect(() => {
    if (!registry) return;
    return registry.register(surface);
  }, [registry, surface]);
}

/** The live surface, for the dock. Null when nothing drawable is mounted. */
export function useDrawingSurface(): DrawingSurface | null {
  return useContext(SurfaceContext).surface;
}
