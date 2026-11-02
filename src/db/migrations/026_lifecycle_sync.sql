-- 026_lifecycle_sync.sql — ĐỒNG BỘ VÒNG ĐỜI MỚI ("đăng ký là ban hành luôn").
--
-- Hệ thống đã chuyển sang mô hình mới: Author đăng ký = ban hành thẳng, phiên
-- bản vào trạng thái 'da_ban_hanh'. Nhưng một số logic nền (001_schema.sql)
-- vẫn chỉ xét 'hieu_luc' của mô hình cũ. Migration append-only này vá:
--   • Điểm 2: fn_generate_due_reviews quét cả 'da_ban_hanh' (không thì nút
--     "Quá hạn xem xét" + theo dõi rà soát của DC Site luôn rỗng).
--   • Điểm 9: fn_activate_due_versions bỏ khối tự chuyển tài liệu quá hạn sang
--     'het_hieu_luc' — spec mới CHỈ CẢNH BÁO, không tự đổi trạng thái.
--   • Điểm 1: ràng buộc chỉ 1 bản 'da_ban_hanh' hiện hành mỗi doc_id.
--
-- KHÔNG sửa 001-025 (runner append-only, đã áp dụng). Các hàm dưới dùng
-- CREATE OR REPLACE nên định nghĩa mới đè bản cũ.

-- ============================================================
-- Điểm 2 — fn_generate_due_reviews: quét cả 'da_ban_hanh' lẫn 'hieu_luc'.
-- next_review_date đã được trigger fn_set_next_review đặt khi INSERT bản
-- 'da_ban_hanh', nên chỉ cần mở rộng vị từ WHERE.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_generate_due_reviews()
RETURNS INTEGER AS $$
DECLARE v_count INTEGER := 0;
BEGIN
    INSERT INTO periodic_reviews (version_id, doc_id, due_date, assigned_department_id)
    SELECT v.version_id, v.doc_id, v.next_review_date, v.owner_department_id
      FROM document_versions v
     WHERE v.status IN ('da_ban_hanh', 'hieu_luc')
       AND v.next_review_date IS NOT NULL
       AND v.next_review_date <= CURRENT_DATE
       AND NOT EXISTS (
           SELECT 1 FROM periodic_reviews p
            WHERE p.version_id = v.version_id
              AND p.status IN ('dang_ra_soat', 'treo_cho_ban_moi'));
    GET DIAGNOSTICS v_count = ROW_COUNT;

    INSERT INTO audit_log (actor_type, event_type, object_type, object_id, after_state)
    SELECT 'he_thong', 'sinh_ra_soat', 'periodic_reviews', p.review_id::TEXT,
           jsonb_build_object('doc_id', p.doc_id, 'due_date', p.due_date)
      FROM periodic_reviews p
     WHERE p.generated_at > now() - interval '1 minute';

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Điểm 9 — fn_activate_due_versions: GIỮ nguyên mọi transition kích hoạt theo
-- lịch (bao gồm het_hieu_luc do có bản thay thế trong vòng kích hoạt), nhưng
-- GỠ khối cuối tự chuyển tài liệu quá hạn (expiry_date) sang 'het_hieu_luc'.
-- Spec mới: hết hạn CHỈ cảnh báo (catalog preset=expired + banner ở detail),
-- không tự đổi trạng thái.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_activate_due_versions()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
    r RECORD;
    p RECORD;
