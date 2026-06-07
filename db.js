// db.js — SQLite nativo de Node.js 22+ (node:sqlite)
'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'boca_urna.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`PRAGMA journal_mode = WAL`);
db.exec(`PRAGMA foreign_keys = ON`);

db.exec(`
  CREATE TABLE IF NOT EXISTS colegios (
    id        TEXT PRIMARY KEY,
    nombre    TEXT NOT NULL,
    creado_en INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS candidatos (
    id        TEXT PRIMARY KEY,
    partido   TEXT NOT NULL,
    nombre    TEXT NOT NULL,
    cargo     TEXT NOT NULL,
    creado_en INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS votos_bu (
    colegio_id   TEXT NOT NULL,
    candidato_id TEXT NOT NULL,
    votos        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (colegio_id, candidato_id)
  );
  CREATE TABLE IF NOT EXISTS votos_oficial (
    colegio_id   TEXT NOT NULL,
    candidato_id TEXT NOT NULL,
    mesa         INTEGER NOT NULL,
    votos        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (colegio_id, candidato_id, mesa)
  );
  CREATE TABLE IF NOT EXISTS config_oficial (
    colegio_id TEXT PRIMARY KEY,
    cant_mesas INTEGER NOT NULL DEFAULT 0,
    electores  INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS monitoreo_config (
    colegio_id TEXT PRIMARY KEY,
    electores  INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS monitoreo_mesas (
    colegio_id  TEXT NOT NULL,
    nombre_mesa TEXT NOT NULL,
    votantes    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (colegio_id, nombre_mesa)
  );
  CREATE TABLE IF NOT EXISTS cortes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    colegio_id TEXT,
    fecha_ts   INTEGER DEFAULT (strftime('%s','now')),
    fecha_str  TEXT,
    contenido  TEXT NOT NULL
  );
`);

// Prepared statements
const q = {
  getColegios:     db.prepare('SELECT * FROM colegios ORDER BY creado_en'),
  insertColegio:   db.prepare('INSERT OR IGNORE INTO colegios (id, nombre) VALUES (?, ?)'),
  deleteColegio:   db.prepare('DELETE FROM colegios WHERE id = ?'),

  getCandidatos:   db.prepare('SELECT * FROM candidatos ORDER BY cargo, creado_en'),
  insertCandidato: db.prepare('INSERT OR IGNORE INTO candidatos (id, partido, nombre, cargo) VALUES (?, ?, ?, ?)'),
  deleteCandidato: db.prepare('DELETE FROM candidatos WHERE id = ?'),

  getAllVotosBU:    db.prepare('SELECT * FROM votos_bu'),
  getVotosBU:      db.prepare('SELECT * FROM votos_bu WHERE colegio_id = ?'),
  upsertVotoBU:    db.prepare(`INSERT INTO votos_bu (colegio_id, candidato_id, votos) VALUES (?, ?, ?)
    ON CONFLICT(colegio_id, candidato_id) DO UPDATE SET votos = votos + excluded.votos`),
  setVotoBU:       db.prepare(`INSERT INTO votos_bu (colegio_id, candidato_id, votos) VALUES (?, ?, ?)
    ON CONFLICT(colegio_id, candidato_id) DO UPDATE SET votos = MAX(0, excluded.votos)`),
  deleteVotosBUColegio:   db.prepare('DELETE FROM votos_bu WHERE colegio_id = ?'),
  deleteVotosBUCandidato: db.prepare('DELETE FROM votos_bu WHERE candidato_id = ?'),

  getAllVotosOficial:     db.prepare('SELECT * FROM votos_oficial'),
  getVotosOficialCol:    db.prepare('SELECT * FROM votos_oficial WHERE colegio_id = ?'),
  upsertVotoOficial:     db.prepare(`INSERT INTO votos_oficial (colegio_id, candidato_id, mesa, votos) VALUES (?, ?, ?, ?)
    ON CONFLICT(colegio_id, candidato_id, mesa) DO UPDATE SET votos = MAX(0, excluded.votos)`),
  deleteVotosOficialColegio:   db.prepare('DELETE FROM votos_oficial WHERE colegio_id = ?'),
  deleteVotosOficialCandidato: db.prepare('DELETE FROM votos_oficial WHERE candidato_id = ?'),

  getAllConfigOficial:    db.prepare('SELECT * FROM config_oficial'),
  getConfigOficial:      db.prepare('SELECT * FROM config_oficial WHERE colegio_id = ?'),
  upsertConfigOficial:   db.prepare(`INSERT INTO config_oficial (colegio_id, cant_mesas, electores) VALUES (?, ?, ?)
    ON CONFLICT(colegio_id) DO UPDATE SET cant_mesas = excluded.cant_mesas, electores = excluded.electores`),
  deleteConfigOficialColegio: db.prepare('DELETE FROM config_oficial WHERE colegio_id = ?'),

  getAllMonitoreoConfig:  db.prepare('SELECT * FROM monitoreo_config'),
  getMonitoreoConfig:    db.prepare('SELECT * FROM monitoreo_config WHERE colegio_id = ?'),
  upsertMonitoreoConfig: db.prepare(`INSERT INTO monitoreo_config (colegio_id, electores) VALUES (?, ?)
    ON CONFLICT(colegio_id) DO UPDATE SET electores = excluded.electores`),
  deleteMonitoreoConfigColegio: db.prepare('DELETE FROM monitoreo_config WHERE colegio_id = ?'),

  getAllMonitoreoMesas:      db.prepare('SELECT * FROM monitoreo_mesas'),
  getMonitoreoMesasColegio:  db.prepare('SELECT * FROM monitoreo_mesas WHERE colegio_id = ?'),
  upsertMonitoreoMesa:       db.prepare(`INSERT INTO monitoreo_mesas (colegio_id, nombre_mesa, votantes) VALUES (?, ?, ?)
    ON CONFLICT(colegio_id, nombre_mesa) DO UPDATE SET votantes = excluded.votantes`),
  deleteMonitoreoMesa:          db.prepare('DELETE FROM monitoreo_mesas WHERE colegio_id = ? AND nombre_mesa = ?'),
  deleteMonitoreoMesasColegio:  db.prepare('DELETE FROM monitoreo_mesas WHERE colegio_id = ?'),

  insertCorte:      db.prepare('INSERT INTO cortes (colegio_id, fecha_str, contenido) VALUES (?, ?, ?)'),
  getCortesColegio: db.prepare('SELECT * FROM cortes WHERE colegio_id = ? ORDER BY fecha_ts DESC'),
  deleteCortesColegio: db.prepare('DELETE FROM cortes WHERE colegio_id = ?'),
};

