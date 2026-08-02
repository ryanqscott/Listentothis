import express from 'express';
import path from 'path';
import { AudioRouter, StartOptions } from './audioRouter';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;
const router = new AudioRouter();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/ffmpeg-check', async (_req, res) => {
  const available = await router.checkFfmpeg();
  res.json({ available });
});

app.get('/api/input-devices', async (_req, res) => {
  try {
    const devices = await router.listInputDevices();
    res.json(devices);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/output-devices', (_req, res) => {
  try {
    res.json({ devices: router.listOutputDevices() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/status', (_req, res) => {
  res.json(router.getStatus());
});

app.post('/api/start', (req, res) => {
  const body = (req.body ?? {}) as Partial<StartOptions>;
  try {
    router.start({
      systemSource: body.systemSource ?? '',
      micSource: body.micSource,
      destination: Number(body.destination),
      systemVolume: body.systemVolume,
      micVolume: body.micVolume,
      includeMic: body.includeMic,
    });
    res.json(router.getStatus());
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/stop', (_req, res) => {
  router.stop();
  res.json(router.getStatus());
});

app.listen(PORT, () => {
  console.log(`Audio passthrough control panel running at http://localhost:${PORT}`);
});
