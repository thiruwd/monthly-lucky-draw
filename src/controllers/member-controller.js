import { memberData } from '../middleware/validation.js';
export function memberController(service) {
  return {
    list: async (req, res) => res.json({ members: await service.list() }),
    create: async (req, res) => res.status(201).json({ member: await service.save(null, memberData(req)) }),
    update: async (req, res) => res.json({ member: await service.save(req.validated.id, memberData(req)) }),
    status: async (req, res) => res.json({ member: await service.setStatus(req.validated.id, req.validated.is_active) }),
    remove: async (req, res) => { await service.remove(req.validated.id); res.status(204).end(); }
  };
}
