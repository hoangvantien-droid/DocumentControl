/**
 * src/config.ts — đọc biến môi trường, kiểm tra biến bắt buộc (DCS-8 §6.1).
 *
 * Nguyên tắc: kiểm tra NGAY khi khởi động, dừng hẳn nếu thiếu. Không để hệ
 * thống chạy được rồi hỏng ở request thứ một trăm.
 */
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';

export interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  logLevel: string;
  databaseUrl: string;
  sessionSecret: string;
  fileStoragePath: string;
  dbPoolMax: number;
  /** Thiếu thì tắt hỏi đáp AI, phần còn lại vẫn chạy (DCS-8 §6.1). */
  embeddingApiUrl: string | null;
  embeddingApiKey: string | null;
  tesseractPath: string;
}

/** Nạp .env đơn giản, không phụ thuộc thư viện. Biến đã có trong process.env thắng. */
function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Bỏ dấu nháy bao quanh nếu có.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

/** Tập hợp lỗi rồi báo một lượt, thay vì dừng ở lỗi đầu tiên. */
class ConfigError extends Error {
  constructor(problems: string[]) {
    super(
      'Cấu hình không hợp lệ — hệ thống dừng khởi động:\n' +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
    this.name = 'ConfigError';
  }
}

export function loadConfig(): Config {
  loadDotEnv();
  const problems: string[] = [];
  const env = process.env;

  const nodeEnv = (env.NODE_ENV ?? 'development') as Config['nodeEnv'];

  const databaseUrl = env.DATABASE_URL ?? '';
  if (!databaseUrl) problems.push('Thiếu biến bắt buộc DATABASE_URL');

  const sessionSecret = env.SESSION_SECRET ?? '';
  if (!sessionSecret) {
    problems.push('Thiếu biến bắt buộc SESSION_SECRET');
  } else if (sessionSecret.length < 32) {
    problems.push('SESSION_SECRET phải dài tối thiểu 32 ký tự');
  }

  const fileStoragePath = env.FILE_STORAGE_PATH ?? '';
  if (!fileStoragePath) problems.push('Thiếu biến bắt buộc FILE_STORAGE_PATH');

  let port = 3000;
  if (env.PORT) {
    const parsed = Number(env.PORT);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
      problems.push(`PORT không hợp lệ: ${env.PORT}`);
    } else {
      port = parsed;
    }
  }

  let dbPoolMax = 10;
  if (env.DB_POOL_MAX) {
    const parsed = Number(env.DB_POOL_MAX);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      problems.push(`DB_POOL_MAX không hợp lệ: ${env.DB_POOL_MAX}`);
    } else {
      dbPoolMax = parsed;
    }
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    nodeEnv,
    port,
    logLevel: env.LOG_LEVEL ?? (nodeEnv === 'production' ? 'info' : 'debug'),
    databaseUrl,
    sessionSecret,
    fileStoragePath,
    dbPoolMax,
    embeddingApiUrl: env.EMBEDDING_API_URL ?? null,
    embeddingApiKey: env.EMBEDDING_API_KEY ?? null,
    tesseractPath: env.TESSERACT_PATH ?? '/usr/bin/tesseract',
  };
}
