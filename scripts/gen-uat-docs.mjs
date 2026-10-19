/**
 * scripts/gen-uat-docs.mjs - sinh 2 tai lieu Word (.docx) cho DCS:
 *   1. docs/uat/DCS-UAT-BanHanh-TuChoi-SoatXet.docx
 *   2. docs/uat/DCS-MoTa-PhanQuyen-TinhNang.docx
 * Chay: npm i -D docx && node scripts/gen-uat-docs.mjs
 * Noi dung bam sat code (route/trang thai/vai tro thuc te).
 */
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, LevelFormat, PageBreak,
} from "docx";
import { writeFileSync, mkdirSync } from "node:fs";

const BRAND = "004B8D", BRAND_DARK = "002B54", HEAD_BG = "EBF4FC", ZEBRA = "F4F8FC";
const MUTED = "5B6B7B", BORDER = "DCEBFA", FONT = "Calibri", OK = "1A7A3A", WARN = "B4700F";

const R = (t, o = {}) => new TextRun({ text: t, font: FONT, size: o.size ?? 21, bold: o.bold, italics: o.italics, color: o.color, break: o.break });
const P = (t, o = {}) => new Paragraph({ alignment: o.align, spacing: { after: o.after ?? 120, before: o.before ?? 0, line: 276 }, children: Array.isArray(t) ? t : [R(t, o)] });
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 140 }, border: { bottom: { color: BORDER, size: 10, space: 6, style: BorderStyle.SINGLE } }, children: [new TextRun({ text: t, font: FONT, size: 30, bold: true, color: BRAND })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 90 }, children: [new TextRun({ text: t, font: FONT, size: 24, bold: true, color: BRAND_DARK })] });
const LI = (t, lvl = 0) => new Paragraph({ numbering: { reference: "b", level: lvl }, spacing: { after: 60, line: 276 }, children: Array.isArray(t) ? t : [R(t)] });

function CELL(c, o = {}) {
  const kids = Array.isArray(c) ? c : [new Paragraph({ spacing: { after: 0, line: 252 }, children: [R(c, { size: o.size ?? 20, bold: o.bold, color: o.color })] })];
  return new TableCell({ width: o.w ? { size: o.w, type: WidthType.PERCENTAGE } : undefined, shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: "auto" } : undefined, margins: { top: 60, bottom: 60, left: 110, right: 110 }, verticalAlign: "center", children: kids });
}
function TABLE(headers, rows, widths) {
  const hdr = new TableRow({ tableHeader: true, children: headers.map((h, i) => CELL(h, { fill: HEAD_BG, bold: true, color: BRAND_DARK, w: widths?.[i] })) });
  const body = rows.map((r, idx) => new TableRow({ children: r.map((c, i) => Array.isArray(c) || typeof c === "string" ? CELL(c, { fill: idx % 2 ? ZEBRA : undefined, w: widths?.[i] }) : new TableCell({ ...c, shading: idx % 2 ? { type: ShadingType.CLEAR, fill: ZEBRA, color: "auto" } : undefined }) ) }));
  const b = (s) => ({ style: BorderStyle.SINGLE, size: s, color: BORDER });
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: b(4), bottom: b(4), left: b(4), right: b(4), insideHorizontal: b(4), insideVertical: b(4) }, rows: [hdr, ...body] });
}
function COVER(title, subtitle) {
  return [
    new Paragraph({ spacing: { before: 700, after: 0 }, children: [new TextRun({ text: "DCS", font: FONT, size: 60, bold: true, color: BRAND })] }),
    new Paragraph({ spacing: { after: 420 }, children: [new TextRun({ text: "He thong Quan ly & Phan phoi Tai lieu", font: FONT, size: 22, color: MUTED })] }),
    new Paragraph({ spacing: { after: 100 }, border: { bottom: { color: BRAND, size: 18, space: 8, style: BorderStyle.SINGLE } }, children: [new TextRun({ text: title, font: FONT, size: 38, bold: true, color: BRAND_DARK })] }),
    new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: subtitle, font: FONT, size: 22, color: MUTED })] }),
  ];
}
const numbering = { config: [{ reference: "b", levels: [
  { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 220 } } } },
  { level: 1, format: LevelFormat.BULLET, text: "\u2013", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 820, hanging: 220 } } } },
] }] };
const styles = { default: { document: { run: { font: FONT, size: 21, color: "222222" } } } };
const pageMargin = { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } };

mkdirSync("docs/uat", { recursive: true });

export { Document, Packer, Paragraph, TextRun, R, P, H1, H2, LI, TABLE, COVER, PageBreak, numbering, styles, pageMargin, writeFileSync, OK, WARN, MUTED };
