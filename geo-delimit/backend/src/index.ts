import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Pool } from 'pg';
import areasRouter from './routes/areas';
import geocodeRouter from './routes/geocode';
import exportRouter from './routes/export';

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Trust Proxy (necessário no Railway/Render/Heroku) ────────────────────────
// O Railway coloca a aplicação detrás de um proxy reverso que adiciona o header
// X-Forwarded-For. Sem isso, express-rate-limit lança erro ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);

// ─── Database Pool ────────────────────────────────────────────────────────────
export const db = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'geodelimit',
  user: process.env.DB_USER || 'geodelimit',
  password: process.env.DB_PASSWORD || 'secret',
});

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '10mb' })); // GeoJSON pode ser grande

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// ─── Rotas ────────────────────────────────────────────────────────────────────
app.use('/api/areas', areasRouter);
app.use('/api/geocode', geocodeRouter);
app.use('/api/export', exportRouter);

app.get('/api/health', (_, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Erro interno do servidor' });
});

app.listen(PORT, () => console.log(`🚀 Backend rodando na porta ${PORT}`));
