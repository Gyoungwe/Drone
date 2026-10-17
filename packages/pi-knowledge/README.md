# @drone/pi-knowledge

The first native Pi package in Drone. It exposes the existing knowledge/Vault
extension through one installable Pi entry point and bundles the `@drone/knowledge`
domain implementation into `dist/index.mjs`.

The package is intentionally honest on first run: `knowledge_status` returns
`{ "status": "unconfigured", "next": "/drone-init" }` until a Vault binding
exists. The package does not create a Vault implicitly and does not change the
existing `.pi/` or Vault file formats.

This package is currently built inside the Drone host repository. It is not yet
the final `drone-plugins` repository package; PR-5 performs that migration after
the external-install and MEM-01 gates pass.

Pi 1.1.0 currently records a local `.tgz` as an extension path instead of unpacking it. Until Pi adds package archive extraction, install the unpacked package directory (the smoke script exercises this path after verifying and reporting the tarball limitation).
