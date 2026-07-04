//+------------------------------------------------------------------+
//|                                               PureScalperEA.mq5   |
//|                    Expert Advisor de Scalping Pur - 100% Auto     |
//|                                                                  |
//|  Strategie : Trend-Momentum Scalper                              |
//|   - Filtre de tendance   : EMA 200                               |
//|   - Signal d'entree      : croisement EMA rapide/lente + RSI     |
//|   - Filtre de volatilite : ATR                                   |
//|   - Gestion du risque    : lot dynamique (% du capital)          |
//|   - Protection           : SL/TP ATR, break-even, trailing stop  |
//+------------------------------------------------------------------+
#property copyright "PureScalperEA"
#property version   "1.00"
#property strict
#property description "Expert Advisor de scalping automatique (M1/M5). Trend-Momentum + ATR + money management."

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\SymbolInfo.mqh>

//+------------------------------------------------------------------+
//| Parametres d'entree                                              |
//+------------------------------------------------------------------+
input group    "=== Identification ==="
input long     InpMagicNumber      = 20260704;   // Magic Number (identifie les trades de l'EA)
input string   InpComment          = "PureScalper"; // Commentaire des ordres

input group    "=== Gestion du risque ==="
input bool     InpUseMoneyMgmt     = true;        // Lot dynamique base sur le risque
input double   InpRiskPercent      = 1.0;         // Risque par trade (% du capital)
input double   InpFixedLot         = 0.10;        // Lot fixe (si money mgmt desactive)
input double   InpMaxLot           = 5.0;         // Lot maximum autorise
input int      InpMaxPositions     = 1;           // Nombre max de positions simultanees

input group    "=== Indicateurs ==="
input int      InpTrendEMA         = 200;         // EMA filtre de tendance
input int      InpFastEMA          = 8;           // EMA rapide
input int      InpSlowEMA          = 21;          // EMA lente
input int      InpRSIPeriod        = 14;          // Periode RSI
input double   InpRSIBuyMax        = 70.0;        // RSI max pour acheter (evite surachat)
input double   InpRSISellMin       = 30.0;        // RSI min pour vendre (evite survente)
input int      InpATRPeriod        = 14;          // Periode ATR
input double   InpATRMinPips       = 3.0;         // ATR minimum en pips (evite marche plat)

input group    "=== Stop Loss / Take Profit (ATR) ==="
input double   InpSL_ATR_Mult      = 1.5;         // Multiplicateur ATR pour le Stop Loss
input double   InpTP_ATR_Mult      = 2.0;         // Multiplicateur ATR pour le Take Profit

input group    "=== Protection dynamique ==="
input bool     InpUseBreakEven     = true;        // Activer le break-even
input double   InpBreakEvenPips     = 5.0;        // Profit (pips) avant break-even
input double   InpBreakEvenLock     = 1.0;        // Pips verrouilles au break-even
input bool     InpUseTrailing      = true;        // Activer le trailing stop
input double   InpTrailStartPips    = 8.0;        // Profit (pips) avant trailing
input double   InpTrailStepPips     = 5.0;        // Distance du trailing (pips)

input group    "=== Filtres de trading ==="
input double   InpMaxSpreadPips    = 3.0;         // Spread maximum autorise (pips)
input bool     InpUseTimeFilter    = true;        // Activer le filtre horaire
input int      InpStartHour        = 7;           // Heure de debut (serveur)
input int      InpEndHour          = 20;          // Heure de fin (serveur)
input bool     InpOneTradePerBar   = true;        // Une seule entree par bougie

//+------------------------------------------------------------------+
//| Objets globaux                                                   |
//+------------------------------------------------------------------+
CTrade         trade;
CPositionInfo  position;
CSymbolInfo    sym;

int      hTrendEMA = INVALID_HANDLE;
int      hFastEMA  = INVALID_HANDLE;
int      hSlowEMA  = INVALID_HANDLE;
int      hRSI      = INVALID_HANDLE;
int      hATR      = INVALID_HANDLE;

double   g_point;       // valeur d'un point
double   g_pip;         // valeur d'un pip (10 points sur 5/3 digits)
int      g_digits;
datetime g_lastBarTime = 0;

