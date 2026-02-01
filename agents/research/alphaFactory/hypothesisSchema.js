function buildHypothesisSchema({
  asset,
  market,
  bias,
  strategy,
  timeHorizon,
  entryRange,
  target,
  stopLoss,
  signals,
  confidence,
  invalidations,
  expectedMove,
  positionSizing,
  related,
  provenance,
  summary,
  rationale
}) {
  return {
    hypothesis_id: `${asset}_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${Math.floor(Math.random()*1000)}`,
    timestamp: new Date().toISOString(),
    asset,
    market,
    bias,
    strategy,
    time_horizon: timeHorizon,
    entry_range: entryRange,
    target,
    stop_loss: stopLoss,
    signals: {
      social_momentum: signals?.social ?? 0,
      price_momentum: signals?.technical ?? 0,
      funding_rate: signals?.funding ?? 0,
      open_interest: signals?.oi ?? 0,
      narrative_fit: signals?.narrative ?? 0
    },
    confidence,
    invalidated_if: invalidations || [],
    expected_move: expectedMove,
    position_sizing: positionSizing,
    related_hypotheses: related || [],
    data_provenance: provenance || {},
    summary,
    rationale
  };
}

module.exports = { buildHypothesisSchema };
