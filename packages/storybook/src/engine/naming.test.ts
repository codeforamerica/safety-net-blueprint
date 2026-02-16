import { describe, it, expect } from 'vitest';
import {
  sanitize,
  toPascalCase,
  toCamelCase,
  toKebabCase,
  storyNameFromExport,
  buildStoryId,
  scenarioDisplayName,
  scenarioMetaTitle,
  scenarioStoryName,
  scenarioStoryId,
  willAutoFlatten,
} from './naming';

// =============================================================================
// sanitize
// =============================================================================

describe('sanitize', () => {
  it('lowercases and replaces non-alphanum with hyphens', () => {
    expect(sanitize('Hello World')).toBe('hello-world');
  });

  it('replaces slashes', () => {
    expect(sanitize('Forms/Person Review')).toBe('forms-person-review');
  });

  it('replaces colons', () => {
    expect(sanitize('Person Review: Red Oak')).toBe('person-review-red-oak');
  });

  it('collapses consecutive hyphens', () => {
    expect(sanitize('Scenarios/Person Review: abc')).toBe('scenarios-person-review-abc');
  });

  it('strips leading and trailing hyphens', () => {
    expect(sanitize('-hello-')).toBe('hello');
  });

  it('handles numbers without adding extra hyphens', () => {
    expect(sanitize('Red Oak2')).toBe('red-oak2');
  });

  it('handles numbers with spaces', () => {
    expect(sanitize('Red Oak 2')).toBe('red-oak-2');
  });

  it('handles empty string', () => {
    expect(sanitize('')).toBe('');
  });
});

// =============================================================================
// toPascalCase
// =============================================================================

describe('toPascalCase', () => {
  it('converts simple kebab-case', () => {
    expect(toPascalCase('person-intake')).toBe('PersonIntake');
  });

  it('converts single word', () => {
    expect(toPascalCase('abc')).toBe('Abc');
  });

  it('handles trailing number segment', () => {
    expect(toPascalCase('red-oak-2')).toBe('RedOak2');
  });

  it('handles number embedded in word', () => {
    expect(toPascalCase('red-oak2')).toBe('RedOak2');
  });

  it('handles multi-word contract id', () => {
    expect(toPascalCase('person-caseworker-review')).toBe('PersonCaseworkerReview');
  });
});

// =============================================================================
// toCamelCase
// =============================================================================

describe('toCamelCase', () => {
  it('converts to camelCase', () => {
    expect(toCamelCase('person-create')).toBe('personCreate');
  });

  it('handles single word', () => {
    expect(toCamelCase('person')).toBe('person');
  });
});

// =============================================================================
// toKebabCase
// =============================================================================

describe('toKebabCase', () => {
  it('converts spaces to hyphens', () => {
    expect(toKebabCase('Red Oak')).toBe('red-oak');
  });

  it('converts mixed case to lowercase', () => {
    expect(toKebabCase('ABC')).toBe('abc');
  });

  it('strips special characters', () => {
    expect(toKebabCase("Mary's Test!")).toBe('mary-s-test');
  });

  it('collapses multiple hyphens', () => {
    expect(toKebabCase('hello   world')).toBe('hello-world');
  });

  it('strips leading/trailing hyphens', () => {
    expect(toKebabCase(' hello ')).toBe('hello');
  });

  it('preserves numbers with spaces', () => {
    expect(toKebabCase('Red Oak 2')).toBe('red-oak-2');
  });

  it('preserves numbers without spaces', () => {
    expect(toKebabCase('Red Oak2')).toBe('red-oak2');
  });

  it('returns empty for empty input', () => {
    expect(toKebabCase('')).toBe('');
  });

  it('returns empty for whitespace only', () => {
    expect(toKebabCase('   ')).toBe('');
  });
});

// =============================================================================
// storyNameFromExport
// =============================================================================

describe('storyNameFromExport', () => {
  it('splits camelCase boundaries', () => {
    expect(storyNameFromExport('RedOak')).toBe('Red Oak');
  });

  it('splits letter-digit boundaries', () => {
    expect(storyNameFromExport('RedOak2')).toBe('Red Oak 2');
  });

  it('handles consecutive capitals', () => {
    expect(storyNameFromExport('SSNField')).toBe('SSN Field');
  });

  it('handles single word', () => {
    expect(storyNameFromExport('Abc')).toBe('Abc');
  });

  it('handles all lowercase', () => {
    expect(storyNameFromExport('abc')).toBe('abc');
  });

  it('handles underscores', () => {
    expect(storyNameFromExport('Person_Intake')).toBe('Person Intake');
  });

  it('handles multi-word export', () => {
    expect(storyNameFromExport('PersonCaseworkerReview')).toBe('Person Caseworker Review');
  });

  it('handles number in middle', () => {
    // ([a-z])(\d) splits "e2" but no rule for digit→uppercase, so "2D" stays joined
    expect(storyNameFromExport('Page2Demographics')).toBe('Page 2Demographics');
  });
});

// =============================================================================
// buildStoryId
// =============================================================================