//+------------------------------------------------------------------+
//| Initialisation                                                   |
//+------------------------------------------------------------------+
int OnInit()
  {
   if(!sym.Name(_Symbol))
     {
      Print("Erreur : impossible d'initialiser le symbole ", _Symbol);
      return(INIT_FAILED);
     }

   g_digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   g_point  = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   // Un pip = 10 points sur les symboles a 3 ou 5 decimales
   g_pip    = (g_digits == 3 || g_digits == 5) ? g_point * 10.0 : g_point;

   // Creation des handles d'indicateurs
   hTrendEMA = iMA(_Symbol, PERIOD_CURRENT, InpTrendEMA, 0, MODE_EMA, PRICE_CLOSE);
   hFastEMA  = iMA(_Symbol, PERIOD_CURRENT, InpFastEMA,  0, MODE_EMA, PRICE_CLOSE);
   hSlowEMA  = iMA(_Symbol, PERIOD_CURRENT, InpSlowEMA,  0, MODE_EMA, PRICE_CLOSE);
   hRSI      = iRSI(_Symbol, PERIOD_CURRENT, InpRSIPeriod, PRICE_CLOSE);
   hATR      = iATR(_Symbol, PERIOD_CURRENT, InpATRPeriod);

   if(hTrendEMA == INVALID_HANDLE || hFastEMA == INVALID_HANDLE ||
      hSlowEMA  == INVALID_HANDLE || hRSI == INVALID_HANDLE || hATR == INVALID_HANDLE)
     {
      Print("Erreur : creation d'un handle d'indicateur echouee");
      return(INIT_FAILED);
     }

   // Configuration de l'objet trade
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(10);
   trade.SetTypeFillingBySymbol(_Symbol);
   trade.SetMarginMode();

   PrintFormat("PureScalperEA initialise sur %s | point=%.5f pip=%.5f digits=%d",
               _Symbol, g_point, g_pip, g_digits);
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
//| Deinitialisation                                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   if(hTrendEMA != INVALID_HANDLE) IndicatorRelease(hTrendEMA);
   if(hFastEMA  != INVALID_HANDLE) IndicatorRelease(hFastEMA);
   if(hSlowEMA  != INVALID_HANDLE) IndicatorRelease(hSlowEMA);
   if(hRSI      != INVALID_HANDLE) IndicatorRelease(hRSI);
   if(hATR      != INVALID_HANDLE) IndicatorRelease(hATR);
  }

//+------------------------------------------------------------------+
//| Tick                                                             |
//+------------------------------------------------------------------+
void OnTick()
  {
   // Gestion des positions ouvertes (break-even / trailing) a chaque tick
   ManageOpenPositions();

   // Detection de nouvelle bougie
   datetime curBarTime = (datetime)SeriesInfoInteger(_Symbol, PERIOD_CURRENT, SERIES_LASTBAR_DATE);
   bool isNewBar = (curBarTime != g_lastBarTime);
   if(isNewBar)
      g_lastBarTime = curBarTime;

   // On ne cherche des entrees qu'a l'ouverture d'une nouvelle bougie
   if(InpOneTradePerBar && !isNewBar)
      return;

   // Filtres globaux
   if(!IsTradingTime())      return;
   if(!IsSpreadOK())         return;
   if(CountMyPositions() >= InpMaxPositions) return;

   // Recuperation des donnees d'indicateurs
   double trendEMA, fastEMA_0, slowEMA_0, fastEMA_1, slowEMA_1, rsi, atr;
   if(!GetIndicatorData(trendEMA, fastEMA_0, slowEMA_0, fastEMA_1, slowEMA_1, rsi, atr))
      return;

   // Filtre de volatilite : ATR suffisant
   double atrPips = atr / g_pip;
   if(atrPips < InpATRMinPips)
      return;

   double close = iClose(_Symbol, PERIOD_CURRENT, 1);

   // --- Signal d'ACHAT ---
   // Tendance haussiere (prix > EMA200), croisement EMA rapide au-dessus lente, RSI pas en surachat
   bool crossUp   = (fastEMA_1 <= slowEMA_1) && (fastEMA_0 > slowEMA_0);
   bool trendUp   = (close > trendEMA) && (fastEMA_0 > trendEMA);
   bool rsiBuyOK  = (rsi < InpRSIBuyMax) && (rsi > 50.0);

   if(crossUp && trendUp && rsiBuyOK)
     {
      OpenTrade(ORDER_TYPE_BUY, atr);
      return;
     }

   // --- Signal de VENTE ---
   bool crossDn   = (fastEMA_1 >= slowEMA_1) && (fastEMA_0 < slowEMA_0);
   bool trendDn   = (close < trendEMA) && (fastEMA_0 < trendEMA);
   bool rsiSellOK = (rsi > InpRSISellMin) && (rsi < 50.0);

   if(crossDn && trendDn && rsiSellOK)
     {
      OpenTrade(ORDER_TYPE_SELL, atr);
      return;
     }
  }

