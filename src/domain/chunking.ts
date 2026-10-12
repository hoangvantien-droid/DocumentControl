/**
 * src/domain/chunking.ts — phân đoạn mục (T-050, DCS-3 §E.4).
 *
 * Quy tắc:
 *  1. Không cắt ngang câu.
 *  2. KHÔNG cắt ngang bảng — bảng dài để nguyên một phân đoạn lớn (hay bị vi
 *     phạm nhất; cắt bảng làm tên chỉ tiêu và con số rơi hai phân đoạn -> máy
 *     trả lời sai ngưỡng).
 *  3. Mục ngắn hơn ngưỡng -> một mục một phân đoạn.
 *  4. Mục dài chia nhiều phân đoạn, mỗi phân đoạn lặp tiêu đề mục ở đầu.
 *  5. doc_type = Form không phân đoạn nội dung (xử lý ở tầng gọi).
 */
export interface Chunk {
  chunkOrder: number;
  content: string;
  contentType: 'van_ban' | 'bang' | 'danh_sach';
}

/** Ngưỡng ký tự cho một phân đoạn văn bản. */
const CHUNK_TARGET = 1500;

/** Nhận diện dòng thuộc bảng: nhiều dấu phân cột (tab, | , nhiều khoảng trắng). */
function looksLikeTableLine(line: string): boolean {
  return /\t/.test(line) || /\|/.test(line) || /\s{3,}\S+\s{3,}/.test(line);
}

/**
 * Chia raw_text của một mục thành các phân đoạn. Khối bảng liên tiếp gộp thành
 * một phân đoạn content_type='bang' và KHÔNG bị cắt dù dài.
 */
export function chunkSection(sectionTitle: string, rawText: string): Chunk[] {
  if (!rawText.trim()) return [];
  const lines = rawText.split(/\r?\n/);
  const chunks: Chunk[] = [];
  let order = 0;

  // Gom các dòng thành khối: khối bảng (liên tiếp dòng-bảng) hoặc khối văn bản.
  type Block = { type: 'bang' | 'van_ban'; text: string };
  const blocks: Block[] = [];
  let buf: string[] = [];
  let bufIsTable = false;

  const flush = () => {
    if (buf.length === 0) return;
    blocks.push({ type: bufIsTable ? 'bang' : 'van_ban', text: buf.join('\n').trim() });
    buf = [];
  };

  for (const line of lines) {
    const isTable = looksLikeTableLine(line);
    if (buf.length === 0) { bufIsTable = isTable; buf.push(line); continue; }
    if (isTable === bufIsTable) { buf.push(line); }
    else { flush(); bufIsTable = isTable; buf.push(line); }
  }
  flush();

  const prefix = `${sectionTitle}\n`;
  for (const block of blocks) {
    if (block.type === 'bang') {
      // Không cắt bảng — một phân đoạn dù dài.
      chunks.push({ chunkOrder: ++order, content: prefix + block.text, contentType: 'bang' });
      continue;
    }
    // Văn bản: cắt theo câu, gộp tới ~CHUNK_TARGET, không cắt giữa câu.
    const sentences = block.text.split(/(?<=[.!?])\s+/);
    let acc = '';
    for (const s of sentences) {
      if (acc && (acc.length + s.length) > CHUNK_TARGET) {
        chunks.push({ chunkOrder: ++order, content: prefix + acc.trim(), contentType: 'van_ban' });
        acc = '';
      }
      acc += (acc ? ' ' : '') + s;
    }
    if (acc.trim()) chunks.push({ chunkOrder: ++order, content: prefix + acc.trim(), contentType: 'van_ban' });
  }

  return chunks;
}
