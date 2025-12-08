/**
 * Unit tests for search filtering and pagination functions
 * Run with: node tests/mock-server/search-pagination.test.js
 */

function filterBySearch(examples, searchQuery) {
  if (!searchQuery) {
    return examples;
  }
  
  const query = searchQuery.toLowerCase();
  return examples.filter(example => {
    const firstName = (example.firstName || '').toLowerCase();
    const lastName = (example.lastName || '').toLowerCase();
    return firstName.includes(query) || lastName.includes(query);
  });
}

function applyPagination(items, limit = 25, offset = 0) {
  const total = items.length;
  const paginatedItems = items.slice(offset, offset + limit);
  const hasNext = offset + limit < total;
  
  return {
    items: paginatedItems,
    total,
    limit,
    offset,
    hasNext
  };
}

function runTests() {
  console.log('Testing Search Filtering and Pagination Functions\n');
  console.log('='.repeat(70));
  
  let passed = 0;
  let failed = 0;
  
  // Sample data
  const examples = [
    { id: '1', firstName: 'Avery', lastName: 'Johnson' },
    { id: '2', firstName: 'Bianca', lastName: 'Rivera' },
    { id: '3', firstName: 'Jordan', lastName: 'Fields' },
    { id: '4', firstName: 'Alex', lastName: 'Smith' }
  ];
  
  // Test 1: No search query returns all
  try {
    console.log('\nTest 1: Filter with no search query');
    const result = filterBySearch(examples, null);
    
    if (result.length === examples.length) {
      console.log('  ✓ PASS: Returns all examples when no search query');
      passed++;
    } else {
      console.log(`  ✗ FAIL: Expected ${examples.length}, got ${result.length}`);
      failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error filtering:', error.message);
    failed++;
  }
  
  // Test 2: Search by first name
  try {
    console.log('\nTest 2: Filter by first name');
    const result = filterBySearch(examples, 'Avery');
    
    if (result.length === 1 && result[0].firstName === 'Avery') {
      console.log('  ✓ PASS: Found person by first name');
      passed++;
    } else {
      console.log(`  ✗ FAIL: Expected 1 result, got ${result.length}`);
      failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error filtering by first name:', error.message);
    failed++;
  }
  
  // Test 3: Search by last name
  try {
    console.log('\nTest 3: Filter by last name');
    const result = filterBySearch(examples, 'Rivera');
    
    if (result.length === 1 && result[0].lastName === 'Rivera') {
      console.log('  ✓ PASS: Found person by last name');
      passed++;
    } else {
      console.log(`  ✗ FAIL: Expected 1 result, got ${result.length}`);
      failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error filtering by last name:', error.message);
    failed++;
  }
  
  // Test 4: Case-insensitive search
  try {
    console.log('\nTest 4: Case-insensitive search');
    const result = filterBySearch(examples, 'avery');
    
    if (result.length === 1 && result[0].firstName === 'Avery') {
      console.log('  ✓ PASS: Case-insensitive search works');
      passed++;
    } else {
      console.log(`  ✗ FAIL: Expected 1 result, got ${result.length}`);
      failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error with case-insensitive search:', error.message);
    failed++;
  }
  
  // Test 5: No matches
  try {
    console.log('\nTest 5: Search with no matches');
    const result = filterBySearch(examples, 'NonExistent');
    
    if (result.length === 0) {
      console.log('  ✓ PASS: Returns empty array when no matches');
      passed++;
    } else {
      console.log(`  ✗ FAIL: Expected 0 results, got ${result.length}`);
      failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error with no matches:', error.message);
    failed++;
  }
  
  // Test 6: Pagination - first page
  try {
    console.log('\nTest 6: Pagination - first page');
    const result = applyPagination(examples, 2, 0);
    
    if (result.items.length === 2 && result.total === 4 && result.hasNext === true) {
      console.log('  ✓ PASS: First page pagination works');
      console.log(`    Items: ${result.items.length}, Total: ${result.total}, HasNext: ${result.hasNext}`);
      passed++;
    } else {
      console.log('  ✗ FAIL: Pagination not working correctly');
      console.log(`    Got: ${JSON.stringify(result, null, 2)}`);
      failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error with pagination:', error.message);
    failed++;
  }
  
  // Test 7: Pagination - last page
  try {
    console.log('\nTest 7: Pagination - last page');
    const result = applyPagination(examples, 2, 2);
    
    if (result.items.length === 2 && result.total === 4 && result.hasNext === false) {
      console.log('  ✓ PASS: Last page pagination works');
      console.log(`    Items: ${result.items.length}, Total: ${result.total}, HasNext: ${result.hasNext}`);
      passed++;
    } else {
      console.log('  ✗ FAIL: Last page pagination not working correctly');
      console.log(`    Got: ${JSON.stringify(result, null, 2)}`);
      failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error with last page pagination:', error.message);
    failed++;
  }
  
  // Test 8: Pagination - empty result
  try {
    console.log('\nTest 8: Pagination - empty result');
    const result = applyPagination([], 25, 0);
    
    if (result.items.length === 0 && result.total === 0 && result.hasNext === false) {
      console.log('  ✓ PASS: Empty pagination works');
      passed++;
    } else {
      console.log('  ✗ FAIL: Empty pagination not working correctly');
      failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error with empty pagination:', error.message);
    failed++;
  }
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log(`\nTest Results: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();

