#!/usr/bin/env node
/**
 * 模拟用户测试：动态生成脱敏的大型生物数据文件（>4 MiB），用于验证 TC-50 大文件保护拦截。
 * 遵循安全合规原则：不将多兆字节真实敏感数据提交入 Git 仓库，而是在测试环境按需确定性生成。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const TARGET_DIR = process.argv[2] || resolve(process.cwd(), "test/fixtures/simulated-user/generated");
const OVERSIZED_BYTES = 4.5 * 1024 * 1024; // 4.5 MiB (> 4 MiB 阈值)

if (!existsSync(TARGET_DIR)) {
  mkdirSync(TARGET_DIR, { recursive: true });
}

console.log(`[Fixture Generator] 生成测试脱敏大文件夹具至: ${TARGET_DIR}`);

// 1. 生成 sample_oversized.bam (伪装 BAM 文件头 + 填充字节)
const bamPath = resolve(TARGET_DIR, "sample_oversized.bam");
const bamHeader = Buffer.from([
  0x1f, 0x8b, 0x08, 0x04, // GZIP ID1, ID2, CM, FLG (BGZF)
  0x00, 0x00, 0x00, 0x00, // MTIME
  0x00, 0xff, 0x06, 0x00, // XFL, OS, XLEN=6
  0x42, 0x43, 0x02, 0x00, // SI1=B, SI2=C, SLEN=2 (BGZF subfield)
  0x1b, 0x00,             // BSIZE
]);
const bamFill = Buffer.alloc(Math.floor(OVERSIZED_BYTES - bamHeader.length), 0x41);
writeFileSync(bamPath, Buffer.concat([bamHeader, bamFill]));
console.log(`  ✓ 生成: ${bamPath} (${(OVERSIZED_BYTES / 1024 / 1024).toFixed(2)} MB)`);

// 2. 生成 sample_oversized.vcf (合成大变异表)
const vcfPath = resolve(TARGET_DIR, "sample_oversized.vcf");
const vcfHeader = "##fileformat=VCFv4.2\n##source=SyntheticDroneFixture\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n";
const vcfRecord = "chr1\t100000\trs123456\tA\tG\t50\tPASS\tDP=100;AF=0.5;SYNTHETIC=TRUE\n";
const repeatCount = Math.ceil((OVERSIZED_BYTES - vcfHeader.length) / vcfRecord.length);
writeFileSync(vcfPath, vcfHeader + vcfRecord.repeat(repeatCount));
console.log(`  ✓ 生成: ${vcfPath} (${((vcfHeader.length + repeatCount * vcfRecord.length) / 1024 / 1024).toFixed(2)} MB)`);

// 3. 生成 sample_oversized.fastq (纯文本大测序文件)
const fqPath = resolve(TARGET_DIR, "sample_oversized.fastq");
const fqRecord = "@SYNTHETIC_READ_SEQ\nACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT\n+\nIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII\n";
const fqRepeat = Math.ceil(OVERSIZED_BYTES / fqRecord.length);
writeFileSync(fqPath, fqRecord.repeat(fqRepeat));
console.log(`  ✓ 生成: ${fqPath} (${((fqRepeat * fqRecord.length) / 1024 / 1024).toFixed(2)} MB)`);

// 4. 生成 sample_oversized.fq.gz (压缩测序文件)
const fqzPath = resolve(TARGET_DIR, "sample_oversized.fq.gz");
// 为了让 gzip 压缩后依然大于 4.2 MB，使用伪随机碱基
const randomBlocks = [];
for (let b = 0; b < 1000; b++) {
  let seq = "";
  for (let s = 0; s < 5000; s++) {
    seq += ["A", "C", "G", "T"][Math.floor(Math.random() * 4)];
  }
  randomBlocks.push(`@READ_${b}\n${seq}\n+\n${"I".repeat(seq.length)}\n`);
}
const rawRandomFq = Buffer.from(randomBlocks.join(""));
writeFileSync(fqzPath, gzipSync(rawRandomFq));
console.log(`  ✓ 生成: ${fqzPath} (${(rawRandomFq.length / 1024 / 1024).toFixed(2)} MB raw)`);

console.log("[Fixture Generator] 完成全部脱敏大文件夹具生成。");
