/**
 * scripts/seed_org_ci.mjs — hạt giống cây tổ chức tối thiểu cho CI.
 *
 * Vì sao cần: không migration nào nạp cây tổ chức (BU MEAT, Site MML) — trong
 * vận hành thật cây này đồng bộ từ L1, còn các test tích hợp tự dựng nó trong
 * before(). Nhưng scripts/seed_matrix.mjs (nạp tài khoản 3 vai) GIẢ ĐỊNH BU
 * MEAT và Site MML đã tồn tại và NÉM lỗi 'BU MEAT missing' nếu thiếu. Trên CI
 * dùng database trống (dcs_test), nên phải dựng cây gốc TRƯỚC seed_matrix.
 *
 * Chỉ nạp đúng mức seed_matrix cần: BU MEAT + Site MML + liên kết org_site_bu.
 * seed_matrix tự lo phần còn lại (Dept QA/PROD/QC, Site HCM, QA2, 7 account).
 *
 * Idempotent: chạy lại không lỗi (ON CONFLICT theo mã là duy nhất).
 * Dùng cùng DATABASE_URL như seed_matrix. Lược đồ ở trạng thái sau migration
 * 005 nên org_site dùng cột legacy_primary_bu_id và liên kết qua org_site_bu.
 *
 * Chạy: DATABASE_URL=postgres://... node scripts/seed_org_ci.mjs
 */
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Thiếu DATABASE_URL');

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  // BU MEAT (MeatLife) — ngành hàng gốc trong mọi fixture DCS.
  let bu = await sql`SELECT bu_id FROM org_bu WHERE bu_code = 'MEAT'`;
  let BU = bu[0]?.bu_id;
  if (!BU) {
    BU = randomUUID();
    await sql`INSERT INTO org_bu (bu_id, bu_code, name) VALUES (${BU}, 'MEAT', 'MeatLife')`;
  }

  // Site MML — nhà máy gốc. Sau migration 005, cột bu_id đã đổi tên thành
  // legacy_primary_bu_id (nullable); liên kết chuẩn nằm ở org_site_bu.
  let st = await sql`SELECT site_id FROM org_site WHERE site_code = 'MML'`;
  let SITE = st[0]?.site_id;
  if (!SITE) {
    SITE = randomUUID();
    await sql`INSERT INTO org_site (site_id, site_code, name, legacy_primary_bu_id)
              VALUES (${SITE}, 'MML', 'MML', ${BU})`;
  }
  await sql`INSERT INTO org_site_bu (site_id, bu_id) VALUES (${SITE}, ${BU})
            ON CONFLICT DO NOTHING`;

  console.log(`Seed org CI xong: BU MEAT=${BU}, Site MML=${SITE}`);
} finally {
  await sql.end();
}
