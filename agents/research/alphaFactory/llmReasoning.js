/**
 * Prompt 18: LLM reasoning layer (fallback to heuristic synthesis)
 */

class LLMReasoningEngine {
  constructor(config = {}) {
    this.config = {
      llm: config.llm || null,
      maxDrivers: config.maxDrivers || 4,
      maxRisks: config.maxRisks || 3,
      ...config
    };
  }

  async synthesize({ hypothesis = {}, signals = {}, narratives = [], derivatives = {}, social = {}, onchain = {} } = {}) {
    if (this.config.llm && typeof this.config.llm.generate === 'function') {
      return this._llmSynthesis({ hypothesis, signals, narratives, derivatives, social, onchain });
    }

    return this._heuristicSynthesis({ hypothesis, signals, narratives, derivatives, social, onchain });
  }

  async _llmSynthesis(payload) {
    const prompt = this._buildPrompt(payload);
    try {
      const response = await this.config.llm.generate({ prompt });
      return response?.result || response || this._heuristicSynthesis(payload);
    } catch (error) {
      return this._heuristicSynthesis(payload);
    }
  }

  _heuristicSynthesis({ hypothesis, signals, narratives, derivatives, social, onchain }) {
    const drivers = [];
    const risks = [];

    const signalPairs = Object.entries(signals || {})
      .filter(([, value]) => typeof value === 'number')
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.config.maxDrivers);

    signalPairs.forEach(([label, value]) => {
      drivers.push(`${label} strength ${Math.round(value * 100)}%`);
    });

    if (derivatives?.fundingSkew && Math.abs(derivatives.fundingSkew) > 0.6) {
      risks.push('Funding skew elevated; watch crowding risk.');
    }

    if (social?.compositeScore && social.compositeScore < 0.4) {
      risks.push('Social momentum fading below 0.4.');
    }

    if (onchain?.compositeScore && onchain.compositeScore < 0.45) {
      risks.push('On-chain participation softening.');
    }

    if (risks.length < this.config.maxRisks) {
      risks.push(...(hypothesis?.invalidations || []).slice(0, this.config.maxRisks - risks.length));
    }

    const narrative = narratives?.[0]?.label || narratives?.[0]?.themeId || 'cross-narrative';

    return {
      summary: `${hypothesis.asset || hypothesis.market || 'Asset'} hypothesis leans ${hypothesis.bias || hypothesis.direction || 'neutral'} on ${narrative} momentum with ${drivers.length} supportive signals.`,
      key_drivers: drivers,
      key_risks: risks.slice(0, this.config.maxRisks),
      open_questions: [
        'Does liquidity remain supportive into the next catalyst?',
        'Is positioning crowded or still early?'
      ]
    };
  }

  _buildPrompt({ hypothesis, signals, narratives, derivatives, social, onchain }) {
    return [
      'You are an institutional crypto research analyst.',
      'Summarize the hypothesis, list key drivers, key risks, and open questions.',
      `Hypothesis: ${JSON.stringify(hypothesis)}`,
      `Signals: ${JSON.stringify(signals)}`,
      `Narratives: ${JSON.stringify(narratives)}`,
      `Derivatives: ${JSON.stringify(derivatives)}`,
      `Social: ${JSON.stringify(social)}`,
      `On-chain: ${JSON.stringify(onchain)}`
    ].join('\n');
  }
}

module.exports = { LLMReasoningEngine };
