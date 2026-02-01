/**
 * Prompt 15: Human-in-the-loop refinement
 * Adds expert review, edits, and audit trail for hypotheses.
 */

class HumanInLoopRefinement {
  constructor(config = {}) {
    this.config = {
      maxQueue: config.maxQueue || 100,
      requireApproval: config.requireApproval !== false,
      ...config
    };

    this.reviewQueue = [];
    this.reviewHistory = [];
  }

  enqueueHypothesis(hypothesis, context = {}) {
    if (!hypothesis) return null;

    const entry = {
      id: hypothesis.id || `H-${Date.now()}`,
      hypothesis,
      context,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    this.reviewQueue.unshift(entry);
    if (this.reviewQueue.length > this.config.maxQueue) {
      this.reviewQueue.pop();
    }

    return entry;
  }

  submitReview({ id, reviewer, decision = 'approve', edits = {}, notes = '', confidenceDelta = 0, tags = [] } = {}) {
    const entryIndex = this.reviewQueue.findIndex(item => item.id === id);
    if (entryIndex === -1) return null;

    const entry = this.reviewQueue.splice(entryIndex, 1)[0];
    const review = {
      id,
      reviewer: reviewer || 'human-analyst',
      decision,
      edits,
      notes,
      confidenceDelta,
      tags,
      reviewedAt: new Date().toISOString()
    };

    const refined = this.applyReview(entry.hypothesis, review);

    this.reviewHistory.unshift({
      ...entry,
      review,
      refinedHypothesis: refined,
      status: 'reviewed'
    });

    return refined;
  }

  applyReview(hypothesis, review) {
    if (!hypothesis) return null;
    const updated = {
      ...hypothesis,
      ...review.edits,
      confidence: this._clampConfidence((hypothesis.confidence || 0.5) + (review.confidenceDelta || 0)),
      humanValidation: {
        status: review.decision,
        reviewer: review.reviewer,
        notes: review.notes,
        tags: review.tags,
        reviewedAt: review.reviewedAt
      }
    };

    if (this.config.requireApproval && review.decision !== 'approve') {
      updated.status = 'rejected';
    }

    return updated;
  }

  getQueue() {
    return this.reviewQueue;
  }

  getHistory() {
    return this.reviewHistory;
  }

  _clampConfidence(value) {
    return Math.max(0, Math.min(1, value));
  }
}

module.exports = { HumanInLoopRefinement };
