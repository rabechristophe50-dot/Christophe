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

input group    "=== Filtre de tendance ==="
input bool     InpTrendFilter    = true;         // Suivre la tendance (EMA) : achat en hausse, vente en baisse
input int      InpTrendFastEMA   = 20;           // EMA rapide (detection de tendance)
input int      InpTrendSlowEMA   = 50;           // EMA lente (detection de tendance)
input bool     InpCloseOnFlip    = true;         // Fermer le cote a contre-tendance quand la tendance s'inverse

input group    "=== Mode HEDGE (deux sens en meme temps) ==="
input bool     InpDualMarket     = true;         // Ouvrir Buy ET Sell au marche en continu (compte hedging)
input int      InpDualPerSide    = 1;            // Positions a maintenir par sens (buy et sell)

input group    "=== Comportement ==="
input bool     InpContinuous     = true;         // MODE CONTINU : la grille suit le prix en temps reel
input double   InpRecenterMovePips = 15.0;       // Re-centrer quand le prix a bouge de X pips
input int      InpMaxOpenPositions = 20;         // Securite : positions ouvertes max (0 = illimite)
input bool     InpRebuildFlat    = true;         // (mode classique) reconstruire quand a plat
input bool     InpRebuildEachBar = false;        // (mode classique) reconstruire a chaque bougie
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
double   g_gridCenter = 0.0;   // prix central de la grille en cours
int      g_hFastEMA = INVALID_HANDLE;
int      g_hSlowEMA = INVALID_HANDLE;

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

   if(InpTrendFilter)
     {
      g_hFastEMA = iMA(_Symbol, PERIOD_CURRENT, InpTrendFastEMA, 0, MODE_EMA, PRICE_CLOSE);
      g_hSlowEMA = iMA(_Symbol, PERIOD_CURRENT, InpTrendSlowEMA, 0, MODE_EMA, PRICE_CLOSE);
      if(g_hFastEMA == INVALID_HANDLE || g_hSlowEMA == INVALID_HANDLE)
        {
         Print("Erreur creation des EMA de tendance");
         return(INIT_FAILED);
        }
     }

   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(20);
   trade.SetTypeFillingBySymbol(_Symbol);
   trade.SetMarginMode();

   PrintFormat("GridEA initialise sur %s | pip=%.5f | %d niveaux, pas=%.0f pips | tendance=%s",
               _Symbol, g_pip, InpLevels, InpGridStepPips, (InpTrendFilter?"ON":"OFF"));
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   if(g_hFastEMA != INVALID_HANDLE) IndicatorRelease(g_hFastEMA);
   if(g_hSlowEMA != INVALID_HANDLE) IndicatorRelease(g_hSlowEMA);
  }

//+------------------------------------------------------------------+
//| Direction de la tendance : +1 hausse, -1 baisse, 0 neutre/off    |
//+------------------------------------------------------------------+
int TrendDirection()
  {
   if(!InpTrendFilter)
      return 0;
   double f[2], s[2];
   if(CopyBuffer(g_hFastEMA, 0, 0, 2, f) < 2) return 0;
   if(CopyBuffer(g_hSlowEMA, 0, 0, 2, s) < 2) return 0;
   if(f[1] > s[1]) return 1;    // EMA rapide au-dessus -> hausse
   if(f[1] < s[1]) return -1;   // EMA rapide en-dessous -> baisse
   return 0;
  }

//+------------------------------------------------------------------+
//| Ferme toutes les positions d'un type donne                       |
//+------------------------------------------------------------------+
void CloseByType(ENUM_POSITION_TYPE ptype)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!position.SelectByTicket(ticket)) continue;
      if(position.Symbol() == _Symbol && position.Magic() == InpMagicNumber &&
         position.PositionType() == ptype)
         trade.PositionClose(ticket);
     }
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

   // Securite : plafond de positions ouvertes
   if(InpMaxOpenPositions > 0 && posCount >= InpMaxOpenPositions)
      return;

   // === MODE HEDGE : Buy ET Sell au marche en continu ===
   if(InpDualMarket)
     {
      ManageDualMarket();
      return;
     }

   if(InpContinuous)
     {
      // === MODE CONTINU : la grille suit le prix en temps reel ===
      if(pendingCount == 0)
        {
         // Plus aucun ordre en attente -> on repose la grille immediatement
         BuildGrid();
        }
      else
        {
         // Re-centrer la grille des que le prix a suffisamment bouge
         sym.RefreshRates();
         double mid = (sym.Ask() + sym.Bid()) / 2.0;
         double driftPips = MathAbs(mid - g_gridCenter) / g_pip;
         if(driftPips >= InpRecenterMovePips)
           {
            DeleteMyPending();
            BuildGrid();
           }
        }
      return;
     }

   // === MODE CLASSIQUE : reconstruction seulement quand a plat ===
   bool flat = (posCount == 0);
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
//| Mode HEDGE : maintient InpDualPerSide positions Buy et Sell       |
//+------------------------------------------------------------------+
void ManageDualMarket()
  {
   int buys  = CountMyPositionsByType(POSITION_TYPE_BUY);
   int sells = CountMyPositionsByType(POSITION_TYPE_SELL);

   int target = (InpDualPerSide < 1) ? 1 : InpDualPerSide;

   int dir = TrendDirection();                 // +1 hausse, -1 baisse, 0 neutre/off
   bool trendActive = (InpTrendFilter && dir != 0);
   bool allowBuy  = (!trendActive || dir == 1);
   bool allowSell = (!trendActive || dir == -1);

   // Fermer le cote a contre-tendance quand la tendance s'inverse
   if(trendActive && InpCloseOnFlip)
     {
      if(dir == 1  && sells > 0) { CloseByType(POSITION_TYPE_SELL); sells = 0; }
      if(dir == -1 && buys  > 0) { CloseByType(POSITION_TYPE_BUY);  buys  = 0; }
     }

   if(allowBuy  && buys  < target)
      OpenMarket(true);
   if(allowSell && sells < target)
      OpenMarket(false);
  }