function getFullState() {
  const bocaUrna = {};
  for (const r of q.getAllVotosBU.all()) {
    if (!bocaUrna[r.colegio_id]) bocaUrna[r.colegio_id] = {};
    bocaUrna[r.colegio_id][r.candidato_id] = r.votos;
  }
  const conteoDetalle = {};
  for (const r of q.getAllVotosOficial.all()) {
    if (!conteoDetalle[r.colegio_id]) conteoDetalle[r.colegio_id] = {};
    if (!conteoDetalle[r.colegio_id][r.candidato_id]) conteoDetalle[r.colegio_id][r.candidato_id] = {};
    conteoDetalle[r.colegio_id][r.candidato_id][r.mesa] = r.votos;
  }
  const configOficial = {};
  for (const r of q.getAllConfigOficial.all()) {
    configOficial[r.colegio_id] = { cantMesas: r.cant_mesas, electores: r.electores };
  }
  const monitoreo = {};
  for (const r of q.getAllMonitoreoConfig.all()) {
    if (!monitoreo[r.colegio_id]) monitoreo[r.colegio_id] = { electores: 0, mesas: {} };
    monitoreo[r.colegio_id].electores = r.electores;
  }
  for (const r of q.getAllMonitoreoMesas.all()) {
    if (!monitoreo[r.colegio_id]) monitoreo[r.colegio_id] = { electores: 0, mesas: {} };
    monitoreo[r.colegio_id].mesas[r.nombre_mesa] = { votantes: r.votantes };
  }
  const colegios = {};
  for (const r of q.getColegios.all()) colegios[r.id] = { nombre: r.nombre };
  const candidatos = {};
  for (const r of q.getCandidatos.all()) candidatos[r.id] = { partido: r.partido, nombre: r.nombre, cargo: r.cargo };
  return { colegios, candidatos, bocaUrna, conteoDetalle, configOficial, monitoreo };
}

function getColegioState(colId) {
  const bocaUrna = {};
  for (const r of q.getVotosBU.all(colId)) bocaUrna[r.candidato_id] = r.votos;
  const conteoDetalle = {};
  for (const r of q.getVotosOficialCol.all(colId)) {
    if (!conteoDetalle[r.candidato_id]) conteoDetalle[r.candidato_id] = {};
    conteoDetalle[r.candidato_id][r.mesa] = r.votos;
  }
  const cfgRow = q.getConfigOficial.get(colId);
  const configOficial = cfgRow ? { cantMesas: cfgRow.cant_mesas, electores: cfgRow.electores } : { cantMesas: 0, electores: 0 };
  const mcRow = q.getMonitoreoConfig.get(colId);
  const monitoreo = { electores: mcRow ? mcRow.electores : 0, mesas: {} };
  for (const r of q.getMonitoreoMesasColegio.all(colId)) monitoreo.mesas[r.nombre_mesa] = { votantes: r.votantes };
  return { bocaUrna, conteoDetalle, configOficial, monitoreo };
}

module.exports = { db, q, getFullState, getColegioState };
