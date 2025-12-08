# Swagger UI - Interactive API Documentation

**Dynamically generated** interactive API documentation from your OpenAPI specifications. The Swagger UI server automatically discovers and serves documentation for all your APIs.

✨ **Everything is auto-discovered** - Add a new OpenAPI spec, restart the server, and see instant documentation!

**For comprehensive testing documentation:** [Testing Guide](./README_TESTING.md)

## Quick Start

```bash
# Start both servers together
npm start

# Or start individually:
npm run swagger:start   # Swagger UI (port 3000)
npm run mock:start      # Mock server (port 1080)
```

**Available at:**
- Swagger UI: `http://localhost:3000`
- Mock API: `http://localhost:1080`

**View documentation:**
- Landing page: `http://localhost:3000` (lists all discovered APIs)
- Individual APIs: `/{api-name}` (one page per spec file)

**Try it out:**
1. Select an API from landing page → Expand endpoint → Click "Try it out" → Execute

## What You Get

✅ **Auto-discovery** - Automatically finds all OpenAPI specs in `/openapi`  
✅ **Multiple APIs** - Separate documentation page for each API  
✅ **Landing page** - Beautiful homepage linking to all APIs  
✅ **Live testing** - "Try it out" functionality against your mock server  
✅ **Real-time updates** - Restart server to see spec changes  
✅ **No file modifications** - Specs are modified in-memory only  

## Features

### Auto-Discovery

Swagger UI automatically discovers all `.yaml` files directly under `/openapi`:

```
openapi/
├── api-one.yaml        ← Discovered
├── api-two.yaml        ← Discovered
├── api-three.yaml      ← Discovered
├── components/         ← Ignored (subdirectory)
└── examples/           ← Ignored (subdirectory)
```

**The server discovers:**
- Any `.yaml` file in `/openapi` root directory
- Creates a documentation page at `/{filename}`
- Adds it to the landing page automatically

**Adding a new API:** Simply add a new `.yaml` file to `/openapi` and restart the Swagger server. No configuration needed!

### Landing Page

The root URL (`http://localhost:3000`) displays a beautiful landing page with:

- List of all available APIs
- Direct links to each API's documentation
- Mock server URL information
- Modern, responsive design

### Individual API Pages

Each API gets its own Swagger UI page with:

- Complete endpoint documentation
- Request/response schemas
- Example values from your OpenAPI specs
- "Try it out" functionality for live testing
- Model definitions and component schemas

### Server Configuration

The Swagger server automatically configures the "Servers" dropdown in Swagger UI to point to your mock server (`http://localhost:1080`), allowing seamless testing.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SWAGGER_HOST` | `localhost` | Host to bind Swagger UI server |
| `SWAGGER_PORT` | `3000` | Port for Swagger UI server |
| `MOCK_SERVER_URL` | `http://localhost:1080` | URL of mock server for "Try it out" |

### Change Swagger Port

```bash
SWAGGER_PORT=4000 npm run swagger:start
```

### Change Mock Server URL

If your mock server runs on a different port or host:

```bash
MOCK_SERVER_URL=http://localhost:8080 npm run swagger:start
```

### Change Host Binding

To allow external access:

```bash
SWAGGER_HOST=0.0.0.0 npm run swagger:start
```

## Usage Examples

### Example 1: Browse API Documentation

1. Visit `http://localhost:3000` (landing page)
2. Click any API from the list
3. Browse available endpoints
4. Expand any endpoint (e.g., `GET /{resources}`) to see:
   - Description from your OpenAPI spec
   - Parameters defined in your spec
   - Response schema
   - Example values

### Example 2: Test GET List Endpoint

1. Navigate to `http://localhost:3000/{api-name}`
2. Expand `GET /{resources}` (list endpoint)
3. Click **Try it out**
4. Set parameters (if defined in your spec):
   - `limit`: 2
   - `offset`: 0
