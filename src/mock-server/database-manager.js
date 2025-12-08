/**
 * Database manager for SQLite persistence
 * Uses JSON column storage for flexible schema
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { deepMerge } from './deep-merge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Store database connections
const databases = new Map();

/**
 * Get or create database for a resource type
 * @param {string} resourceName - Name of the resource (e.g., 'persons')
 * @returns {Database} SQLite database instance
 */
export function getDatabase(resourceName) {
  if (databases.has(resourceName)) {
    return databases.get(resourceName);
  }
  
  const dataDir = join(__dirname, '../../generated/mock-data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  
  const dbPath = join(dataDir, `${resourceName}.db`);
  const db = new Database(dbPath);
  
  // Enable JSON support
  db.pragma('journal_mode = WAL');
  
  // Create resources table with JSON storage
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
    `);
  } catch (error) {
    console.error(`Failed to create resources table for ${resourceName}:`, error);
    throw error;
  }
  
  // Create indexes for common search fields
  // These improve query performance for JSON extracts
  // Using nested path for name fields (name.firstName, name.lastName)
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_name_firstName ON resources(json_extract(data, '$.name.firstName'));`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_name_lastName ON resources(json_extract(data, '$.name.lastName'));`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_status ON resources(json_extract(data, '$.status'));`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_email ON resources(json_extract(data, '$.email'));`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_createdAt ON resources(json_extract(data, '$.createdAt'));`);
  } catch (error) {
    // Indexes may already exist or fields may not be present in all resources
    console.warn(`Warning: Could not create indexes for ${resourceName}:`, error.message);
  }
  
  databases.set(resourceName, db);
  return db;
}

/**
 * Find all resources with optional filtering and pagination
 * @param {string} resourceName - Name of the resource
 * @param {Object} filters - Filter conditions (key-value pairs)
 * @param {Object} pagination - Pagination options {limit, offset}
 * @returns {Object} {items: Array, total: number}
 */
export function findAll(resourceName, filters = {}, pagination = {}) {
  const db = getDatabase(resourceName);
  const { limit = 25, offset = 0 } = pagination;
  
  // Build WHERE clause from filters
  const whereClauses = [];
  const params = [];
  
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null) {
      whereClauses.push(`json_extract(data, '$.${key}') = ?`);
      params.push(value);
    }
  }
  
  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  
  // Get total count
  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM resources ${whereClause}`);
  const { count: total } = countStmt.get(...params);
  
  // Get paginated items
  const selectStmt = db.prepare(`
    SELECT data FROM resources 
    ${whereClause}
    ORDER BY json_extract(data, '$.createdAt') DESC
    LIMIT ? OFFSET ?
  `);
  
  const rows = selectStmt.all(...params, limit, offset);
  const items = rows.map(row => JSON.parse(row.data));
  
  return { items, total };
}

/**
 * Search resources by query
 * @param {string} resourceName - Name of the resource
 * @param {string} query - Search query
 * @param {string[]} searchFields - Fields to search in
 * @param {Object} pagination - Pagination options
 * @returns {Object} {items: Array, total: number}
 */
export function search(resourceName, query, searchFields = [], pagination = {}) {
  const db = getDatabase(resourceName);
  const { limit = 25, offset = 0 } = pagination;
  
  if (!query || searchFields.length === 0) {
    return findAll(resourceName, {}, pagination);
  }
  
  // Build WHERE clause for search
  const whereClauses = searchFields.map(field => 
    `LOWER(json_extract(data, '$.${field}')) LIKE LOWER(?)`
  );
  const whereClause = `WHERE ${whereClauses.join(' OR ')}`;
  
  // Prepare search pattern
  const searchPattern = `%${query}%`;
  const params = searchFields.map(() => searchPattern);
  
  // Get total count
  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM resources ${whereClause}`);
  const { count: total } = countStmt.get(...params);
  
  // Get paginated items
  const selectStmt = db.prepare(`
    SELECT data FROM resources 
    ${whereClause}
    ORDER BY json_extract(data, '$.createdAt') DESC
    LIMIT ? OFFSET ?
  `);
  
  const rows = selectStmt.all(...params, limit, offset);
  const items = rows.map(row => JSON.parse(row.data));
  
  return { items, total };
}

