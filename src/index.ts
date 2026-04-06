import express from 'express';
import cors from 'cors';
import generateRouter from './routes/generate';
import printPlanningRouter from './routes/printPlanning';

const app = express();
const PORT = process.env.PORT ?? 3001;

const allowedOrigin = process.env.FRONTEND_URL ?? 'http://localhost:5173';
app.use(cors({ origin: allowedOrigin }));
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
