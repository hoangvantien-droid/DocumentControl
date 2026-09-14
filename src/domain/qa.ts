/**
 * src/domain/qa.ts — hỏi đáp AI có trích dẫn (T-087, T-088).
 *
 * Nguyên tắc (DCS-1): máy chỉ trả lời từ phân đoạn của phiên bản ĐANG HIỆU LỰC
 * (is_current), mọi câu trả lời PHẢI kèm trích dẫn tới cấp mục, không đủ căn cứ
 * thì trả lời "không tìm thấy". Truy vấn tôn trọng phân quyền người hỏi.
 *
 * Embedding sinh qua API NGOÀI (config.embeddingApiUrl). Thiếu -> tắt hỏi đáp,
 * phần còn lại của hệ thống vẫn chạy (DCS-5 §1.3). Không tạo chỉ mục vector
 * (~15k phân đoạn quét tuần tự ~100ms là chấp nhận được, DCS-5 §1.4).
 */
import type { Sql } from 'postgres';
import type { Config } from '../config.js';
import { writeAudit } from '../lib/audit.js';

export interface Citation {
  doc_id: string;
  version_no: string;
  section_code: string | null;
  section_title: string | null;
  page_from: number | null;
  effective_date: string | null;
}

export interface QaResult {
  enabled: boolean;
  answer: string;
  citations: Citation[];
  chunkIdsUsed: string[];
  insufficientEvidence: boolean;
}

/** Hỏi đáp có bật không (phụ thuộc cấu hình embedding API). */
export function qaEnabled(config: Config): boolean {
  return !!config.embeddingApiUrl;
}

/** Gọi API ngoài sinh embedding cho một đoạn văn bản. */
async function embed(config: Config, text: string): Promise<number[] | null> {
  if (!config.embeddingApiUrl) return null;
  try {
    const res = await fetch(config.embeddingApiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.embeddingApiKey ? { authorization: `Bearer ${config.embeddingApiKey}` } : {}),
      },
      body: JSON.stringify({ input: text }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embedding?: number[]; data?: { embedding: number[] }[] };
    return data.embedding ?? data.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

/**
 * Trả lời câu hỏi. Retrieval: embedding câu hỏi -> cosine với document_chunks
 * (is_current, trong phạm vi người hỏi) -> top-k. Không đủ -> insufficient.
 *
 * Đây là tầng RETRIEVAL + trích dẫn; phần sinh câu trả lời ngôn ngữ tự nhiên để
 * lại cho tích hợp LLM sau (giữ trích dẫn làm nòng cốt, đúng REQ-H02/H04).
 */
export async function answer(
  sql: Sql,
  config: Config,
  input: { question: string; userId: string },
): Promise<QaResult> {
  if (!qaEnabled(config)) {
    return { enabled: false, answer: 'Hỏi đáp AI chưa bật trên hệ thống này.', citations: [], chunkIdsUsed: [], insufficientEvidence: true };
  }

  const qVec = await embed(config, input.question);
  if (!qVec) {
    return { enabled: true, answer: 'Không sinh được embedding cho câu hỏi (API ngoài lỗi).', citations: [], chunkIdsUsed: [], insufficientEvidence: true };
  }

  const vecLiteral = `[${qVec.join(',')}]`;
  // Chỉ phân đoạn is_current, trong phạm vi người hỏi; quét tuần tự cosine.
  const hits = await sql<{
    chunk_id: string; doc_id: string; section_id: string; content: string; dist: number;
  }[]>`
    SELECT c.chunk_id, c.doc_id, c.section_id, c.content,
           (c.embedding <=> ${vecLiteral}::vector) AS dist
      FROM document_chunks c
      JOIN document_versions v ON v.version_id = c.version_id
      JOIN documents d ON d.doc_id = c.doc_id
     WHERE c.is_current = TRUE
       AND c.embedding IS NOT NULL
       AND (d.scope_level = 'group'
            OR EXISTS (
              SELECT 1 FROM user_departments ud
                JOIN org_department dp ON dp.dept_id = ud.dept_id
                JOIN org_site st ON st.site_id = dp.site_id
               WHERE ud.user_id = ${input.userId} AND ud.is_active
                 AND ((d.scope_level='bu' AND EXISTS (
                        SELECT 1 FROM org_site_bu sb
                         WHERE sb.site_id = st.site_id AND sb.bu_id = d.scope_bu_id
                      ))
                   OR (d.scope_level='site' AND st.site_id = d.scope_site_id)
                   OR (d.scope_level='dept' AND dp.dept_id = d.scope_dept_id))))
     ORDER BY dist ASC
     LIMIT 5`;

  if (hits.length === 0) {
    await logQuery(sql, input.userId, input.question, []);
    return { enabled: true, answer: 'Không tìm thấy nội dung phù hợp trong tài liệu đang hiệu lực.', citations: [], chunkIdsUsed: [], insufficientEvidence: true };
  }

  // Trích dẫn tới cấp mục — nếu không tra được mã mục thì CHẶN câu trả lời (REQ-H02).
  const citations: Citation[] = [];
  for (const h of hits) {
    const sec = (await sql<{
      section_code: string | null; section_title: string | null; page_from: number | null;
      version_no: string; effective_date: string | null;
    }[]>`
      SELECT s.section_code, s.section_title, s.page_from,
             v.version_no, v.effective_date::text AS effective_date
        FROM document_sections s JOIN document_versions v ON v.version_id = s.version_id
       WHERE s.section_id = ${h.section_id}`)[0];
    if (!sec) continue; // trích dẫn không tra được mã -> bỏ, không bịa
    citations.push({
      doc_id: h.doc_id, version_no: sec.version_no,
      section_code: sec.section_code, section_title: sec.section_title,
      page_from: sec.page_from, effective_date: sec.effective_date,
    });
  }

  const chunkIdsUsed = hits.map((h) => h.chunk_id);
  await logQuery(sql, input.userId, input.question, chunkIdsUsed);

  // Ghép câu trả lời từ nội dung phân đoạn hàng đầu (giữ nguyên văn, không suy đoán).
  const answerText = hits.map((h) => h.content).join('\n\n');
  return { enabled: true, answer: answerText, citations, chunkIdsUsed, insufficientEvidence: false };
}

async function logQuery(sql: Sql, userId: string, question: string, chunkIds: string[]): Promise<void> {
  await sql.begin(async (tx) => {
    await writeAudit(tx as never, {
      eventType: 'hoi_ai', actorUserId: userId,
      objectType: 'query', objectId: question.slice(0, 64),
      context: { chunk_ids_used: chunkIds },
    });
  });
}
