import { register } from 'node:module';

process.env.DATABASE_URL = 'postgres://test';
process.env.ADMIN_PASSWORD = 'correct horse';
process.env.HASH_SALT = 'test-salt';
process.env.SESSION_SECRET = 'test-session-secret-0123456789abcdef';
register('./hooks.mjs', import.meta.url);
