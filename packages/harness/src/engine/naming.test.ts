import { describe, it, expect } from 'vitest';
import {
  sanitize,
  toPascalCase,
  toCamelCase,
  toKebabCase,
  storyNameFromExport,
  buildStoryId,
  customDisplayName,
  customMetaTitle,
  customStoryId,
  willAutoFlatten,
} from './naming';
import * as namingExports from './naming';

// =============================================================================
// sanitize
// =============================================================================

describe('sanitize', () => {
  it('lowercases and replaces non-alphanum with hyphens', () => {
    expect(sanitize('Hello World')).toBe('hello-world');
  });

  it('replaces slashes', () => {
    expect(sanitize('Caseworker/Review')).toBe('caseworker-review');
  });

  it('replaces colons', () => {
    expect(sanitize('Person Review: Red Oak')).toBe('person-review-red-oak');
  });

  it('collapses consecutive hyphens', () => {
    expect(sanitize('Applicant/Intake/abc')).toBe('applicant-intake-abc');
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

  it('splits letter-digit boundaries (case-insensitive)', () => {
    expect(storyNameFromExport('RedOak2')).toBe('Red Oak 2');
  });

  it('splits uppercase letter before digit (C3 → C 3)', () => {
    expect(storyNameFromExport('C3')).toBe('C 3');
  });

  it('splits digit-to-letter boundaries', () => {
    expect(storyNameFromExport('Page2Demographics')).toBe('Page 2 Demographics');
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

  it('handles hyphens', () => {
    expect(storyNameFromExport('Person-Intake')).toBe('Person Intake');
  });

  it('handles multi-word export', () => {
    expect(storyNameFromExport('PersonCaseworkerReview')).toBe('Person Caseworker Review');
  });
});

// =============================================================================
// buildStoryId
// =============================================================================

describe('buildStoryId', () => {
  it('combines sanitized title and export-derived name', () => {
    expect(buildStoryId('Caseworker/Review', 'PersonCaseworkerReview')).toBe(
      'caseworker-review--person-caseworker-review',
    );
  });

  it('handles role/category/name structure', () => {
    expect(buildStoryId('Applicant/Intake/red oak', 'RedOak')).toBe(
      'applicant-intake-red-oak--red-oak',
    );
  });

  it('handles trailing number in title (letter-digit split)', () => {
    // Title has "red oak2" (no space before 2)
    // Export RedOak2 → storyNameFromExport → "Red Oak 2" → sanitize → "red-oak-2"
    expect(buildStoryId('Caseworker/Review/red oak2', 'RedOak2')).toBe(
      'caseworker-review-red-oak2--red-oak-2',
    );
  });

  it('handles spaced number in title', () => {
    // Title has "red oak 2" (space before 2)
    // Export RedOak2 → storyNameFromExport → "Red Oak 2" → sanitize → "red-oak-2"
    expect(buildStoryId('Caseworker/Review/red oak 2', 'RedOak2')).toBe(
      'caseworker-review-red-oak-2--red-oak-2',
    );
  });
});

// =============================================================================
// customDisplayName
// =============================================================================

describe('customDisplayName', () => {
  it('replaces hyphens with spaces and capitalizes words', () => {
    expect(customDisplayName('red-oak')).toBe('Red Oak');
  });

  it('capitalizes single word', () => {
    expect(customDisplayName('abc')).toBe('Abc');
  });

  it('capitalizes words with trailing number', () => {
    expect(customDisplayName('red-oak-2')).toBe('Red Oak 2');
  });

  it('capitalizes words with embedded number', () => {
    expect(customDisplayName('red-oak2')).toBe('Red Oak2');
  });
});

// =============================================================================
// customMetaTitle / auto-flattening
// =============================================================================

describe('custom title and auto-flattening', () => {
  it('meta title uses Role/Category/Name when category is provided', () => {
    expect(customMetaTitle('caseworker', 'Review', 'red oak')).toBe(
      'Caseworker/Review/red oak',
    );
  });

  it('meta title uses Role/Name when no category', () => {
    expect(customMetaTitle('applicant', undefined, 'red oak')).toBe(
      'Applicant/red oak',
    );
  });

  it('capitalizes role', () => {
    const title = customMetaTitle('applicant', 'Intake', 'abc');
    expect(title.startsWith('Applicant/')).toBe(true);
  });

  it('auto-flattens when story name matches leaf of title', () => {
    const title = customMetaTitle('applicant', 'Intake', 'abc');
    // Story name from export "Abc" → storyNameFromExport → "Abc"
    // Leaf of title is "abc" — these don't match (case difference)
    expect(willAutoFlatten(title, 'abc')).toBe(true);
  });

  it('does NOT auto-flatten when name does not match leaf', () => {
    expect(willAutoFlatten('Caseworker/Review/red oak', 'Something Else')).toBe(false);
  });
});

// =============================================================================
// customStoryId (end-to-end)
// =============================================================================

describe('customStoryId', () => {
  it('computes correct ID with role and category', () => {
    expect(customStoryId('caseworker', 'Review', 'red-oak')).toBe(
      'caseworker-review-red-oak--red-oak',
    );
  });

  it('computes correct ID without category', () => {
    expect(customStoryId('applicant', undefined, 'citizen')).toBe(
      'applicant-citizen--citizen',
    );
  });

  it('computes correct ID for name with trailing number', () => {
    // kebab "red-oak-2" → display "red oak 2" → title "Caseworker/Review/red oak 2"
    // export "RedOak2" → storyNameFromExport "Red Oak 2" → sanitize "red-oak-2"
    expect(customStoryId('caseworker', 'Review', 'red-oak-2')).toBe(
      'caseworker-review-red-oak-2--red-oak-2',
    );
  });

  it('computes correct ID for name with embedded number', () => {
    // kebab "red-oak2" → display "red oak2" → title "Caseworker/Review/red oak2"
    // export "RedOak2" → storyNameFromExport "Red Oak 2" → sanitize "red-oak-2"
    expect(customStoryId('caseworker', 'Review', 'red-oak2')).toBe(
      'caseworker-review-red-oak2--red-oak-2',
    );
  });

  it('computes correct ID for single word', () => {
    expect(customStoryId('applicant', 'Intake', 'abc')).toBe(
      'applicant-intake-abc--abc',
    );
  });

  it('computes correct ID for applicant intake custom story', () => {
    expect(customStoryId('applicant', 'Intake', 'citizen')).toBe(
      'applicant-intake-citizen--citizen',
    );
  });

  it('computes correct ID for short names like c2', () => {
    // toPascalCase('c2') → 'C2', storyNameFromExport('C2') → 'C 2' (case-insensitive /gi),
    // sanitize('C 2') → 'c-2'
    expect(customStoryId('caseworker', 'Reports', 'c2')).toBe(
      'caseworker-reports-c2--c-2',
    );
  });

  it('computes correct ID for two-letter names', () => {
    expect(customStoryId('caseworker', 'Reports', 'ca')).toBe(
      'caseworker-reports-ca--ca',
    );
  });

  it('story ID reflects the role prefix for proper sidebar grouping', () => {
    expect(customStoryId('caseworker', 'Review', 'abc')).toMatch(/^caseworker-/);
    expect(customStoryId('applicant', 'Intake', 'citizen')).toMatch(/^applicant-/);
  });
});

// =============================================================================
// customStoryId: rename scenario regression tests
// =============================================================================

describe('customStoryId rename scenarios', () => {
  it('produces different IDs for different custom names', () => {
    const id3 = customStoryId('caseworker', 'Reports', 'california-3');
    const id6 = customStoryId('caseworker', 'Reports', 'california-6');
    expect(id3).not.toBe(id6);
  });

  it('computes correct ID after rename (california-3 → california-6)', () => {
    const id = customStoryId('caseworker', 'Reports', 'california-6');
    expect(id).toBe('caseworker-reports-california-6--california-6');
  });

  it('computes correct ID for original name (california-3)', () => {
    const id = customStoryId('caseworker', 'Reports', 'california-3');
    expect(id).toBe('caseworker-reports-california-3--california-3');
  });

  it('computes correct ID with no category', () => {
    const id = customStoryId('applicant', undefined, 'my-variant');
    expect(id).toBe('applicant-my-variant--my-variant');
  });
});

// =============================================================================
// Verify old "snapshot" names are not exported (rename guard)
// =============================================================================

describe('snapshot→custom rename guard', () => {
  it('does not export snapshotDisplayName', () => {
    expect(namingExports).not.toHaveProperty('snapshotDisplayName');
  });

  it('does not export snapshotMetaTitle', () => {
    expect(namingExports).not.toHaveProperty('snapshotMetaTitle');
  });

  it('does not export snapshotStoryId', () => {
    expect(namingExports).not.toHaveProperty('snapshotStoryId');
  });

  it('exports customDisplayName', () => {
    expect(namingExports).toHaveProperty('customDisplayName');
  });

  it('exports customMetaTitle', () => {
    expect(namingExports).toHaveProperty('customMetaTitle');
  });

  it('exports customStoryId', () => {
    expect(namingExports).toHaveProperty('customStoryId');
  });
});
