// @ts-nocheck
// packages/knowledge/src/capability-discovery.ts
async function readCapabilitySources(port, refs) {
  const values = await Promise.all(refs.map((ref) => port.readSource(ref)));
  return values.filter((value) => Boolean(value));
}

export {
  readCapabilitySources
};
