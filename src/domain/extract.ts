/**
 * src/domain/extract.ts — đọc PDF và bóc tách mục theo tiêu đề (T-045).
 *
 * Dùng unpdf để lấy văn bản. Nhận dòng dạng "6.2 Tần suất lưu mẫu" làm đầu mục
 * (DCS-2 §4.3). Kết quả nạp vào document_sections; mục thuộc PHIÊN BẢN.
 *
 * parse_status: thanh_cong nếu bóc được mục; kem_tin_cay nếu văn bản quá ít so
 * với số trang (dấu hiệu tệp quét chưa OCR); that_bai nếu không đọc được.
 */
import { extractText, getDocumentProxy } from 'unpdf';
import { readFile } from 'node:fs/promises';

export interface ExtractedSection {
  sectionCode: string;
  sectionTitle: string;
  orderNo: number;
  rawText: string;
}

export interface ExtractResult {
  parseStatus: 'thanh_cong' | 'kem_tin_cay' | 'that_bai';
  parseNote: string | null;
  pageCount: number;
  sections: ExtractedSection[];
  fullText: string;
}

/** Đầu mục: "6", "6.2", "6.2.1" theo sau bởi tiêu đề. Không khớp số trong câu. */
const HEADING_RE = /^\s*(\d+(?:\.\d+)*)[.)]?\s+(\S.{0,150}?)\s*$/;

/** Bóc tách văn bản thô thành mục. Xuất riêng để test không cần PDF thật. */
export function splitSections(fullText: string): ExtractedSection[] {
  const lines = fullText.split(/\r?\n/);
  const sections: ExtractedSection[] = [];
  let current: ExtractedSection | null = null;
  let order = 0;

  for (const line of lines) {
    const m = line.match(HEADING_RE);
    // Coi là đầu mục khi: khớp mẫu, tiêu đề có chữ cái (không phải chỉ số/ngày).
    if (m && /\p{L}/u.test(m[2]!)) {
      if (current) sections.push(current);
      current = { sectionCode: m[1]!, sectionTitle: m[2]!.trim(), orderNo: ++order, rawText: '' };
    } else if (current) {
      current.rawText += (current.rawText ? '\n' : '') + line.trim();
    }
  }
  if (current) sections.push(current);
  return sections.map((s) => ({ ...s, rawText: s.rawText.trim() }));
}

/** Đọc một tệp PDF và bóc tách. */
export async function extractPdf(filePath: string): Promise<ExtractResult> {
  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch {
    return { parseStatus: 'that_bai', parseNote: 'Không mở được tệp', pageCount: 0, sections: [], fullText: '' };
  }

  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    const fullText = Array.isArray(text) ? text.join('\n') : text;
    const sections = splitSections(fullText);

    // Heuristic tệp quét chưa OCR: rất ít ký tự so với số trang.
    const charsPerPage = totalPages > 0 ? fullText.length / totalPages : 0;
    if (charsPerPage < 50) {
      return {
        parseStatus: 'kem_tin_cay',
        parseNote: 'Văn bản trích ra quá ít — có thể là tệp quét chưa nhận dạng ký tự (OCR)',
        pageCount: totalPages, sections, fullText,
      };
    }
    if (sections.length === 0) {
      return {
        parseStatus: 'kem_tin_cay',
        parseNote: 'Không nhận ra tiêu đề mục — kiểm tra định dạng tài liệu',
        pageCount: totalPages, sections, fullText,
      };
    }
    return { parseStatus: 'thanh_cong', parseNote: null, pageCount: totalPages, sections, fullText };
  } catch (e) {
    return {
      parseStatus: 'that_bai',
      parseNote: `Lỗi đọc PDF: ${(e as Error).message}`,
      pageCount: 0, sections: [], fullText: '',
    };
  }
}
