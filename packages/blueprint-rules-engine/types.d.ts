/**
 * A typed node in a rules evaluation result.
 *
 * Each fact in the graph resolves to one of four states:
 *   complete    — resolved; all inputs explicitly provided
 *   placeholder — resolved; at least one input used a schema default
 *   missing     — could not compute; one or more required inputs are absent
 *   error       — threw during evaluation (e.g. dependency error or bad expression)
 */
export type FactNode<T> =
  | { type: 'output' | 'intermediate'; state: 'complete' | 'placeholder'; value: T }
  | { type: 'output' | 'intermediate'; state: 'missing'; value: null; missing: string[] }
  | { type: 'output' | 'intermediate'; state: 'error'; value: null; message: string };
