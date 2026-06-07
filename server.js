// ─────────────────────────────────────────────────────────────────────────────
// server.js — Gigabrain Boca de Urna
// Express REST API + WebSocket para tiempo real
// ─────────────────────────────────────────────────────────────────────────────
const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const crypto    = require('crypto');
const { q, getFullState, getColegioState } = require('./db');

const PORT = process.env.PORT || 4011;
const MONITOR_USER = process.env.MONITOR_USER || 'admin';
const MONITOR_PASSWORD = process.env.MONITOR_PASSWORD || 'plra2026internas';
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(express.json());

function safeCompare(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireMonitorPassword(req, res, next) {
  const auth = req.get('authorization') || '';
  const [scheme, encoded] = auth.split(' ');

  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const splitAt = decoded.indexOf(':');
    const user = splitAt >= 0 ? decoded.slice(0, splitAt) : '';
    const password = splitAt >= 0 ? decoded.slice(splitAt + 1) : '';

    if (safeCompare(user, MONITOR_USER) && safeCompare(password, MONITOR_PASSWORD)) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Monitor Central", charset="UTF-8"');
  res.status(401).send('Contraseña requerida para acceder al Monitor Central.');
}

app.get('/monitor.html', requireMonitorPassword, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'monitor.html'));
});

app.get('/dashboard.html', requireMonitorPassword, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.post('/api/colegios', requireMonitorPassword);
app.delete('/api/colegios/:id', requireMonitorPassword);
app.post('/api/candidatos', requireMonitorPassword);
app.delete('/api/candidatos/:id', requireMonitorPassword);
app.delete('/api/reiniciar-todo', requireMonitorPassword);

app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────────────────────
// WEBSOCKET — difusión en tiempo real
// ─────────────────────────────────────────────────────────────────────────────

/** Envía un mensaje a TODOS los clientes conectados */
function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

wss.on('connection', (ws) => {
  // Al conectar, enviamos el estado completo al cliente nuevo
  try {
    ws.send(JSON.stringify({ type: 'init', data: getFullState() }));
  } catch (e) {
    console.error('Error enviando estado inicial:', e.message);
  }

  ws.on('error', (err) => console.error('WS error:', err.message));
});

// ─────────────────────────────────────────────────────────────────────────────
// API — COLEGIOS
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/colegios', (req, res) => {
  const rows = q.getColegios.all();
  const colegios = {};
  rows.forEach(r => { colegios[r.id] = { nombre: r.nombre }; });
  res.json(colegios);
});

app.post('/api/colegios', (req, res) => {
  const { nombre } = req.body;
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  const id = 'col_' + Date.now();
  q.insertColegio.run(id, nombre.trim());
  broadcast({ type: 'colegios', data: getFullState().colegios });
  res.json({ id, nombre: nombre.trim() });
});

app.delete('/api/colegios/:id', (req, res) => {
  const { id } = req.params;
  q.deleteColegio.run(id);
  q.deleteVotosBUColegio.run(id);
  q.deleteVotosOficialColegio.run(id);
  q.deleteConfigOficialColegio.run(id);
  q.deleteMonitoreoConfigColegio.run(id);
  q.deleteMonitoreoMesasColegio.run(id);
  q.deleteCortesColegio.run(id);
  broadcast({ type: 'full', data: getFullState() });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// API — CANDIDATOS
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/candidatos', (req, res) => {
  const rows = q.getCandidatos.all();
  const candidatos = {};
  rows.forEach(r => { candidatos[r.id] = { partido: r.partido, nombre: r.nombre, cargo: r.cargo }; });
  res.json(candidatos);
});

app.post('/api/candidatos', (req, res) => {
  const { partido, nombre, cargo } = req.body;
  if (!partido || !nombre || !cargo) return res.status(400).json({ error: 'Todos los campos son requeridos' });
  const id = 'cand_' + Date.now();
  q.insertCandidato.run(id, partido.trim(), nombre.trim(), cargo.trim());
  broadcast({ type: 'candidatos', data: getFullState().candidatos });
  res.json({ id, partido, nombre, cargo });
});

