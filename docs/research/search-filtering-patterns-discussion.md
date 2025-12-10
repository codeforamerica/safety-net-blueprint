# REST API Search & Filtering Patterns Discussion

*Exported conversation exploring options for adding generic search/filtering capabilities to REST APIs*

---

## Context

This discussion explores alternatives for adding search/filtering capabilities to a REST API (Safety Net OpenAPI toolkit) with these goals:
- Minimal changes to REST API specs
- As simple/generic as possible
- Backend-agnostic

---

## Approaches Considered

### 1. JSON:API Filtering
```
GET /applications?filter[status]=submitted&filter[programs]=snap,cash_programs
```
- Well-documented spec with wide adoption
- Clean syntax: `filter[field]=value`
- Supports operators: `filter[income][gte]=1000`

### 2. OData-style Query Parameters
```
GET /persons?$filter=monthlyIncome gt 1000 and status eq 'approved'&$orderby=createdAt desc
```
- Very powerful, supports complex expressions
- Industry standard (Microsoft ecosystem)
- **Downside**: More complex to parse and implement

### 3. GraphQL-like Query Params (LHS Brackets)
```
GET /applications?status[eq]=submitted&income[gte]=1000&programs[contains]=snap
```
- Operators in brackets: `[eq]`, `[ne]`, `[gt]`, `[gte]`, `[lt]`, `[lte]`, `[contains]`, `[in]`
- Clean for OpenAPI documentation

### 4. RSQL/FIQL (Feed Item Query Language)
```
GET /persons?query=status==approved;monthlyIncome>=1000,email==*@example.com
```
- Compact expression syntax
- `;` for AND, `,` for OR
- **Downside**: Requires a parser library

### 5. Simple Field-Based Filtering
```
GET /persons?status=approved&monthlyIncome.gte=1000&sort=-createdAt
```
- Dot notation for nested fields
- Suffix operators: `.gte`, `.lte`, `.contains`, `.in`

---

## Most Widely Used Approaches in Production

### 1. Simple Query Parameters (Most Common)
```
GET /users?status=active&role=admin&created_after=2024-01-01
```
**Used by:** GitHub, Stripe, Twilio, most APIs

**Pros:** Dead simple, self-documenting, easy to cache
**Cons:** No standard for operators (each API invents its own)

### 2. JSON:API `filter[]` Syntax (Second Most Common)
```
GET /users?filter[status]=active&filter[age][gte]=21
```
**Used by:** Shopify, Ember ecosystem, government APIs

**Pros:** Formal spec, clear namespacing, operator support
**Cons:** Verbose, bracket encoding issues

### 3. Field-Level Operators (Growing Adoption)
```
GET /users?status=active&age__gte=21&name__contains=john
```
**Used by:** Django REST Framework, Strapi, many Python/Node APIs

**Pros:** Clean, intuitive, easy to implement
**Cons:** No formal standard (though `__` convention is de facto)

---

## Options That Don't Require Specific Properties in Spec

### 1. Single `filter` String Parameter (OData-style)
```
GET /persons?filter=status eq 'approved' and income gte 1000
```
**Used by:** OData, Microsoft Graph API, Salesforce SOQL

```yaml
- name: filter
  in: query
  schema:
    type: string
  description: Filter expression (OData syntax)
```

### 2. Single `q` or `query` Parameter (Search syntax)
```
GET /persons?q=status:approved income:>1000 name:john*
```
**Used by:** Elasticsearch, GitHub search, Jira JQL, Lucene-based APIs

```yaml
- name: q
  in: query
  schema:
    type: string
  description: Search query with field:value syntax
```

### 3. JSON-encoded `filter` Parameter
```
GET /persons?filter={"status":"approved","income":{"$gte":1000}}
```
**Used by:** MongoDB Atlas API, Strapi, LoopBack, Parse

```yaml
- name: filter
  in: query
  schema:
    type: string
  description: JSON-encoded filter object
```

---

## Query String vs Request Body

### Query String (Standard REST)
```
GET /persons?filter={"status":"approved","income":{"$gte":1000}}
```

**Pros:**
- RESTful—`GET` with no body
- Cacheable (CDNs, browsers, proxies)
- Bookmarkable/shareable URLs
- Works with browser, curl, any HTTP client

**Cons:**
- URL encoding makes it ugly: `%7B%22status%22%3A%22approved%22%7D`
- URL length limits (~2KB safe, ~8KB max depending on server)
- Complex filters become unreadable

### Request Body (Pragmatic for Complex Filters)
```
POST /persons/search
Content-Type: application/json

{"status": "approved", "income": {"$gte": 1000}}
```

**Used by:** Elasticsearch, Shopify GraphQL, Algolia, MongoDB Atlas

**Pros:**
- Clean JSON, no encoding
- No length limits
- Easier to construct programmatically
- Supports arbitrarily complex queries

**Cons:**
- Not RESTful (POST for a read operation)
- Not cacheable without extra work

### Hybrid Approach (Common Compromise)
Many APIs do both:

| Endpoint | Use Case |
|----------|----------|
| `GET /persons?filter=...` | Simple filters, cacheable |
| `POST /persons/search` | Complex queries, no limits |

---

## Final Recommendation (Backend-Agnostic)

### `POST /resources/search` with JSON body

```
POST /persons/search
Content-Type: application/json

{
  "filter": {
    "status": "approved",
    "monthlyIncome": { "$gte": 1000 }
  },
  "sort": ["-createdAt", "name.lastName"],
  "limit": 25,
  "offset": 0
}
```

### Why This Wins

| Factor | Benefit |
|--------|---------|
| **Spec simplicity** | One endpoint, one request body schema |
| **No URL encoding** | Clean, readable JSON |
| **No length limits** | Complex filters aren't a problem |
| **Self-documenting** | JSON schema describes all options |
| **Widely adopted** | Elasticsearch, Algolia, Typesense, Meilisearch, Shopify |
| **Language agnostic** | Easy to build in any client |
| **Extensible** | Add features (aggregations, facets, projections) without breaking changes |

### OpenAPI Spec (Minimal)

```yaml
/persons/search:
  post:
    summary: Search persons
    requestBody:
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/SearchRequest'
    responses:
      '200':
        description: Search results
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SearchResponse'
```

```yaml
components:
  schemas:
    SearchRequest:
      type: object
      properties:
        filter:
          type: object
          description: Field filters with optional operators ($eq, $ne, $gt, $gte, $lt, $lte, $in, $contains)
        sort:
          type: array
          items:
            type: string
          description: Sort fields (prefix with - for descending)
        limit:
          type: integer
          default: 25
        offset:
          type: integer
          default: 0
```

### The Trade-off

You lose `GET` cacheability, but in practice:
- Most filtered searches aren't cached anyway
- Search results change frequently
- If you need caching, add `GET` with simple filters later

---

This is the **cleanest, most generic, most future-proof** approach for search/filtering in REST APIs today.
