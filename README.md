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

Releases are automated with [changesets](https://github.com/changesets/changesets). Merge the `chore(release): version packages` pull request on `develop`, then merge `develop` into `main` to publish.

See [docs/RELEASE.md](docs/RELEASE.md) for the full process.
