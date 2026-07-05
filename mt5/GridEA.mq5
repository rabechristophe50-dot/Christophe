//+------------------------------------------------------------------+
//|                                                       GridEA.mq5   |
//|     Grille de cassure (ladder) facon "GTS EA Gold Strategy".      |
//|                                                                  |
//|  Pose une echelle de N BUY STOP au-dessus du prix et N SELL STOP  |
//|  en-dessous, espaces d'un pas fixe, chacun 0.01 lot avec TP/SL.    |
//|  Quand le prix casse, les ordres se declenchent en cascade dans   |
//|  le sens du mouvement. La grille est reconstruite quand le compte  |
//|  est a plat (aucune position ouverte).                            |
//|                                                                  |
//|  1 pip = 0.01 $ sur l'or (XAUUSD).                               |
//|                                                                  |
//|  ⚠️ STRATEGIE A HAUT RISQUE : en marche sans direction (range),   |
//|  les BUY STOP et SELL STOP se declenchent a tour de role et       |
//|  cumulent les petites pertes. A tester serieusement en demo.      |
//+------------------------------------------------------------------+
#property copyright "PureGridEA"
#property version   "1.00"
#property strict
#property description "Grille de cassure (buy stop / sell stop empiles) facon GTS Gold Strategy. XAUUSD M1.";

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\SymbolInfo.mqh>

//+------------------------------------------------------------------+
//| Parametres                                                       |
//+------------------------------------------------------------------+
input group    "=== Identification ==="
input long     InpMagicNumber   = 20260706;      // Magic Number
input string   InpComment       = "PureGrid";    // Commentaire des ordres

input group    "=== Grille ==="
input int      InpLevels        = 5;             // Nombre d'ordres de chaque cote
input double   InpFirstStepPips  = 30.0;         // Distance du prix au 1er ordre (pips)
input double   InpGridStepPips   = 30.0;         // Ecart entre 2 ordres (pips)
input double   InpLotPerOrder    = 0.01;         // Lot par ordre
input double   InpTP_Pips        = 50.0;         // Take Profit par ordre (pips, 0 = aucun)
input double   InpSL_Pips        = 100.0;        // Stop Loss par ordre (pips, 0 = aucun)

input group    "=== Protection globale ==="
input bool     InpUseEquityStop = true;          // Fermer tout si perte flottante trop grande
input double   InpMaxLossMoney   = 50.0;         // Perte flottante max (devise du compte)
input double   InpTakeAllProfit  = 0.0;          // Fermer tout si profit flottant atteint (0 = off)

input group    "=== Comportement ==="
input bool     InpRebuildFlat    = true;         // Reconstruire la grille quand a plat
input bool     InpRebuildEachBar = false;        // Reconstruire aussi a chaque bougie (si a plat)
input double   InpMaxSpreadPips  = 40.0;         // Spread max autorise (pips)
input bool     InpUseTimeFilter  = true;         // Filtre horaire
input int      InpStartHour      = 7;            // Heure debut (serveur)
input int      InpEndHour        = 20;           // Heure fin (serveur)

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

   if(InpLevels < 1)
     {
      Print("InpLevels doit etre >= 1");
      return(INIT_FAILED);
     }

   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(20);
   trade.SetTypeFillingBySymbol(_Symbol);
   trade.SetMarginMode();

   PrintFormat("GridEA initialise sur %s | pip=%.5f | %d niveaux, pas=%.0f pips",
               _Symbol, g_pip, InpLevels, InpGridStepPips);
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   // Protection globale sur le P&L flottant
   if(ManageGlobalRisk())
      return;

   int posCount     = CountMyPositions();
   int pendingCount = CountMyPending();

   // Nouvelle bougie
   datetime curBar = (datetime)SeriesInfoInteger(_Symbol, PERIOD_CURRENT, SERIES_LASTBAR_DATE);
   bool isNewBar = (curBar != g_lastBarTime);
   if(isNewBar)
      g_lastBarTime = curBar;

   // Filtres
   if(!IsTradingTime()) return;
   if(!IsSpreadOK())    return;

   bool flat = (posCount == 0);

   // Reconstruction de la grille quand le compte est a plat
   if(flat && InpRebuildFlat)
     {
      if(pendingCount == 0)
        {
         BuildGrid();
        }
      else if(InpRebuildEachBar && isNewBar)
        {
         DeleteMyPending();
         BuildGrid();
        }
     }
  }

