/**
 * src/jobs/scheduler.ts — tác vụ nền chạy hằng ngày (T-035).
 *
 * Chạy như tiến trình oneshot qua systemd timer (deploy/dcs-jobs.timer), KHÔNG
 * chạy trong tiến trình máy chủ web. Trên máy 1 GB, tách tiến trình để trả sạch
 * bộ nhớ sau khi xong (DCS-8 §1.2).
 *
 * Gồm: chuyển hiệu lực theo ngày, sinh rà soát tới hạn, dọn phiên hết hạn.
 * Leo thang (fn_run_escalations) thêm ở giai đoạn 7.
 */
import { loadConfig } from '../config.js';
import { getSql, closeSql } from '../db/client.js';
import { activateDueVersions, generateDueReviews } from '../domain/lifecycle.js';
import { runEscalations } from '../domain/escalation.js';
import { purgeExpiredSessions } from '../domain/session.js';

export async function runDailyJobs(): Promise<{
  activated: number; reviewsGenerated: number; escalationsSent: number; sessionsPurged: number;
}> {
  const config = loadConfig();
  const sql = getSql(config);
  const activated = await activateDueVersions(sql);
  const reviewsGenerated = await generateDueReviews(sql);
  const escalationsSent = await runEscalations(sql);
  const sessionsPurged = await purgeExpiredSessions(sql);
  return { activated, reviewsGenerated, escalationsSent, sessionsPurged };
}

// Chạy trực tiếp: node dist/jobs/scheduler.js
if (process.argv[1]?.endsWith('scheduler.ts') || process.argv[1]?.endsWith('scheduler.js')) {
  runDailyJobs()
    .then((r) => {
      console.log(
        `Tác vụ nền xong: kích hoạt ${r.activated}, sinh rà soát ${r.reviewsGenerated}, ` +
        `leo thang ${r.escalationsSent}, dọn phiên ${r.sessionsPurged}`,
      );
      return closeSql();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Tác vụ nền thất bại:', err);
      closeSql().finally(() => process.exit(1));
    });
}
