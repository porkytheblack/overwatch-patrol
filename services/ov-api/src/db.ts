import { openDb } from '@overwatch/shared-ts';
import { ENV } from './env.js';

export const db = openDb(ENV.SQLITE_PATH);
