/**
 * src/domain/content.ts — điều phối xử lý nội dung một phiên bản (T-045→T-050).
 *
 * Đọc PDF -> bóc tách mục -> phân đoạn -> lưu document_sections + document_chunks
 * + cập nhật parse_status/parse_note. Phiên bản mới bóc tách LẠI từ đầu, không
 * tái dùng mục cũ (REQ-D06). Form không phân đoạn nội dung (E.4 quy tắc 5).
 */
import { randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { extractPdf } from './extract.js';
import { chunkSection } from './chunking.js';
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
): Promise<ProcessResult> {
  const meta = (await sql<{ file_path: string; doc_type: string }[]>`
    SELECT v.file_path, d.doc_type
      FROM document_versions v JOIN documents d ON d.doc_id = v.doc_id
     WHERE v.version_id = ${versionId}`)[0];
  if (!meta) throw new Error('Không tìm thấy phiên bản để xử lý nội dung');

  const result = await extractPdf(meta.file_path);
  const isForm = meta.doc_type === 'Form';

  return sql.begin(async (tx) => {
    // Bóc tách lại: xoá mục cũ của chính phiên bản này (nếu chạy lại).
    await tx`DELETE FROM document_sections WHERE version_id = ${versionId}`;

    let chunkCount = 0;
    for (const s of result.sections) {
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

    await tx`
      UPDATE document_versions
         SET parse_status = ${result.parseStatus}, parse_note = ${result.parseNote},
             file_page_count = ${result.pageCount}
       WHERE version_id = ${versionId}`;

    await writeAudit(tx as TransactionSql, {
      eventType: 'sua_nhan', actorType: 'he_thong',
      objectType: 'document_versions', objectId: versionId,
      afterState: { parse_status: result.parseStatus, sections: result.sections.length, chunks: chunkCount },
    });

    return {
      parseStatus: result.parseStatus,
      sectionCount: result.sections.length,
      chunkCount,
    };
  }) as Promise<ProcessResult>;
}
