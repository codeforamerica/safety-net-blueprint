# Troubleshooting

> **Status: Draft**

Common issues and solutions.

## Installation Issues

### Node Version Error

```
error engine: Wanted: node >=20.0.0
```

**Solution:** Update Node.js to version 20 or higher.

```bash
# Using nvm
nvm install 20
nvm use 20

# Verify
node --version
```

### Native Module Build Failure (better-sqlite3)

```
gyp ERR! build error
```

**Solution:** Install build tools.

**macOS:**
```bash
xcode-select --install
```

**Ubuntu/Debian:**
```bash
sudo apt-get install build-essential python3
```

**Windows:**
```bash
npm install --global windows-build-tools
```

## Validation Errors

### $ref Resolution Failed

```
Error: ENOENT: no such file or directory, open './components/person.yaml'
```

**Cause:** Missing referenced file or incorrect path.

**Solution:** Check the `$ref` path is correct and the file exists.

### Additional Properties Error

```
Error: homeAddress must NOT have additional property 'country'
```

**Cause:** Example has a property not defined in the schema.

**Solution:** Either:
- Remove the property from the example
- Add the property to the schema

### Missing Required Property

```
Error: must have required property 'signature'
```

**Cause:** Example is missing a required field.

**Solution:** Add the missing field to the example.

### Type Mismatch

```
Error: price must be number
```

**Cause:** Example value has wrong type.

**Solution:** Use the correct type (e.g., `99.99` not `"99.99"`).

### Enum Value Invalid

```
Error: status must be equal to one of the allowed values
```

**Cause:** Example uses a value not in the enum.

**Solution:** Use a value from the enum list.

## Overlay Errors

### Target Not Found Warning

```
⚠ Target $.Person.properties.foo does not exist in base schema
```

**Cause:** The overlay target path doesn't match the actual schema structure.

**Solution:** Check the base schema and correct the path.

### Unknown State

```
Error: Unknown state 'newstate'
Available states: <lists configured states>
```

**Cause:** No overlay file exists for the specified state.

**Solution:** Create `openapi/overlays/<new-state>/modifications.yaml`.

## Mock Server Issues

### Port Already in Use

```
Error: listen EADDRINUSE: address already in use :::1080
```

**Solution:** Kill the existing process.

```bash
# macOS/Linux
lsof -ti:1080 | xargs kill

# Or use a different port
MOCK_SERVER_PORT=8080 npm run mock:start
```

### Database Corruption

```
Error: SQLITE_CORRUPT: database disk image is malformed
```

**Solution:** Reset the database.

```bash
npm run mock:reset
```

### Search Not Working

**Symptom:** Search returns no results when it should.

**Causes:**
- Field not indexed for search
- Case sensitivity
- Wrong field name

**Solution:** Check example data has searchable string fields.

### Wrong Data Returned

**Symptom:** API returns unexpected data.

**Solution:** Reset to example data.

```bash
npm run mock:reset
```

## Client Generation Issues

### Generation Fails

```
Error: Cannot find module '@zodios/core'
```

**Solution:** Install dependencies.

```bash
npm install
```

### Type Errors After Generation

**Symptom:** TypeScript errors in generated clients.

**Cause:** Spec changed but clients weren't regenerated.

**Solution:** Regenerate clients.

```bash
STATE=<your-state> npm run clients:generate
```

### Zod Validation Error at Runtime

```
ZodError: Expected string, received number
```

**Cause:** Backend response doesn't match spec.

**Solution:** Either fix the backend or update the spec.

## Postman Issues

### Collection Not Found

```
Could not find collection file
```

**Solution:** Generate the collection first.

```bash
STATE=<your-state> npm run postman:generate
```

### Tests Fail with 404

**Cause:** Resource IDs in collection don't exist.

**Solution:**
- Ensure backend has the test data
- Or update collection with valid IDs

### Connection Refused

```
Error: connect ECONNREFUSED 127.0.0.1:1080
```

**Cause:** API server not running.

**Solution:** Start the server or check the URL.

## CI/CD Issues

### Mock Server Not Ready

**Symptom:** Tests start before server is ready.

**Solution:** Add a health check wait.

```yaml
- name: Wait for mock server
  run: |
    npm run mock:start &
    sleep 5
    curl --retry 10 --retry-delay 2 http://localhost:1080/persons
```

### State Not Set

**Symptom:** Overlay not applied in CI.

**Solution:** Set STATE environment variable.

```yaml
env:
  STATE: <your-state>
```

### Permission Denied

```
Error: EACCES: permission denied
```

**Solution:** Check file permissions or run without sudo.

## Getting Help

1. Check this troubleshooting guide
2. Search existing [GitHub Issues](https://github.com/codeforamerica/safety-net-apis/issues)
3. Open a new issue with:
   - Error message
   - Steps to reproduce
   - Node.js version (`node --version`)
   - Operating system
