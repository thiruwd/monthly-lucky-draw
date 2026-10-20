import { randomBytes, createHash } from 'node:crypto';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { sqlUtc } from '../utils/time.js';
import { AppError } from '../utils/errors.js';

export const tokenHash = token => createHash('sha256').update(token).digest('hex');
// A real scrypt operation also runs for nonexistent usernames.
const dummyHash = hashPassword(randomBytes(32).toString('hex'));

export class AuthService {
  constructor(store, config) { Object.assign(this, { store, config }); }
  async login(username, password) {
    const admin = await this.store.findAdmin(username);
    const valid = await verifyPassword(password, admin?.password_hash || await dummyHash);
    if (!valid || !admin) throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect username or password.');
    const token = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    await this.store.createSession({ tokenHash: tokenHash(token), adminId: String(admin.id), csrfToken,
      expiresAt: sqlUtc(new Date(Date.now() + this.config.sessionHours * 3600000)), expectedPasswordHash: admin.password_hash });
    return { token, csrfToken, admin: { id: String(admin.id), username: admin.username } };
  }
  async session(token) {
    if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
    const session = await this.store.findSession(tokenHash(token));
    return session && { admin: { id: String(session.admin_id), username: session.username }, csrfToken: session.csrf_token };
  }
  logout(token) { return this.store.deleteSession(tokenHash(token)); }
  async changePassword(id, currentPassword, newPassword) {
    const admin = await this.store.findAdminById(id);
    if (!admin || !await verifyPassword(currentPassword, admin.password_hash)) throw new AppError(403, 'INCORRECT_PASSWORD', 'Your current password is incorrect.');
    if (currentPassword === newPassword) throw new AppError(422, 'PASSWORD_UNCHANGED', 'Choose a different password.');
    await this.store.changeAdminPassword(id, admin.password_hash, await hashPassword(newPassword));
  }
}
