import assert from "node:assert/strict";
import { access,writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function verifyScriptReaders({js,wait,cwd,checks}) {
 const fixtures=[
  ["lowercase.r","R 小写","r",'writeLines("must not run", "preview-must-not-execute")\nx <- 1\n'],
  ["uppercase.R","R 大写","r",'x <- c(1, 2)\nprint(mean(x))\n'],
  ["uppercase.PY","Python 大写","python",'open("preview-must-not-execute", "w").write("must not run")\nprint(1)\n'],
  ["mixed.Py","Python 混合大小写","python",'def sample(x):\n    return x + 1\n'],
 ];
 for(const [name,label,language,source] of fixtures) {
  await writeFile(join(cwd,name),source);
  await js("window.deliveryFixture.clearPreview();true");
  await wait("!document.querySelector('#artifact-preview')");
  await js(`[...document.querySelectorAll('#conversation .markdown-body a')].find(a=>a.textContent===${JSON.stringify(label)}).click();true`);
  await wait(`document.querySelector('[data-testid=resource-code] .resource-code-tools')?.innerText.startsWith(${JSON.stringify(language+" ·")})`);
  await wait("!!document.querySelector('[data-testid=resource-code] code span[style*=color]')");
  assert((await js("document.querySelector('[data-testid=resource-code] pre').innerText")).includes(source.split("\n")[0]));
  checks.push(`${name}: actual assistant Markdown link → production preload/IPC → bounded source with loaded ${language} syntax highlighting`);
 }
 await assert.rejects(access(join(cwd,"preview-must-not-execute")),{code:"ENOENT"});
 checks.push("script preview does not execute R/Python or create the script's output file");
}
