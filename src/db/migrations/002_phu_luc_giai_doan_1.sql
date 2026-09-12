-- 002_phu_luc_giai_doan_1.sql — Phu luc trien khai giai doan 1 + Phu luc B.
-- Nguon: DCS-4 (dong 1303-cuoi). CHI chay o giai doan 1.

-- ============================================================
-- ============================================================
-- PHU LUC TRIEN KHAI — GIAI DOAN 1
-- (L1 chua co that · VPS 1 CPU / 1 GB RAM · BU MeatLife · ~500 tai lieu)
--
-- Phan nay CHI chay o giai doan 1. Khi L1 len that, chay phan "GO BO" o cuoi
-- de tra he thong ve dung thiet ke goc.
-- ============================================================

-- ------------------------------------------------------------
-- 1. CO HE THONG — dieu khien hanh vi theo giai doan
-- ------------------------------------------------------------
CREATE TABLE system_flags (
    flag_key    VARCHAR(40) PRIMARY KEY,
    flag_value  BOOLEAN NOT NULL,
    note        TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_flags (flag_key, flag_value, note) VALUES
 ('m14_enabled',        FALSE, 'Thu vien dieu khoan QDMS M14 chua van hanh — bo qua kiem tra dieu khoan'),
 ('l1_synced',          FALSE, 'L1 CHUA co that — DCS tu quan to chuc/nguoi dung qua man hinh tam'),
 ('temp_org_admin',     TRUE,  'CO HAN SU DUNG: tat khi l1_synced = TRUE. Xem canh bao ben duoi'),
 ('ocr_batch_only',     TRUE,  'Nhan dang ky tu chay theo lo ngoai gio — RAM 1 GB khong cho chay dong thoi'),
 ('embedding_external', TRUE,  'Sinh embedding qua API ngoai — mo hinh tai cho can >1 GB, bat kha thi');

-- ------------------------------------------------------------
-- 2. GO QUY TAC CHAN GHI LEN BANG TO CHUC
--
-- Thiet ke goc chan DCS ghi len ban doc dong bo tu L1. Giai doan 1 chua co L1
-- nen phai tam mo — CAU TRUC BANG KHONG DOI MOT DONG NAO, chi mo/dong quy tac.
--
-- ⚠️  MAN HINH QUAN TRI TO CHUC TAM CO HAN SU DUNG.
--     Neu khong danh dau, ba nam sau no van con do va DCS am tham tro thanh
--     nguon su that thu hai ve to chuc — dung thu ca thiet ke nay co tranh.
-- ------------------------------------------------------------
DROP RULE IF EXISTS org_bu_no_write   ON org_bu;
DROP RULE IF EXISTS org_site_no_write ON org_site;
DROP RULE IF EXISTS org_dept_no_write ON org_department;
DROP RULE IF EXISTS user_dept_no_write ON app_user_dept;

-- Bu lai bang ghi vet: moi thao tac tren to chuc trong giai doan 1 deu phai
-- de lai dau vet, de khi doi chieu voi L1 biet duoc ai khai gi.
CREATE OR REPLACE FUNCTION fn_log_temp_org()
RETURNS TRIGGER AS $$
BEGIN
    -- object_id chi gioi han 64 ky tu: ghi KHOA CHINH, khong ghi ca dong.
    -- Toan bo noi dung dong di vao after_state (JSONB, khong gioi han).
    INSERT INTO audit_log (actor_type, event_type, object_type, object_id, after_state)
    VALUES ('nguoi', 'sua_ma_tran', TG_TABLE_NAME,
            left(coalesce(to_jsonb(NEW), to_jsonb(OLD)) ->> (TG_ARGV[0]), 64),
            jsonb_build_object('thao_tac', TG_OP, 'giai_doan', 'L1_chua_co',
                               'du_lieu', coalesce(to_jsonb(NEW), to_jsonb(OLD))));
    RETURN coalesce(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_log_org_bu   AFTER INSERT OR UPDATE OR DELETE ON org_bu
    FOR EACH ROW EXECUTE FUNCTION fn_log_temp_org('bu_id');
CREATE TRIGGER trg_log_org_site AFTER INSERT OR UPDATE OR DELETE ON org_site
    FOR EACH ROW EXECUTE FUNCTION fn_log_temp_org('site_id');
CREATE TRIGGER trg_log_org_dept AFTER INSERT OR UPDATE OR DELETE ON org_department
    FOR EACH ROW EXECUTE FUNCTION fn_log_temp_org('dept_id');

-- ------------------------------------------------------------
-- 3. NGUOI DUNG TAM — bo sung cot chi dung khi L1 chua co
--
-- Thiet ke goc: app_user_ref CHI luu user_id, moi thong tin khac hoi L1.
-- Giai doan 1 khong co L1 de hoi, nen phai luu tam ho ten va dang nhap.
-- Cac cot nay CO HAN SU DUNG — go bo khi L1 len.
-- ------------------------------------------------------------
ALTER TABLE app_user_ref
    ADD COLUMN IF NOT EXISTS full_name  VARCHAR(150),   -- TAM: L1 se cung cap
    ADD COLUMN IF NOT EXISTS email      VARCHAR(150),   -- TAM: dung de dang nhap giai doan 1
    ADD COLUMN IF NOT EXISTS is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS temp_record BOOLEAN NOT NULL DEFAULT TRUE;
                                        -- TRUE = khai tay, chua doi chieu voi L1

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_email
    ON app_user_ref(lower(email)) WHERE email IS NOT NULL;

-- ------------------------------------------------------------
-- 3b. TAI LIEU CU NAP TU KHO HIEN CO
--
-- Xung dot: guard "effective_date >= ngay xac nhan" sinh ra de ngan tai lieu co
-- hieu luc khi chua ai duoc dao tao. Nhung ~500 tai lieu cu DA co hieu luc tu lau
-- — ngay hieu luc that cua chung nam trong qua khu.
--
-- KHONG tat guard (mo lo hong kho dong lai). KHONG dat ngay hieu luc = ngay nap
-- (lam sai lich su, chu ky ra soat tinh sai). Thay vao do: tach lam hai ngay.
--   effective_date          = ngay nap  -> thoa guard
--   original_effective_date = ngay hieu luc THAT ngoai doi
-- Chu ky ra soat tinh theo ngay GOC, de tai lieu da qua han hien ra ngay
-- chu khong bi dat lai dong ho.
-- ------------------------------------------------------------
ALTER TABLE document_versions
    ADD COLUMN IF NOT EXISTS original_effective_date DATE,
    ADD COLUMN IF NOT EXISTS migrated_record BOOLEAN NOT NULL DEFAULT FALSE;

-- Ban ghi nap tu kho cu BAT BUOC co ngay hieu luc goc
ALTER TABLE document_versions
    ADD CONSTRAINT chk_migrated_has_original CHECK (
        migrated_record = FALSE OR original_effective_date IS NOT NULL);

-- Chu ky ra soat cua ban ghi nap tinh theo ngay GOC
CREATE OR REPLACE FUNCTION fn_review_anchor_date(v document_versions)
RETURNS DATE AS $$
    SELECT CASE WHEN v.migrated_record THEN v.original_effective_date
                ELSE v.effective_date END;
$$ LANGUAGE sql IMMUTABLE;

-- ------------------------------------------------------------
-- 4. TINH CHINH CHO 1 GB RAM
--
-- KHONG tao chi muc HNSW/IVFFlat tren cot embedding.
-- Voi ~500 tai lieu → ~15.000 phan doan, quet tuan tu chi mat khoang 100 ms,
-- trong khi chi muc HNSW ngon them ~200 MB — o quy mo nay la lo.
-- Khi vuot ~100.000 phan doan moi can tinh lai.
-- ------------------------------------------------------------
-- (khong co lenh CREATE INDEX nao o day — day la co y)

-- Gioi han so ket qua tra ve de khong keo ca bang vao bo nho
CREATE OR REPLACE FUNCTION fn_search_limited(
    p_user UUID, p_q TEXT, p_include_historical BOOLEAN DEFAULT FALSE, p_limit INT DEFAULT 50)
RETURNS TABLE (
    doc_id VARCHAR(50), version_id UUID, version_no VARCHAR(20), title VARCHAR(300),
    status VARCHAR(20), section_code VARCHAR(30), section_title VARCHAR(300),
    snippet TEXT, match_level TEXT, rank REAL
) AS $$
    SELECT * FROM fn_search(p_user, p_q, p_include_historical) LIMIT p_limit;
$$ LANGUAGE sql STABLE;

-- ------------------------------------------------------------
-- 5. GO BO KHI L1 LEN THAT — chay phan nay, KHONG chay o giai doan 1
-- ------------------------------------------------------------
/*
-- Buoc 1: doi chieu du lieu tam voi L1, dam bao moi user_id da khop
SELECT user_id, full_name FROM app_user_ref WHERE temp_record = TRUE;

-- Buoc 2: tra lai quy tac chan ghi
CREATE RULE org_bu_no_write    AS ON UPDATE TO org_bu         DO INSTEAD NOTHING;
CREATE RULE org_site_no_write  AS ON UPDATE TO org_site       DO INSTEAD NOTHING;
CREATE RULE org_dept_no_write  AS ON UPDATE TO org_department DO INSTEAD NOTHING;
CREATE RULE user_dept_no_write AS ON UPDATE TO app_user_dept  DO INSTEAD NOTHING;

DROP TRIGGER trg_log_org_bu   ON org_bu;
DROP TRIGGER trg_log_org_site ON org_site;
DROP TRIGGER trg_log_org_dept ON org_department;

-- Buoc 3: go cot tam
ALTER TABLE app_user_ref DROP COLUMN full_name, DROP COLUMN email, DROP COLUMN temp_record;

-- Buoc 4: tat co
UPDATE system_flags SET flag_value = TRUE  WHERE flag_key = 'l1_synced';
UPDATE system_flags SET flag_value = FALSE WHERE flag_key = 'temp_org_admin';
*/

-- ============================================================
-- ============================================================
-- PHU LUC B — XU LY SAU DIEM TREO
-- (bo sung sau khi ra soat lai bo tai lieu)
-- ============================================================

-- ------------------------------------------------------------
-- B1. DUONG SUA KHAN CAP
--
-- Van de: phat hien mot SOP DA HIEU LUC ghi sai nguong CCP thi lam gi?
-- Hai duong hien co deu te:
--   - Thu hoi  -> hien truong mat tai lieu, phai dung chuyen
--   - Ban moi  -> mat vai ngay cho dang ky + xac nhan + toi ngay hieu luc
-- Thuc te nguoi ta se sua tay len ban in va khong bao ai — he thong bi bo qua
-- dung luc quan trong nhat.
--
-- Nguyen tac: tinh huong nay CHAC CHAN xay ra. Thiet ke no CO KIEM SOAT van an
-- toan hon gia vo no khong ton tai. Doi lai: hau kiem BAT BUOC, co han chot.
-- ------------------------------------------------------------
ALTER TABLE document_versions
    ADD COLUMN IF NOT EXISTS emergency_fix        BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS emergency_reason     TEXT,
    ADD COLUMN IF NOT EXISTS emergency_raised_by  UUID REFERENCES app_user_ref(user_id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS emergency_review_due DATE,
    ADD COLUMN IF NOT EXISTS emergency_closed_at  TIMESTAMPTZ;

ALTER TABLE document_versions
    ADD CONSTRAINT chk_emergency_fields CHECK (
        emergency_fix = FALSE
        OR (coalesce(emergency_reason,'') <> ''
            AND emergency_raised_by IS NOT NULL
            AND emergency_review_due IS NOT NULL));

-- Ban sua khan cap duoc MIEN guard ngay hieu luc (co hieu luc ngay), nhung
-- BAT BUOC hau kiem trong 7 ngay. Mien guard la ngoai le DUY NHAT trong he thong.
CREATE OR REPLACE FUNCTION fn_raise_emergency_fix(
    p_version UUID, p_reason TEXT, p_user UUID)
RETURNS VOID AS $$
BEGIN
    IF coalesce(p_reason,'') = '' THEN
        RAISE EXCEPTION 'Sửa khẩn cấp bắt buộc ghi lý do';
    END IF;
    UPDATE document_versions
       SET emergency_fix = TRUE, emergency_reason = p_reason,
           emergency_raised_by = p_user,
           emergency_review_due = CURRENT_DATE + 7,
           effective_date = CURRENT_DATE
     WHERE version_id = p_version;

    INSERT INTO audit_log (actor_user_id, actor_type, event_type, object_type, object_id, after_state)
    VALUES (p_user, 'nguoi', 'sua_khan_cap', 'document_versions', p_version::TEXT,
            jsonb_build_object('ly_do', p_reason, 'han_hau_kiem', CURRENT_DATE + 7));
END;
$$ LANGUAGE plpgsql;

-- Ban sua khan cap chua hau kiem la MOT LOAI TON DONG — phai leo thang nhu moi
-- loai khac, khong de nam im. Noi rang buoc CHECK truoc khi them loai moi.
ALTER TABLE escalation_rules DROP CONSTRAINT IF EXISTS escalation_rules_backlog_type_check;
ALTER TABLE escalation_rules ADD CONSTRAINT escalation_rules_backlog_type_check
    CHECK (backlog_type IN ('cho_xac_nhan', 'ra_soat_qua_han',
                            'xac_nhan_doc_thieu', 'goi_treo',
                            'sua_khan_cap_cho_hau_kiem'));

INSERT INTO escalation_rules (backlog_type, level, threshold_days, notify_target) VALUES
    ('sua_khan_cap_cho_hau_kiem', 1, 3,  'nguoi_giu_viec'),
    ('sua_khan_cap_cho_hau_kiem', 2, 7,  'quan_ly_bo_phan'),
    ('sua_khan_cap_cho_hau_kiem', 4, 10, 'cap_tren')
ON CONFLICT (backlog_type, level) DO NOTHING;

CREATE VIEW v_emergency_pending AS
SELECT v.version_id, v.doc_id, v.version_no, v.title,
       v.emergency_reason, v.emergency_raised_by, v.emergency_review_due,
       (CURRENT_DATE - v.emergency_review_due) AS so_ngay_qua_han
  FROM document_versions v
 WHERE v.emergency_fix = TRUE AND v.emergency_closed_at IS NULL;

-- ------------------------------------------------------------
-- B2. KIEM TRA TOAN VEN TEP
--
-- Schema da luu file_hash tu dau nhung chua ai quy dinh AI doi chieu va BAO LAU
-- MOT LAN. Mot tep hong am tham se duoc phat hien dung luc danh gia vien mo no ra.
-- ------------------------------------------------------------
CREATE TABLE file_integrity_checks (
    check_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id      UUID NOT NULL REFERENCES document_versions(version_id) ON DELETE CASCADE,
    checked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expected_hash   VARCHAR(64) NOT NULL,
    actual_hash     VARCHAR(64),
    result          VARCHAR(12) NOT NULL
        CHECK (result IN ('khop', 'lech', 'mat_tep')),
    note            TEXT
);

CREATE INDEX idx_integrity_bad ON file_integrity_checks(version_id)
    WHERE result <> 'khop';

-- Uu tien kiem tai lieu DANG HIEU LUC va lau chua kiem nhat.
-- Tren may 1 GB: chay theo lo nho ban dem, khong quet het mot luot.
CREATE VIEW v_files_due_integrity_check AS
SELECT v.version_id, v.doc_id, v.version_no, v.file_path, v.file_hash,
       max(c.checked_at) AS lan_kiem_gan_nhat
  FROM document_versions v
  LEFT JOIN file_integrity_checks c ON c.version_id = v.version_id
 WHERE v.status = 'hieu_luc'
 GROUP BY v.version_id, v.doc_id, v.version_no, v.file_path, v.file_hash
HAVING max(c.checked_at) IS NULL
    OR max(c.checked_at) < now() - interval '90 days'
 ORDER BY lan_kiem_gan_nhat NULLS FIRST;

-- ------------------------------------------------------------
-- B3. THOI HAN LUU TRU
--
-- ⚠️  GIA TRI DUOI DAY LA MAC DINH TAM, CAN QA XAC NHAN.
--     Thoi han luu ho so la chinh sach cua cong ty va co the da ban hanh.
--     Cac con so nay dat theo thong le ISO/BRC, KHONG phai quyet dinh cua he thong.
-- ------------------------------------------------------------
CREATE TABLE retention_policy (
    doc_type            VARCHAR(20) PRIMARY KEY,
    retain_years        SMALLINT NOT NULL CHECK (retain_years > 0),
    confirmed_by_qa     BOOLEAN NOT NULL DEFAULT FALSE,   -- FALSE = con la mac dinh tam
    note                TEXT
);

INSERT INTO retention_policy (doc_type, retain_years, confirmed_by_qa, note) VALUES
    ('SOP',      10, FALSE, 'Mac dinh tam — cho QA xac nhan'),
    ('WI',       10, FALSE, 'Mac dinh tam — cho QA xac nhan'),
    ('Policy',   10, FALSE, 'Mac dinh tam — cho QA xac nhan'),
    ('Form',      5, FALSE, 'Mac dinh tam — cho QA xac nhan'),
    ('External',  5, FALSE, 'Mac dinh tam — theo thoi han cua to chuc phat hanh')
ON CONFLICT (doc_type) DO NOTHING;

-- Tai lieu qua thoi han luu tru. KHONG tu dong xoa — chi liet ke de nguoi quyet.
-- Tieu huy la quyet dinh chat luong co ten nguoi, khong phai tac vu nen.
CREATE VIEW v_retention_due AS
SELECT v.version_id, v.doc_id, v.version_no, v.title, d.doc_type,
       v.status, v.effective_at, r.retain_years, r.confirmed_by_qa,
       (v.effective_at::date + (r.retain_years || ' years')::INTERVAL)::date AS ngay_het_han_luu
  FROM document_versions v
  JOIN documents d ON d.doc_id = v.doc_id
  JOIN retention_policy r ON r.doc_type = d.doc_type
 WHERE v.status IN ('het_hieu_luc', 'thu_hoi')
   AND v.effective_at IS NOT NULL
   AND v.effective_at::date + (r.retain_years || ' years')::INTERVAL < now();

-- Bo sung su kien ghi vet moi
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_event_type_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_event_type_check
    CHECK (event_type IN (
        'nop_dang_ky', 'rut_lai', 'sua_truoc_khi_nop',
        'xac_nhan', 'tu_choi_boi_admin', 'tu_choi_tu_dong', 'tich_checklist',
        'chuyen_hieu_luc', 'chuyen_het_hieu_luc', 'thu_hoi',
        'khai_nhan', 'sua_nhan', 'xac_nhan_nhan_chep',
        'xem', 'tai', 'in', 'tra_cuu_qr', 'xac_nhan_doc', 'hoi_ai',
        'xem_so_sanh', 'tim_kiem',
        'sua_ma_tran', 'gui_thong_bao',
        'sinh_ra_soat', 'ket_luan_ra_soat', 'dong_ra_soat_theo_ban_moi',
        'tao_goi', 'gan_vao_goi', 'doi_ngay_goi', 'thao_thanh_vien',
        'giai_the_goi', 'kich_hoat_goi', 'leo_thang',
        'sua_khan_cap', 'dong_hau_kiem_khan_cap',
        'kiem_toan_ven_tep', 'tieu_huy_ho_so', 'doi_so_hieu', 'dong_bo_l1'));
