# Tome

A lightweight block-based terminal built with Tauri 2 + React + TypeScript.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm tauri dev

# Build for production
pnpm tauri build
```

## Testing

```bash
# Run Rust tests
cd src-tauri && cargo test

# Run frontend tests
pnpm test
```

## CI

GitHub Actions CI is configured to run on every push and pull request:

- **Rust tests**: `cargo test` with formatting (`cargo fmt`) and linting (`cargo clippy`)
- **Frontend tests**: `vitest` with TypeScript type checking
- **Tauri build**: Ensures the app builds successfully

See `.github/workflows/ci.yml` for details.
