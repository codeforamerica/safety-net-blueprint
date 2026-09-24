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

/** A declared input, keyed in `Graph.inputs` by its JSONPath-style field path. */
export interface InputNode {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  description?: string;
  format?: string;
  enum?: string[];
  default?: unknown;
}

/** A derived fact: a CEL expression over inputs and other facts. */
export interface FactDefinition {
  expression: string;
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  description?: string;
}

/**
 * A compiled rule graph, as this engine needs it.
 *
 * These are the four fields `evaluate` reads. A graph produced by
 * blueprint-core carries more — `$schema`, `domain`, `ruleset` — and
 * satisfies this structurally, so it can be passed straight in. This
 * package deliberately states what it requires rather than mirroring the
 * contract: `graph-schema.yaml` is the authority on what a graph is, and a
 * second copy of it here could only fall behind.
 */
export interface Graph {
  /** Field paths the graph reads, e.g. `$.household.members[].age`. */
  inputs: Record<string, InputNode>;
  /** Every derived fact, by name. */
  facts: Record<string, FactDefinition>;
  /** For each fact, the inputs and facts it reads. */
  dependencies: Record<string, string[]>;
  /** The facts that are the graph's answers, as opposed to intermediates. */
  outputs: string[];
}

/**
 * Evaluate a compiled graph against a set of inputs.
 *
 * Inputs are keyed by the graph's top-level namespaces — `{ household: {…} }`
 * for paths beginning `$.household`. A namespace that is absent does not
 * throw: the facts depending on it resolve to `missing`, listing the paths
 * they could not reach.
 *
 * @param graph - A compiled graph, e.g. from `generate(docs, 'graph')`
 * @param inputs - Namespace-keyed input values
 * @returns Every fact in the graph by name, inputs excluded
 */
export declare function evaluate(
  graph: Graph,
  inputs: Record<string, unknown>
): Record<string, FactNode<unknown>>;

declare global {
  interface Window {
    /**
     * Present when the browser bundle is loaded via a script tag:
     *
     *   <script src="https://unpkg.com/@codeforamerica/blueprint-rules-engine/dist/browser.js"></script>
     *
     * The bundle is an IIFE and exports nothing importable, so this global is
     * the only way to reach it. Consumers with a bundler should import
     * `evaluate` from the package root instead.
     */
    RulesEngine: { evaluate: typeof evaluate };
  }
}