//+------------------------------------------------------------------+
//| Recupere les valeurs d'indicateurs (bougie fermee = index 1)     |
//+------------------------------------------------------------------+
bool GetIndicatorData(double &trendEMA, double &fastEMA_0, double &slowEMA_0,
                      double &fastEMA_1, double &slowEMA_1, double &rsi, double &atr)
  {
   double bufTrend[2], bufFast[3], bufSlow[3], bufRSI[2], bufATR[2];

   if(CopyBuffer(hTrendEMA, 0, 0, 2, bufTrend) < 2) return false;
   if(CopyBuffer(hFastEMA,  0, 0, 3, bufFast)  < 3) return false;
   if(CopyBuffer(hSlowEMA,  0, 0, 3, bufSlow)  < 3) return false;
   if(CopyBuffer(hRSI,      0, 0, 2, bufRSI)   < 2) return false;
   if(CopyBuffer(hATR,      0, 0, 2, bufATR)   < 2) return false;

   // index 0 = bougie en cours, index 1 = derniere bougie fermee, index 2 = precedente
   trendEMA  = bufTrend[1];
   fastEMA_0 = bufFast[1];   // bougie fermee
   slowEMA_0 = bufSlow[1];
   fastEMA_1 = bufFast[2];   // bougie precedente (pour detecter le croisement)
   slowEMA_1 = bufSlow[2];
   rsi       = bufRSI[1];
   atr       = bufATR[1];
   return true;
  }

//+------------------------------------------------------------------+
//| Ouvre un trade avec SL/TP bases sur l'ATR                        |
//+------------------------------------------------------------------+
void OpenTrade(ENUM_ORDER_TYPE type, double atr)
  {
   sym.RefreshRates();
   double price = (type == ORDER_TYPE_BUY) ? sym.Ask() : sym.Bid();

   double slDist = atr * InpSL_ATR_Mult;
   double tpDist = atr * InpTP_ATR_Mult;

   // Respect de la distance minimale du broker (stops level)
   double minStop = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * g_point;
   if(slDist < minStop) slDist = minStop * 1.5;
   if(tpDist < minStop) tpDist = minStop * 1.5;

   double sl, tp;
   if(type == ORDER_TYPE_BUY)
     {
      sl = price - slDist;
      tp = price + tpDist;
     }
   else
     {
      sl = price + slDist;
      tp = price - tpDist;
     }

   sl = NormalizeDouble(sl, g_digits);
   tp = NormalizeDouble(tp, g_digits);

   double lot = CalculateLot(slDist);
   if(lot <= 0.0)
     {
      Print("Lot calcule invalide, trade annule");
      return;
     }

   bool ok;
   if(type == ORDER_TYPE_BUY)
      ok = trade.Buy(lot, _Symbol, price, sl, tp, InpComment);
   else
      ok = trade.Sell(lot, _Symbol, price, sl, tp, InpComment);

   if(ok)
      PrintFormat("%s ouvert | lot=%.2f prix=%.5f SL=%.5f TP=%.5f",
                  (type==ORDER_TYPE_BUY?"BUY":"SELL"), lot, price, sl, tp);
   else
      PrintFormat("Echec ouverture %s | code=%d msg=%s",
                  (type==ORDER_TYPE_BUY?"BUY":"SELL"), trade.ResultRetcode(), trade.ResultRetcodeDescription());
  }

//+------------------------------------------------------------------+
//| Calcul du lot selon le risque (% du capital) et la distance SL   |
//+------------------------------------------------------------------+
double CalculateLot(double slDistance)
  {
   double minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);

   double lot;
   if(!InpUseMoneyMgmt)
     {
      lot = InpFixedLot;
     }
   else
     {
      double balance   = AccountInfoDouble(ACCOUNT_BALANCE);
      double riskMoney = balance * InpRiskPercent / 100.0;

      double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
      double tickSize  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
      if(tickSize <= 0.0 || tickValue <= 0.0)
         return NormalizeLot(InpFixedLot, minLot, maxLot, lotStep);

      // Perte pour 1 lot si le SL est touche
      double lossPerLot = (slDistance / tickSize) * tickValue;
      if(lossPerLot <= 0.0)
         return NormalizeLot(InpFixedLot, minLot, maxLot, lotStep);

      lot = riskMoney / lossPerLot;
     }

   // Plafond utilisateur
   if(lot > InpMaxLot) lot = InpMaxLot;

   return NormalizeLot(lot, minLot, maxLot, lotStep);
  }