app.delete('/api/candidatos/:id', (req, res) => {
  const { id } = req.params;
  q.deleteCandidato.run(id);
  q.deleteVotosBUCandidato.run(id);
  q.deleteVotosOficialCandidato.run(id);
  broadcast({ type: 'full', data: getFullState() });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// API — VOTOS BOCA DE URNA
// ─────────────────────────────────────────────────────────────────────────────

/** Suma o resta votos (atómico en SQLite) */
app.post('/api/votos-bu/:colegioId/:candidatoId', (req, res) => {
  const { colegioId, candidatoId } = req.params;
  const { delta } = req.body; // +1 o -1 o número para carga manual

  if (typeof delta !== 'number') return res.status(400).json({ error: 'delta debe ser número' });

  if (delta > 0) {
    q.upsertVotoBU.run(colegioId, candidatoId, delta);
  } else if (delta < 0) {
    // Restar sin bajar de 0
    const actual = q.getVotosBU.all(colegioId).find(r => r.candidato_id === candidatoId);
    const actVal = actual ? actual.votos : 0;
    const nuevo  = Math.max(0, actVal + delta);
    q.setVotoBU.run(colegioId, candidatoId, nuevo);
  }

  // Broadcast solo el colegio afectado
  broadcast({
    type: 'voto_bu',
    colegioId,
    data: getColegioState(colegioId).bocaUrna
  });

  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// API — VOTOS OFICIALES
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/votos-oficial/:colegioId/:candidatoId/:mesa', (req, res) => {
  const { colegioId, candidatoId, mesa } = req.params;
  const { votos } = req.body;
  const mesaNum = parseInt(mesa);
  const votosNum = Math.max(0, parseInt(votos) || 0);

  q.upsertVotoOficial.run(colegioId, candidatoId, mesaNum, votosNum);

  broadcast({
    type: 'voto_oficial',
    colegioId,
    data: getColegioState(colegioId).conteoDetalle
  });

  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// API — CONFIG OFICIAL (mesas + electores por colegio)
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/config-oficial/:colegioId', (req, res) => {
  const { colegioId } = req.params;
  const { cantMesas, electores } = req.body;
  q.upsertConfigOficial.run(colegioId, parseInt(cantMesas) || 0, parseInt(electores) || 0);
  broadcast({
    type: 'config_oficial',
    colegioId,
    data: getColegioState(colegioId).configOficial
  });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// API — MONITOREO DE PARTICIPACIÓN
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/monitoreo/:colegioId/electores', (req, res) => {
  const { colegioId } = req.params;
  const { electores } = req.body;
  q.upsertMonitoreoConfig.run(colegioId, parseInt(electores) || 0);
  broadcast({
    type: 'monitoreo',
    colegioId,
    data: getColegioState(colegioId).monitoreo
  });
  res.json({ ok: true });
});

app.post('/api/monitoreo/:colegioId/mesas', (req, res) => {
  const { colegioId } = req.params;
  const { nombre, votantes } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre de mesa requerido' });
  q.upsertMonitoreoMesa.run(colegioId, nombre.trim(), parseInt(votantes) || 0);
  broadcast({
    type: 'monitoreo',
    colegioId,
    data: getColegioState(colegioId).monitoreo
  });
  res.json({ ok: true });
});

app.delete('/api/monitoreo/:colegioId/mesas/:nombre', (req, res) => {
  const { colegioId, nombre } = req.params;
  q.deleteMonitoreoMesa.run(colegioId, decodeURIComponent(nombre));
  broadcast({
    type: 'monitoreo',
    colegioId,
    data: getColegioState(colegioId).monitoreo
  });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// API — CORTES E HISTORIAL
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/cortes/:colegioId', (req, res) => {
  const { colegioId } = req.params;
  const { contenido } = req.body;
  if (!contenido) return res.status(400).json({ error: 'Contenido requerido' });
  const fecha_str = new Date().toLocaleString('es-PY', { timeZone: 'America/Asuncion' });
  const info = q.insertCorte.run(colegioId, fecha_str, contenido);
  res.json({ id: info.lastInsertRowid, fecha_str });
});

app.get('/api/cortes/:colegioId', (req, res) => {
  const { colegioId } = req.params;
  const rows = q.getCortesColegio.all(colegioId);
  res.json(rows);
});

// ─────────────────────────────────────────────────────────────────────────────
// API — REINICIO
// ─────────────────────────────────────────────────────────────────────────────

app.delete('/api/reiniciar/:colegioId', (req, res) => {
  const { colegioId } = req.params;
  q.deleteVotosBUColegio.run(colegioId);
  q.deleteVotosOficialColegio.run(colegioId);
  q.deleteConfigOficialColegio.run(colegioId);
  q.deleteMonitoreoConfigColegio.run(colegioId);
  q.deleteMonitoreoMesasColegio.run(colegioId);
  q.deleteCortesColegio.run(colegioId);
  broadcast({ type: 'full', data: getFullState() });
  res.json({ ok: true });
});

app.delete('/api/reiniciar-todo', (req, res) => {
  const { db } = require('./db');
  db.exec(`
    DELETE FROM votos_bu;
    DELETE FROM votos_oficial;
    DELETE FROM config_oficial;
    DELETE FROM monitoreo_config;
    DELETE FROM monitoreo_mesas;
    DELETE FROM cortes;
    DELETE FROM colegios;
    DELETE FROM candidatos;
  `);
  broadcast({ type: 'full', data: getFullState() });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// API — ESTADO COMPLETO (para polling fallback)
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/estado', (req, res) => {
  res.json(getFullState());
});

// ─────────────────────────────────────────────────────────────────────────────
// INICIO
// ─────────────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════╗`);
  console.log(`║  🗳️  Gigabrain Boca de Urna        ║`);
  console.log(`║  Servidor corriendo en :${PORT}       ║`);
  console.log(`╠════════════════════════════════════╣`);
  console.log(`║  Boca de Urna:    /boca_urna.html  ║`);
  console.log(`║  Monitor Central: /monitor.html    ║`);
  console.log(`╚════════════════════════════════════╝\n`);
});