/**
 * Find a resource by ID
 * @param {string} resourceName - Name of the resource
 * @param {string} id - Resource ID
 * @returns {Object|null} Resource object or null if not found
 */
export function findById(resourceName, id) {
  const db = getDatabase(resourceName);
  const stmt = db.prepare('SELECT data FROM resources WHERE id = ?');
  const row = stmt.get(id);
  
  if (!row) {
    return null;
  }
  
  return JSON.parse(row.data);
}

/**
 * Create a new resource
 * @param {string} resourceName - Name of the resource
 * @param {Object} data - Resource data
 * @returns {Object} Created resource with generated fields
 */
export function create(resourceName, data) {
  const db = getDatabase(resourceName);
  
  // Generate server-side fields
  const id = randomUUID();
  const now = new Date().toISOString();
  
  const resource = {
    ...data,
    id,
    createdAt: now,
    updatedAt: now
  };
  
  const stmt = db.prepare('INSERT INTO resources (id, data) VALUES (?, ?)');
  stmt.run(id, JSON.stringify(resource));
  
  return resource;
}

/**
 * Update a resource
 * @param {string} resourceName - Name of the resource
 * @param {string} id - Resource ID
 * @param {Object} updates - Fields to update
 * @returns {Object|null} Updated resource or null if not found
 */
export function update(resourceName, id, updates) {
  const db = getDatabase(resourceName);
  
  // Get existing resource
  const existing = findById(resourceName, id);
  if (!existing) {
    return null;
  }
  
  // Deep merge updates (preserving id and createdAt)
  const merged = deepMerge(existing, updates, ['id', 'createdAt']);
  const updated = {
    ...merged,
    updatedAt: new Date().toISOString()
  };
  
  const stmt = db.prepare('UPDATE resources SET data = ? WHERE id = ?');
  stmt.run(JSON.stringify(updated), id);
  
  return updated;
}

/**
 * Delete a resource
 * @param {string} resourceName - Name of the resource
 * @param {string} id - Resource ID
 * @returns {boolean} True if deleted, false if not found
 */
export function deleteResource(resourceName, id) {
  const db = getDatabase(resourceName);
  
  const stmt = db.prepare('DELETE FROM resources WHERE id = ? RETURNING id');
  const result = stmt.get(id);
  
  return result !== undefined;
}

/**
 * Clear all resources from a database
 * @param {string} resourceName - Name of the resource
 */
export function clearAll(resourceName) {
  const db = getDatabase(resourceName);
  db.prepare('DELETE FROM resources').run();
}

/**
 * Insert a resource with specific ID (for seeding)
 * @param {string} resourceName - Name of the resource
 * @param {Object} resource - Complete resource object with id
 */
export function insertResource(resourceName, resource) {
  const db = getDatabase(resourceName);
  
  // Ensure timestamps exist
  if (!resource.createdAt) {
    resource.createdAt = new Date().toISOString();
  }
  if (!resource.updatedAt) {
    resource.updatedAt = resource.createdAt;
  }
  
  const stmt = db.prepare('INSERT OR REPLACE INTO resources (id, data) VALUES (?, ?)');
  stmt.run(resource.id, JSON.stringify(resource));
}

/**
 * Get count of resources
 * @param {string} resourceName - Name of the resource
 * @returns {number} Count of resources
 */
export function count(resourceName) {
  const db = getDatabase(resourceName);
  const { count } = db.prepare('SELECT COUNT(*) as count FROM resources').get();
  return count;
}

/**
 * Close all database connections
 */
export function closeAll() {
  for (const [name, db] of databases.entries()) {
    db.close();
    databases.delete(name);
  }
}
