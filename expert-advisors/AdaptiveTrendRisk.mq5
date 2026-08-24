//+------------------------------------------------------------------+
//|                                          AdaptiveTrendRisk.mq5    |
//|   Bot suivi de tendance + moteur de risque (MetaTrader 5)        |
//|   Jumeau MQL5 de indicators/adaptive_trend_risk_strategy.pine    |
//|                                                                  |
//|   Reglage par defaut : OR (XAUUSD) et BTC (BTCUSD).              |
//|                                                                  |
//|   AVERTISSEMENT : aucun EA n'est garanti rentable. Backtestez    |
//|   dans le Strategy Tester MT5 ET verifiez sur TradingView avec   |
//|   le fichier Pine avant tout usage en reel. Commencez en DEMO.   |
//+------------------------------------------------------------------+
#property copyright "Christophe"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>
CTrade trade;

//--- ① Tendance
input group "① Tendance"
input int    InpEmaFast    = 21;      // EMA rapide
input int    InpEmaSlow    = 55;      // EMA lente
input int    InpSlopeLen   = 5;       // Bougies pour la pente EMA

//--- ② Entree sur repli
input group "② Entree sur repli"
input double InpPullbackAtr   = 0.5;  // Repli max sur EMA rapide (x ATR)
input bool   InpRequireReject = true; // Exiger une bougie de rejet

//--- ③ Gestion du risque
input group "③ Gestion du risque"
input bool   InpUseFixedLot  = false; // Lot fixe (comme la video 0.01) au lieu du risque %
input double InpFixedLot      = 0.01; // Volume fixe si InpUseFixedLot = true
input double InpRiskPerTrade = 1.0;   // Risque par trade (% du solde) si lot NON fixe
input int    InpAtrLen       = 14;    // Longueur ATR
input double InpAtrMult       = 2.0;  // Stop Loss = ATR x
input double InpRR            = 2.0;   // Ratio Risque:Recompense (TP)
input bool   InpUseBE         = true; // Break-even a +1R
input bool   InpUseTrail      = true; // Trailing stop ATR apres +1R
input double InpTrailMult     = 2.0;  // Trailing = ATR x

//--- ④ Filtres
input group "④ Filtres"
input bool   InpUseVolFilter = true;  // Filtre regime de volatilite
input double InpVolFloor     = 0.3;   // ATR min (% du prix)
input bool   InpUseHtf       = false; // Filtre tendance HTF (EMA 200)
input int    InpHtfEmaLen    = 200;   // EMA long terme
input bool   InpUseSession   = false; // Filtre plage horaire (heure serveur)
input int    InpSessStart    = 8;     // Heure debut (0-23)
input int    InpSessEnd      = 16;    // Heure fin (0-23)
input bool   InpAllowLong     = true; // Autoriser les LONG
input bool   InpAllowShort    = true; // Autoriser les SHORT

//--- ⑤ Divers
input group "⑤ Divers"
input long   InpMagic        = 990011; // Numero magique
input int    InpSlippage     = 20;     // Slippage (points)

//--- Handles indicateurs
int hEmaFast = INVALID_HANDLE;
int hEmaSlow = INVALID_HANDLE;
int hHtf     = INVALID_HANDLE;
int hAtr     = INVALID_HANDLE;

//--- Etat du trade gere (une position par symbole/magique)
double g_entry       = 0.0;
double g_initialStop = 0.0;
bool   g_beMoved     = false;

datetime g_lastBar = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   hEmaFast = iMA(_Symbol, PERIOD_CURRENT, InpEmaFast, 0, MODE_EMA, PRICE_CLOSE);
   hEmaSlow = iMA(_Symbol, PERIOD_CURRENT, InpEmaSlow, 0, MODE_EMA, PRICE_CLOSE);
   hHtf     = iMA(_Symbol, PERIOD_CURRENT, InpHtfEmaLen, 0, MODE_EMA, PRICE_CLOSE);
   hAtr     = iATR(_Symbol, PERIOD_CURRENT, InpAtrLen);

   if(hEmaFast==INVALID_HANDLE || hEmaSlow==INVALID_HANDLE ||
      hHtf==INVALID_HANDLE || hAtr==INVALID_HANDLE)
   {
      Print("Erreur creation des handles indicateurs");
      return(INIT_FAILED);
   }

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippage);
   trade.SetTypeFillingBySymbol(_Symbol);
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   IndicatorRelease(hEmaFast);
   IndicatorRelease(hEmaSlow);
   IndicatorRelease(hHtf);
   IndicatorRelease(hAtr);
}

