import { AppError } from '../utils/errors.js';
import { isoUtc } from '../utils/time.js';

const member = row => row && ({ ...row, id: String(row.id), created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString() });
const winner = row => ({ ...row, id: String(row.id), member_id: String(row.member_id), won_at: row.won_at.toISOString() });

export class SupabaseStore {
  constructor(pool) { this.pool = pool; }
  async withWriteLock(work) {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await db.query("SET LOCAL lock_timeout = '8s'");
      const { rows } = await db.query('SELECT id FROM lucky_draw.draw_lock WHERE id=1 FOR UPDATE');
      if (rows.length !== 1) throw new Error('Run npm run setup:supabase first.');
      const result = await work(db); await db.query('COMMIT'); return result;
    } catch (error) { try { await db.query('ROLLBACK'); } catch {} throw error; }
    finally { db.release(); }
  }
  async withSnapshot(work) {
    const db = await this.pool.connect();
    try { await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); const result = await work(db); await db.query('COMMIT'); return result; }
    catch (error) { try { await db.query('ROLLBACK'); } catch {} throw error; }
    finally { db.release(); }
  }
  async listMembers(db = this.pool) {
    const { rows } = await db.query('SELECT id,name,member_code,email,is_active,created_at,updated_at FROM lucky_draw.members WHERE deleted_at IS NULL ORDER BY id DESC');
    return rows.map(member);
  }
  async findMember(id, db = this.pool) {
    const { rows } = await db.query('SELECT id,name,member_code,email,is_active,created_at,updated_at FROM lucky_draw.members WHERE id=$1 AND deleted_at IS NULL', [id]);
    return member(rows[0]);
  }
  async createMember(data, db) {
    const { rows } = await db.query('INSERT INTO lucky_draw.members (name,member_code,email,is_active) VALUES ($1,$2,$3,$4) RETURNING id', [data.name, data.member_code, data.email, data.is_active]);
    return this.findMember(String(rows[0].id), db);
  }
  async updateMember(id, data, db) {
    await db.query('UPDATE lucky_draw.members SET name=$1,member_code=$2,email=$3,is_active=$4,updated_at=now() WHERE id=$5 AND deleted_at IS NULL', [data.name, data.member_code, data.email, data.is_active, id]);
    return this.findMember(id, db);
  }
  async setMemberStatus(id, active, db) { await db.query('UPDATE lucky_draw.members SET is_active=$1,updated_at=now() WHERE id=$2 AND deleted_at IS NULL', [active, id]); return this.findMember(id, db); }
  async deleteMember(id, db) { await db.query('UPDATE lucky_draw.members SET is_active=false,deleted_at=now(),updated_at=now() WHERE id=$1 AND deleted_at IS NULL', [id]); }
  async eligible(period, db = this.pool) {
    const { rows } = await db.query(`SELECT m.id,m.name,m.member_code FROM lucky_draw.members m WHERE m.deleted_at IS NULL AND m.is_active=true
      AND NOT EXISTS (SELECT 1 FROM lucky_draw.winners w WHERE w.member_id=m.id AND w.draw_month=$1 AND w.draw_year=$2) ORDER BY m.id`, [period.month, period.year]);
    return rows.map(row => ({ ...row, id: String(row.id) }));
  }
  async winners({ month, year, limit = 100, offset = 0 }, db = this.pool) {
    const where = month ? 'WHERE draw_month=$1 AND draw_year=$2' : '', values = month ? [month, year] : [];
    const { rows } = await db.query(`SELECT id,member_id,name,draw_month,draw_year,won_at FROM lucky_draw.winners ${where} ORDER BY won_at DESC,id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]);
    const count = await db.query(`SELECT count(*) AS total FROM lucky_draw.winners ${where}`, values);
    return { items: rows.map(winner), total: Number(count.rows[0].total), limit, offset };
  }
  async counts(db = this.pool) {
    const { rows } = await db.query('SELECT count(*) AS total,count(*) FILTER (WHERE is_active) AS active FROM lucky_draw.members WHERE deleted_at IS NULL');
    return { total: Number(rows[0].total), active: Number(rows[0].active) };
  }
  async insertWinner(data, db) {
    const { rows } = await db.query('INSERT INTO lucky_draw.winners (member_id,name,draw_month,draw_year,won_at) VALUES ($1,$2,$3,$4,$5) RETURNING id,member_id,name,draw_month,draw_year,won_at', [data.member_id, data.name, data.draw_month, data.draw_year, isoUtc(data.won_at)]);
    return winner(rows[0]);
  }
  async findDrawRequest(adminId, key, db) { const { rows } = await db.query('SELECT response_json FROM lucky_draw.requests WHERE admin_id=$1 AND request_key=$2', [adminId, key]); return rows[0]?.response_json || null; }
  async saveDrawRequest(adminId, key, response, db) { await db.query('INSERT INTO lucky_draw.requests (admin_id,request_key,response_json) VALUES ($1,$2,$3)', [adminId, key, JSON.stringify(response)]); }
  async getPublicDisplay(db = this.pool) { const { rows } = await db.query('SELECT data FROM lucky_draw.live_display WHERE id=1'); return rows[0]?.data || null; }
  async savePublicDisplay(data, db) { await db.query('INSERT INTO lucky_draw.live_display (id,data) VALUES (1,$1) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()', [JSON.stringify(data)]); }
  async findAdmin(username) { const { rows } = await this.pool.query('SELECT id,username,password_hash FROM lucky_draw.admins WHERE lower(username)=lower($1)', [username]); return rows[0]; }
  async findAdminById(id) { const { rows } = await this.pool.query('SELECT id,username,password_hash FROM lucky_draw.admins WHERE id=$1', [id]); return rows[0]; }
  async ensureAdmin({ username, passwordHash }) {
    return this.withWriteLock(async db => {
      const { rows } = await db.query('SELECT id FROM lucky_draw.admins LIMIT 1');
      if (!rows.length) await db.query('INSERT INTO lucky_draw.admins (username,password_hash) VALUES ($1,$2)', [username, passwordHash]);
    });
  }
  async createSession(data) {
    return this.withWriteLock(async db => {
      const { rows } = await db.query('SELECT password_hash FROM lucky_draw.admins WHERE id=$1 FOR UPDATE', [data.adminId]);
      if (!rows[0] || (data.expectedPasswordHash && rows[0].password_hash !== data.expectedPasswordHash)) throw new AppError(401, 'CREDENTIALS_CHANGED', 'Your password changed. Sign in again.');
      await db.query('DELETE FROM lucky_draw.sessions WHERE expires_at<=now()');
      await db.query('INSERT INTO lucky_draw.sessions (token_hash,admin_id,csrf_token,expires_at) VALUES ($1,$2,$3,$4)', [data.tokenHash, data.adminId, data.csrfToken, isoUtc(data.expiresAt)]);
    });
  }
  async findSession(hash) {
    const { rows } = await this.pool.query('SELECT s.admin_id,s.csrf_token,a.username FROM lucky_draw.sessions s JOIN lucky_draw.admins a ON a.id=s.admin_id WHERE token_hash=$1 AND expires_at>now()', [hash]);
    return rows[0];
  }
  async deleteSession(hash) { await this.pool.query('DELETE FROM lucky_draw.sessions WHERE token_hash=$1', [hash]); }
  async changeAdminPassword(id, expectedHash, newHash) {
    return this.withWriteLock(async db => {
      const { rows } = await db.query('SELECT password_hash FROM lucky_draw.admins WHERE id=$1 FOR UPDATE', [id]);
      if (!rows[0] || rows[0].password_hash !== expectedHash) throw new AppError(409, 'PASSWORD_CHANGED', 'Your password changed in another session. Sign in again.');
      await db.query('UPDATE lucky_draw.admins SET password_hash=$1,updated_at=now() WHERE id=$2', [newHash, id]);
      await db.query('DELETE FROM lucky_draw.sessions WHERE admin_id=$1', [id]);
    });
  }
}
