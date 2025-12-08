/**
 * Unit tests for list response generation
 * Run with: node tests/mock-server/list-response.test.js
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

function generateListResponse(spec, listSchemaRef, individualExamples, queryParams = {}, specPath = null) {
  // Simplified version - in real code this resolves the schema
  const listSchema = listSchemaRef || {
    properties: {
      limit: { default: 25 },
      offset: { default: 0 }
    }
  };

  // Filter by search if provided
  let filtered = individualExamples;
  if (queryParams.search) {
    filtered = filterBySearch(individualExamples, queryParams.search);
  }

  // Apply pagination
  const limit = parseInt(queryParams.limit) || listSchema.properties?.limit?.default || 25;
  const offset = parseInt(queryParams.offset) || listSchema.properties?.offset?.default || 0;
  
  return applyPagination(filtered, limit, offset);
}

function runTests() {
  console.log('Testing List Response Generation\n');
  console.log('='.repeat(70));
  
  let passed = 0;
  let failed = 0;
  
  // Sample data
  const examples = [
    { id: '1', firstName: 'Avery', lastName: 'Johnson' },
    { id: '2', firstName: 'Bianca', lastName: 'Rivera' },
    { id: '3', firstName: 'Jordan', lastName: 'Fields' }
  ];
  
  const listSchema = {
    properties: {
      limit: { default: 25 },
      offset: { default: 0 }
    }
  };
  
  // Test 1: Default list response (no filters)
  try {
    console.log('\nTest 1: Generate default list response');
    const result = generateListResponse({}, listSchema, examples, {});
    
    if (result.items.length === 3 && result.total === 3 && result.limit === 25 && result.offset === 0) {
      console.log('  ✓ PASS: Default list response generated correctly');
      passed++;
    } else {
      console.log('  ✗ FAIL: Default list response not correct');
      console.log(`    Got: ${JSON.stringify(result, null, 2)}`);
      failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error generating default list:', error.message);
    failed++;
  }
  
  // Test 2: List response with search
  try {
    console.log('\nTest 2: Generate list response with search');
    const result = generateListResponse({}, listSchema, examples, { search: 'Avery' });
    
    if (result.items.length === 1 && result.total === 1 && result.items[0].firstName === 'Avery') {
      console.log('  ✓ PASS: List response with search generated correctly');
      passed++;
    } else {
      console.log('  ✗ FAIL: List response with search not correct');
      console.log(`    Got: ${JSON.stringify(result, null, 2)}`);
      failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error generating list with search:', error.message);
    failed++;
  }
  
  // Test 3: List response with pagination
  try {
    console.log('\nTest 3: Generate list response with pagination');
    const result = generateListResponse({}, listSchema, examples, { limit: '2', offset: '0' });
    
    if (result.items.length === 2 && result.total === 3 && result.limit === 2 && result.hasNext === true) {
      console.log('  ✓ PASS: List response with pagination generated correctly');
      passed++;
    } else {
      console.log('  ✗ FAIL: List response with pagination not correct');
      console.log(`    Got: ${JSON.stringify(result, null, 2)}`);
      failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error generating list with pagination:', error.message);
    failed++;
  }
  
  // Test 4: List response with search and pagination
  try {
    console.log('\nTest 4: Generate list response with search and pagination');
    const result = generateListResponse({}, listSchema, examples, { search: 'Rivera', limit: '1', offset: '0' });
    
    if (result.items.length === 1 && result.total === 1 && result.items[0].lastName === 'Rivera') {
      console.log('  ✓ PASS: List response with search and pagination generated correctly');
      passed++;
    } else {
      console.log('  ✗ FAIL: List response with search and pagination not correct');
      console.log(`    Got: ${JSON.stringify(result, null, 2)}`);
      failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error generating list with search and pagination:', error.message);
    failed++;
  }
  
  // Test 5: Empty search results
  try {
    console.log('\nTest 5: Generate list response for empty search');
    const result = generateListResponse({}, listSchema, examples, { search: 'NonExistent' });
    
    if (result.items.length === 0 && result.total === 0 && result.hasNext === false) {
      console.log('  ✓ PASS: Empty search results handled correctly');
      passed++;
    } else {
      console.log('  ✗ FAIL: Empty search results not handled correctly');
      console.log(`    Got: ${JSON.stringify(result, null, 2)}`);
      failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error with empty search results:', error.message);
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