//+------------------------------------------------------------------+
//| Lecture d'un buffer indicateur a un shift donne                  |
//+------------------------------------------------------------------+
double Buf(int handle, int shift)
{
   double b[];
   if(CopyBuffer(handle, 0, shift, 1, b) < 1)
      return(0.0);
   return(b[0]);
}

//+------------------------------------------------------------------+
//| Position ouverte par cet EA sur ce symbole ?                     |
//+------------------------------------------------------------------+
bool HasPosition()
{
   if(!PositionSelect(_Symbol))
      return(false);
   return(PositionGetInteger(POSITION_MAGIC) == InpMagic);
}

//+------------------------------------------------------------------+
//| Calcul du volume selon le risque en % et la distance de stop     |
//+------------------------------------------------------------------+
double CalcLots(double stopDistance)
{
   double step   = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double minLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step <= 0) step = 0.01;

   double lots;

   // Mode "lot fixe" (comme la video : SELL 0.01)
   if(InpUseFixedLot)
   {
      lots = InpFixedLot;
   }
   else
   {
      // Mode "risque %" : lot calcule pour risquer InpRiskPerTrade % du solde
      double balance    = AccountInfoDouble(ACCOUNT_BALANCE);
      double riskAmount = balance * (InpRiskPerTrade / 100.0);
      double tickValue  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
      double tickSize   = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
      if(stopDistance <= 0 || tickValue <= 0 || tickSize <= 0)
         return(0.0);

      double moneyPerLot = (stopDistance / tickSize) * tickValue; // perte pour 1 lot si stop touche
      if(moneyPerLot <= 0)
         return(0.0);

      lots = riskAmount / moneyPerLot;
   }

   lots = MathFloor(lots / step) * step;
   lots = MathMax(minLot, MathMin(maxLot, lots));
   return(lots);
}

//+------------------------------------------------------------------+
//| Filtre plage horaire (heure serveur)                             |
//+------------------------------------------------------------------+
bool InSession()
{
   if(!InpUseSession)
      return(true);
   MqlDateTime t;
   TimeToStruct(TimeCurrent(), t);
   int h = t.hour;
   if(InpSessStart <= InpSessEnd)
      return(h >= InpSessStart && h < InpSessEnd);
   // plage qui traverse minuit
   return(h >= InpSessStart || h < InpSessEnd);
}

//+------------------------------------------------------------------+
void OnTick()
{
   // ---- Gestion de la position ouverte (a chaque tick) ----
   ManageOpenPosition();

   // ---- Detection nouvelle bougie (on trade sur bougie cloturee) ----
   datetime curBar = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(curBar == g_lastBar)
      return;
   g_lastBar = curBar;

   if(HasPosition())
      return; // une seule position a la fois

   CheckForEntry();
}

//+------------------------------------------------------------------+
//| Recherche d'un signal sur la derniere bougie cloturee (shift 1)  |
//+------------------------------------------------------------------+
void CheckForEntry()
{
   // Valeurs sur bougie cloturee
   double emaFast1 = Buf(hEmaFast, 1);
   double emaFastN = Buf(hEmaFast, 1 + InpSlopeLen);
   double emaSlow1 = Buf(hEmaSlow, 1);
   double atr1     = Buf(hAtr, 1);
   double htf1     = Buf(hHtf, 1);
   if(emaFast1==0 || emaSlow1==0 || atr1==0)
      return;

   double close1 = iClose(_Symbol, PERIOD_CURRENT, 1);
   double open1  = iOpen(_Symbol, PERIOD_CURRENT, 1);
   double high1  = iHigh(_Symbol, PERIOD_CURRENT, 1);
   double low1   = iLow(_Symbol, PERIOD_CURRENT, 1);

   double slope   = emaFast1 - emaFastN;
   bool   trendUp = (emaFast1 > emaSlow1) && (slope > 0);
   bool   trendDn = (emaFast1 < emaSlow1) && (slope < 0);

   bool touchedUp = (low1  <= emaFast1 + atr1 * InpPullbackAtr);
   bool touchedDn = (high1 >= emaFast1 - atr1 * InpPullbackAtr);

   bool rejUp = !InpRequireReject || (close1 > open1 && close1 > emaFast1);
   bool rejDn = !InpRequireReject || (close1 < open1 && close1 < emaFast1);

   double atrPct = close1 != 0 ? atr1 / close1 * 100.0 : 0.0;
   bool volOk    = !InpUseVolFilter || atrPct >= InpVolFloor;
   bool htfLong  = !InpUseHtf || close1 > htf1;
   bool htfShort = !InpUseHtf || close1 < htf1;
   bool filters  = volOk && InSession();

   bool longSig  = InpAllowLong  && trendUp && touchedUp && rejUp && htfLong  && filters;
   bool shortSig = InpAllowShort && trendDn && touchedDn && rejDn && htfShort && filters;

   if(longSig)
      OpenTrade(true, atr1);
   else if(shortSig)
      OpenTrade(false, atr1);
}

