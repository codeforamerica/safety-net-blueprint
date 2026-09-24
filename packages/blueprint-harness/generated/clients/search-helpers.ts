/**
 * Search Query Helpers for Safety Net API Clients
 *
 * This module provides utilities for building search queries using the
 * field:value syntax supported by all list endpoints.
 *
 * @module search-helpers
 *
 * @example
 * import { q, search } from '@codeforamerica/safety-net-colorado';
 *
 * const query = q(
 *   search.eq("status", "approved"),
 *   search.gte("income", 1000),
 *   search.in("programs", ["snap", "cash_programs"])
 * );
 * // => "status:approved income:>=1000 programs:snap,cash_programs"
 *
 * const results = await personsClient.listPersons({
 *   queries: { q: query, limit: 25 }
 * });
 */

/**
 * Combines multiple search conditions into a single query string.
 *
 * Multiple conditions are ANDed together (all must match).
 * Use comma-separated values within a single condition for OR logic.
 *
 * ## Syntax Reference
 *
 * | Pattern | Description | Example |
 * |---------|-------------|---------|
 * | `term` | Full-text exact match | `john` |
 * | `*term*` | Full-text contains | `*john*` |
 * | `term*` | Full-text starts with | `john*` |
 * | `*term` | Full-text ends with | `*smith` |
 * | `field:value` | Exact match | `status:approved` |
 * | `field:*value*` | Contains (case-insensitive) | `name:*john*` |
 * | `field:value*` | Starts with | `name:john*` |
 * | `field:*value` | Ends with | `email:*@example.com` |
 * | `field:"value"` | Quoted value (for spaces) | `name:"john doe"` |
 * | `field.nested:value` | Nested field (dot notation) | `address.state:CA` |
 * | `field:>value` | Greater than | `income:>1000` |
 * | `field:>=value` | Greater than or equal | `income:>=1000` |
 * | `field:<value` | Less than | `income:<5000` |
 * | `field:<=value` | Less than or equal | `income:<=5000` |
 * | `field:val1,val2` | Match any value (OR) | `status:approved,pending` |
 * | `-field:value` | Exclude / negate | `-status:denied` |
 * | `field:*` | Field exists (not null) | `email:*` |
 * | `-field:*` | Field does not exist | `-deletedAt:*` |
 *
 * @example
 * // Full-text search
 * q("john")
 * // => "john"
 *
 * @example
 * // Exact match on a field
 * q("status:approved")
 * // => "status:approved"
 *
 * @example
 * // Multiple conditions (AND)
 * q("status:approved", "income:>=1000")
 * // => "status:approved income:>=1000"
 *
 * @example
 * // Using the search builder
 * q(search.eq("status", "approved"), search.gte("income", 1000))
 * // => "status:approved income:>=1000"
 *
 * @param conditions - One or more search conditions to combine
 * @returns A search query string to pass to the `q` parameter
 */
export function q(...conditions: string[]): string {
  return conditions.filter(Boolean).join(" ");
}

/**
 * Search query builder with type-safe methods for each operator.
 *
 * Use these methods to construct search conditions without memorizing
 * the query syntax. All methods return strings that can be passed to `q()`.
 *
 * @example
 * import { q, search } from '@codeforamerica/safety-net-colorado';
 *
 * // Build a complex query
 * const query = q(
 *   search.eq("status", "approved"),
 *   search.gte("income", 1000),
 *   search.in("programs", ["snap", "medical_assistance"]),
 *   search.not("state", "TX")
 * );
 *
 * // Use with Zodios client
 * const results = await personsClient.listPersons({
 *   queries: { q: query, limit: 25 }
 * });
 */
export const search = {
  /**
   * Exact match: `field:value`
   *
   * @example
   * search.eq("status", "approved")
   * // => "status:approved"
   *
   * @example
   * // Nested field
   * search.eq("address.state", "CA")
   * // => "address.state:CA"
   */
  eq: (field: string, value: string | number | boolean): string =>
    `${field}:${value}`,

  /**
   * Greater than: `field:>value`
   *
   * @example
   * search.gt("income", 1000)
   * // => "income:>1000"
   */
  gt: (field: string, value: string | number): string => `${field}:>${value}`,

  /**
   * Greater than or equal: `field:>=value`
   *
   * @example
   * search.gte("income", 1000)
   * // => "income:>=1000"
   */
  gte: (field: string, value: string | number): string => `${field}:>=${value}`,

  /**
   * Less than: `field:<value`
   *
   * @example
   * search.lt("age", 65)
   * // => "age:<65"
   */
  lt: (field: string, value: string | number): string => `${field}:<${value}`,

  /**
   * Less than or equal: `field:<=value`
   *
   * @example
   * search.lte("income", 5000)
   * // => "income:<=5000"
   */
  lte: (field: string, value: string | number): string => `${field}:<=${value}`,

  /**
   * Match any of the values (OR): `field:val1,val2,val3`
   *
   * @example
   * search.in("status", ["approved", "pending", "under_review"])
   * // => "status:approved,pending,under_review"
   */
  in: (field: string, values: (string | number)[]): string =>
    `${field}:${values.join(",")}`,

  /**
   * Exclude / negate: `-field:value`
   *
   * @example
   * search.not("status", "denied")
   * // => "-status:denied"
   */
  not: (field: string, value: string | number): string => `-${field}:${value}`,

  /**
   * Field exists (is not null): `field:*`
   *
   * @example
   * search.exists("email")
   * // => "email:*"
   */
  exists: (field: string): string => `${field}:*`,

  /**
   * Field does not exist (is null): `-field:*`
   *
   * @example
   * search.notExists("deletedAt")
   * // => "-deletedAt:*"
   */
  notExists: (field: string): string => `-${field}:*`,

  /**
   * Contains (case-insensitive): `field:*value*`
   *
   * @example
   * search.contains("name", "john")
   * // => "name:*john*"
   */
  contains: (field: string, value: string): string => `${field}:*${value}*`,

  /**
   * Starts with (case-insensitive): `field:value*`
   *
   * @example
   * search.startsWith("name", "john")
   * // => "name:john*"
   */
  startsWith: (field: string, value: string): string => `${field}:${value}*`,

  /**
   * Ends with (case-insensitive): `field:*value`
   *
   * @example
   * search.endsWith("email", "@example.com")
   * // => "email:*@example.com"
   */
  endsWith: (field: string, value: string): string => `${field}:*${value}`,

  /**
   * Quoted value (for values containing spaces): `field:"value with spaces"`
   *
   * @example
   * search.quoted("name", "john doe")
   * // => 'name:"john doe"'
   */
  quoted: (field: string, value: string): string => `${field}:"${value}"`,

  /**
   * Full-text exact match (no field specified)
   *
   * Searches across all searchable fields for an exact match of the term.
   *
   * @example
   * search.text("john")
   * // => "john"
   */
  text: (term: string): string => term,

  /**
   * Full-text contains search (no field specified)
   *
   * @example
   * search.textContains("john")
   * // => "*john*"
   */
  textContains: (term: string): string => `*${term}*`,

  /**
   * Full-text starts with search (no field specified)
   *
   * @example
   * search.textStartsWith("john")
   * // => "john*"
   */
  textStartsWith: (term: string): string => `${term}*`,

  /**
   * Full-text ends with search (no field specified)
   *
   * @example
   * search.textEndsWith("smith")
   * // => "*smith"
   */
  textEndsWith: (term: string): string => `*${term}`,
};
