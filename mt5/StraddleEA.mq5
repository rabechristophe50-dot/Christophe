//+------------------------------------------------------------------+
//|                                                   StraddleEA.mq5   |
//|        Straddle / Reversion - ordres en attente, SL serre, TP     |
//|        au niveau oppose. Version EA pour backtest dans MT5.        |
//|                                                                  |
//|  Mode "reversion" (defaut) :                                     |
//|    Sell Limit en haut / Buy Limit en bas.                        |
//|    SL tres serre au-dela ; TP = ligne opposee (le prix revient). |
//|  Mode "breakout" :                                               |
//|    Buy Stop en haut / Sell Stop en bas ; TP dans le sens cassure.|
//|                                                                  |
//|  1 pip = 0.01 $ sur l'or (XAUUSD).                               |
//+------------------------------------------------------------------+
#property copyright "PureStraddleEA"
#property version   "1.00"
#property strict
#property description "Straddle/Reversion : ordres en attente, SL serre, TP au niveau oppose. XAUUSD."

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\SymbolInfo.mqh>

enum ENUM_STRADDLE_MODE
  {
   MODE_REVERSION = 0,   // Reversion (Buy/Sell Limit, TP au niveau oppose)
   MODE_BREAKOUT  = 1    // Breakout (Buy/Sell Stop, TP dans le sens de la cassure)
  };

//+------------------------------------------------------------------+
//| Parametres                                                       |
//+------------------------------------------------------------------+
input group    "=== Identification ==="
input long              InpMagicNumber   = 20260705;      // Magic Number
input string            InpComment       = "PureStraddle"; // Commentaire des ordres

input group    "=== Strategie ==="
input ENUM_STRADDLE_MODE InpMode         = MODE_REVERSION; // Mode de straddle
input double            InpEntryDistPips = 100.0;          // Distance des ordres au prix (pips)
input double            InpSL_Pips       = 20.0;           // SL tres serre (pips)
input double            InpTP_Pips       = 150.0;          // TP en mode breakout uniquement (pips)

input group    "=== Gestion du risque ==="
input bool              InpUseRisk       = false;          // Lot dynamique base sur le risque
input double            InpRiskPercent   = 0.5;            // Risque par trade (% du capital)
input double            InpFixedLot      = 0.01;           // Lot fixe
input double            InpMaxLot        = 5.0;            // Lot maximum

input group    "=== Comportement ==="
input bool              InpRecenterEachBar = true;         // Recentrer les ordres a chaque bougie
input double            InpMaxSpreadPips = 40.0;           // Spread max autorise (pips)
input bool              InpUseTimeFilter = true;           // Filtre horaire
input int               InpStartHour     = 7;              // Heure debut (serveur)
input int               InpEndHour       = 20;             // Heure fin (serveur)

//+------------------------------------------------------------------+
//| Globaux                                                          |
//+------------------------------------------------------------------+
CTrade         trade;
CPositionInfo  position;
CSymbolInfo    sym;

double   g_point;
double   g_pip;
int      g_digits;
datetime g_lastBarTime = 0;

//+------------------------------------------------------------------+
int OnInit()
  {
   if(!sym.Name(_Symbol))
     {
      Print("Erreur init symbole ", _Symbol);
      return(INIT_FAILED);
     }

   g_digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   g_point  = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   g_pip    = (g_digits == 3 || g_digits == 5) ? g_point * 10.0 : g_point;

   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(20);
   trade.SetTypeFillingBySymbol(_Symbol);
   trade.SetMarginMode();

   PrintFormat("StraddleEA initialise sur %s | pip=%.5f mode=%s",
               _Symbol, g_pip, (InpMode==MODE_REVERSION?"REVERSION":"BREAKOUT"));
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   int posCount     = CountMyPositions();
   int pendingCount = CountMyPending();

   // OCO : une position ouverte -> on supprime les ordres en attente restants
   if(posCount > 0 && pendingCount > 0)
     {
      DeleteMyPending();
      return;
     }

   // Detection de nouvelle bougie
   datetime curBar = (datetime)SeriesInfoInteger(_Symbol, PERIOD_CURRENT, SERIES_LASTBAR_DATE);
   bool isNewBar = (curBar != g_lastBarTime);
   if(isNewBar)
      g_lastBarTime = curBar;

   // Rien a faire si une position est deja ouverte
   if(posCount > 0)
      return;

   // Filtres
   if(!IsTradingTime()) return;
   if(!IsSpreadOK())    return;

   if(pendingCount == 0)
     {
      // Aucun ordre : on pose le straddle
      PlaceStraddle();
     }
   else if(InpRecenterEachBar && isNewBar)
     {
      // Recentrage a chaque nouvelle bougie
      DeleteMyPending();
      PlaceStraddle();
     }
  }

