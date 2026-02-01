class OnChainSignals {
  normalize(value, min, max) {
    if (max === min) return 0;
    const normalized = (value - min) / (max - min);
    return Math.max(0, Math.min(1, normalized));
  }

  analyze(metrics = {}) {
    const activeAddresses = metrics.activeAddresses24h || 0;
    const activeAddressGrowth = metrics.activeAddressGrowth || 0;
    const txVolumeUsd = metrics.txVolumeUsd || 0;
    const whaleNetflow = metrics.whaleNetflow || 0;
    const exchangeNetflow = metrics.exchangeNetflow || 0;
    const dexVolume = metrics.dexVolumeUsd || 0;
    const dexVolumeChange = metrics.dexVolumeChange || 0;
    const stablecoinNetflow = metrics.stablecoinNetflowUsd || 0;
    const bridgeVolume = metrics.bridgeVolumeUsd || 0;
    const gasPriceGwei = metrics.gasPriceGwei || 0;
    const holderConcentration = metrics.top10HolderPct || 0;

    const whaleSignal = this.normalize(whaleNetflow, -1e8, 1e8);
    const exchangeSignal = this.normalize(exchangeNetflow, -1e8, 1e8);
    const activitySignal = this.normalize(activeAddressGrowth, -50, 50);
    const txSignal = this.normalize(txVolumeUsd, 0, 1e9);
    const dexSignal = this.normalize(dexVolumeChange, -50, 50);
    const stablecoinSignal = this.normalize(stablecoinNetflow, -5e8, 5e8);
    const bridgeSignal = this.normalize(bridgeVolume, 0, 5e8);
    const gasSignal = this.normalize(gasPriceGwei, 5, 200);
    const concentrationRisk = this.normalize(holderConcentration, 10, 80);

    const composite = (
      whaleSignal * 0.15 +
      exchangeSignal * 0.1 +
      activitySignal * 0.15 +
      txSignal * 0.1 +
      dexSignal * 0.15 +
      stablecoinSignal * 0.15 +
      bridgeSignal * 0.1 +
      gasSignal * 0.1
    );

    return {
      activeAddresses,
      activeAddressGrowth,
      txVolumeUsd,
      whaleNetflow,
      exchangeNetflow,
      dexVolume,
      dexVolumeChange,
      stablecoinNetflow,
      bridgeVolume,
      gasPriceGwei,
      holderConcentration,
      concentrationRisk,
      compositeScore: composite
    };
  }
}

module.exports = { OnChainSignals };
