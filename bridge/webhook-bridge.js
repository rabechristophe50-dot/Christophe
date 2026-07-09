#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════
//  webhook-bridge.js — reçoit les alertes JSON de l'indicateur TradingView
//  (ifvg_indicator.pine) et les dépose dans un fichier que MT5/cTrader lit.
//
//  Flux : TradingView (alerte "Any alert() function call")
//         → webhook POST → ce bridge → fichier d'ordres → EA/cBot exécute.
//
//  Usage :
//    node bridge/webhook-bridge.js
//  Puis dans l'alerte TradingView, mets l'URL webhook :
//    http://TON_IP:8080/webhook?token=changeme
//
//  ⚠️ TradingView doit pouvoir joindre ta machine (IP publique/port ouvert,
//     ou tunnel type ngrok/cloudflared). Pour du 100% local, préfère les
//     versions natives MT5 (mt5/IFVG_EA.mq5) ou cTrader (ctrader/IFVGBot.cs).
// ════════════════════════════════════════════════════════════════════════
import http from "http";
import { appendFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const CFG = {
  port: Number(process.env.BRIDGE_PORT || 8080),
  token: process.env.BRIDGE_TOKEN || "changeme", // protège l'endpoint
  // Fichier d'ordres lu par l'EA MT5 / le cBot cTrader.
  // MT5 : place-le dans le dossier "Files" du terminal (Fichiers → Ouvrir le dossier de données → MQL5/Files).
  dropFile: process.env.BRIDGE_DROPFILE || join(dirname(fileURLToPath(import.meta.url)), "ifvg_order.txt"),
  journal: join(dirname(fileURLToPath(import.meta.url)), "signals.jsonl"),
};

function handle(order) {
  // Normalise en une ligne CSV simple pour l'EA :
  // side,symbol,entry,sl,tp,riskUsd,timeframe
  const line = [order.side, order.symbol, order.entry, order.sl, order.tp, order.riskUsd ?? "", order.timeframe ?? ""].join(",");
  writeFileSync(CFG.dropFile, line + "\n");                 // dernier ordre (écrasé)
  appendFileSync(CFG.journal, JSON.stringify({ ...order, received: new Date().toISOString() }) + "\n");
  console.log(`[${new Date().toISOString()}] ordre reçu → ${line}`);
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST") { res.writeHead(405); return res.end("POST only"); }
  const url = new URL(req.url, `http://localhost`);
  if (url.searchParams.get("token") !== CFG.token) { res.writeHead(401); return res.end("bad token"); }

  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on("end", () => {
    let order;
    try { order = JSON.parse(body); }
    catch { res.writeHead(400); return res.end("bad json"); }
    if (!order.side || !order.symbol) { res.writeHead(422); return res.end("champs manquants"); }
    try { handle(order); res.writeHead(200); res.end("ok"); }
    catch (e) { console.error("erreur:", e.message); res.writeHead(500); res.end("erreur"); }
  });
});

server.listen(CFG.port, () => {
  console.log(`IFVG webhook-bridge sur :${CFG.port}  (token: ${CFG.token})`);
  console.log(`Ordres écrits dans : ${CFG.dropFile}`);
  console.log(`Journal : ${CFG.journal}`);
});
