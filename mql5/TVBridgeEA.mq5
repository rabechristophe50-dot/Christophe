//+------------------------------------------------------------------+
//|                                                  TVBridgeEA.mq5   |
//|  Pont TradingView -> MT5, version SIMPLE.                          |
//|                                                                    |
//|  A chaque NOUVEAU signal ecrit par le pont, ouvre une position au  |
//|  marche avec l'entree/SL/TP copies-colles de l'indicateur RUGA.    |
//|  Plusieurs positions peuvent coexister (compte hedging).           |
//+------------------------------------------------------------------+
#property copyright "TV->MT5 bridge (simple)"
#property version   "2.00"
#property strict

#include <Trade/Trade.mqh>

//--- Reglages (simples) --------------------------------------------
input string InpFileName     = "tv_signal.json"; // fichier signal (dossier Common\Files)
input double InpLot          = 0.01;             // lot par position (si le signal n'en donne pas)
input long   InpMagic        = 88112277;         // magic number
input int    InpSlippage     = 20;               // deviation max en points
input bool   InpShowDrawings = true;             // afficher les lignes/labels de RUGA sur MT5
input string InpDrawFile     = "tv_draw.txt";    // fichier des dessins (dossier Common\Files)

//--- Global --------------------------------------------------------
CTrade   trade;
long     g_lastId  = -1;   // dernier id de signal traite
int      g_drawTick = 0;
#define DRAW_PREFIX "TVD_"

//+------------------------------------------------------------------+
int OnInit()
  {
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippage);
   trade.SetTypeFillingBySymbol(_Symbol);
   EventSetTimer(1);

   // Baseline : ne pas retrader le signal deja present au demarrage.
   string j0 = ReadCommonFile(InpFileName);
   if(j0 != "")
     {
      long cur = (long)JsonNumber(j0, "id");
      if(cur > 0) { g_lastId = cur; PrintFormat("Baseline: signal id=%d deja present, ignore.", cur); }
     }

   PrintFormat("TVBridgeEA (simple) demarre. Fichier=%s Magic=%d [REEL]", InpFileName, InpMagic);
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   ObjectsDeleteAll(0, DRAW_PREFIX);
  }

//+------------------------------------------------------------------+
//| Timer : lit le signal et agit                                    |
//+------------------------------------------------------------------+
void OnTimer()
  {
   if(InpShowDrawings && (++g_drawTick % 5 == 0))
      RenderDrawings();

   string json = ReadCommonFile(InpFileName);
   if(json == "") return;

   long   id      = (long)JsonNumber(json, "id");
   string action  = JsonString(json, "action");
   string symbol  = JsonString(json, "symbol");
   double lot     = JsonNumber(json, "lot");
   double slPrice = JsonNumber(json, "sl_price");
   double tpPrice = JsonNumber(json, "tp_price");

   if(id <= 0 || action == "") return;
   if(id == g_lastId) return;      // deja traite
   g_lastId = id;

   if(symbol == "") symbol = _Symbol;
   if(lot   <= 0)   lot    = InpLot;

   PrintFormat("Signal #%d : %s %s lot=%.2f SL=%.3f TP=%.3f", id, action, symbol, lot, slPrice, tpPrice);
   Execute(action, symbol, lot, slPrice, tpPrice);
  }

//+------------------------------------------------------------------+
//| Ouvre la position (copie-colle SL/TP)                            |
//+------------------------------------------------------------------+
void Execute(string action, string symbol, double lot, double slPrice, double tpPrice)
  {
   if(!SymbolSelect(symbol, true))
     { PrintFormat("ERREUR: symbole %s introuvable.", symbol); return; }

   if(action == "CLOSE") { CloseSymbol(symbol); return; }

   bool isBuy = (action == "BUY");
   if(!isBuy && action != "SELL") { PrintFormat("Action inconnue: %s", action); return; }

   int    digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double price  = isBuy ? SymbolInfoDouble(symbol, SYMBOL_ASK) : SymbolInfoDouble(symbol, SYMBOL_BID);
   double sl = (slPrice > 0) ? NormalizeDouble(slPrice, digits) : 0;
   double tp = (tpPrice > 0) ? NormalizeDouble(tpPrice, digits) : 0;

   // Un SL/TP du mauvais cote serait rejete -> on l'ignore.
   if(sl > 0 && ((isBuy && sl >= price) || (!isBuy && sl <= price))) sl = 0;
   if(tp > 0 && ((isBuy && tp <= price) || (!isBuy && tp >= price))) tp = 0;

   lot = NormalizeLot(symbol, lot);

   bool ok = isBuy ? trade.Buy(lot, symbol, 0.0, sl, tp, "TVBridge")
                   : trade.Sell(lot, symbol, 0.0, sl, tp, "TVBridge");
   if(ok)
      PrintFormat("OK %s %.2f %s @~%.3f SL=%.3f TP=%.3f", action, lot, symbol, price, sl, tp);
   else
      PrintFormat("ECHEC %s %s : ret=%d %s", action, symbol, trade.ResultRetcode(), trade.ResultRetcodeDescription());
  }

//+------------------------------------------------------------------+
//| Ferme toutes les positions de cet EA sur le symbole              |
//+------------------------------------------------------------------+
void CloseSymbol(string symbol)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if(trade.PositionClose(ticket)) PrintFormat("Ferme #%d sur %s", ticket, symbol);
     }
  }

