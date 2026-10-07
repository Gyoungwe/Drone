function hostLanguage() {
  return String(process.env.DRONE_REPLY_LANGUAGE || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}
function bilingual(zh, en) {
  return hostLanguage() === "zh" ? `${zh}
${en}` : en;
}
export {
  bilingual,
  hostLanguage
};
