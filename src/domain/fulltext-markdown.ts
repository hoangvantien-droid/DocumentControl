/**
 * src/domain/fulltext-markdown.ts — Bộ_Sinh_Markdown toàn văn cấp phiên bản.
 *
 * Hàm thuần, TẤT ĐỊNH: cùng đầu vào luôn cho cùng chuỗi — không Date.now(),
 * không randomUUID, không I/O, KHÔNG nhận filePath (DCS mục Requirement 2.2,
 * 9.2). Nhận đúng dữ liệu đã có trong processVersionContent (meta + sections +
 * fullText) và trả về:
 *   - markdown:        Markdown_Toàn_Văn (lưu document_versions.markdown_content).
 *   - fulltextSource:  nguồn văn bản để sinh Chỉ_Mục_Toàn_Văn (tsvector), NULL
 *                      với Tài_Liệu_Dạng_Form.
 *
 * Non-Form: frontmatter YAML đủ bảy trường ngữ cảnh + thân heading mỗi mục;
 * fulltextSource = fullText nối thêm các sectionTitle để phủ TOÀN BỘ thân kể cả
 * dòng không khớp HEADING_RE (Requirement 1.2, 6.3).
 * Form: markdown chỉ gồm frontmatter tối giản + danh sách tiêu đề (KHÔNG rawText);
 * fulltextSource = null (Requirement 6.1, 6.2).
 */
import type { ExtractedSection } from './extract.js';

/** Metadata ngữ cảnh lấy từ document_versions + documents (đã truy vấn sẵn). */
export interface FulltextMeta {
  docId: string;                 // documents.doc_id / document_versions.doc_id
  title: string;                 // document_versions.title
  versionNo: string;             // document_versions.version_no
  scope: string | null;          // document_versions.scope
  status: string;                // document_versions.status (vd 'hieu_luc')
  effectiveDate: string | null;  // document_versions.effective_date (ISO date)
  docType: string;               // documents.doc_type
}

export interface FulltextMarkdown {
  /** Markdown_Toàn_Văn đầy đủ — lưu vào document_versions.markdown_content. */
  markdown: string;
  /**
   * Nguồn văn bản để sinh Chỉ_Mục_Toàn_Văn (tsvector).
   * NULL với Tài_Liệu_Dạng_Form (Requirement 6.2). Non-Form: phủ TOÀN BỘ thân
   * kể cả phần không khớp HEADING_RE (Requirement 6.3).
   */
  fulltextSource: string | null;
}

/** Thoát giá trị cho YAML: null/undefined -> chuỗi rỗng, còn lại bọc nháy kép an toàn.
 * DATE từ postgres.js về dạng Date object nên phải String(v) trước khi replace. */
function yamlValue(v: unknown): string {
  if (v === null || v === undefined) return '""';
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  // Thoát dấu gạch chéo ngược và nháy kép để YAML hợp lệ; giữ tất định.
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Dựng khối frontmatter YAML đủ bảy trường ngữ cảnh (Requirement 9.1). */
function buildFrontmatter(meta: FulltextMeta): string {
  const lines = [
    '---',
    `docId: ${yamlValue(meta.docId)}`,
    `title: ${yamlValue(meta.title)}`,
    `versionNo: ${yamlValue(meta.versionNo)}`,
    `scope: ${yamlValue(meta.scope)}`,
    `status: ${yamlValue(meta.status)}`,
    `effectiveDate: ${yamlValue(meta.effectiveDate)}`,
    `docType: ${yamlValue(meta.docType)}`,
    '---',
  ];
  return lines.join('\n');
}

/**
 * Sinh Markdown_Toàn_Văn + nguồn chỉ mục từ dữ liệu đã bóc tách. Thuần, tất
 * định; giữ nguyên thứ tự `sections`.
 */
export function buildFulltextMarkdown(
  meta: FulltextMeta,
  sections: ExtractedSection[],
  fullText: string,
  isForm: boolean,
): FulltextMarkdown {
  const frontmatter = buildFrontmatter(meta);

  if (isForm) {
    // Form: chỉ frontmatter + danh sách tiêu đề mục, KHÔNG rawText, index NULL.
    const titleList = sections.map((s) => `- ${s.sectionCode} ${s.sectionTitle}`);
    const markdown = [frontmatter, '', ...titleList].join('\n');
    return { markdown, fulltextSource: null };
  }

  // Non-Form: thân gồm mỗi mục một heading kèm rawText.
  const body: string[] = [];
  for (const s of sections) {
    body.push(`## ${s.sectionCode} ${s.sectionTitle}`);
    if (s.rawText) body.push(s.rawText);
  }
  const markdown = [frontmatter, '', ...body].join('\n');

  // Nguồn index phủ toàn thân (fullText) + nối thêm tiêu đề mục để tiêu đề cũng
  // vào chỉ mục toàn văn (Requirement 6.3).
  const titles = sections.map((s) => s.sectionTitle).join('\n');
  const fulltextSource = titles ? `${fullText}\n${titles}` : fullText;

  return { markdown, fulltextSource };
}
