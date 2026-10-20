// A deterministic repository double for service/API tests. Real SQL is tested separately.
export class MemoryStore {
  constructor() {
    this.members = []; this.history = []; this.requests = new Map(); this.sessions = new Map(); this.admins = [];
    this.nextId = 1; this.tail = Promise.resolve();
  }
  async withWriteLock(work) {
    const previous = this.tail;
    let unlock;
    this.tail = new Promise(resolve => { unlock = resolve; });
    await previous;
    const backup = structuredClone({ members: this.members, history: this.history, requests: this.requests, nextId: this.nextId, publicDisplay: this.publicDisplay });
    try { return await work(this); }
    catch (error) { Object.assign(this, backup); throw error; }
    finally { unlock(); }
  }
  async withSnapshot(work) { return this.withWriteLock(work); }
  async listMembers() { return this.members.filter(member => !member.deleted_at).map(member => ({ ...member })); }
  async findMember(id) { return (await this.listMembers()).find(member => member.id === String(id)); }
  async createMember(data) {
    if (data.member_code && this.members.some(member => member.member_code === data.member_code)) throw Object.assign(new Error('Duplicate'), { code: 'ER_DUP_ENTRY' });
    const member = { id: String(this.nextId++), ...data, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
    this.members.push(member); return { ...member };
  }
  async updateMember(id, data) { Object.assign(this.members.find(member => member.id === id), data); return this.findMember(id); }
  async setMemberStatus(id, active) { return this.updateMember(id, { is_active: active }); }
  async deleteMember(id) { return this.updateMember(id, { deleted_at: '2026-01-01T00:00:00Z', is_active: false }); }
  async eligible(period) {
    return this.members.filter(member => !member.deleted_at && member.is_active && !this.history.some(winner => winner.member_id === member.id && winner.draw_month === period.month && winner.draw_year === period.year))
      .map(member => ({ id: member.id, name: member.name, member_code: member.member_code }));
  }
  async winners({ month, year, limit = 100, offset = 0 }) {
    const items = this.history.filter(winner => !month || (winner.draw_month === month && winner.draw_year === year)).toReversed();
    return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
  }
  async counts() { const members = await this.listMembers(); return { total: members.length, active: members.filter(member => member.is_active).length }; }
  async insertWinner(data) {
    if (this.history.some(winner => winner.member_id === data.member_id && winner.draw_month === data.draw_month && winner.draw_year === data.draw_year)) throw Object.assign(new Error('Duplicate'), { code: 'ER_DUP_ENTRY' });
    const winner = { ...data, id: String(this.history.length + 1), won_at: data.won_at.replace(' ', 'T') + 'Z' };
    this.history.push(winner); return winner;
  }
  async findDrawRequest(adminId, key) { return this.requests.get(`${adminId}:${key}`); }
  async saveDrawRequest(adminId, key, response) { this.requests.set(`${adminId}:${key}`, structuredClone(response)); }
  async findAdmin(username) { return this.admins.find(admin => admin.username === username); }
  async createSession(data) { this.sessions.set(data.tokenHash, { admin_id: data.adminId, csrf_token: data.csrfToken, username: this.admins.find(admin => admin.id === data.adminId).username, expires_at: data.expiresAt }); }
  async findSession(hash) { const session = this.sessions.get(hash); return session && new Date(session.expires_at.replace(' ', 'T') + 'Z') > new Date() ? session : null; }
  async deleteSession(hash) { this.sessions.delete(hash); }
  async getPublicDisplay() { return this.publicDisplay || null; }
  async savePublicDisplay(data) { this.publicDisplay = structuredClone(data); }
  async findAdminById(id) { return this.admins.find(admin => admin.id === id); }
  async changeAdminPassword(id, expectedHash, newHash) {
    const admin = await this.findAdminById(id);
    if (admin.password_hash !== expectedHash) throw new Error('Password changed concurrently');
    admin.password_hash = newHash;
    for (const [hash, session] of this.sessions) if (session.admin_id === id) this.sessions.delete(hash);
  }
}
