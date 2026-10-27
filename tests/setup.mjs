import { register } from 'node:module';

process.env.DATABASE_URL = 'postgres://test';
process.env.ADMIN_PASSWORD = 'correct horse';
process.env.HASH_SALT = 'test-salt';
register('./hooks.mjs', import.meta.url);
