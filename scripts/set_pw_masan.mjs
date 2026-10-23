import postgres from 'postgres';
import argon2 from 'argon2';
import { readFileSync } from 'node:fs';

function loadDbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync('/etc/dcs/.env', 'utf8');
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error('DATABASE_URL not found');
  return m[1].trim();
}

const sql = postgres(loadDbUrl(), { max: 1 });
const pw = process.env.RESET_PW;
if (!pw) throw new Error('RESET_PW missing');
const hash = await argon2.hash(pw, { type: argon2.argon2id });
try {
  const rows = await sql`UPDATE users SET password_hash=${hash} WHERE is_active=TRUE RETURNING email`;
  console.log(`Updated ${rows.length} users`);
  for (const r of rows) console.log(`  ${r.email}`);
} finally {
  await sql.end();
}
