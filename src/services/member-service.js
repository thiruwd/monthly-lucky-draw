import { AppError } from '../utils/errors.js';

export class MemberService {
  constructor(store, onChange) { this.store = store; this.onChange = onChange; }
  list() { return this.store.listMembers(); }
  async save(id, data) {
    return this.store.withWriteLock(async db => {
      if (id && !await this.store.findMember(id, db)) throw new AppError(404, 'MEMBER_NOT_FOUND', 'Participant not found.');
      const result = await (id ? this.store.updateMember(id, data, db) : this.store.createMember(data, db));
      if (this.onChange) await this.onChange(db);
      return result;
    });
  }
  async setStatus(id, active) {
    return this.store.withWriteLock(async db => {
      if (!await this.store.findMember(id, db)) throw new AppError(404, 'MEMBER_NOT_FOUND', 'Participant not found.');
      const result = await this.store.setMemberStatus(id, active, db);
      if (this.onChange) await this.onChange(db);
      return result;
    });
  }
  async remove(id) {
    return this.store.withWriteLock(async db => {
      if (!await this.store.findMember(id, db)) throw new AppError(404, 'MEMBER_NOT_FOUND', 'Participant not found.');
      await this.store.deleteMember(id, db);
      if (this.onChange) await this.onChange(db);
    });
  }
}
