import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseVocabulary } from './vocabulary.js';
import { parseRulesheet } from './rulesheet.js';
import { parseRuleflow } from './ruleflow.js';
import { parseRuletest } from './ruletest.js';

function findFiles(dir, extension) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) results.push(...findFiles(full, extension));
    else if (entry.endsWith(extension)) results.push(full);
  }
  return results;
}

/**
 * Load every real Corticon file under a project directory into a single in-memory
 * model. Takes a plain directory path -- not any one of this spike's own fixture
 * paths hardcoded -- so it works against any real Corticon project, not just the
 * ones vendored here.
 */
export function loadProject(projectDir) {
  const vocabularies = new Map();
  for (const file of findFiles(projectDir, '.ecore')) {
    vocabularies.set(relative(projectDir, file), parseVocabulary(file));
  }

  const rulesheets = new Map();
  for (const file of findFiles(projectDir, '.ers')) {
    rulesheets.set(relative(projectDir, file), parseRulesheet(file));
  }

  const ruleflows = new Map();
  for (const file of findFiles(projectDir, '.erf')) {
    ruleflows.set(relative(projectDir, file), parseRuleflow(file));
  }

  const ruletests = new Map();
  for (const file of findFiles(projectDir, '.ert')) {
    ruletests.set(relative(projectDir, file), parseRuletest(file));
  }

  return { projectDir, vocabularies, rulesheets, ruleflows, ruletests };
}
