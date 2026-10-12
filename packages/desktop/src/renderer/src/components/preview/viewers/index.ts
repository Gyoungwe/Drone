import { registerPreviewRenderer } from "../preview-registry";
import { MediaViewer } from "./MediaViewer";
import { MermaidViewer } from "./MermaidViewer";
import { NotebookViewer } from "./NotebookViewer";

/** 第一批预览器（P3）。表格（csv / tsv）沿用 ResourceTextPreview 内的 TableReader。 */
registerPreviewRenderer("notebook", NotebookViewer);
registerPreviewRenderer("mermaid", MermaidViewer);
registerPreviewRenderer("audio", MediaViewer);
registerPreviewRenderer("video", MediaViewer);
