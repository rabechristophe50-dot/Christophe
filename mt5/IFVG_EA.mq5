//+------------------------------------------------------------------+
//|  IFVG_EA.mq5 — "Comment bien trader les IFVG ?"                   |
//|  Expert Advisor MT5 · concept ICT Inverse Fair Value Gap          |
//|  Réglé pour l'OR (XAUUSD) en 5 min et 15 min.                     |
//|                                                                    |
//|  Détecte l'IFVG ET passe les ordres automatiquement.              |
//|  Mêmes 4 règles que la version Pine :                             |
//|   1. Prise de liquidité (sweep) avant l'IFVG                      |
//|   2. 1 seul FVG -> IFVG (pas de cluster)                          |
//|   3. Inversion confirmée par la CLÔTURE du corps                  |
//|   4. Cible IRL -> ERL (liquidité externe = swing opposé)          |
//+------------------------------------------------------------------+
#property copyright "IFVG"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>
CTrade trade;

//--- Inputs -----------------------------------------------------------
input int    InpPivotLen      = 8;      // Longueur des swings (liquidité)
input int    InpWindowBars    = 18;     // Fenêtre max sweep -> IFVG (bougies)
input bool   InpRequireSingle = true;   // Exiger 1 seul FVG (règle #2)
input bool   InpUseAtrFilter  = true;   // Filtre taille FVG par ATR
input double InpMinFvgAtr      = 0.25;   // FVG min = x * ATR(14)
input double InpMinFvgPts      = 0.0;    // Taille min FVG en points (si ATR off)
input bool   InpUseSwingTP     = true;   // Cible = liquidité externe (swing)
input double InpRRFallback     = 2.0;    // R:R si pas de swing dispo
input double InpSlPadPct       = 0.05;   // Marge du stop au-delà de l'IFVG (%)
input bool   InpAllowLongs      = true;
input bool   InpAllowShorts     = true;
input double InpRiskUsd         = 20.0;  // Risque $ par trade
input double InpMaxLots         = 5.0;   // Plafond de lots
input long   InpMagic           = 902501;
input int    InpMaxPositions    = 1;     // Positions simultanées max (ce magic)

//--- State (persiste entre bougies) -----------------------------------
double lastSwingHigh = 0.0; bool hasSwingHigh = false;
double lastSwingLow  = 0.0; bool hasSwingLow  = false;

int    lState = 0; double lFvgTop = 0, lFvgBot = 0; int lExpiry = 0; double lSweepLow = 0;
int    sState = 0; double sFvgTop = 0, sFvgBot = 0; int sExpiry = 0; double sSweepHigh = 0;

int    barCounter = 0;          // index de bougie interne
datetime lastBarTime = 0;
int    atrHandle = INVALID_HANDLE;

//+------------------------------------------------------------------+
int OnInit()
  {
   trade.SetExpertMagicNumber(InpMagic);
   atrHandle = iATR(_Symbol, PERIOD_CURRENT, 14);
   if(atrHandle == INVALID_HANDLE) { Print("ATR handle KO"); return(INIT_FAILED); }
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason) { if(atrHandle!=INVALID_HANDLE) IndicatorRelease(atrHandle); }

//+------------------------------------------------------------------+
//| Nombre de positions ouvertes par cet EA                          |
//+------------------------------------------------------------------+
int CountPositions()
  {
   int n = 0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) == InpMagic &&
         PositionGetString(POSITION_SYMBOL) == _Symbol) n++;
     }
   return n;
  }

//+------------------------------------------------------------------+
//| Taille en lots à partir du risque $ et de la distance au SL      |
//+------------------------------------------------------------------+
double CalcLots(double slDistance)
  {
   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(slDistance <= 0 || tickSize <= 0 || tickValue <= 0) return 0;
   double moneyPerLot = (slDistance / tickSize) * tickValue;
   if(moneyPerLot <= 0) return 0;
   double lots = InpRiskUsd / moneyPerLot;
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double minL = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxL = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step > 0) lots = MathFloor(lots / step) * step;
   lots = MathMax(minL, MathMin(MathMin(maxL, InpMaxLots), lots));
   return lots;
  }

