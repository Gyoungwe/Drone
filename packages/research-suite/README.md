# @drone/research-suite

The suite package aggregates `@drone/pi-core`, `@drone/pi-knowledge` and
`@drone/pi-research`. Pi does not automatically load resources from dependency
packages, so the manifest points at each bundled dependency's `dist` and
`skills` paths and `bundleDependencies` keeps all three packages inside the
tarball. The Pi host remains a peer dependency and is never duplicated.

This package is a release candidate until the npm scope and external Pi CLI
installation matrix are approved. The repository currently validates the
manifest, bundle declarations and offline unpacked fixture only.
