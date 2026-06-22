import express from 'express';
import multer from 'multer';
import Replicate from 'replicate';
import sharp from 'sharp';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const replicate = new Replicate({ auth: process.env.REPLICATE_API_KEY });

const BG_MODEL = { owner: '851-labs', name: 'background-remover' } as const;

// Community models have no "official" predictions endpoint, so calling
// `owner/name` without a version 404s. Resolve the latest version once and
// reuse it (cached for the process lifetime).
let cachedVersion: string | null = null;
async function resolveBgModel(): Promise<`${string}/${string}:${string}` | `${string}/${string}`> {
  if (!cachedVersion) {
    const model = await replicate.models.get(BG_MODEL.owner, BG_MODEL.name);
    cachedVersion = model.latest_version?.id ?? null;
  }
  return cachedVersion
    ? `${BG_MODEL.owner}/${BG_MODEL.name}:${cachedVersion}`
    : `${BG_MODEL.owner}/${BG_MODEL.name}`;
}

/** Coerce a replicate.run() result (string URL | array | FileOutput) into bytes. */
async function resultToBuffer(output: unknown): Promise<Buffer> {
  let result: unknown = Array.isArray(output) ? output[0] : output;

  // replicate >= 1.x returns a FileOutput (has .blob()).
  if (result && typeof (result as { blob?: unknown }).blob === 'function') {
    const blob = await (result as { blob: () => Promise<Blob> }).blob();
    return Buffer.from(await blob.arrayBuffer());
  }

  // Otherwise it's a URL (string, or an object with .url()).
  const maybeUrl = result as { url?: () => unknown };
  const url = typeof maybeUrl?.url === 'function' ? String(maybeUrl.url()) : String(result);
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch result image from Replicate');
  return Buffer.from(await response.arrayBuffer());
}

router.post('/remove-bg', upload.single('image'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No image provided' });
    return;
  }

  if (!process.env.REPLICATE_API_KEY) {
    res.status(500).json({ error: 'REPLICATE_API_KEY not configured' });
    return;
  }

  try {
    // Convert to PNG base64 data URL for Replicate
    const pngBuffer = await sharp(req.file.buffer).png().toBuffer();
    const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;

    // Background removal — returns a transparent PNG. Pin the latest version
    // (community models 404 on the unversioned/official endpoint).
    const model = await resolveBgModel();
    const output = await replicate.run(model, { input: { image: dataUrl } });

    const resultBuffer = await resultToBuffer(output);

    // Ensure it's a clean PNG with alpha.
    const png = await sharp(resultBuffer).ensureAlpha().png().toBuffer();

    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', 'attachment; filename="no-bg.png"');
    res.send(png);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Background removal failed';
    res.status(500).json({ error: message });
  }
});

export default router;
