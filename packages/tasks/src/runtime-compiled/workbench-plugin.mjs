function createWorkbenchPluginPort(client) {
  return Object.freeze({
    status: () => client.invoke("status", {}),
    plan: (items) => client.invoke("plan", { items: [...items] }),
    todo: (input) => client.invoke("todo", input),
    memorySave: (input) => client.invoke("memorySave", input),
    persist: () => client.invoke("persist", {})
  });
}
export {
  createWorkbenchPluginPort
};