//+------------------------------------------------------------------+
//| Construit l'echelle d'ordres stop                                |
//+------------------------------------------------------------------+
void BuildGrid()
  {
   sym.RefreshRates();
   double ask = sym.Ask();
   double bid = sym.Bid();

   double first = InpFirstStepPips * g_pip;
   double step  = InpGridStepPips * g_pip;
   double tp    = InpTP_Pips * g_pip;
   double sl    = InpSL_Pips * g_pip;

   for(int i = 0; i < InpLevels; i++)
     {
      // BUY STOP au-dessus
      double buyPrice = NormalizeDouble(ask + first + i * step, g_digits);
      double buyTP = (InpTP_Pips > 0) ? NormalizeDouble(buyPrice + tp, g_digits) : 0.0;
      double buySL = (InpSL_Pips > 0) ? NormalizeDouble(buyPrice - sl, g_digits) : 0.0;
      if(!trade.BuyStop(InpLotPerOrder, buyPrice, _Symbol, buySL, buyTP, ORDER_TIME_GTC, 0, InpComment))
         PrintFormat("Echec Buy Stop @ %.2f code=%d", buyPrice, trade.ResultRetcode());

      // SELL STOP en-dessous
      double sellPrice = NormalizeDouble(bid - first - i * step, g_digits);
      double sellTP = (InpTP_Pips > 0) ? NormalizeDouble(sellPrice - tp, g_digits) : 0.0;
      double sellSL = (InpSL_Pips > 0) ? NormalizeDouble(sellPrice + sl, g_digits) : 0.0;
      if(!trade.SellStop(InpLotPerOrder, sellPrice, _Symbol, sellSL, sellTP, ORDER_TIME_GTC, 0, InpComment))
         PrintFormat("Echec Sell Stop @ %.2f code=%d", sellPrice, trade.ResultRetcode());
     }
   PrintFormat("Grille posee : %d Buy Stop + %d Sell Stop autour de %.2f",
               InpLevels, InpLevels, (ask + bid) / 2.0);
  }

//+------------------------------------------------------------------+
//| Protection globale : coupe tout si perte/profit flottant atteint |
//+------------------------------------------------------------------+
bool ManageGlobalRisk()
  {
   double floating = MyFloatingPnL();
   bool triggered = false;

   if(InpUseEquityStop && floating <= -MathAbs(InpMaxLossMoney))
     {
      PrintFormat("STOP GLOBAL : perte flottante %.2f <= -%.2f -> fermeture de tout",
                  floating, MathAbs(InpMaxLossMoney));
      triggered = true;
     }
   if(InpTakeAllProfit > 0.0 && floating >= InpTakeAllProfit)
     {
      PrintFormat("OBJECTIF GLOBAL : profit flottant %.2f >= %.2f -> fermeture de tout",
                  floating, InpTakeAllProfit);
      triggered = true;
     }

   if(triggered)
     {
      CloseAllPositions();
      DeleteMyPending();
      return true;
     }
   return false;
  }

double MyFloatingPnL()
  {
   double total = 0.0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!position.SelectByTicket(ticket)) continue;
      if(position.Symbol() == _Symbol && position.Magic() == InpMagicNumber)
         total += position.Profit() + position.Swap() + position.Commission();
     }
   return total;
  }

void CloseAllPositions()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!position.SelectByTicket(ticket)) continue;
      if(position.Symbol() == _Symbol && position.Magic() == InpMagicNumber)
         trade.PositionClose(ticket);
     }
  }

//+------------------------------------------------------------------+
//| Comptage / suppression                                           |
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
