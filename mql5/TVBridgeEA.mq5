//+------------------------------------------------------------------+
//|                                                  TVBridgeEA.mq5   |
//|  Pont TradingView -> MT5 : lit le signal publie par le pont Node  |
//|  (indicateur verrouille lu via CDP) et prend les positions.       |
//|                                                                    |
//|  Le pont Node ecrit tv_signal.json. L'EA le lit sur timer et      |
//|  execute quand un NOUVEL id de signal apparait (idempotent).      |
//+------------------------------------------------------------------+
#property copyright "TV->MT5 bridge"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>

//--- Entrees -------------------------------------------------------
input string InpFileName      = "tv_signal.json"; // nom du fichier signal (dossier Common\Files)
input bool   InpUseHttp       = false;            // true = lire via WebRequest au lieu du fichier
input string InpHttpUrl       = "http://127.0.0.1:8787/signal"; // URL du pont (si InpUseHttp)
input int    InpTimerSeconds  = 1;                // frequence de lecture (secondes)
input double InpDefaultLot    = 0.10;             // lot si le signal n'en precise pas
input int    InpSlPoints      = 0;                // stop loss en points (0 = off, ecrase par le signal si >0)
input int    InpTpPoints      = 0;                // take profit en points (0 = off)
input int    InpSlippage      = 20;               // deviation max en points
input long   InpMagic         = 88112277;         // magic number
input bool   InpCloseOpposite = true;             // fermer la position inverse avant d'ouvrir
input bool   InpAllowTrading  = true;             // false = mode simulation (log sans ordre reel)

//--- Global --------------------------------------------------------
CTrade   trade;
long     g_lastId = -1;   // dernier id de signal traite

//+------------------------------------------------------------------+
int OnInit()
  {
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippage);
   trade.SetTypeFillingBySymbol(_Symbol);
   EventSetTimer(MathMax(1, InpTimerSeconds));
   PrintFormat("TVBridgeEA demarre. Source=%s  Magic=%d  Trading=%s",
               InpUseHttp ? "HTTP" : "FICHIER:"+InpFileName,
               InpMagic, InpAllowTrading ? "ON" : "SIMULATION");
   if(InpUseHttp)
      Print("Rappel: ajouter ", InpHttpUrl, " dans Outils > Options > Expert Advisors > URL autorisees.");
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason) { EventKillTimer(); }

//+------------------------------------------------------------------+
//| Timer : lit le signal et agit                                    |
//+------------------------------------------------------------------+
void OnTimer()
  {
   string json = ReadSignal();
   if(json == "") return;

   long   id     = (long)JsonNumber(json, "id");
   string action = JsonString(json, "action");
   string symbol = JsonString(json, "symbol");
   double lot    = JsonNumber(json, "lot");
   int    slPts  = (int)JsonNumber(json, "sl_points");
   int    tpPts  = (int)JsonNumber(json, "tp_points");

   if(id <= 0 || action == "") return;
   if(id == g_lastId) return;        // deja traite
   g_lastId = id;

   if(symbol == "") symbol = _Symbol;
   if(lot <= 0)     lot    = InpDefaultLot;
   if(slPts <= 0)   slPts  = InpSlPoints;
   if(tpPts <= 0)   tpPts  = InpTpPoints;

   PrintFormat("Signal #%d recu : action=%s symbol=%s lot=%.2f sl=%d tp=%d",
               id, action, symbol, lot, slPts, tpPts);

   Execute(action, symbol, lot, slPts, tpPts);
  }

//+------------------------------------------------------------------+
//| Execution de l'ordre                                             |
//+------------------------------------------------------------------+
void Execute(string action, string symbol, double lot, int slPts, int tpPts)
  {
   if(!InpAllowTrading)
     {
      PrintFormat("[SIMULATION] %s %s %.2f (aucun ordre reel envoye)", action, symbol, lot);
      return;
     }

   if(!SymbolSelect(symbol, true))
     {
      PrintFormat("ERREUR: symbole %s introuvable chez le broker.", symbol);
      return;
     }

   if(action == "CLOSE")
     {
      CloseSymbol(symbol);
      return;
     }

   bool isBuy = (action == "BUY");
   if(!isBuy && action != "SELL")
     {
      PrintFormat("Action inconnue: %s", action);
      return;
     }

   if(InpCloseOpposite)
      ClosePositionsByType(symbol, isBuy ? POSITION_TYPE_SELL : POSITION_TYPE_BUY);

   // Deja dans le bon sens ? ne pas empiler.
   if(HasPosition(symbol, isBuy ? POSITION_TYPE_BUY : POSITION_TYPE_SELL))
     {
      PrintFormat("Position %s deja ouverte sur %s, on ignore.", action, symbol);
      return;
     }

   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   double ask   = SymbolInfoDouble(symbol, SYMBOL_ASK);
   double bid   = SymbolInfoDouble(symbol, SYMBOL_BID);
   double price = isBuy ? ask : bid;
   double sl = 0, tp = 0;

   if(slPts > 0) sl = isBuy ? price - slPts * point : price + slPts * point;
   if(tpPts > 0) tp = isBuy ? price + tpPts * point : price - tpPts * point;

   lot = NormalizeLot(symbol, lot);

   bool ok = isBuy ? trade.Buy(lot, symbol, 0.0, sl, tp, "TVBridge")
                   : trade.Sell(lot, symbol, 0.0, sl, tp, "TVBridge");
   if(ok)
      PrintFormat("OK %s %.2f %s @~%.5f (ret=%d)", action, lot, symbol, price, trade.ResultRetcode());
   else
      PrintFormat("ECHEC %s %s : ret=%d %s", action, symbol, trade.ResultRetcode(), trade.ResultRetcodeDescription());
  }

