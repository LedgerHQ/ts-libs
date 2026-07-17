# ts-libs

A set of TypeScript libraries shared across Ledger stacks.

## Install a package

```sh
pnpm add @ledgerhq/logs
```

## Contributing

Open a PR targeting `develop`. Add a changeset to document your changes:

```sh
pnpm changelog
```

## Development

```sh
mise install   # install toolchain (node, pnpm, …)
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

## Release

Merge `develop` into `main` to trigger an automatic release.
