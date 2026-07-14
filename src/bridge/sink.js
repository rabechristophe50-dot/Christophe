/**
 * Diffusion du signal vers MT5.
 *  - fichier : ecriture atomique de tv_signal.json (l'EA le lit sur timer)
 *  - http    : GET /signal renvoie le dernier signal en JSON (WebRequest)
 */
import { writeFileSync, renameSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { createServer } from 'http';

/** Ecriture atomique d'un fichier texte (temp + rename). */
export function writeTextAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export class SignalSink {
  constructor(cfg) {
    this.cfg = cfg.sink;
    this.latest = { id: 0, action: 'FLAT', ts: 0 };
    this.server = null;
  }

  start() {
    if (this.cfg.http) {
      this.server = createServer((req, res) => {
        if (req.url.startsWith('/signal')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(this.latest));
        } else if (req.url.startsWith('/health')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, latest_id: this.latest.id }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      this.server.listen(this.cfg.http_port, () => {
        console.log(`[bridge] HTTP en ecoute sur http://127.0.0.1:${this.cfg.http_port}/signal`);
      });
    }
    if (this.cfg.file) {
      mkdirSync(dirname(this.cfg.file_path), { recursive: true });
      this._writeFile(); // etat initial FLAT
    }
  }

  /** Publie un nouveau signal (incremente l'id -> l'EA sait qu'il est neuf). */
  publish({ action, symbol, lot, sl_points, tp_points, sl_price, tp_price, sl_dist, tp_dist, reason }) {
    this.latest = {
      id: this.latest.id + 1,
      action,
      symbol,
      lot,
      sl_points,
      tp_points,
      sl_price: sl_price || 0,
      tp_price: tp_price || 0,
      sl_dist: sl_dist || 0,
      tp_dist: tp_dist || 0,
      reason: reason || '',
      ts: Date.now(),
    };
    if (this.cfg.file) this._writeFile();
    return this.latest;
  }

  _writeFile() {
    const tmp = this.cfg.file_path + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.latest));
    renameSync(tmp, this.cfg.file_path); // rename = atomique, l'EA ne lit jamais un fichier a moitie ecrit
  }

  stop() {
    if (this.server) this.server.close();
  }
}
