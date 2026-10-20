import { isoUtc } from '../utils/time.js';

const member = row => row && ({ ...row, id: String(row.id), is_active: Boolean(row.is_active),
  created_at: isoUtc(row.created_at), updated_at: isoUtc(row.updated_at) });
const winner = row => ({ ...row, id: String(row.id), member_id: String(row.member_id), won_at: isoUtc(row.won_at) });

export class MysqlStore {
  constructor(pool) { this.pool = pool; }

  async withWriteLock(work) {
    const connection = await this.pool.getConnection();
    let begun = false;
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();
      begun = true;
      // Every draw and member mutation takes this same InnoDB row lock.
      const [locks] = await connection.execute('SELECT id FROM draw_lock WHERE id = 1 FOR UPDATE');
      if (locks.length !== 1) throw new Error('Missing draw lock. Run the database migration.');
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      if (begun) {
        try { await connection.rollback(); } catch { /* Keep the original failure. */ }
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async withSnapshot(work) {
    const connection = await this.pool.getConnection();
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      try { await connection.rollback(); } catch { /* Keep the original failure. */ }
      throw error;
    } finally { connection.release(); }
  }

  async listMembers(db = this.pool) {
    const [rows] = await db.execute('SELECT id, member_code, name, email, is_active, created_at, updated_at FROM members WHERE deleted_at IS NULL ORDER BY id DESC');
    return rows.map(member);
  }

  async findMember(id, db = this.pool) {
    const [rows] = await db.execute('SELECT id, member_code, name, email, is_active, created_at, updated_at FROM members WHERE id = ? AND deleted_at IS NULL', [id]);
    return member(rows[0]);
  }

  async createMember(data, db) {
    const [result] = await db.execute('INSERT INTO members (name, member_code, email, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
      [data.name, data.member_code, data.email, data.is_active]);
    return this.findMember(String(result.insertId), db);
  }

  async updateMember(id, data, db) {
    await db.execute('UPDATE members SET name = ?, member_code = ?, email = ?, is_active = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND deleted_at IS NULL',
      [data.name, data.member_code, data.email, data.is_active, id]);
    return this.findMember(id, db);
  }

  async setMemberStatus(id, active, db) {
    await db.execute('UPDATE members SET is_active = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND deleted_at IS NULL', [active, id]);
    return this.findMember(id, db);
  }

  async deleteMember(id, db) {
    await db.execute('UPDATE members SET is_active = FALSE, deleted_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ? AND deleted_at IS NULL', [id]);
  }

  async eligible(period, db = this.pool) {
    const [rows] = await db.execute(`SELECT m.id, m.name, m.member_code FROM members m
      WHERE m.is_active = TRUE AND m.deleted_at IS NULL AND NOT EXISTS (
        SELECT 1 FROM lucky_draw_winners w WHERE w.member_id = m.id AND w.draw_month = ? AND w.draw_year = ?
      ) ORDER BY m.id`, [period.month, period.year]);
    return rows.map(row => ({ ...row, id: String(row.id) }));
  }

  async winners({ month, year, limit = 100, offset = 0 }, db = this.pool) {
    const where = month ? 'WHERE draw_month = ? AND draw_year = ?' : '';
    const values = month ? [month, year] : [];
    const [rows] = await db.query(`SELECT id, member_id, member_name AS name, draw_month, draw_year, won_at
      FROM lucky_draw_winners ${where} ORDER BY won_at DESC, id DESC LIMIT ? OFFSET ?`, [...values, Number(limit), Number(offset)]);
    const [[count]] = await db.execute(`SELECT COUNT(*) AS total FROM lucky_draw_winners ${where}`, values);
    return { items: rows.map(winner), total: Number(count.total), limit, offset };
  }

  async counts(db = this.pool) {
    const [[row]] = await db.execute('SELECT COUNT(*) AS total, COALESCE(SUM(is_active = TRUE), 0) AS active FROM members WHERE deleted_at IS NULL');
    return { total: Number(row.total), active: Number(row.active) };
  }

  async insertWinner(data, db) {
    const [result] = await db.execute('INSERT INTO lucky_draw_winners (member_id, member_name, draw_month, draw_year, won_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [data.member_id, data.name, data.draw_month, data.draw_year, data.won_at, data.won_at]);
    return { ...data, id: String(result.insertId), won_at: isoUtc(data.won_at) };
  }

  async findDrawRequest(adminId, key, db) {
    const [rows] = await db.execute('SELECT response_json FROM draw_requests WHERE admin_id = ? AND request_key = ?', [adminId, key]);
    const response = rows[0]?.response_json;
    return typeof response === 'string' ? JSON.parse(response) : response;
  }

  async saveDrawRequest(adminId, key, response, db) {
    await db.execute('INSERT INTO draw_requests (admin_id, request_key, response_json, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP())', [adminId, key, JSON.stringify(response)]);
  }

  async findAdmin(username) {
    const [rows] = await this.pool.execute('SELECT id, username, password_hash FROM admins WHERE username = ?', [username]);
    return rows[0];
  }

  async createSession(data) {
    await this.pool.execute('DELETE FROM admin_sessions WHERE expires_at <= UTC_TIMESTAMP()');
    await this.pool.execute('INSERT INTO admin_sessions (token_hash, admin_id, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())',
      [data.tokenHash, data.adminId, data.csrfToken, data.expiresAt]);
  }

  async findSession(hash) {
    const [rows] = await this.pool.execute(`SELECT s.admin_id, s.csrf_token, a.username FROM admin_sessions s
      JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()`, [hash]);
    return rows[0];
  }

  async deleteSession(hash) { await this.pool.execute('DELETE FROM admin_sessions WHERE token_hash = ?', [hash]); }
}
