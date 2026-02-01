/**
 * Prompt 20: End-to-end workflow orchestrator
 */

class WorkflowOrchestrator {
  constructor(config = {}) {
    this.config = {
      requireHumanReview: config.requireHumanReview || false,
      runAlerts: config.runAlerts !== false,
      publishIntegrations: config.publishIntegrations || false,
      ...config
    };
  }

  async run({ agent, twitterAccounts = [], context = {} } = {}) {
    if (!agent) throw new Error('Workflow requires agent instance');

    const snapshot = await agent.collectAlphaFactorySnapshot({ twitterAccounts });
    const hypotheses = snapshot.structuredHypothesis ? [snapshot.structuredHypothesis] : [];

    let reviewTicket = null;
    if (this.config.requireHumanReview && hypotheses[0]) {
      reviewTicket = agent.requestHumanReview(hypotheses[0], { snapshotContext: context });
    }

    let alertResults = [];
    if (this.config.runAlerts && hypotheses.length > 0) {
      alertResults = await agent.evaluateHypothesisAlerts(hypotheses, { snapshot, context });
    }

    let integrationResults = [];
    if (this.config.publishIntegrations) {
      integrationResults = await agent.publishIntegrations(
        { snapshot, hypotheses, alerts: alertResults, review: reviewTicket },
        { context, timestamp: new Date().toISOString() }
      );
    }

    return {
      snapshot,
      hypotheses,
      reviewTicket,
      alerts: alertResults,
      integrations: integrationResults
    };
  }
}

module.exports = { WorkflowOrchestrator };
