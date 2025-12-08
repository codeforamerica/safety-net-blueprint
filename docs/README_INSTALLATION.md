# Installation Guide

Complete setup instructions for the OpenAPI Tools project.

## Requirements

- **Node.js** >= 18.0.0 (Required for Express 5 and better-sqlite3)
- **npm** (comes with Node.js)

**Check your Node version:**
```bash
node --version
```

## Installation Steps

### 1. Install Node.js

If you don't have Node.js 18+ installed:

**macOS (using Homebrew):**
```bash
brew install node@18
```

**macOS/Linux (using nvm - recommended):**
```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Install Node 18
nvm install 18
nvm use 18
```

**Windows:**
Download from [nodejs.org](https://nodejs.org/)

### 2. Clone Repository

```bash
git clone <repository-url>
cd model-app-openapi
```

### 3. Install Dependencies

```bash
npm install
```

This installs all production and development dependencies.

## Dependencies

### Production Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `express` | ^5.x | Web server for mock API |
| `better-sqlite3` | ^11.x | Fast SQLite database for persistence |
| `ajv` | ^8.x | JSON Schema validation |
| `ajv-formats` | ^3.x | Format validators (email, uuid, date, etc.) |
| `js-yaml` | ^4.1.0 | YAML parser for OpenAPI specs |
| `@apidevtools/json-schema-ref-parser` | ^11.x | Resolve $ref in OpenAPI |
| `cors` | ^2.x | CORS middleware |
| `swagger-ui-express` | ^5.x | Swagger UI for API documentation |

### Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `openapi-zod-client` | ^1.18.2 | Zodios client generator |

## Optional: Automatic Node Version Switching

This project includes configuration for automatically loading the correct Node.js version when you enter the project directory.

### Using direnv (Recommended)

The project includes [direnv](https://direnv.net/) configuration (`.envrc`) that automatically loads the Node version from `.nvmrc`.

**Setup:**

1. Install direnv:
   ```bash
   # macOS with Homebrew
   brew install direnv
   
   # Ubuntu/Debian
   sudo apt-get install direnv
   
   # Or see https://direnv.net/docs/installation.html
   ```

2. Add direnv hook to your shell config:
   
   **For Zsh (e.g., `~/.zshrc`):**
   ```bash
   eval "$(direnv hook zsh)"
   ```
   
   **For Bash (e.g., `~/.bashrc`):**
   ```bash
   eval "$(direnv hook bash)"
   ```

3. Reload your shell:
   ```bash
   source ~/.zshrc  # or ~/.bashrc
   ```

4. When you `cd` into the project, direnv will automatically switch to Node 18.20.8

### Using nvm Manually

If you prefer not to use direnv, manually switch Node versions:

```bash
# Every time you enter the project directory
nvm use
```

This reads the `.nvmrc` file and switches to the correct Node version.

## Verification

After installation, verify everything is working:

```bash
# Check Node version
node --version
# Should show: v18.20.8 (or higher 18.x)

# Check npm version
npm --version

# Run tests
npm test

# Start mock server
npm run mock:start
# Should start without errors
```

## Troubleshooting

### Node Version Issues

**Issue:** `npm ERR! engine Unsupported engine`

**Solution:** Upgrade to Node.js 18 or higher:
```bash
nvm install 18
nvm use 18
```

### Installation Fails on better-sqlite3

**Issue:** Native module compilation errors

**Solution:** Ensure you have build tools installed:

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

### Permission Errors

**Issue:** `EACCES` permission errors during npm install

**Solution:** Don't use sudo with npm. Fix npm permissions:
```bash
# Change npm's default directory
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.profile
source ~/.profile
```

### Port Already in Use

**Issue:** `EADDRINUSE` when starting servers

**Solution:** Check what's using the port:
```bash
# Check port 1080 (mock server)
lsof -i :1080

# Check port 3000 (Swagger UI)
lsof -i :3000

# Kill the process if needed
kill -9 <PID>
```

## Next Steps

After successful installation:

1. **[Quick Start Guide](./QUICK_START.md)** - Get up and running
2. **[Mock Server Guide](./README_MOCK_SERVER.md)** - Start the mock server
3. **[API Client Generator](./README_API_CLIENTS.md)** - Generate TypeScript clients
4. **[Postman Collection Generator](./README_POSTMAN.md)** - Generate test collections
5. **[Swagger UI Guide](./README_SWAGGER.md)** - View interactive documentation

## Updating Dependencies

To update dependencies to their latest versions:

```bash
# Check for outdated packages
npm outdated

# Update all packages (respects semver ranges in package.json)
npm update

# Update to latest versions (may have breaking changes)
npm install <package>@latest
```

## Uninstallation

To remove the project:

```bash
# Remove node_modules
rm -rf node_modules

# Remove generated files
rm -rf generated/mock-data/*.db
rm -rf generated/clients/zodios/*.ts

# Remove the project directory
cd ..
rm -rf model-app-openapi
```

---

For more help, see:
- [Quick Start Guide](./QUICK_START.md)
- [Testing Documentation](./README_TESTING.md)
- [Troubleshooting in Mock Server Guide](./README_MOCK_SERVER.md#troubleshooting)


