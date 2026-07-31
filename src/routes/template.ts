import { Router, Request, Response } from 'express';
import { getTemplate } from '../templates';

const router = Router();

router.get('/templates/:id', (req: Request, res: Response) => {
  const tpl = getTemplate(req.params.id);
  if (!tpl) { res.status(404).json({ error: 'Unknown template' }); return; }
  res.json(tpl);
});

export default router;