//+------------------------------------------------------------------+
//| Normalise le lot aux contraintes du broker                       |
//+------------------------------------------------------------------+
double NormalizeLot(double lot, double minLot, double maxLot, double lotStep)
  {
   if(lotStep > 0.0)
      lot = MathFloor(lot / lotStep) * lotStep;
   if(lot < minLot) lot = minLot;
   if(lot > maxLot) lot = maxLot;
   return NormalizeDouble(lot, 2);
  }

//+------------------------------------------------------------------+
//| Gestion des positions ouvertes : break-even + trailing stop      |
//+------------------------------------------------------------------+
void ManageOpenPositions()
  {
   if(!InpUseBreakEven && !InpUseTrailing)
      return;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!position.SelectByTicket(ticket)) continue;
      if(position.Symbol() != _Symbol) continue;
      if(position.Magic() != InpMagicNumber) continue;

      ENUM_POSITION_TYPE ptype = position.PositionType();
      double openPrice = position.PriceOpen();
      double curSL     = position.StopLoss();
      double curTP     = position.TakeProfit();

      sym.RefreshRates();
      double curPrice = (ptype == POSITION_TYPE_BUY) ? sym.Bid() : sym.Ask();

      double profitPips = (ptype == POSITION_TYPE_BUY)
                          ? (curPrice - openPrice) / g_pip
                          : (openPrice - curPrice) / g_pip;

      double newSL = curSL;

      // --- Break-even ---
      if(InpUseBreakEven && profitPips >= InpBreakEvenPips)
        {
         double bePrice = (ptype == POSITION_TYPE_BUY)
                          ? openPrice + InpBreakEvenLock * g_pip
                          : openPrice - InpBreakEvenLock * g_pip;
         bePrice = NormalizeDouble(bePrice, g_digits);

         if(ptype == POSITION_TYPE_BUY && (curSL < bePrice || curSL == 0.0))
            newSL = bePrice;
         if(ptype == POSITION_TYPE_SELL && (curSL > bePrice || curSL == 0.0))
            newSL = bePrice;
        }

      // --- Trailing stop ---
      if(InpUseTrailing && profitPips >= InpTrailStartPips)
        {
         double trailPrice = (ptype == POSITION_TYPE_BUY)
                             ? curPrice - InpTrailStepPips * g_pip
                             : curPrice + InpTrailStepPips * g_pip;
         trailPrice = NormalizeDouble(trailPrice, g_digits);

         if(ptype == POSITION_TYPE_BUY && trailPrice > newSL)
            newSL = trailPrice;
         if(ptype == POSITION_TYPE_SELL && (trailPrice < newSL || newSL == 0.0))
            newSL = trailPrice;
        }

      // Application si le SL a change de facon significative
      if(newSL != curSL && MathAbs(newSL - curSL) >= g_point)
        {
         if(!trade.PositionModify(ticket, newSL, curTP))
            PrintFormat("Echec modification SL ticket=%I64u code=%d", ticket, trade.ResultRetcode());
        }
     }
  }

//+------------------------------------------------------------------+
//| Compte les positions de cet EA sur ce symbole                    |
//+------------------------------------------------------------------+
int CountMyPositions()
  {
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!position.SelectByTicket(ticket)) continue;
      if(position.Symbol() == _Symbol && position.Magic() == InpMagicNumber)
         count++;
     }
   return count;
  }

//+------------------------------------------------------------------+
//| Filtre horaire                                                   |
//+------------------------------------------------------------------+
bool IsTradingTime()
  {
   if(!InpUseTimeFilter)
      return true;

   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   int h = dt.hour;

   if(InpStartHour <= InpEndHour)
      return (h >= InpStartHour && h < InpEndHour);
   // Plage qui passe minuit
   return (h >= InpStartHour || h < InpEndHour);
  }

//+------------------------------------------------------------------+
//| Filtre de spread                                                 |
//+------------------------------------------------------------------+
bool IsSpreadOK()
  {
   double spread = (SymbolInfoDouble(_Symbol, SYMBOL_ASK) -
                    SymbolInfoDouble(_Symbol, SYMBOL_BID)) / g_pip;
   return (spread <= InpMaxSpreadPips);
  }
//+------------------------------------------------------------------+
