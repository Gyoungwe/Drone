function emitProcessEvent(event, ...args) {
  process.emit(event, ...args);
}
export {
  emitProcessEvent
};
