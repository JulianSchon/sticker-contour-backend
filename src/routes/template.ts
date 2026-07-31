import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { getTemplate } from '../templates';
import { generateTemplatePdf } from '../services/templatePdf';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });
const router = Router();

router.get('/templates/:id', (req: Request, res: Response) => {
  const tpl = getTemplate(req.params.id);
  if (!tpl) { res.status(404).json({ error: 'Unknown template' }); return; }
  res.json(tpl);
});

function parseHex(hex: unknown): { r: number; g: number; b: number } {
  const m = typeof hex === 'string' && hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return { r: 255, g: 255, b: 255 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

router.post(
  '/template-generate',
  upload.single('image'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) { res.status(400).json({ error: 'No image uploaded' }); return; }
      const tpl = getTemplate(String(req.body.templateId));
      if (!tpl) { res.status(400).json({ error: 'Unknown templateId' }); return; }
      const bgColor = parseHex(req.body.bgColor);
      const pdf = await generateTemplatePdf(req.file.buffer, tpl, bgColor);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="peltor.pdf"');
      res.setHeader('Content-Length', pdf.length.toString());
      res.send(pdf);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
