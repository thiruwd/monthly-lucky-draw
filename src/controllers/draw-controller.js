export function drawController(service) {
  return {
    eligible: async (req, res) => res.json(await service.eligible()),
    status: async (req, res) => res.json(await service.status()),
    winners: async (req, res) => res.json(await service.winners(req.validated)),
    spin: async (req, res) => res.json(await service.spin(req.auth.admin.id, req.get('Idempotency-Key')))
  };
}