describe('buildStoryId', () => {
  it('combines sanitized title and export-derived name', () => {
    expect(buildStoryId('Forms/Person Review', 'PersonCaseworkerReview')).toBe(
      'forms-person-review--person-caseworker-review',
    );
  });

  it('handles scenario with simple name', () => {
    expect(buildStoryId('Scenarios/Person Review: red oak', 'RedOak')).toBe(
      'scenarios-person-review-red-oak--red-oak',
    );
  });

  it('handles scenario with trailing number (letter-digit split)', () => {
    // Title has "red oak2" (no space before 2)
    // Export RedOak2 → storyNameFromExport → "Red Oak 2" → sanitize → "red-oak-2"
    expect(buildStoryId('Scenarios/Person Review: red oak2', 'RedOak2')).toBe(
      'scenarios-person-review-red-oak2--red-oak-2',
    );
  });

  it('handles scenario with spaced number', () => {
    // Title has "red oak 2" (space before 2)
    // Export RedOak2 → storyNameFromExport → "Red Oak 2" → sanitize → "red-oak-2"
    expect(buildStoryId('Scenarios/Person Review: red oak 2', 'RedOak2')).toBe(
      'scenarios-person-review-red-oak-2--red-oak-2',
    );
  });
});

// =============================================================================
// scenarioDisplayName
// =============================================================================

describe('scenarioDisplayName', () => {
  it('replaces hyphens with spaces', () => {
    expect(scenarioDisplayName('red-oak')).toBe('red oak');
  });

  it('preserves lowercase', () => {
    expect(scenarioDisplayName('abc')).toBe('abc');
  });

  it('preserves numbers', () => {
    expect(scenarioDisplayName('red-oak-2')).toBe('red oak 2');
  });

  it('preserves embedded numbers', () => {
    expect(scenarioDisplayName('red-oak2')).toBe('red oak2');
  });
});

// =============================================================================
// scenarioMetaTitle / scenarioStoryName / auto-flattening
// =============================================================================

describe('scenario title and auto-flattening', () => {
  it('meta title uses Scenarios/ prefix', () => {
    expect(scenarioMetaTitle('Person Review', 'red oak')).toBe(
      'Scenarios/Person Review: red oak',
    );
  });

  it('story name matches the last segment of meta title', () => {
    const formTitle = 'Person Review';
    const displayName = 'red oak';
    const title = scenarioMetaTitle(formTitle, displayName);
    const name = scenarioStoryName(formTitle, displayName);

    expect(willAutoFlatten(title, name)).toBe(true);
  });

  it('auto-flattens for simple names', () => {
    const title = scenarioMetaTitle('Person Intake', 'abc');
    const name = scenarioStoryName('Person Intake', 'abc');
    expect(willAutoFlatten(title, name)).toBe(true);
  });

  it('auto-flattens for names with numbers', () => {
    const title = scenarioMetaTitle('Person Review', 'red oak 2');
    const name = scenarioStoryName('Person Review', 'red oak 2');
    expect(willAutoFlatten(title, name)).toBe(true);
  });

  it('meta title has exactly 2 segments so scenarios render as flat sidebar leaves', () => {
    const title = scenarioMetaTitle('Person Review', 'red oak');
    const segments = title.split('/');
    expect(segments).toHaveLength(2);
    expect(segments[0]).toBe('Scenarios');
  });

  it('does NOT auto-flatten when name does not match leaf', () => {
    expect(willAutoFlatten('Scenarios/Person Review', 'Something Else')).toBe(false);
  });
});

// =============================================================================
// scenarioStoryId (end-to-end)
// =============================================================================

describe('scenarioStoryId', () => {
  it('computes correct ID for simple name', () => {
    expect(scenarioStoryId('Person Review', 'red-oak')).toBe(
      'scenarios-person-review-red-oak--red-oak',
    );
  });

  it('computes correct ID for name with trailing number', () => {
    // kebab "red-oak-2" → display "red oak 2" → title "Scenarios/Person Review: red oak 2"
    // export "RedOak2" → storyNameFromExport "Red Oak 2" → sanitize "red-oak-2"
    expect(scenarioStoryId('Person Review', 'red-oak-2')).toBe(
      'scenarios-person-review-red-oak-2--red-oak-2',
    );
  });

  it('computes correct ID for name with embedded number', () => {
    // kebab "red-oak2" → display "red oak2" → title "Scenarios/Person Review: red oak2"
    // export "RedOak2" → storyNameFromExport "Red Oak 2" → sanitize "red-oak-2"
    expect(scenarioStoryId('Person Review', 'red-oak2')).toBe(
      'scenarios-person-review-red-oak2--red-oak-2',
    );
  });

  it('computes correct ID for single word', () => {
    expect(scenarioStoryId('Person Intake', 'abc')).toBe(
      'scenarios-person-intake-abc--abc',
    );
  });

  it('computes correct ID for Person Intake wizard', () => {
    expect(scenarioStoryId('Person Intake', 'citizen')).toBe(
      'scenarios-person-intake-citizen--citizen',
    );
  });

  it('story ID lives under scenarios- root so navigating to it expands the Scenarios sidebar group', () => {
    expect(scenarioStoryId('Person Review', 'abc')).toMatch(/^scenarios-/);
    expect(scenarioStoryId('Person Intake', 'citizen')).toMatch(/^scenarios-/);
  });
});
