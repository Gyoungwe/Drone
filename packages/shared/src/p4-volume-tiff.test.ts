import { describe, expect, it } from "vitest";
import { fileTypeOf } from "./file-types";
import { mrcBytes, niftiBytes, tiffBytes } from "./p4-fixtures";
import { decodeTiff, readTiffInfo } from "./tiff-preview";
import { parseMrc, parseNifti, parseVolume, sliceToRgba, volumeMip, volumeSlice } from "./volume-preview";

describe("file types", () => {
	it("tif / nii / nii.gz / mrc 映射到新预览器", () => {
		expect(fileTypeOf("a.tif").previewKind).toBe("tiff");
		expect(fileTypeOf("a.TIFF").previewKind).toBe("tiff");
		expect(fileTypeOf("brain.nii").previewKind).toBe("volume");
		expect(fileTypeOf("brain.nii.gz")).toMatchObject({ previewKind: "volume", gzip: true });
		expect(fileTypeOf("emd_1234.map").previewKind).toBe("volume");
	});
});

describe("tiff", () => {
	it("8 位灰度：尺寸、页数、像素", () => {
		const img = decodeTiff(tiffBytes({ w: 4, h: 3, pages: 3 }));
		expect(img).toMatchObject({ width: 4, height: 3, pages: 3, bitsPerSample: 8, samplesPerPixel: 1 });
		expect(img.outWidth).toBe(4);
		expect(img.min).toBe(0);
		expect(img.max).toBe(5);
		expect(img.rgba[3]).toBe(255);
	});
	it("16 位大端 + RGB", () => {
		const img = decodeTiff(
			tiffBytes({ w: 2, h: 2, bits: 16, spp: 3, le: false, pixel: (x, _y, c) => 1000 * (c + 1) + x }),
		);
		expect(img.samplesPerPixel).toBe(3);
		expect(img.max).toBe(3001);
		expect(img.rgba[2 * 4 + 2]).toBe(255);
	});
	it("大图降采样到 maxSide", () => {
		const img = decodeTiff(tiffBytes({ w: 600, h: 300 }), 120);
		expect([img.outWidth, img.outHeight]).toEqual([120, 60]);
	});
	it("LZW 只回元数据；坏文件抛错", () => {
		expect(readTiffInfo(tiffBytes({ w: 2, h: 2, compression: 5 })).unsupported).toBe("compression 5");
		expect(() => decodeTiff(tiffBytes({ w: 2, h: 2, compression: 5 }))).toThrow(/unsupported/);
		expect(() => readTiffInfo(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not a TIFF/);
	});
});

describe("volume", () => {
	const vol = parseNifti(niftiBytes([4, 3, 2], (x, y, z) => x + 10 * y + 100 * z));
	it("NIfTI 头：维度、dtype、体素尺寸、范围", () => {
		expect(vol).toMatchObject({ format: "nifti", dims: [4, 3, 2], dtype: "float32", spacing: [1, 2, 2.5] });
		expect([vol.min, vol.max]).toEqual([0, 123]);
	});
	it("三个正交切片与 MIP", () => {
		const z = volumeSlice(vol, "z", 1);
		expect([z.width, z.height, z.values[0]]).toEqual([4, 3, 100]);
		const y = volumeSlice(vol, "y", 2);
		expect([y.width, y.height]).toEqual([4, 2]);
		expect(y.values[0]).toBe(120); // 顶行 = 最高 z
		const x = volumeSlice(vol, "x", 99); // 越界夹紧
		expect(x.values[x.values.length - 1]).toBe(3 + 20);
		expect(volumeMip(vol).values[0]).toBe(100);
		expect(sliceToRgba(z, vol.min, vol.max).length).toBe(4 * 3 * 4);
	});
	it("MRC int16 + 体素尺寸来自晶胞", () => {
		const m = parseMrc(mrcBytes([3, 2, 2]));
		expect(m).toMatchObject({ format: "mrc", dims: [3, 2, 2], dtype: "int16", min: -10, max: 1 });
		expect(m.spacing[0]).toBeCloseTo(1.5);
		expect(parseVolume(mrcBytes([2, 2, 2]), "x.mrc").format).toBe("mrc");
	});
	it("坏文件 / 超大体积报错", () => {
		expect(() => parseNifti(new Uint8Array(400))).toThrow(/NIfTI/);
		const big = niftiBytes([2, 2, 2], () => 0);
		new DataView(big.buffer).setInt16(42, 30000, true);
		new DataView(big.buffer).setInt16(44, 30000, true);
		expect(() => parseNifti(big)).toThrow(/too large/);
	});
});
