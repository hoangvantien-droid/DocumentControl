/**
 * src/domain/content.ts — điều phối xử lý nội dung một phiên bản (T-045→T-050).
 *
 * Đọc PDF -> bóc tách mục -> phân đoạn -> lưu document_sections + document_chunks
 * + cập nhật parse_status/parse_note. Phiên bản mới bóc tách LẠI từ đầu, không
 * tái dùng mục cũ (REQ-D06). Form không phân đoạn nội dung (E.4 quy tắc 5).
 */
import { randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { extractPdf, splitSections, type ExtractResult } from './extract.js';
import { chunkSection } from './chunking.js';
import { type OcrEngine, TesseractEngine } from './ocr-engine.js';
import { buildFulltextMarkdown, type FulltextMeta } from './fulltext-markdown.js';
import { writeAudit } from '../lib/audit.js';

export interface ProcessResult {
  parseStatus: string;
  sectionCount: number;
  chunkCount: number;
}

/**
 * Xử lý nội dung phiên bản từ tệp file_path đã lưu. Gọi sau khi nộp đăng ký
 * hoặc bởi OCR worker. isForm=true thì chỉ lưu mục, không phân đoạn.
 */
export async function processVersionContent(
  sql: Sql,
  versionId: string,
  opts: { tesseractPath?: string; ocrEngine?: OcrEngine } = {},
): Promise<ProcessResult> {
  // Lấy thêm các trường ngữ cảnh phục vụ Frontmatter_Ngữ_Cảnh (task 4.3 sẽ dùng):
  // title, version_no, scope, status, effective_date, doc_id từ document_versions
  // và doc_type từ documents. effective_date là DATE có thể NULL, postgres.js trả
  // về dạng chuỗi ISO (string) hoặc NULL, nên khai string | null.
  const meta = (await sql<{
    file_path: string;
    title: string;
    version_no: string;
    scope: string | null;
    status: string;
    effective_date: string | null;
    doc_id: string;
    doc_type: string;
  }[]>`
    SELECT v.file_path, v.title, v.version_no, v.scope, v.status, v.effective_date,
           v.doc_id, d.doc_type
      FROM document_versions v JOIN documents d ON d.doc_id = v.doc_id
     WHERE v.version_id = ${versionId}`)[0];
  if (!meta) throw new Error('Không tìm thấy phiên bản để xử lý nội dung');

  let result = await extractPdf(meta.file_path);
  const isForm = meta.doc_type === 'Form';

  // Chọn engine OCR: ưu tiên engine truyền vào (worker tạo từ cấu hình), nếu
  // không có thì giữ tương thích ngược bằng cách tự dựng TesseractEngine từ
  // tesseractPath. Không có cả hai thì engine = null -> bỏ qua Nhánh_OCR.
  const engine: OcrEngine | null =
    opts.ocrEngine ?? (opts.tesseractPath ? new TesseractEngine(opts.tesseractPath) : null);

  // Nối OCR trọn luồng: tệp quét (bóc tách kém) -> engine OCR -> bóc tách lại từ
  // văn bản OCR. Chạy tiến trình rời (DCS-8 §1.2). Chỉ khi có engine.
  if (result.parseStatus === 'kem_tin_cay' && !isForm && engine) {
    const ocr = await engine.run(meta.file_path);
    if (ocr.ok && ocr.text.trim().length > 0) {
      const sections = splitSections(ocr.text);
      const ocrResult: ExtractResult = {
        parseStatus: sections.length > 0 ? 'thanh_cong' : 'kem_tin_cay',
        parseNote: sections.length > 0
          ? 'Bóc tách từ văn bản nhận dạng ký tự (OCR)'
          : 'OCR xong nhưng không nhận ra tiêu đề mục',
        pageCount: result.pageCount,
        sections,
        fullText: ocr.text,
      };
      result = ocrResult;
    }
  }

  return sql.begin(async (tx) => {
    // Bóc tách lại: xoá mục cũ của chính phiên bản này (nếu chạy lại).
    await tx`DELETE FROM document_sections WHERE version_id = ${versionId}`;

    // Dedup section_code (constraint uq_section_per_version): PDF thực tế có
    // mục trùng mã (vd ABC có 3 mục "2"). Giữ mục đầu nguyên mã, các mục sau
    // thêm hậu tố -2, -3 để không dính 23505 mà vẫn giữ đủ nội dung duyệt.
    const seen = new Map<string, number>();
    const sections = result.sections.map((s) => {
      const n = (seen.get(s.sectionCode) ?? 0) + 1;
      seen.set(s.sectionCode, n);
      return n > 1 ? { ...s, sectionCode: `${s.sectionCode}-${n}` } : s;
    });

    let chunkCount = 0;
    for (const s of sections) {
      const sectionId = randomUUID();
      await tx`
        INSERT INTO document_sections (section_id, version_id, section_code, section_title, order_no, raw_text)
        VALUES (${sectionId}, ${versionId}, ${s.sectionCode}, ${s.sectionTitle}, ${s.orderNo}, ${s.rawText})`;

      // Form: giữ mục nhưng KHÔNG phân đoạn nội dung.
      if (isForm) continue;

      const chunks = chunkSection(s.sectionTitle, s.rawText);
      for (const c of chunks) {
        await tx`
          INSERT INTO document_chunks (section_id, version_id, doc_id, chunk_order, content, content_type)
          SELECT ${sectionId}, ${versionId}, v.doc_id, ${c.chunkOrder}, ${c.content}, ${c.contentType}
            FROM document_versions v WHERE v.version_id = ${versionId}`;
        chunkCount++;
      }
    }

    // Sinh Markdown_Toàn_Văn + nguồn chỉ mục từ dữ liệu ĐÃ bóc tách (result.sections
    // + result.fullText) — KHÔNG parse lại PDF. Hàm thuần, tất định nên chạy lại cho
    // cùng kết quả (idempotent). Map meta đã truy vấn đầu hàm sang FulltextMeta.
    const fmMeta: FulltextMeta = {
      docId: meta.doc_id,
      title: meta.title,
      versionNo: meta.version_no,
      scope: meta.scope,
      status: meta.status,
      effectiveDate: meta.effective_date,
      docType: meta.doc_type,
    };
    const fm = buildFulltextMarkdown(fmMeta, sections, result.fullText, isForm);

    // GỘP vào chính câu UPDATE hiện có để chỉ một UPDATE trong transaction. Ghi đè
    // markdown_content + fulltext_tsv nên chạy lại là thay thế (idempotent); nằm trong
    // transaction nên rollback thì không lưu gì. fulltextSource NULL (Form) -> tsv NULL;
    // CASE WHEN phân biệt null qua ${fm.fulltextSource}::text IS NULL rồi dùng vn_tsv.
    await tx`
      UPDATE document_versions
         SET parse_status = ${result.parseStatus}, parse_note = ${result.parseNote},
             file_page_count = ${result.pageCount},
             markdown_content = ${fm.markdown},
             fulltext_tsv = CASE
               WHEN ${fm.fulltextSource}::text IS NULL THEN NULL
               ELSE vn_tsv(${fm.fulltextSource})
             END
       WHERE version_id = ${versionId}`;

    await writeAudit(tx as TransactionSql, {
      eventType: 'sua_nhan', actorType: 'he_thong',
      objectType: 'document_versions', objectId: versionId,
      afterState: { parse_status: result.parseStatus, sections: sections.length, chunks: chunkCount },
    });

    return {
      parseStatus: result.parseStatus,
      sectionCount: sections.length,
      chunkCount,
    };
  }) as Promise<ProcessResult>;
}