5. Click **Execute**
6. View live response from your mock server:
   ```json
   {
     "items": [
       { "id": "...", ... },
       { "id": "...", ... }
     ],
     "total": 10,
     "limit": 2,
     "offset": 0,
     "hasNext": true
   }
   ```

### Example 3: Test POST Endpoint

1. Navigate to `http://localhost:3000/{api-name}`
2. Expand `POST /{resources}` (create endpoint)
3. Click **Try it out**
4. Edit the request body (pre-filled with example data from your spec)
5. Click **Execute**
6. View the created resource with generated ID and timestamps

### Example 4: Test Search/Filter

1. Navigate to `http://localhost:3000/{api-name}`
2. Expand `GET /{resources}` endpoint
3. Click **Try it out**
4. Set query parameters defined in your spec:
   - `search`: your-search-term
   - `limit`: 10
5. Click **Execute**
6. View filtered results from your mock server

## Architecture

### How It Works

1. **Discovery**: Server scans `/openapi` directory for `.yaml` files
2. **Loading**: Each spec is loaded and dereferenced (all `$ref` resolved)
3. **Configuration**: Server URLs updated in-memory to point to mock server
4. **Serving**: Each API gets:
   - Swagger UI page at `/{api-name}`
   - JSON spec endpoint at `/{api-name}/spec.json`
5. **Landing**: Root path serves custom landing page

### File Structure

```
scripts/swagger/
└── server.js           # Swagger UI server implementation

Dependencies:
- swagger-ui-express    # Swagger UI middleware
- express              # Web server
- @apidevtools/json-schema-ref-parser  # Resolve $refs
```

### In-Memory Processing

**Important:** The Swagger server never modifies your OpenAPI files on disk. All transformations happen in-memory:

- `$ref` resolution
- Server URL injection
- Spec serving

Your original files remain unchanged.

## Comparison with Other Tools

### Swagger UI vs Postman

| Feature | Swagger UI | Postman |
|---------|-----------|---------|
| **Documentation** | ✅ Excellent | ✅ Good |
| **Try It Out** | ✅ Built-in | ✅ Built-in |
| **Test Scripts** | ❌ No | ✅ Automated tests |
| **Collections** | ❌ No | ✅ Organized requests |
| **Environments** | ⚠️ Manual | ✅ Built-in |
| **Sharing** | ⚠️ URL only | ✅ Export collections |

**Use Swagger UI when:**
- You want to browse API documentation
- You need quick one-off API testing
- You want to share documentation with stakeholders

**Use Postman when:**
- You need automated test scripts
- You want to save request collections
- You need environment management

### Swagger UI vs Mock Server Alone

| Feature | Swagger UI | Mock Server |
|---------|-----------|-------------|
| **Documentation UI** | ✅ Beautiful | ❌ None |
| **Interactive Testing** | ✅ Browser-based | ⚠️ Command-line |
| **Schema Visibility** | ✅ Clear | ❌ Not visible |
| **Production Ready** | ⚠️ Docs only | ✅ Full server |

**Recommendation:** Use both together for the best experience.

## Troubleshooting

### Swagger UI not starting

**Issue:** Server won't start

**Solutions:**
- Check if port 3000 is already in use: `lsof -i :3000`
- Try a different port: `SWAGGER_PORT=4000 npm run swagger:start`
- Check for error messages in terminal

### "Try it out" not working

**Issue:** Clicking Execute shows errors or no response

**Solutions:**
- Ensure mock server is running: `npm run mock:start`
- Check mock server URL matches: Look at "Servers" dropdown in Swagger UI
- Verify mock server is accessible: `curl http://localhost:1080/health`
- Check browser console for CORS errors

### API not showing up

**Issue:** Your API doesn't appear on landing page

**Solutions:**
- Ensure `.yaml` file is directly in `/openapi` (not in subdirectory)
- Check file has valid OpenAPI format
- Check terminal for loading errors
- Restart Swagger server: Stop and run `npm run swagger:start` again

### Changes not reflected

**Issue:** Updated OpenAPI spec but Swagger UI shows old version

