/**
 * The contract pipeline.
 *
 *   discover → load → resolve → validate, with generate() alongside
 *
 * Only `discover` reads a directory, and nothing here writes: the caller
 * decides where output goes. Everything between operates on documents
 * already in memory, which is what makes each stage testable without a
 * filesystem.
 *
 * `generate`, `resolve` and `validate` take the whole document set rather
 * than one document, because the questions they answer are cross-file. A
 * composition projects into a sibling spec, an enum is injected from another
 * document, a state machine's references resolve against schemas declared
 * elsewhere, and a JSON Schema check needs every document registered before
 * any one of them can be validated.
 */

/** Contract types the pipeline recognizes. */
export type ContractType =
  | 'openapi'
  | 'asyncapi'
  | 'state-machine'
  | 'rules'
  | 'rules-examples'
  | 'graph'
  | 'compositions'
  | 'annotations'
  | 'registry'
  | 'sla-types'
  | 'metrics'
  | 'schema'
  | 'components'
  | 'mock-data'
  | 'config'
  | 'overlay'
  | 'unknown';

/** A contract file found on disk, with its position in the set. */
export interface DiscoveredFile {
  /** Absolute path. */
  path: string;
  /**
   * Path relative to the directory discovery started from. Part of a
   * document's identity within the set: a generated overlay addresses its
   * target by relative path.
   */
  relativePath: string;
  type: ContractType;
  /**
   * Which domain the file belongs to: `info.x-domain`, then a top-level
   * `domain`, then a path segment or filename prefix naming a known domain.
   * Null when none of those identify one.
   */
  domain: string | null;
}

/** One `$ref` occurrence and what it points at. */
export interface RefEntry {
  /** The fragment, e.g. `/components/schemas/Application`. */
  pointer: string;
  /** True when the ref names another file. */
  external: boolean;
  /** The file part, or null for a same-document ref. */
  file: string | null;
  /** The schema name: the last segment of the fragment. */
  name: string | null;
  /**
   * Whether the pointer resolves within this document. Null for external
   * refs, which cannot be checked from one document alone. Tracked apart
   * from `target` because a pointer can legitimately address a null node.
   */
  resolved: boolean | null;
  /** The referenced value, or null if external or unresolved. */
  target: unknown;
}

/** What produced a resolved document set. */
export interface Provenance {
  resolvedAt: string;
  /** Titles of the overlays applied, in order. */
  overlays: string[];
  /** Environment filtered to, or null if unfiltered. */
  envTarget: string | null;
  /** Names of the variables substituted. */
  variables: string[];
}

/**
 * A loaded contract document.
 *
 * `content` is the document in its native shape — what was parsed is what
 * gets written back — and is the source of truth. `refs()` and `model()` are
 * derived views, computed per call from the current `content`, so a document
 * produced by a resolve pass reports its own state rather than the one it
 * was loaded with. To change a document, change `content`.
 */
export interface Doc {
  path: string;
  /** Null when loaded outside a set; `generate` rejects such a document. */
  relativePath: string | null;
  type: ContractType;
  /** Same derivation as `DiscoveredFile`; falls back to what the content states. */
  domain: string | null;
  content: Record<string, unknown>;
  /** Every `$ref` in the document, keyed by the literal ref string. */
  refs(): Map<string, RefEntry>;
  /**
   * The sibling documents this one's external `$ref`s point at, keyed by the
   * ref's file part as written. Canonical `https://` refs are skipped.
   */
  externalRefs(docs: Doc[]): Map<string, Record<string, unknown>>;
  /** Follow one external `$ref` to the schema it names, within the set. */
  resolveRef(ref: string, docs: Doc[]): Record<string, unknown>;
  /**
   * Normalized view of blueprint-authored types, null for documents whose
   * shape an external standard already defines — OpenAPI, AsyncAPI, JSON
   * Schema. A parallel representation of those would only need converting
   * back for the tools that already speak them.
   */
  model(): StateMachineModel | null;
  /** True when a resolve manifest governs this document's location. */
  resolved: boolean;
  provenance: Provenance | null;
}

/** A step in a state machine, with branch and loop bodies under `children`. */
export interface StepNode {
  /** `set`, `emit`, `call`, `if`, `match`, `forEach`, or a container kind. */
  kind: string;
  children: StepNode[];
  [field: string]: unknown;
}

/**
 * State machines normalized so every step has the same shape.
 *
 * The authored format nests bodies under a different key per kind — `then`
 * and `else` on if, `when` on match, `do` on forEach — so walking it means
 * knowing all of them. Here a caller recurses `children`.
 */
export interface StateMachineModel {
  machines: Array<{
    object?: string;
    states?: Array<Record<string, unknown>>;
    actions: Array<{ id?: string; steps: StepNode[]; [field: string]: unknown }>;
    events: Array<{ type?: string; steps: StepNode[]; [field: string]: unknown }>;
    procedures: Array<{ id?: string; steps: StepNode[]; [field: string]: unknown }>;
    [field: string]: unknown;
  }>;
  /** Shared procedures on a base machine that declares none of its own. */
  procedures: Array<{ id?: string; steps: StepNode[]; [field: string]: unknown }>;
}

