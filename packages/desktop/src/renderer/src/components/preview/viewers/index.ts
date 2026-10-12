import { registerPreviewRenderer } from "../preview-registry";
import { DocOutlineViewer } from "./DocOutlineViewer";
import { MediaViewer } from "./MediaViewer";
import { MermaidViewer } from "./MermaidViewer";
import { MeshViewer } from "./MeshViewer";
import { NotebookViewer } from "./NotebookViewer";
import { NpyViewer } from "./NpyViewer";
import { TiffViewer } from "./TiffViewer";
import { VolumeViewer } from "./VolumeViewer";

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

/** P4 补充：TIFF（第 1 页像素 + 多页计数）、体数据（NIfTI / MRC 三正交切片 + MIP）。 */
registerPreviewRenderer("tiff", TiffViewer);
registerPreviewRenderer("volume", VolumeViewer);