//+------------------------------------------------------------------+
//| Détection d'une nouvelle bougie                                  |
//+------------------------------------------------------------------+
bool IsNewBar()
  {
   datetime t = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(t != lastBarTime) { lastBarTime = t; return true; }
   return false;
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   if(!IsNewBar()) return;
   int need = 2 * InpPivotLen + 5;
   if(Bars(_Symbol, PERIOD_CURRENT) < need) return;

   barCounter++;

   //--- ATR courant
   double atrBuf[]; double atr = 0;
   if(CopyBuffer(atrHandle, 0, 1, 1, atrBuf) == 1) atr = atrBuf[0];
   double minSize = InpUseAtrFilter ? InpMinFvgAtr * atr : InpMinFvgPts;

   //--- 1. Confirmation d'un pivot à shift (1 + pivotLen) ------------
   int pc = 1 + InpPivotLen;
   double pcHigh = iHigh(_Symbol, PERIOD_CURRENT, pc);
   double pcLow  = iLow(_Symbol, PERIOD_CURRENT, pc);
   bool isHigh = true, isLow = true;
   int last = 1 + 2 * InpPivotLen;
   for(int k = 1; k <= last; k++)
     {
      if(k == pc) continue;
      if(iHigh(_Symbol, PERIOD_CURRENT, k) >= pcHigh) isHigh = false;
      if(iLow(_Symbol, PERIOD_CURRENT, k)  <= pcLow)  isLow  = false;
     }
   if(isHigh) { lastSwingHigh = pcHigh; hasSwingHigh = true; }
   if(isLow)  { lastSwingLow  = pcLow;  hasSwingLow  = true; }

   //--- Bougie d'évaluation = dernière clôturée (shift 1) -----------
   double o1 = iOpen(_Symbol, PERIOD_CURRENT, 1);
   double h1 = iHigh(_Symbol, PERIOD_CURRENT, 1);
   double l1 = iLow(_Symbol,  PERIOD_CURRENT, 1);
   double c1 = iClose(_Symbol,PERIOD_CURRENT, 1);
   double h3 = iHigh(_Symbol, PERIOD_CURRENT, 3);
   double l3 = iLow(_Symbol,  PERIOD_CURRENT, 3);

   bool sellsideSweep = hasSwingLow  && l1 < lastSwingLow  && c1 > lastSwingLow;
   bool buysideSweep  = hasSwingHigh && h1 > lastSwingHigh && c1 < lastSwingHigh;

   // FVG (3 bougies)
   bool bearFVG = (h1 < l3);  double bearTop = l3, bearBot = h1;
   bool bullFVG = (l1 > h3);  double bullTop = l1, bullBot = h3;
   bool bearOk = bearFVG && (minSize <= 0 || (bearTop - bearBot) >= minSize);
   bool bullOk = bullFVG && (minSize <= 0 || (bullTop - bullBot) >= minSize);

   //================= LONG =================
   if(sellsideSweep && InpAllowLongs && lState == 0)
     { lState = 1; lExpiry = barCounter + InpWindowBars; lFvgTop = 0; lFvgBot = 0; lSweepLow = l1; }
   if(lState >= 1 && barCounter > lExpiry) lState = 0;
   if(lState == 1 && bearOk) { lFvgTop = bearTop; lFvgBot = bearBot; lState = 2; }
   else if(lState == 2 && bearOk)
     { if(InpRequireSingle) lState = 0; else { lFvgTop = bearTop; lFvgBot = bearBot; } }

   bool longSignal = (lState == 2 && c1 > lFvgTop && c1 > o1);
   if(longSignal)
     {
      double entry = c1;
      double sl = MathMin(lFvgBot, lSweepLow) * (1.0 - InpSlPadPct / 100.0);
      double risk = entry - sl;
      double tp = (InpUseSwingTP && hasSwingHigh && lastSwingHigh > entry) ? lastSwingHigh : entry + risk * InpRRFallback;
      if(risk > 0 && CountPositions() < InpMaxPositions)
        {
         double lots = CalcLots(risk);
         if(lots > 0)
           {
            double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
            trade.Buy(lots, _Symbol, ask, NormalizeDouble(sl, _Digits), NormalizeDouble(tp, _Digits), "IFVG LONG");
           }
        }
      lState = 0;
     }

   //================= SHORT =================
   if(buysideSweep && InpAllowShorts && sState == 0)
     { sState = 1; sExpiry = barCounter + InpWindowBars; sFvgTop = 0; sFvgBot = 0; sSweepHigh = h1; }
   if(sState >= 1 && barCounter > sExpiry) sState = 0;
   if(sState == 1 && bullOk) { sFvgTop = bullTop; sFvgBot = bullBot; sState = 2; }
   else if(sState == 2 && bullOk)
     { if(InpRequireSingle) sState = 0; else { sFvgTop = bullTop; sFvgBot = bullBot; } }

   bool shortSignal = (sState == 2 && c1 < sFvgBot && c1 < o1);
   if(shortSignal)
     {
      double entry = c1;
      double sl = MathMax(sFvgTop, sSweepHigh) * (1.0 + InpSlPadPct / 100.0);
      double risk = sl - entry;
      double tp = (InpUseSwingTP && hasSwingLow && lastSwingLow < entry) ? lastSwingLow : entry - risk * InpRRFallback;
      if(risk > 0 && CountPositions() < InpMaxPositions)
        {
         double lots = CalcLots(risk);
         if(lots > 0)
           {
            double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
            trade.Sell(lots, _Symbol, bid, NormalizeDouble(sl, _Digits), NormalizeDouble(tp, _Digits), "IFVG SHORT");
           }
        }
      sState = 0;
     }
  }
//+------------------------------------------------------------------+