**Solutions:**
- Restart Swagger server (specs are loaded at startup)
- Hard refresh browser: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
- Clear browser cache

### CORS errors

**Issue:** Browser console shows CORS errors when using "Try it out"

**Solutions:**
- Ensure mock server has CORS enabled (it does by default)
- Check mock server is running
- Verify you're accessing Swagger UI via `localhost` (not `127.0.0.1` if mock uses `localhost`)

## Best Practices

### 1. Start Mock Server First

Always start the mock server before Swagger UI for the best experience:

```bash
# Terminal 1
npm run mock:start

# Terminal 2
npm run swagger:start
```

### 2. Keep Specs Well-Documented

Swagger UI displays descriptions from your OpenAPI specs. Add:
- Endpoint descriptions
- Parameter descriptions
- Schema descriptions
- Example values

### 3. Use Examples

Include example values in your OpenAPI specs for better documentation:

```yaml
components:
  schemas:
    YourResource:
      type: object
      properties:
        fieldName:
          type: string
          example: "example value"  # Shows in Swagger UI
```

### 4. Organize APIs

Create separate OpenAPI files for logical API groupings:
- `{domain}.yaml` - One domain per file
- `{feature}.yaml` - One feature area per file
- Each file gets its own documentation page

### 5. Use for Demos

Swagger UI is perfect for:
- Stakeholder demonstrations
- API design reviews
- Developer onboarding
- Client discussions

## Advanced Usage

### Custom Swagger Options

Edit `scripts/swagger/server.js` to customize Swagger UI options:

```javascript
const swaggerOptions = {
  swaggerOptions: {
    url: `/${api.name}/spec.json`,
    displayRequestDuration: true,  // Show response time
    persistAuthorization: true,    // Remember auth tokens
    tryItOutEnabled: true,          // Enable "Try it out"
    filter: true,                   // Add search filter
    syntaxHighlight: {             // Customize colors
      theme: "monokai"
    }
  }
};
```

### Multiple Environments

To test against different servers, restart Swagger with different mock server URLs:

**Development:**
```bash
MOCK_SERVER_URL=http://localhost:1080 npm run swagger:start
```

**Staging:**
```bash
MOCK_SERVER_URL=https://staging-api.example.com npm run swagger:start
```

### Deploy Swagger UI

For production documentation:

1. Deploy Swagger server to your infrastructure
2. Point `MOCK_SERVER_URL` to your production API
3. Configure authentication if needed
4. Share URL with your team/clients

## Tips & Tricks

💡 **Keyboard Shortcuts**: Use browser search (`Ctrl+F` / `Cmd+F`) to quickly find endpoints

💡 **Expand All**: Click "List Operations" dropdown → "Expand Operations" to see all at once

💡 **Model Definitions**: Scroll to bottom of page to see all schema definitions

💡 **Response Samples**: Click "Example Value" / "Model" tabs to switch between views

💡 **Authentication**: If your API requires auth, use the "Authorize" button at top

💡 **Copy curl**: After executing a request, copy the curl command from the response section

## How It Works

The Swagger server is completely dynamic:

1. **Scans `/openapi/`** - Finds all `.yaml` files in the root directory
2. **Loads specs** - Parses and validates each OpenAPI specification
3. **Resolves references** - Dereferences all `$ref` pointers
4. **Injects server URL** - Configures mock server URL for "Try it out"
5. **Creates routes** - Sets up `/{api-name}` route for each spec
6. **Serves documentation** - Renders Swagger UI for each API
7. **Generates landing page** - Lists all discovered APIs

**No configuration required** - Just add OpenAPI specs and restart!

## Summary

Swagger UI provides:

✅ **100% dynamic** - Automatically discovers your APIs  
✅ **Beautiful documentation** - Interactive browser-based interface  
✅ **Live testing** - "Try it out" against your mock server  
✅ **Zero configuration** - Add specs and restart  
✅ **Multiple APIs** - Separate page for each spec file  
✅ **In-memory processing** - Never modifies your files  

**Your specs change, your documentation changes!** 🚀