//+------------------------------------------------------------------+
//| Ouvre une position au marche (buy ou sell) avec TP/SL            |
//+------------------------------------------------------------------+
void OpenMarket(bool isBuy)
  {
   sym.RefreshRates();
   double price = isBuy ? sym.Ask() : sym.Bid();
   double slp = InpSL_Pips * g_pip;
   double tpp = InpTP_Pips * g_pip;

   double sl = 0.0, tp = 0.0;
   if(isBuy)
     {
      if(InpSL_Pips > 0) sl = NormalizeDouble(price - slp, g_digits);
      if(InpTP_Pips > 0) tp = NormalizeDouble(price + tpp, g_digits);
      if(!trade.Buy(InpLotPerOrder, _Symbol, price, sl, tp, InpComment))
         PrintFormat("Echec BUY marche @ %.2f code=%d", price, trade.ResultRetcode());
     }
   else
     {
      if(InpSL_Pips > 0) sl = NormalizeDouble(price + slp, g_digits);
      if(InpTP_Pips > 0) tp = NormalizeDouble(price - tpp, g_digits);
      if(!trade.Sell(InpLotPerOrder, _Symbol, price, sl, tp, InpComment))
         PrintFormat("Echec SELL marche @ %.2f code=%d", price, trade.ResultRetcode());
     }
  }

//+------------------------------------------------------------------+
//| Compte les positions de cet EA d'un type donne                   |
//+------------------------------------------------------------------+
int CountMyPositionsByType(ENUM_POSITION_TYPE ptype)
  {
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!position.SelectByTicket(ticket)) continue;
      if(position.Symbol() == _Symbol && position.Magic() == InpMagicNumber &&
         position.PositionType() == ptype)
         count++;
     }
   return count;
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

   int dir = TrendDirection();                 // +1 hausse, -1 baisse, 0 neutre/off
   bool trendActive = (InpTrendFilter && dir != 0);
   bool allowBuy  = (!trendActive || dir == 1);
   bool allowSell = (!trendActive || dir == -1);

   for(int i = 0; i < InpLevels; i++)
     {
      // BUY STOP au-dessus (seulement si tendance haussiere ou pas de filtre)
      if(allowBuy)
        {
         double buyPrice = NormalizeDouble(ask + first + i * step, g_digits);
         double buyTP = (InpTP_Pips > 0) ? NormalizeDouble(buyPrice + tp, g_digits) : 0.0;
         double buySL = (InpSL_Pips > 0) ? NormalizeDouble(buyPrice - sl, g_digits) : 0.0;
         if(!trade.BuyStop(InpLotPerOrder, buyPrice, _Symbol, buySL, buyTP, ORDER_TIME_GTC, 0, InpComment))
            PrintFormat("Echec Buy Stop @ %.2f code=%d", buyPrice, trade.ResultRetcode());
        }

      // SELL STOP en-dessous (seulement si tendance baissiere ou pas de filtre)
      if(allowSell)
        {
         double sellPrice = NormalizeDouble(bid - first - i * step, g_digits);
         double sellTP = (InpTP_Pips > 0) ? NormalizeDouble(sellPrice - tp, g_digits) : 0.0;
         double sellSL = (InpSL_Pips > 0) ? NormalizeDouble(sellPrice + sl, g_digits) : 0.0;
         if(!trade.SellStop(InpLotPerOrder, sellPrice, _Symbol, sellSL, sellTP, ORDER_TIME_GTC, 0, InpComment))
            PrintFormat("Echec Sell Stop @ %.2f code=%d", sellPrice, trade.ResultRetcode());
        }
     }
   g_gridCenter = (ask + bid) / 2.0;
   PrintFormat("Grille posee : %d Buy Stop + %d Sell Stop autour de %.2f",
               InpLevels, InpLevels, g_gridCenter);
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
