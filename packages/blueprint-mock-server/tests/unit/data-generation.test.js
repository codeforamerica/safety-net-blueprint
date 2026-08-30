/**
 * Unit tests for data generation functions
 * Run with: node tests/mock-server/data-generation.test.js
 */

import { randomUUID } from 'crypto';

// Simplified versions of the functions for testing
function generateValueFromSchema(schema, fieldName = '') {
  if (!schema || typeof schema !== 'object') {
    return null;
  }

  if (schema.$ref) {
    return null;
  }

  const type = schema.type;

  switch (type) {
    case 'string':
      if (schema.enum && schema.enum.length > 0) {
        return schema.enum[Math.floor(Math.random() * schema.enum.length)];
      }
      if (schema.format === 'uuid') {
        return randomUUID();
      }
      if (schema.format === 'email') {
        return `${fieldName || 'user'}${Math.floor(Math.random() * 1000)}@example.com`;
      }
      if (schema.format === 'date') {
        const year = 1980 + Math.floor(Math.random() * 40);
        const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
        const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      if (schema.format === 'date-time') {
        return new Date().toISOString();
      }
      if (schema.pattern) {
        if (schema.pattern.includes('\\d{3}-\\d{2}-\\d{4}')) {
          const part1 = String(Math.floor(Math.random() * 900) + 100);
          const part2 = String(Math.floor(Math.random() * 90) + 10);
          const part3 = String(Math.floor(Math.random() * 9000) + 1000);
          return `${part1}-${part2}-${part3}`;
        }
      }
      const minLength = schema.minLength || 1;
      const maxLength = schema.maxLength || 50;
      const length = minLength + Math.floor(Math.random() * (maxLength - minLength + 1));
      return 'x'.repeat(length);

    case 'integer':
    case 'number':
      const min = schema.minimum !== undefined ? schema.minimum : 0;
      const max = schema.maximum !== undefined ? schema.maximum : 1000;
      const value = min + Math.floor(Math.random() * (max - min + 1));
      return type === 'integer' ? value : value + Math.random();

    case 'boolean':
      return Math.random() > 0.5;

    case 'array':
      if (schema.items) {
        const arrayLength = schema.minItems || 1;
        return Array.from({ length: arrayLength }, () => generateValueFromSchema(schema.items, 'item'));
      }
      return [];

    case 'object':
      if (schema.properties) {
        const obj = {};
        const required = schema.required || [];
        
        for (const field of required) {
          if (schema.properties[field]) {
            obj[field] = generateValueFromSchema(schema.properties[field], field);
          }
        }
        
        for (const [key, value] of Object.entries(schema.properties)) {
          if (!required.includes(key) && Math.random() > 0.5) {
            obj[key] = generateValueFromSchema(value, key);
          }
        }
        
        return obj;
      }
      return {};

    default:
      return null;
  }
}

function runTests() {
  console.log('Testing Data Generation Functions\n');
  console.log('='.repeat(70));
  
  let passed = 0;
  let failed = 0;
  
  // Test 1: UUID generation
  try {
    console.log('\nTest 1: Generate UUID from schema');
    const schema = { type: 'string', format: 'uuid' };
    const value = generateValueFromSchema(schema);
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (value && uuidRegex.test(value)) {
      console.log('  ✓ PASS: UUID generated correctly');
      console.log(`    Generated: ${value}`);
      passed++;
    } else {
      console.log('  ✗ FAIL: UUID not generated correctly');
      console.log(`    Got: ${value}`);
      failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error generating UUID:', error.message);
    failed++;
  }
  
  // Test 2: Email generation
  try {
    console.log('\nTest 2: Generate email from schema');
    const schema = { type: 'string', format: 'email' };
    const value = generateValueFromSchema(schema, 'test');
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (value && emailRegex.test(value) && value.includes('test')) {
      console.log('  ✓ PASS: Email generated correctly');
      console.log(`    Generated: ${value}`);
      passed++;
    } else {
      console.log('  ✗ FAIL: Email not generated correctly');
      console.log(`    Got: ${value}`);
      failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error generating email:', error.message);
    failed++;
  }
  
  // Test 3: Enum selection
  try {
    console.log('\nTest 3: Select value from enum');
    const schema = { type: 'string', enum: ['male', 'female', 'non_binary'] };
    const value = generateValueFromSchema(schema);
    
    if (schema.enum.includes(value)) {
      console.log('  ✓ PASS: Enum value selected correctly');
      console.log(`    Selected: ${value}`);
      passed++;
    } else {
      console.log('  ✗ FAIL: Enum value not selected correctly');
      console.log(`    Got: ${value}, Expected one of: ${schema.enum.join(', ')}`);
      failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error selecting enum:', error.message);
    failed++;
  }
  
  // Test 4: SSN pattern
  try {
    console.log('\nTest 4: Generate SSN from pattern');
    const schema = { type: 'string', pattern: '^\\d{3}-\\d{2}-\\d{4}$' };
    const value = generateValueFromSchema(schema);
    const ssnRegex = /^\d{3}-\d{2}-\d{4}$/;
    
    if (value && ssnRegex.test(value)) {
      console.log('  ✓ PASS: SSN generated correctly');
      console.log(`    Generated: ${value}`);
      passed++;
    } else {
      console.log('  ✗ FAIL: SSN not generated correctly');
      console.log(`    Got: ${value}`);
      failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error generating SSN:', error.message);
    failed++;
  }
  
  // Test 5: Integer with min/max
  try {
    console.log('\nTest 5: Generate integer within range');
    const schema = { type: 'integer', minimum: 1, maximum: 100 };
    const value = generateValueFromSchema(schema);
    
    if (typeof value === 'number' && value >= 1 && value <= 100 && Number.isInteger(value)) {
      console.log('  ✓ PASS: Integer generated within range');
      console.log(`    Generated: ${value}`);
      passed++;
    } else {
      console.log('  ✗ FAIL: Integer not generated correctly');
      console.log(`    Got: ${value}, Expected: integer between 1 and 100`);
      failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error generating integer:', error.message);
    failed++;
  }
  
  // Test 6: Object with required fields
  try {
    console.log('\nTest 6: Generate object with required fields');
    const schema = {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string', minLength: 1, maxLength: 10 },
        optional: { type: 'string' }
      }
    };
    const value = generateValueFromSchema(schema);
    
    if (value && value.id && value.name && typeof value.id === 'string' && typeof value.name === 'string') {
      console.log('  ✓ PASS: Object with required fields generated correctly');
      console.log(`    Generated: ${JSON.stringify(value, null, 2)}`);
      passed++;
    } else {
      console.log('  ✗ FAIL: Object not generated correctly');
      console.log(`    Got: ${JSON.stringify(value, null, 2)}`);
      failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error generating object:', error.message);
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