/** A compiled decision graph. Names the contract it came from. */
export interface Graph {
  $schema: string;
  domain: string;
  ruleset: string;
  outputs: string[];
  inputs: Record<string, unknown>;
  facts: Record<string, unknown>;
  dependencies: Record<string, string[]>;
}

/** One example record, as `generate(docs, 'examples')` groups them. */
export interface ExampleRecord {
  /** The example's key in the source document, e.g. `ApplicationExample1`. */
  key: string;
  /** Same as `key`; kept for callers that display a name. */
  name: string;
  /** The record itself. */
  data: Record<string, unknown>;
}

/** An OpenAPI Overlay document. */
export interface Overlay {
  overlay?: string;
  info?: { title?: string; version?: string };
  actions: Array<{
    target: string;
    description?: string;
    file?: string;
    files?: string | string[];
    [operation: string]: unknown;
  }>;
}

export interface ResolveOptions {
  /** Applied in order. Authored overlays first, then generated ones. */
  overlays?: Overlay[];
  /** Keep only nodes whose `x-environments` lists this, and strip the marker. */
  envTarget?: string | null;
  /** Values for `${VAR}` placeholders. Unresolved ones are left literal. */
  envVariables?: Record<string, string>;
}

export interface ResolveResult {
  docs: Doc[];
  /** Write alongside the output; `load` reads it back as provenance. */
  manifest: Provenance;
  /** Conditions worth attention that did not stop resolution. */
  warnings: string[];
  /** What each pass did, for a caller that reports progress. */
  applied: string[];
}

/** One finding. `rule` identifies the check, for grouping and filtering. */
export interface Finding {
  rule: string;
  message: string;
  path: string;
}

export interface DocValidation {
  path: string;
  type: ContractType;
  /** True when there are no errors. Warnings do not make a document invalid. */
  ok: boolean;
  errors: Finding[];
  warnings: Finding[];
}

export interface ValidationResult {
  /** True when every document is ok. */
  ok: boolean;
  results: DocValidation[];
  /** Human-readable rendering, never truncated. */
  report: string;
}

/**
 * Find contract files, optionally of one type.
 *
 * The only function that reads a directory.
 */
export function discover(dir: string, type?: ContractType): DiscoveredFile[];

/**
 * Read one contract file.
 *
 * Takes what `discover` returned, so `discover(dir).map(load)` keeps the
 * file's position and domain. A bare path is accepted for a file in no set;
 * `relativePath` is then null and `generate` will refuse the document.
 */
export function load(file: DiscoveredFile | string): Doc;

/**
 * Generate an artifact from a contract set.
 *
 * `overlay` produces the OpenAPI Overlays that compositions, rulesets and
 * state machine actions project into their sibling specs; `resolve` applies
 * them. `graph` produces one compiled decision graph per ruleset, with where
 * each should be written.
 *
 * @throws If a composition or rules document has no `relativePath`, since an
 *   overlay addresses its target by relative path.
 * @throws If `type` is not a known artifact kind.
 */
export function generate(docs: Doc[], type: 'overlay'): Overlay[];
export function generate(docs: Doc[], type: 'graph'): Array<{ path: string; graph: Graph }>;
export function generate(
  docs: Doc[],
  type: 'postman',
  options?: { baseUrl?: string; collectionId?: string | null }
): Record<string, unknown>;
/**
 * Example records grouped by the schema each exemplifies.
 *
 * Keyed by schema name — `Application`, `ApplicationMember` — not by
 * collection. Naming a collection is the mock server's concern; a schema is
 * something the document declares.
 */
export function generate(
  docs: Doc[],
  type: 'examples'
): Record<string, ExampleRecord[]>;

/** Apply overlays, inject enums, filter by environment, substitute variables. */
export function resolve(docs: Doc[], options?: ResolveOptions): ResolveResult;

/** Check the document set. Every type is checked or reported as unchecked. */
export function validate(docs: Doc[]): ValidationResult;

/** Directory of the bundled blueprint validation schemas. */
export const schemasDir: string;

/** Directory of the bundled base contracts. */
export const baseContractsDir: string;

// ---------------------------------------------------------------------------
// Reads over an already-loaded document set.
// ---------------------------------------------------------------------------


/**
 * Read out a fact the documents already state.
 *
 * The counterpart to `generate`. `relationships` indexes endpoints by the
 * contract artifact that generated them, keyed `{type}:{domain}:{id}` from
 * each operation's `x-relationship`; plain `fk` relationships are
 * field-level, not endpoint-level, and are skipped.
 */
export function extract(
  docs: Doc[],
  type: 'relationships'
): Map<string, { path: string; method: string }>;

