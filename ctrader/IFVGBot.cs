// ════════════════════════════════════════════════════════════════════════
//  IFVGBot.cs — "Comment bien trader les IFVG ?"
//  cBot cTrader (cAlgo) · concept ICT Inverse Fair Value Gap
//  Réglé pour l'OR (XAUUSD) en 5 min et 15 min.
//
//  Détecte l'IFVG ET passe les ordres automatiquement.
//  Mêmes 4 règles que la version Pine :
//   1. Prise de liquidité (sweep) avant l'IFVG
//   2. 1 seul FVG -> IFVG (pas de cluster)
//   3. Inversion confirmée par la CLÔTURE du corps
//   4. Cible IRL -> ERL (liquidité externe = swing opposé)
//
//  Colle ce fichier dans un nouveau cBot cTrader, compile, lance sur XAUUSD 5m/15m.
// ════════════════════════════════════════════════════════════════════════
using System;
using cAlgo.API;
using cAlgo.API.Indicators;

namespace cAlgo.Robots
{
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.None)]
    public class IFVGBot : Robot
    {
        [Parameter("Longueur swings (liquidité)", DefaultValue = 8, MinValue = 2)]
        public int PivotLen { get; set; }

        [Parameter("Fenêtre max sweep->IFVG", DefaultValue = 18, MinValue = 3)]
        public int WindowBars { get; set; }

        [Parameter("Exiger 1 seul FVG", DefaultValue = true)]
        public bool RequireSingle { get; set; }

        [Parameter("Filtre taille FVG par ATR", DefaultValue = true)]
        public bool UseAtrFilter { get; set; }

        [Parameter("FVG min = x * ATR(14)", DefaultValue = 0.25, MinValue = 0)]
        public double MinFvgAtr { get; set; }

        [Parameter("Taille min FVG (points, si ATR off)", DefaultValue = 0.0)]
        public double MinFvgPts { get; set; }

        [Parameter("Cible = liquidité externe (swing)", DefaultValue = true)]
        public bool UseSwingTP { get; set; }

        [Parameter("R:R si pas de swing", DefaultValue = 2.0, MinValue = 0.5)]
        public double RRFallback { get; set; }

        [Parameter("Marge du stop au-delà IFVG (%)", DefaultValue = 0.05)]
        public double SlPadPct { get; set; }

        [Parameter("Signaux LONG", DefaultValue = true)]
        public bool AllowLongs { get; set; }

        [Parameter("Signaux SHORT", DefaultValue = true)]
        public bool AllowShorts { get; set; }

        [Parameter("Risque $ par trade", DefaultValue = 20.0, MinValue = 0)]
        public double RiskUsd { get; set; }

        [Parameter("Max positions simultanées", DefaultValue = 1, MinValue = 1)]
        public int MaxPositions { get; set; }

        private const string Label = "IFVG";
        private AverageTrueRange _atr;

        // État (persiste entre bougies)
        private double _lastSwingHigh; private bool _hasSwingHigh;
        private double _lastSwingLow;  private bool _hasSwingLow;

        private int _lState; private double _lFvgTop, _lFvgBot; private int _lExpiry; private double _lSweepLow;
        private int _sState; private double _sFvgTop, _sFvgBot; private int _sExpiry; private double _sSweepHigh;

        protected override void OnStart()
        {
            _atr = Indicators.AverageTrueRange(14, MovingAverageType.Exponential);
        }

        protected override void OnBar()
        {
            int need = 2 * PivotLen + 5;
            if (Bars.Count < need) return;

            int last = Bars.Count - 1;      // bougie en cours (vient d'ouvrir)
            int i = last - 1;               // dernière bougie CLÔTURÉE (= "shift 1")
            double atr = _atr.Result.Last(1);
            double minSize = UseAtrFilter ? MinFvgAtr * atr : MinFvgPts;

            // 1. Confirmation d'un pivot à (i - PivotLen) -----------------
            int pc = i - PivotLen;
            double pcHigh = Bars.HighPrices[pc];
            double pcLow  = Bars.LowPrices[pc];
            bool isHigh = true, isLow = true;
            for (int k = i - 2 * PivotLen; k <= i; k++)
            {
                if (k == pc || k < 0) continue;
                if (Bars.HighPrices[k] >= pcHigh) isHigh = false;
                if (Bars.LowPrices[k]  <= pcLow)  isLow  = false;
            }
            if (isHigh) { _lastSwingHigh = pcHigh; _hasSwingHigh = true; }
            if (isLow)  { _lastSwingLow  = pcLow;  _hasSwingLow  = true; }

            // Bougie d'évaluation = i (dernière clôturée)
            double o1 = Bars.OpenPrices[i], h1 = Bars.HighPrices[i], l1 = Bars.LowPrices[i], c1 = Bars.ClosePrices[i];
            double h3 = Bars.HighPrices[i - 2], l3 = Bars.LowPrices[i - 2];

            bool sellsideSweep = _hasSwingLow  && l1 < _lastSwingLow  && c1 > _lastSwingLow;
            bool buysideSweep  = _hasSwingHigh && h1 > _lastSwingHigh && c1 < _lastSwingHigh;

            bool bearFVG = h1 < l3; double bearTop = l3, bearBot = h1;
            bool bullFVG = l1 > h3; double bullTop = l1, bullBot = h3;
            bool bearOk = bearFVG && (minSize <= 0 || (bearTop - bearBot) >= minSize);
            bool bullOk = bullFVG && (minSize <= 0 || (bullTop - bullBot) >= minSize);

            // ============ LONG ============
            if (sellsideSweep && AllowLongs && _lState == 0)
            { _lState = 1; _lExpiry = i + WindowBars; _lFvgTop = 0; _lFvgBot = 0; _lSweepLow = l1; }
            if (_lState >= 1 && i > _lExpiry) _lState = 0;
            if (_lState == 1 && bearOk) { _lFvgTop = bearTop; _lFvgBot = bearBot; _lState = 2; }
            else if (_lState == 2 && bearOk)
            { if (RequireSingle) _lState = 0; else { _lFvgTop = bearTop; _lFvgBot = bearBot; } }

            bool longSignal = _lState == 2 && c1 > _lFvgTop && c1 > o1;
            if (longSignal)
            {
                double entry = c1;
                double sl = Math.Min(_lFvgBot, _lSweepLow) * (1.0 - SlPadPct / 100.0);
                double risk = entry - sl;
                double tp = (UseSwingTP && _hasSwingHigh && _lastSwingHigh > entry) ? _lastSwingHigh : entry + risk * RRFallback;
                if (risk > 0 && CountPositions() < MaxPositions)
                    Enter(TradeType.Buy, risk, sl, tp);
                _lState = 0;
            }

            // ============ SHORT ============
            if (buysideSweep && AllowShorts && _sState == 0)
            { _sState = 1; _sExpiry = i + WindowBars; _sFvgTop = 0; _sFvgBot = 0; _sSweepHigh = h1; }
            if (_sState >= 1 && i > _sExpiry) _sState = 0;
            if (_sState == 1 && bullOk) { _sFvgTop = bullTop; _sFvgBot = bullBot; _sState = 2; }
            else if (_sState == 2 && bullOk)
            { if (RequireSingle) _sState = 0; else { _sFvgTop = bullTop; _sFvgBot = bullBot; } }

            bool shortSignal = _sState == 2 && c1 < _sFvgBot && c1 < o1;
            if (shortSignal)
            {
                double entry = c1;
                double sl = Math.Max(_sFvgTop, _sSweepHigh) * (1.0 + SlPadPct / 100.0);
                double risk = sl - entry;
                double tp = (UseSwingTP && _hasSwingLow && _lastSwingLow < entry) ? _lastSwingLow : entry - risk * RRFallback;
                if (risk > 0 && CountPositions() < MaxPositions)
                    Enter(TradeType.Sell, risk, sl, tp);
                _sState = 0;
            }
        }

        private int CountPositions()
        {
            int n = 0;
            foreach (var p in Positions)
                if (p.Label == Label && p.SymbolName == SymbolName) n++;
            return n;
        }

        // Ouvre une position dimensionnée sur le risque, SL/TP en pips (distance)
        private void Enter(TradeType side, double riskDistance, double sl, double tp)
        {
            double slPips = riskDistance / Symbol.PipSize;
            double tpDist = Math.Abs(tp - (side == TradeType.Buy ? Symbol.Ask : Symbol.Bid));
            double tpPips = tpDist / Symbol.PipSize;

            // Volume à partir du risque $ : riskUsd / (slPips * valeur d'un pip par unité)
            double pipValuePerUnit = Symbol.PipValue; // en devise du compte, pour 1 unité
            if (pipValuePerUnit <= 0 || slPips <= 0) return;
            double units = RiskUsd / (slPips * pipValuePerUnit);
            double volume = Symbol.NormalizeVolumeInUnits(units, RoundingMode.Down);
            if (volume < Symbol.VolumeInUnitsMin) return;

            ExecuteMarketOrder(side, SymbolName, volume, Label, slPips, tpPips);
        }
    }
}
