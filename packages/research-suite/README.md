# @gyoungwe/research-suite

The suite package aggregates `@gyoungwe/pi-core`, `@gyoungwe/pi-knowledge` and
`@gyoungwe/pi-research`. Pi does not automatically load resources from dependency
packages, so the manifest points at each bundled dependency's `dist` and
`skills` paths and `bundleDependencies` keeps all three packages inside the
tarball. The Pi host remains a peer dependency and is never duplicated.

The `0.1.1` package is published under the `@gyoungwe` scope. The repository
keeps the manifest, bundle declarations and offline unpacked fixture as release
gates; install the published package with `pi install npm:@gyoungwe/research-suite`.
