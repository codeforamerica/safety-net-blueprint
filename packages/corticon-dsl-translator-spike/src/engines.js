/**
 * Registry of known source-engine adapters. Each entry maps an --engine name to the
 * two modules that engine must provide -- both are per-engine, since ingestion has
 * to parse that engine's own file format and expression translation has to parse
 * that engine's own expression syntax:
 *
 * - `ingestModule` exports `loadProject(projectDir)`, producing the shared,
 *   engine-agnostic project model that src/graph/ and src/classify/ operate on.
 * - `expressionParserModule` exports `parseExpression(text)`, producing the shared,
 *   engine-agnostic AST that src/translate/'s CEL generator operates on.
 *
 * Every engine module exports these under the SAME fixed names (`loadProject`,
 * `parseExpression`) -- the module path is what identifies the engine, not the
 * export name, the same way Corticon's own `project.js`/`expression-parser.js`
 * don't call these `loadCorticonProject`/`parseCorticonExpression`. Adding a new
 * engine means adding one entry here with both module paths; nothing downstream
 * ever names a specific engine or guesses a module path.
 */
export const ENGINES = {
  corticon: {
    ingestModule: './sources/corticon/project.js',
    expressionParserModule: './sources/corticon/expression-parser.js',
  },
};

/** Which engine --engine defaults to when omitted -- today the only one that exists. */
export const DEFAULT_ENGINE = 'corticon';

/** Resolves an engine name to its actual loadProject/parseExpression functions, or throws a clear error for an unknown engine. */
export async function resolveEngine(engineName) {
  const engine = ENGINES[engineName];
  if (!engine) {
    throw new Error(`Unknown engine "${engineName}". Known engines: ${Object.keys(ENGINES).join(', ')}`);
  }
  const [ingest, expressionParser] = await Promise.all([import(engine.ingestModule), import(engine.expressionParserModule)]);
  return { loadProject: ingest.loadProject, parseExpression: expressionParser.parseExpression };
}
