/**
 * Research Insights Dashboard Component
 * Displays institutional-grade signals with 10-second readability
 */

class ResearchInsightsDashboard {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.signals = [];
        this.selectedSignalType = 'DIRECTIONAL_ALPHA';
        this.marketRegime = null;
    }

    /**
     * Render Main Dashboard
     */
    render() {
        if (!this.container) return;

        this.container.innerHTML = `
            <div class="insights-dashboard">
                <!-- Market Regime Indicator -->
                <div class="regime-banner" id="regimeBanner">
                    ${this.renderRegimeBanner()}
                </div>

                <!-- Signal Type Selector -->
                <div class="signal-type-selector">
                    ${this.renderSignalTypeSelector()}
                </div>

                <!-- Signals Grid -->
                <div class="signals-grid" id="signalsGrid">
                    ${this.renderSignalsGrid()}
                </div>
            </div>
        `;

        this.attachEventListeners();
    }

    /**
     * Render Market Regime Banner
     */
    renderRegimeBanner() {
        if (!this.marketRegime) {
            return `<div class="regime-loading">Detecting market regime...</div>`;
        }

        const regimeColors = {
            'RISK_ON': { bg: 'rgba(34, 197, 94, 0.1)', border: '#22c55e', text: '#22c55e' },
            'RISK_OFF': { bg: 'rgba(239, 68, 68, 0.1)', border: '#ef4444', text: '#ef4444' },
            'COMPRESSION': { bg: 'rgba(251, 191, 36, 0.1)', border: '#fbbf24', text: '#fbbf24' },
            'TRANSITION': { bg: 'rgba(139, 92, 246, 0.1)', border: '#8b5cf6', text: '#8b5cf6' }
        };

        const colors = regimeColors[this.marketRegime.state] || regimeColors['RISK_ON'];

        return `
            <div class="regime-content" style="background: ${colors.bg}; border-color: ${colors.border};">
                <div class="regime-left">
                    <div class="regime-indicator" style="background: ${colors.text};"></div>
                    <div class="regime-info">
                        <div class="regime-label">Market Regime</div>
                        <div class="regime-state" style="color: ${colors.text};">
                            ${this.marketRegime.state.replace('_', '-')}
                        </div>
                    </div>
                </div>
                <div class="regime-right">
                    <div class="regime-confidence">
                        Confidence: ${(this.marketRegime.confidence * 100).toFixed(0)}%
                    </div>
                    <div class="regime-impact">
                        ${this.marketRegime.impact}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render Signal Type Selector
     */
    renderSignalTypeSelector() {
        const types = [
            { id: 'DIRECTIONAL_ALPHA', label: 'Directional Alpha', icon: '📈' },
            { id: 'LEVERAGE_STRESS', label: 'Leverage Stress', icon: '⚡' },
            { id: 'LIQUIDITY_STRESS', label: 'Liquidity Health', icon: '💧' },
            { id: 'YIELD_SUSTAINABILITY', label: 'Yield Quality', icon: '🌾' }
        ];

        return types.map(type => `
            <button 
                class="signal-type-btn ${this.selectedSignalType === type.id ? 'active' : ''}" 
                data-type="${type.id}"
            >
                <span class="type-icon">${type.icon}</span>
                <span class="type-label">${type.label}</span>
            </button>
        `).join('');
    }

    /**
     * Render Signals Grid
     */
    renderSignalsGrid() {
        if (this.signals.length === 0) {
            return `
                <div class="no-signals">
                    <div class="no-signals-icon">🔍</div>
                    <div class="no-signals-text">No signals available</div>
                    <button class="scan-btn" onclick="researchDashboard.scanMarkets()">
                        Scan Markets
                    </button>
                </div>
            `;
        }

        return this.signals
            .map(signal => this.renderSignalCard(signal))
            .join('');
    }

    /**
     * Render Individual Signal Card
     * This is the 10-second actionable format
     */
    renderSignalCard(signal) {
        const confidenceColor = this.getConfidenceColor(signal.confidenceLevel);
        const signalColor = this.getSignalColor(signal.signal);

        return `
            <div class="insight-card" data-asset="${signal.asset}">
                <!-- Card Header -->
                <div class="insight-header">
                    <div class="insight-asset">
                        <div class="asset-symbol">${signal.asset}</div>
                        <div class="asset-time">${signal.timeHorizon}</div>
                    </div>
                    <div class="insight-confidence" style="background: ${confidenceColor}20; color: ${confidenceColor}; border-color: ${confidenceColor}40;">
                        <div class="confidence-score">${(signal.confidence * 100).toFixed(0)}%</div>
                        <div class="confidence-label">${signal.confidenceLevel}</div>
                    </div>
                </div>

                <!-- Signal Action -->
                <div class="insight-signal" style="background: ${signalColor}15; border-left: 3px solid ${signalColor};">
                    <div class="signal-action" style="color: ${signalColor};">
                        ${signal.signal}
                    </div>
                    ${signal.suppressed ? `
                        <div class="signal-suppression">
                            ⚠️ ${signal.suppressionReason}
                        </div>
                    ` : ''}
                </div>

                <!-- Drivers Section -->
                <div class="insight-section">
                    <div class="section-title">
                        <span class="section-icon">✅</span>
                        Drivers
                    </div>
                    <div class="section-content">
                        ${this.renderDrivers(signal.drivers)}
                    </div>
                </div>

                <!-- Risks Section -->
                <div class="insight-section">
                    <div class="section-title">
                        <span class="section-icon">⚠️</span>
                        Risks
                    </div>
                    <div class="section-content">
                        ${this.renderRisks(signal.risks)}
                    </div>
                </div>

                <!-- Invalidation Criteria -->
                <div class="insight-invalidation">
                    <div class="invalidation-title">Invalidation:</div>
                    <div class="invalidation-list">
                        ${signal.invalidation.map(criterion => 
                            `<div class="invalidation-item">• ${criterion}</div>`
                        ).join('')}
                    </div>
                </div>

                <!-- Composite Scores -->
                <div class="insight-scores">
                    ${this.renderCompositeScores(signal.details.compositeScores)}
                </div>

                <!-- Expand Button -->
                <button class="expand-btn" onclick="researchDashboard.expandSignal('${signal.asset}')">
                    View Details →
                </button>
            </div>
        `;
    }

    /**
     * Render Drivers List
     */
    renderDrivers(drivers) {
        if (!drivers || drivers.length === 0) {
            return `<div class="no-items">No strong drivers detected</div>`;
        }

        return drivers.map(driver => {
            const isWarning = driver.startsWith('⚠️');
            return `
                <div class="driver-item ${isWarning ? 'warning' : ''}">
                    <span class="bullet">•</span>
                    <span class="text">${driver}</span>
                </div>
            `;
        }).join('');
    }

    /**
     * Render Risks List
     */
    renderRisks(risks) {
        if (!risks || risks.length === 0) {
            return `<div class="no-items">No major risks detected</div>`;
        }

        return risks.map(risk => `
            <div class="risk-item">
                <span class="bullet">•</span>
                <span class="text">${risk}</span>
            </div>
        `).join('');
    }

    /**
     * Render Composite Scores
     */
    renderCompositeScores(scores) {
        if (!scores) return '';

        return `
            <div class="scores-grid">
                ${scores.leverageStress ? `
                    <div class="score-pill">
                        <span class="score-label">Leverage:</span>
                        <span class="score-value ${this.getStressClass(scores.leverageStress)}">
                            ${scores.leverageStress}
                        </span>
                    </div>
                ` : ''}
                ${scores.liquidityHealth ? `
                    <div class="score-pill">
                        <span class="score-label">Liquidity:</span>
                        <span class="score-value ${this.getHealthClass(scores.liquidityHealth)}">
                            ${scores.liquidityHealth}
                        </span>
                    </div>
                ` : ''}
                ${scores.yieldQuality ? `
                    <div class="score-pill">
                        <span class="score-label">Yield:</span>
                        <span class="score-value ${this.getQualityClass(scores.yieldQuality)}">
                            ${scores.yieldQuality}
                        </span>
                    </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * Update Signals
     */
    updateSignals(signals, regime) {
        this.signals = signals;
        this.marketRegime = regime;
        this.render();
    }

    /**
     * Event Listeners
     */
    attachEventListeners() {
        // Signal type selector
        document.querySelectorAll('.signal-type-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.selectedSignalType = e.currentTarget.dataset.type;
                this.loadSignalsForType(this.selectedSignalType);
            });
        });
    }

    /**
     * Load Signals for Selected Type
     */
    async loadSignalsForType(signalType) {
        try {
            const response = await fetch(`/api/research/signals?type=${signalType}`);
            const data = await response.json();
            
            this.updateSignals(data.signals, data.regime);
        } catch (error) {
            console.error('Error loading signals:', error);
        }
    }

    /**
     * Scan Markets
     */
    async scanMarkets() {
        try {
            // Show loading state
            document.getElementById('signalsGrid').innerHTML = `
                <div class="scanning-state">
                    <div class="scan-spinner"></div>
                    <div class="scan-text">Scanning markets...</div>
                </div>
            `;

            const response = await fetch('/api/research/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ signalType: this.selectedSignalType })
            });

            const data = await response.json();
            this.updateSignals(data.signals, data.regime);

        } catch (error) {
            console.error('Error scanning markets:', error);
        }
    }

    /**
     * Expand Signal Details
     */
    expandSignal(asset) {
        // Open modal with full signal details
        console.log('Expand signal for:', asset);
        // Implementation would show modal with all technical details
    }

    /**
     * Helper: Get Confidence Color
     */
    getConfidenceColor(level) {
        const colors = {
            'HIGH': '#22c55e',
            'MEDIUM': '#fbbf24',
            'LOW': '#ef4444'
        };
        return colors[level] || '#64748b';
    }

    /**
     * Helper: Get Signal Color
     */
    getSignalColor(signal) {
        if (signal.includes('LONG')) return '#22c55e';
        if (signal.includes('SHORT')) return '#ef4444';
        if (signal.includes('MONITOR')) return '#fbbf24';
        return '#64748b';
    }

    /**
     * Helper: Get Stress Class
     */
    getStressClass(level) {
        const classes = {
            'EXTREME': 'stress-extreme',
            'HIGH': 'stress-high',
            'ELEVATED': 'stress-elevated',
            'NORMAL': 'stress-normal',
            'LOW': 'stress-low'
        };
        return classes[level] || 'stress-normal';
    }

    /**
     * Helper: Get Health Class
     */
    getHealthClass(level) {
        const classes = {
            'EXCELLENT': 'health-excellent',
            'GOOD': 'health-good',
            'ADEQUATE': 'health-adequate',
            'WEAK': 'health-weak',
            'STRESSED': 'health-stressed'
        };
        return classes[level] || 'health-adequate';
    }

    /**
     * Helper: Get Quality Class
     */
    getQualityClass(level) {
        const classes = {
            'SUSTAINABLE': 'quality-sustainable',
            'MODERATE': 'quality-moderate',
            'FRAGILE': 'quality-fragile',
            'UNSUSTAINABLE': 'quality-unsustainable'
        };
        return classes[level] || 'quality-moderate';
    }
}

// Global instance
let researchDashboard;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    researchDashboard = new ResearchInsightsDashboard('insightsDashboard');
    researchDashboard.render();
    researchDashboard.loadSignalsForType('DIRECTIONAL_ALPHA');
});
