import { registerPreviewRenderer } from "../preview-registry";
import { DocOutlineViewer } from "./DocOutlineViewer";
import { MediaViewer } from "./MediaViewer";
import { MermaidViewer } from "./MermaidViewer";
import { MeshViewer } from "./MeshViewer";
import { NotebookViewer } from "./NotebookViewer";
import { NpyViewer } from "./NpyViewer";

/** 第一批预览器（P3）。表格（csv / tsv）沿用 ResourceTextPreview 内的 TableReader。 */
registerPreviewRenderer("notebook", NotebookViewer);
registerPreviewRenderer("mermaid", MermaidViewer);
registerPreviewRenderer("audio", MediaViewer);
registerPreviewRenderer("video", MediaViewer);

/** 第二批（P4）：npy 热图、STL/OBJ 网格、typst / latex 结构预览。html（隔离 iframe）与 svg（预览 / 源码）沿用现有实现。 */
registerPreviewRenderer("array", NpyViewer);
registerPreviewRenderer("mesh", MeshViewer);
registerPreviewRenderer("typst", DocOutlineViewer);
registerPreviewRenderer("latex", DocOutlineViewer);