double NormalizeLot(string symbol, double lot)
  {
   double minLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double step   = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   if(step > 0) lot = MathRound(lot / step) * step;
   if(lot < minLot) lot = minLot;
   if(lot > maxLot) lot = maxLot;
   return lot;
  }

//+------------------------------------------------------------------+
//| Miroir visuel (lignes / labels / boites de RUGA)                 |
//+------------------------------------------------------------------+
color ColorForText(string text)
  {
   string t = text; StringToLower(t);
   if(StringFind(t, "sl") >= 0)   return clrTomato;
   if(StringFind(t, "tp") >= 0)   return clrLimeGreen;
   if(StringFind(t, "buy") >= 0)  return clrDodgerBlue;
   if(StringFind(t, "sell") >= 0) return clrOrange;
   return clrSilver;
  }

void RenderDrawings()
  {
   string content = ReadCommonFile(InpDrawFile);
   if(content == "") return;
   StringReplace(content, "\r", "");
   ObjectsDeleteAll(0, DRAW_PREFIX);

   string lines[];
   int n = StringSplit(content, (ushort)'\n', lines);
   datetime anchor = TimeCurrent();
   int idx = 0;
   for(int i = 0; i < n; i++)
     {
      string p[];
      int k = StringSplit(lines[i], (ushort)'|', p);
      if(k < 2) continue;
      if(p[0] == "L")
        {
         double price = StringToDouble(p[1]); if(price <= 0) continue;
         string name = DRAW_PREFIX + "L" + IntegerToString(idx++);
         if(ObjectCreate(0, name, OBJ_HLINE, 0, 0, price))
           { ObjectSetInteger(0,name,OBJPROP_COLOR,clrDimGray); ObjectSetInteger(0,name,OBJPROP_STYLE,STYLE_DOT);
             ObjectSetInteger(0,name,OBJPROP_BACK,true); ObjectSetInteger(0,name,OBJPROP_SELECTABLE,false); }
        }
      else if(p[0] == "B" && k >= 3)
        {
         double hi = StringToDouble(p[1]); double lo = StringToDouble(p[2]); if(hi<=0||lo<=0) continue;
         datetime t1 = anchor - 400*PeriodSeconds(); datetime t2 = anchor + 30*PeriodSeconds();
         string name = DRAW_PREFIX + "B" + IntegerToString(idx++);
         if(ObjectCreate(0, name, OBJ_RECTANGLE, 0, t1, hi, t2, lo))
           { ObjectSetInteger(0,name,OBJPROP_COLOR,clrSlateGray); ObjectSetInteger(0,name,OBJPROP_FILL,true);
             ObjectSetInteger(0,name,OBJPROP_BACK,true); ObjectSetInteger(0,name,OBJPROP_SELECTABLE,false); }
        }
      else if(p[0] == "T" && k >= 3)
        {
         double price = StringToDouble(p[1]); if(price <= 0) continue;
         color c = ColorForText(p[2]);
         string name = DRAW_PREFIX + "T" + IntegerToString(idx++);
         if(ObjectCreate(0, name, OBJ_TEXT, 0, anchor, price))
           { ObjectSetString(0,name,OBJPROP_TEXT," "+p[2]); ObjectSetInteger(0,name,OBJPROP_COLOR,c);
             ObjectSetInteger(0,name,OBJPROP_FONTSIZE,8); ObjectSetInteger(0,name,OBJPROP_ANCHOR,ANCHOR_RIGHT);
             ObjectSetInteger(0,name,OBJPROP_SELECTABLE,false); }
        }
     }
   ChartRedraw(0);
  }

//+------------------------------------------------------------------+
//| Lecture fichier (dossier Common\Files) + mini-parseur JSON       |
//+------------------------------------------------------------------+
string ReadCommonFile(string name)
  {
   int h = FileOpen(name, FILE_READ | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(h == INVALID_HANDLE) return "";
   string content = "";
   while(!FileIsEnding(h)) content += FileReadString(h) + "\n";
   FileClose(h);
   return content;
  }

string JsonRawValue(string json, string key)
  {
   string pat = "\"" + key + "\"";
   int k = StringFind(json, pat); if(k < 0) return "";
   int colon = StringFind(json, ":", k + StringLen(pat)); if(colon < 0) return "";
   int i = colon + 1, n = StringLen(json);
   while(i < n)
     { ushort c = StringGetCharacter(json, i); if(c!=' '&&c!='\t'&&c!='\n'&&c!='\r') break; i++; }
   if(i >= n) return "";
   if(StringGetCharacter(json, i) == '"')
     { int end = StringFind(json, "\"", i + 1); if(end < 0) return ""; return StringSubstr(json, i + 1, end - i - 1); }
   int start = i;
   while(i < n)
     { ushort c = StringGetCharacter(json, i); if(c==','||c=='}'||c==' '||c=='\n'||c=='\r'||c=='\t') break; i++; }
   return StringSubstr(json, start, i - start);
  }

string JsonString(string json, string key) { return JsonRawValue(json, key); }
double JsonNumber(string json, string key) { string v = JsonRawValue(json, key); return (v == "") ? 0.0 : StringToDouble(v); }
//+------------------------------------------------------------------+