//+------------------------------------------------------------------+
//| Pose les deux ordres en attente autour du prix                   |
//+------------------------------------------------------------------+
void PlaceStraddle()
  {
   sym.RefreshRates();
   double mid = (sym.Ask() + sym.Bid()) / 2.0;

   double d  = InpEntryDistPips * g_pip;
   double sl = InpSL_Pips * g_pip;
   double tp = InpTP_Pips * g_pip;

   double upper = NormalizeDouble(mid + d, g_digits);   // ligne "sell" (haut)
   double lower = NormalizeDouble(mid - d, g_digits);   // ligne "buy"  (bas)

   double lot = CalculateLot(sl);
   if(lot <= 0.0)
     {
      Print("Lot invalide, straddle annule");
      return;
     }

   // Respect de la distance minimale du broker
   double minStop = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * g_point;

   if(InpMode == MODE_REVERSION)
     {
      // Sell Limit en haut : SL au-dessus, TP = ligne opposee (bas)
      double slUp = NormalizeDouble(upper + sl, g_digits);
      double tpUp = lower;
      if(!trade.SellLimit(lot, upper, _Symbol, slUp, tpUp, ORDER_TIME_GTC, 0, InpComment))
         PrintFormat("Echec Sell Limit @ %.2f code=%d", upper, trade.ResultRetcode());

      // Buy Limit en bas : SL en-dessous, TP = ligne opposee (haut)
      double slDn = NormalizeDouble(lower - sl, g_digits);
      double tpDn = upper;
      if(!trade.BuyLimit(lot, lower, _Symbol, slDn, tpDn, ORDER_TIME_GTC, 0, InpComment))
         PrintFormat("Echec Buy Limit @ %.2f code=%d", lower, trade.ResultRetcode());
     }
   else // MODE_BREAKOUT
     {
      // Buy Stop en haut : SL en-dessous, TP dans le sens de la cassure
      double slUp = NormalizeDouble(upper - sl, g_digits);
      double tpUp = NormalizeDouble(upper + tp, g_digits);
      if(!trade.BuyStop(lot, upper, _Symbol, slUp, tpUp, ORDER_TIME_GTC, 0, InpComment))
         PrintFormat("Echec Buy Stop @ %.2f code=%d", upper, trade.ResultRetcode());

      // Sell Stop en bas : SL au-dessus, TP dans le sens de la cassure
      double slDn = NormalizeDouble(lower + sl, g_digits);
      double tpDn = NormalizeDouble(lower - tp, g_digits);
      if(!trade.SellStop(lot, lower, _Symbol, slDn, tpDn, ORDER_TIME_GTC, 0, InpComment))
         PrintFormat("Echec Sell Stop @ %.2f code=%d", lower, trade.ResultRetcode());
     }
  }

//+------------------------------------------------------------------+
//| Calcul du lot                                                    |
//+------------------------------------------------------------------+
double CalculateLot(double slDistance)
  {
   double minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);

   double lot;
   if(!InpUseRisk)
     {
      lot = InpFixedLot;
     }
   else
     {
      double balance   = AccountInfoDouble(ACCOUNT_BALANCE);
      double riskMoney = balance * InpRiskPercent / 100.0;
      double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
      double tickSize  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
      if(tickSize <= 0.0 || tickValue <= 0.0 || slDistance <= 0.0)
         return NormalizeLot(InpFixedLot, minLot, maxLot, lotStep);
      double lossPerLot = (slDistance / tickSize) * tickValue;
      if(lossPerLot <= 0.0)
         return NormalizeLot(InpFixedLot, minLot, maxLot, lotStep);
      lot = riskMoney / lossPerLot;
     }
   if(lot > InpMaxLot) lot = InpMaxLot;
   return NormalizeLot(lot, minLot, maxLot, lotStep);
  }

double NormalizeLot(double lot, double minLot, double maxLot, double lotStep)
  {
   if(lotStep > 0.0)
      lot = MathFloor(lot / lotStep) * lotStep;
   if(lot < minLot) lot = minLot;
   if(lot > maxLot) lot = maxLot;
   return NormalizeDouble(lot, 2);
  }

//+------------------------------------------------------------------+
//| Comptage / suppression des ordres de cet EA                      |
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

int CountMyPending()
  {
   int count = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      if(OrderGetString(ORDER_SYMBOL) == _Symbol &&
         OrderGetInteger(ORDER_MAGIC) == InpMagicNumber)
         count++;
     }
   return count;
  }

void DeleteMyPending()
  {
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      if(OrderGetString(ORDER_SYMBOL) == _Symbol &&
         OrderGetInteger(ORDER_MAGIC) == InpMagicNumber)
        {
         if(!trade.OrderDelete(ticket))
            PrintFormat("Echec suppression ordre #%I64u code=%d", ticket, trade.ResultRetcode());
        }
     }
  }

//+------------------------------------------------------------------+
//| Filtres                                                          |
//+------------------------------------------------------------------+
bool IsTradingTime()
  {
   if(!InpUseTimeFilter) return true;
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   int h = dt.hour;
   if(InpStartHour <= InpEndHour)
      return (h >= InpStartHour && h < InpEndHour);
   return (h >= InpStartHour || h < InpEndHour);
  }

bool IsSpreadOK()
  {
   double spread = (SymbolInfoDouble(_Symbol, SYMBOL_ASK) -
                    SymbolInfoDouble(_Symbol, SYMBOL_BID)) / g_pip;
   return (spread <= InpMaxSpreadPips);
  }
//+------------------------------------------------------------------+
