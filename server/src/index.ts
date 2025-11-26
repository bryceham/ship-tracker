import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import api from './routes/api';
import { scrapeVessels, setWebSocketNotifier } from './services/scraper';
import dotenv from 'dotenv';
import { readFile } from 'fs/promises';
import { WebSocketServer, WebSocket } from 'ws';

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
console.log(`Server is running on port ${port}`);

const server = serve({
    fetch: app.fetch,
    port
});

// WebSocket Server Setup
const wss = new WebSocketServer({ server });

const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    clients.add(ws);

    ws.on('close', () => {
        console.log('WebSocket client disconnected');
        clients.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients.delete(ws);
    });
});

// Broadcast to all connected clients
function broadcast(message: any) {
    const data = JSON.stringify(message);
    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// Scraper Cron (every 5 minutes)
const INTERVAL = 5 * 60 * 1000;
let nextScrapeTime = Date.now() + INTERVAL;

// Countdown broadcast (every second)
setInterval(() => {
    const remaining = Math.max(0, Math.floor((nextScrapeTime - Date.now()) / 1000));
    broadcast({
        type: 'countdown',
        seconds: remaining
    });
}, 1000);

// Set up WebSocket notifier for scraper
setWebSocketNotifier((hasChanges: boolean) => {
    if (hasChanges) {
        console.log('Broadcasting changes detected');
        broadcast({
            type: 'changes',
            hasChanges: true
        });
    }
});

console.log('Starting scraper service...');
scrapeVessels(); // Run immediately on start
nextScrapeTime = Date.now() + INTERVAL;

setInterval(() => {
    scrapeVessels();
    nextScrapeTime = Date.now() + INTERVAL;
}, INTERVAL);
