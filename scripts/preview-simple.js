import { createApp } from '../src/app.js';
import { MemoryStore } from '../tests/helpers/memory-store.js';
import { MemberService } from '../src/services/member-service.js';
import { DrawService } from '../src/services/draw-service.js';
import { hashPassword } from '../src/utils/password.js';

const store = new MemoryStore();
store.admins.push({ id: '1', username: 'ui-test', password_hash: await hashPassword('local-preview-password') });
const draw = new DrawService(store, { timezone: 'Asia/Kolkata', liveDraws: true });
const members = new MemberService(store, db => draw.refreshDisplay(db));
for (const name of ['Aarav Sharma', 'Ananya Patel', 'Arjun Mehta', 'Diya Nair', 'Ishaan Kapoor', 'Kavya Rao', 'Neel Shah', 'Priya Iyer', 'Rohan Gupta', 'Sana Khan', 'Vikram Desai', 'Zoya Ali']) {
  await members.save(null, { name, member_code: null, email: null, is_active: true });
}
const config = { production: false, origin: 'http://127.0.0.1:3001', timezone: 'Asia/Kolkata', trustProxy: 0, sessionHours: 1, liveDraws: true };
const server = createApp({ store, config }).listen(3001, '127.0.0.1', () => console.log('DISPOSABLE UI PREVIEW (no cloud database). Public: http://127.0.0.1:3001 · Admin: /admin · ui-test / local-preview-password'));
process.on('SIGINT', () => server.close()); process.on('SIGTERM', () => server.close());