BEGIN
    -- Duong 1: cac ban KHONG thuoc goi, kich hoat doc lap tung ban.
    -- Ban thuoc goi di duong 2 ben duoi — ca goi cung len hoac khong ai len.
    FOR r IN
        SELECT version_id, doc_id, change_significance, supersedes_version_id
          FROM document_versions
         WHERE status = 'da_dang_ky'
           AND package_id IS NULL
           AND effective_date <= CURRENT_DATE
         ORDER BY doc_id, effective_date, version_no
         FOR UPDATE
    LOOP
        -- Hết hiệu lực bản cũ TRƯỚC, để không vi phạm uq_one_effective_per_doc
        UPDATE document_versions
           SET status = 'het_hieu_luc'
         WHERE doc_id = r.doc_id AND status = 'hieu_luc';

        UPDATE document_versions
           SET status = 'hieu_luc', effective_at = now()
         WHERE version_id = r.version_id;

        INSERT INTO audit_log (actor_type, event_type, object_type, object_id, after_state)
        VALUES ('he_thong', 'chuyen_hieu_luc', 'document_versions',
                r.version_id::TEXT, jsonb_build_object('status', 'hieu_luc'));

        -- Ban ghi ra soat dang treo cho ban moi cua CUNG doc_id nay -> dong lai.
        UPDATE periodic_reviews
           SET status = 'da_dong', resolved_by_version_id = r.version_id, closed_at = now()
         WHERE doc_id = r.doc_id AND status = 'treo_cho_ban_moi';

        -- Ke thua xac nhan doc khi la thay doi NHO: sao chep sang ban moi.
        IF r.change_significance = 'nho' AND r.supersedes_version_id IS NOT NULL THEN
            INSERT INTO read_acknowledgements
                (version_id, user_id, department_id, functional_group_id, acknowledged_at, inherited_from_version_id)
            SELECT r.version_id, a.user_id, a.department_id, a.functional_group_id, a.acknowledged_at, a.version_id
              FROM read_acknowledgements a
             WHERE a.version_id = r.supersedes_version_id
            ON CONFLICT (version_id, user_id) DO NOTHING;
        END IF;

        v_count := v_count + 1;
    END LOOP;

    -- Duong 2: GOI BAN HANH — nguyen tu. Chi kich hoat khi MOI thanh vien da
    -- 'da_dang_ky'. Thieu mot thanh vien thi khong thanh vien nao len (REQ-C12).
    FOR p IN
        SELECT pk.package_id
          FROM release_packages pk
         WHERE pk.status = 'dang_mo'
           AND pk.effective_date <= CURRENT_DATE
           AND EXISTS (SELECT 1 FROM document_versions m WHERE m.package_id = pk.package_id)
           AND NOT EXISTS (
               SELECT 1 FROM document_versions m
                WHERE m.package_id = pk.package_id
                  AND m.status <> 'da_dang_ky')     -- con thanh vien chua san sang -> ca goi dung
         FOR UPDATE
    LOOP
        FOR r IN
            SELECT version_id, doc_id, change_significance, supersedes_version_id
              FROM document_versions
             WHERE package_id = p.package_id
             ORDER BY doc_id, version_no
             FOR UPDATE
        LOOP
            UPDATE document_versions
               SET status = 'het_hieu_luc'
             WHERE doc_id = r.doc_id AND status = 'hieu_luc';

            UPDATE document_versions
               SET status = 'hieu_luc', effective_at = now()
             WHERE version_id = r.version_id;

            INSERT INTO audit_log (actor_type, event_type, object_type, object_id, after_state)
            VALUES ('he_thong', 'chuyen_hieu_luc', 'document_versions',
                    r.version_id::TEXT, jsonb_build_object('status','hieu_luc','package_id',p.package_id));

            UPDATE periodic_reviews
               SET status = 'da_dong', resolved_by_version_id = r.version_id, closed_at = now()
             WHERE doc_id = r.doc_id AND status = 'treo_cho_ban_moi';

            IF r.change_significance = 'nho' AND r.supersedes_version_id IS NOT NULL THEN
                INSERT INTO read_acknowledgements
                    (version_id, user_id, department_id, functional_group_id, acknowledged_at, inherited_from_version_id)
                SELECT r.version_id, a.user_id, a.department_id, a.functional_group_id, a.acknowledged_at, a.version_id
                  FROM read_acknowledgements a
                 WHERE a.version_id = r.supersedes_version_id
                ON CONFLICT (version_id, user_id) DO NOTHING;
            END IF;

            v_count := v_count + 1;
        END LOOP;

        UPDATE release_packages
           SET status = 'da_kich_hoat', activated_at = now()
         WHERE package_id = p.package_id;

        INSERT INTO audit_log (actor_type, event_type, object_type, object_id, after_state)
        VALUES ('he_thong', 'kich_hoat_goi', 'release_packages', p.package_id::TEXT,
                jsonb_build_object('status','da_kich_hoat'));
    END LOOP;

    -- Điểm 9: BỎ khối tự chuyển tài liệu quá hạn sang 'het_hieu_luc'.
    -- Hết hạn chỉ cảnh báo (không tự đổi trạng thái) — xem catalog preset=expired
    -- và banner "ĐÃ QUÁ NGÀY HẾT HẠN" ở detail.eta.

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Điểm 1 — chỉ 1 bản 'da_ban_hanh' hiện hành mỗi doc_id.
-- uq_one_effective_per_doc hiện chỉ phủ 'hieu_luc' (mô hình cũ). Mô hình mới
-- bản hiện hành là 'da_ban_hanh' nên cần ràng buộc riêng, song song.
-- ============================================================
CREATE UNIQUE INDEX uq_one_current_per_doc
    ON document_versions (doc_id)
    WHERE status = 'da_ban_hanh';
