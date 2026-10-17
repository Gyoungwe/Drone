# @drone/pi-research

Native Pi package for a bounded, evidence-gated research loop.

The package exposes local source discovery, hash-checked reads, source-linked
candidate note deposition and a source-grounded answer packet. A source must be
discovered before it can be read; an answer packet requires two distinct read
receipts. The packet is evidence for a model or host to assess, and never claims
independent scientific verification.

`research_loop` from the existing research domain remains available for the
run-level evidence lifecycle. Network, Zotero and institutional adapters stay
at the host boundary until their Electron-free package split is complete.

The package is self-contained after `npm run build`; the Pi host is a peer
dependency and is not bundled.
