import readline from 'node:readline/promises';
import { eq } from 'drizzle-orm';
import { schema } from '@overwatch/shared-ts';
import { db } from './db.js';
import { hashPassword } from './auth.js';

const username = process.argv[2];
if (!username) {
  console.error('usage: pnpm reset-password <username>');
  process.exit(1);
}

const user = db.select().from(schema.users).where(eq(schema.users.username, username)).get();
if (!user) {
  console.error(`no such user: ${username}`);
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const pw = await rl.question(`new password for ${username}: `);
rl.close();
if (pw.length < 8) {
  console.error('password must be ≥ 8 chars');
  process.exit(1);
}
db.update(schema.users)
  .set({ password_hash: await hashPassword(pw) })
  .where(eq(schema.users.id, user.id))
  .run();
console.log('✓ password updated');
