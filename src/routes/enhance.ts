import express from 'express';
import multer from 'multer';
import Replicate from 'replicate';
import sharp from 'sharp';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const replicate = new Replicate({ auth: process.env.REPLICATE_API_KEY });

router.post('/enhance', upload.single('image'), async (req, res) => {
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
    const base64 = pngBuffer.toString('base64');
    const dataUrl = `data:image/png;base64,${base64}`;

    // Run Real-ESRGAN 4x upscale (no pinned version — uses latest deployment)
    const output = await replicate.run(
      'nightmareai/real-esrgan' as `${string}/${string}`,
      {
        input: {
          image:  dataUrl,
          scale:  4,
          face_enhance: false,
        },
      }
    ) as unknown as string;

    // Fetch the result image from Replicate's CDN
    const response = await fetch(output);
    if (!response.ok) throw new Error('Failed to fetch enhanced image from Replicate');

    const arrayBuffer = await response.arrayBuffer();
    const resultBuffer = Buffer.from(arrayBuffer);

    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', 'attachment; filename="enhanced.png"');
    res.send(resultBuffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Enhancement failed';
    res.status(500).json({ error: message });
  }
});

export default router;