//+------------------------------------------------------------------+
//| Aides positions                                                  |
//+------------------------------------------------------------------+
bool HasPosition(string symbol, ENUM_POSITION_TYPE type)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE) == type) return true;
     }
   return false;
  }

void ClosePositionsByType(string symbol, ENUM_POSITION_TYPE type)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE) == type)
        {
         if(trade.PositionClose(ticket))
            PrintFormat("Ferme position inverse #%d sur %s", ticket, symbol);
        }
     }
  }

void CloseSymbol(string symbol)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if(trade.PositionClose(ticket))
         PrintFormat("Ferme #%d sur %s (CLOSE)", ticket, symbol);
     }
  }

double NormalizeLot(string symbol, double lot)
  {
   double minLot  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double step    = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   if(step > 0) lot = MathRound(lot / step) * step;
   if(lot < minLot) lot = minLot;
   if(lot > maxLot) lot = maxLot;
   return lot;
  }

//+------------------------------------------------------------------+
//| Lecture du signal (fichier ou HTTP)                              |
//+------------------------------------------------------------------+
string ReadSignal()
  {
   if(InpUseHttp) return ReadHttp();
   return ReadFile();
  }

string ReadFile()
  {
   // Le pont Node ecrit dans le dossier COMMUN : ...\MetaQuotes\Terminal\Common\Files
   int h = FileOpen(InpFileName, FILE_READ | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(h == INVALID_HANDLE) return "";
   string content = "";
   while(!FileIsEnding(h))
      content += FileReadString(h);
   FileClose(h);
   return content;
  }

string ReadHttp()
  {
   char   post[], result[];
   string headers;
   string resultHeaders;
   ResetLastError();
   int code = WebRequest("GET", InpHttpUrl, "", 5000, post, result, resultHeaders);
   if(code == -1)
     {
      static bool warned = false;
      if(!warned) { PrintFormat("WebRequest a echoue (err=%d). URL autorisee ?", GetLastError()); warned = true; }
      return "";
     }
   return CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
  }

//+------------------------------------------------------------------+
//| Mini-parseur JSON (objet plat uniquement)                        |
//+------------------------------------------------------------------+
string JsonRawValue(string json, string key)
  {
   string pat = "\"" + key + "\"";
   int k = StringFind(json, pat);
   if(k < 0) return "";
   int colon = StringFind(json, ":", k + StringLen(pat));
   if(colon < 0) return "";
   int i = colon + 1;
   int n = StringLen(json);
   // sauter espaces
   while(i < n)
     {
      ushort c = StringGetCharacter(json, i);
      if(c != ' ' && c != '\t' && c != '\n' && c != '\r') break;
      i++;
     }
   if(i >= n) return "";
   ushort first = StringGetCharacter(json, i);
   if(first == '"')
     {
      int end = StringFind(json, "\"", i + 1);
      if(end < 0) return "";
      return StringSubstr(json, i + 1, end - i - 1);
     }
   // nombre / bool : jusqu'a , } ou fin
   int start = i;
   while(i < n)
     {
      ushort c = StringGetCharacter(json, i);
      if(c == ',' || c == '}' || c == ' ' || c == '\n' || c == '\r' || c == '\t') break;
      i++;
     }
   return StringSubstr(json, start, i - start);
  }

string JsonString(string json, string key) { return JsonRawValue(json, key); }
double JsonNumber(string json, string key)
  {
   string v = JsonRawValue(json, key);
   if(v == "") return 0.0;
   return StringToDouble(v);
  }
//+------------------------------------------------------------------+