//+------------------------------------------------------------------+
void OpenTrade(bool isLong, double atr)
{
   double price = isLong ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                         : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double stopDist = atr * InpAtrMult;
   if(stopDist <= 0)
      return;

   // Contrainte courtier : le stop ne peut pas etre plus proche que le
   // "stops level". Critique en M1 ou l'ATR peut donner un stop minuscule,
   // sinon l'ordre est rejete (invalid stops). On elargit au minimum requis.
   double point       = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   long   stopsLvlPts = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minDist     = (stopsLvlPts + 5) * point; // +5 pts de marge de securite
   if(stopDist < minDist)
      stopDist = minDist;

   double sl = isLong ? price - stopDist : price + stopDist;
   double tp = isLong ? price + stopDist * InpRR : price - stopDist * InpRR;

   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   sl = NormalizeDouble(sl, digits);
   tp = NormalizeDouble(tp, digits);

   double lots = CalcLots(stopDist);
   if(lots <= 0)
   {
      Print("Volume calcule = 0, trade ignore. Verifiez le risque / la marge.");
      return;
   }

   bool ok = isLong ? trade.Buy(lots, _Symbol, price, sl, tp, "ATR-Engine")
                    : trade.Sell(lots, _Symbol, price, sl, tp, "ATR-Engine");
   if(ok)
   {
      g_entry       = price;
      g_initialStop = sl;
      g_beMoved     = false;
      PrintFormat("%s ouvert  lots=%.2f  entry=%.5f  SL=%.5f  TP=%.5f",
                  isLong ? "LONG" : "SHORT", lots, price, sl, tp);
   }
   else
      PrintFormat("Echec ouverture ordre: %d", trade.ResultRetcode());
}

//+------------------------------------------------------------------+
//| Break-even + trailing stop sur la position en cours              |
//+------------------------------------------------------------------+
void ManageOpenPosition()
{
   if(!HasPosition())
   {
      g_entry = 0.0; g_initialStop = 0.0; g_beMoved = false;
      return;
   }

   long   type      = PositionGetInteger(POSITION_TYPE);
   double openP     = PositionGetDouble(POSITION_PRICE_OPEN);
   double curSL     = PositionGetDouble(POSITION_SL);
   double curTP     = PositionGetDouble(POSITION_TP);
   int    digits    = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double point     = SymbolInfoDouble(_Symbol, SYMBOL_POINT);

   // Reconstruction de l'etat si l'EA a redemarre
   if(g_entry == 0.0)
   {
      g_entry       = openP;
      g_initialStop = (curSL != 0.0) ? curSL : openP;
      g_beMoved     = false;
   }

   double oneR = MathAbs(g_entry - g_initialStop);
   if(oneR <= 0)
      return;

   double atr = Buf(hAtr, 1);

   if(type == POSITION_TYPE_BUY)
   {
      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      double newSL = curSL;

      if(InpUseBE && !g_beMoved && bid >= g_entry + oneR)
      {
         newSL = MathMax(curSL, g_entry);
         g_beMoved = true;
      }
      if(InpUseTrail && g_beMoved && atr > 0)
         newSL = MathMax(newSL, bid - atr * InpTrailMult);

      newSL = NormalizeDouble(newSL, digits);
      if(newSL > curSL + point)
         trade.PositionModify(_Symbol, newSL, curTP);
   }
   else if(type == POSITION_TYPE_SELL)
   {
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double newSL = curSL;

      if(InpUseBE && !g_beMoved && ask <= g_entry - oneR)
      {
         newSL = (curSL == 0.0) ? g_entry : MathMin(curSL, g_entry);
         g_beMoved = true;
      }
      if(InpUseTrail && g_beMoved && atr > 0)
      {
         double trailSL = ask + atr * InpTrailMult;
         newSL = (newSL == 0.0) ? trailSL : MathMin(newSL, trailSL);
      }

      newSL = NormalizeDouble(newSL, digits);
      if(newSL != 0.0 && (curSL == 0.0 || newSL < curSL - point))
         trade.PositionModify(_Symbol, newSL, curTP);
   }
}
//+------------------------------------------------------------------+
