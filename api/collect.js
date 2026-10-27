// Vercel only runs functions from /api, so this just points at the real handler in backend/.
export { default } from '../backend/collect.js';
