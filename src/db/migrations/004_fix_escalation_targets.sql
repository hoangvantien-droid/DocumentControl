-- 004_fix_escalation_targets.sql — Sửa fn_run_escalations (lỗ hổng đã ghi ở DCS-4).
--
-- Bản gốc DCS-4 tham chiếu bảng `users` (KHÔNG tồn tại) cho notify_target
-- 'dcs_admin', và app_user_role cho 'cap_tren'. Tạo lại hàm dùng app_user_role
-- (bảng đã tạo ở migration 003) cho cả hai — nguồn vai trò hợp lệ ở giai đoạn 1.
--
--   'dcs_admin' -> người có DC_SITE_QA_MANAGER hoặc DC_BU_OWNER (đóng vai Admin)
--   'cap_tren'  -> người có DC_GROUP_OWNER

CREATE OR REPLACE FUNCTION fn_run_escalations()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
    b RECORD;
    v_target UUID;
BEGIN
    FOR b IN
        SELECT bl.*, er.level, er.notify_target
          FROM v_backlog_all bl
          JOIN escalation_rules er
            ON er.backlog_type = bl.backlog_type
           AND er.is_active
           AND bl.days_overdue >= er.threshold_days
         WHERE NOT EXISTS (
               SELECT 1 FROM escalations_sent es
                WHERE es.backlog_type = bl.backlog_type
                  AND es.object_id    = bl.object_id
                  AND es.level        = er.level)
    LOOP
        v_target := CASE b.notify_target
            WHEN 'nguoi_giu_viec'   THEN b.holder_user_id
            WHEN 'quan_ly_bo_phan'  THEN (SELECT manager_user_id FROM org_department
                                           WHERE dept_id = b.department_id)
            WHEN 'dcs_admin'        THEN (SELECT user_id FROM app_user_role
                                           WHERE role_code IN ('DC_SITE_QA_MANAGER','DC_BU_OWNER')
                                             AND is_active LIMIT 1)
            WHEN 'cap_tren'         THEN (SELECT user_id FROM app_user_role
                                           WHERE role_code = 'DC_GROUP_OWNER'
                                             AND is_active LIMIT 1)
        END;

        -- Không tìm được người nhận thì bỏ qua bậc này, KHÔNG ghi escalations_sent
        -- (để khi khai xong sẽ gửi được).
        CONTINUE WHEN v_target IS NULL;

        INSERT INTO escalations_sent (backlog_type, object_id, level, sent_to_user_id)
        VALUES (b.backlog_type, b.object_id, b.level, v_target)
        ON CONFLICT (backlog_type, object_id, level) DO NOTHING;

        INSERT INTO audit_log (actor_type, event_type, object_type, object_id, after_state)
        VALUES ('he_thong', 'leo_thang', b.backlog_type, b.object_id,
                jsonb_build_object('level', b.level, 'sent_to', v_target,
                                   'days_overdue', b.days_overdue));
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;
