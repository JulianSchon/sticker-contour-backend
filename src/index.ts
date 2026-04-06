import express from 'express';
import cors from 'cors';
import generateRouter from './routes/generate';
import printPlanningRouter from './routes/printPlanning';

const app = express();
const PORT = process.env.PORT ?? 3001;

// Allow localhost in dev, plus any origins listed in FRONTEND_URL (comma-separated).
// Vercel preview deployments get auto-allowed via the *.vercel.app wildcard.
const extraOrigins = (process.env.FRONTEND_URL ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const allowedOrigins = [
  'http://localhost:5173',
  ...extraOrigins,
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server requests (no origin) and exact matches
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    // Allow any *.vercel.app preview URL
    if (/^https:\/\/[^.]+\.vercel\.app$/.test(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
}));
app.use(express.json());

app.use('/api', generateRouter);
app.use('/api', printPlanningRouter);

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: err.message ?? 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
