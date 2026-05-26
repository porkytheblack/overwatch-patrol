import { hashPassword } from './auth.js';
import { schema, newId, nowIso } from '@overwatch/shared-ts';
import { eq } from 'drizzle-orm';
import { db } from './db.js';
import readline from 'node:readline/promises';

async function prompt(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await rl.question(q);
  rl.close();
  return ans.trim();
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);

const username = (args.username as string) || (await prompt('username: '));
const password = (args.password as string) || (await prompt('password: '));

const existing = db.select().from(schema.users).where(eq(schema.users.username, username)).get();
if (existing) {
  console.log('user already exists; skipping');
  process.exit(0);
}

const id = newId();
db.insert(schema.users)
  .values({
    id,
    username,
    password_hash: await hashPassword(password),
    role: 'operator',
    created_at: nowIso(),
  })
  .run();

console.log(`✓ created operator ${username}`);
