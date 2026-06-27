import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import api from './routes/api';
import { scrapeVessels } from './services/scraper';
import dotenv from 'dotenv';
import { readFile } from 'fs/promises';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './db';

dotenv.config();

const app = new Hono();

app.use('/*', cors());

app.route('/api', api);

// Serve static files from client/dist
app.use('/*', serveStatic({ root: '../client/dist' }));

// Fallback for SPA
app.get('*', async (c) => {
    try {
        const html = await readFile('../client/dist/index.html', 'utf-8');
        return c.html(html);
    } catch (e) {
        return c.text('Client not built', 404);
    }
});

const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// Run database migrations on startup
(async () => {
    try {
        console.log('Running database migrations...');
        await migrate(db, { migrationsFolder: './drizzle' });
        console.log('Migrations applied successfully.');
    } catch (error) {
        console.error('Failed to run database migrations:', error);
    }
})();

console.log(`Server is running on port ${port}`);

serve({
    fetch: app.fetch,
    port
});

// Scraper Cron (every 10 minutes)
const INTERVAL = 60 * 1000 * 10;
console.log('Starting scraper service...');
scrapeVessels(); // Run immediately on start
setInterval(() => {
    scrapeVessels();
}, INTERVAL);
