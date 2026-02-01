class SocialMomentumScorer {
  constructor() {
    this.prevMentions = 0;
    this.prevTimestamp = Date.now() - 3600000;
  }

  computeMentionDelta(currentMentions) {
    const now = Date.now();
    const deltaHours = Math.max(1, (now - this.prevTimestamp) / 3600000);
    const delta = this.prevMentions > 0 ? (currentMentions - this.prevMentions) / this.prevMentions : 0;
    this.prevMentions = currentMentions;
    this.prevTimestamp = now;
    return { delta, deltaHours };
  }

  computeEngagementVelocity(tweets = []) {
    const total = tweets.reduce((acc, t) => acc + (t.engagement?.like_count || 0) + (t.engagement?.retweet_count || 0) + (t.engagement?.reply_count || 0), 0);
    const ageHours = Math.max(1, (Date.now() - new Date(tweets[0]?.timestamp || Date.now()).getTime()) / 3600000);
    return Math.log1p(total) / ageHours;
  }

  computeUniqueMentions(tweets = []) {
    return new Set(tweets.map(t => t.author)).size;
  }

  normalize(value, min, max) {
    if (max === min) return 0;
    const normalized = (value - min) / (max - min);
    return Math.max(0, Math.min(1, normalized));
  }

  computeComposite({ mentionDelta, engagementVelocity, uniqueAccounts, sentiment, narrativeAlignment, influencerCascade }) {
    const deltaScore = this.normalize(mentionDelta, -0.5, 2);
    const engagementScore = this.normalize(engagementVelocity, 0, 5);
    const uniqueScore = this.normalize(uniqueAccounts, 1, 100);
    const sentimentScore = this.normalize(sentiment, -1, 1);
    const narrativeScore = this.normalize(narrativeAlignment, 0, 1);
    const cascadeScore = this.normalize(influencerCascade, 0, 1);

    return (
      deltaScore * 0.2 +
      engagementScore * 0.2 +
      uniqueScore * 0.15 +
      sentimentScore * 0.2 +
      narrativeScore * 0.15 +
      cascadeScore * 0.1
    );
  }

  analyze(twitterAnalysis, narrativeClusters = []) {
    const mentions = twitterAnalysis?.cleanedTweets || 0;
    const { delta } = this.computeMentionDelta(mentions);
    const engagementVelocity = this.computeEngagementVelocity(twitterAnalysis?.tweets || []);
    const uniqueAccounts = twitterAnalysis?.uniqueAccounts || 0;
    const sentiment = twitterAnalysis?.sentiment || 0;

    const narrativeAlignment = narrativeClusters.length
      ? narrativeClusters.reduce((s, n) => s + (n.velocity_score || 0), 0) / narrativeClusters.length
      : 0;

    const influencerCascade = twitterAnalysis?.uniqueAccounts ? Math.min(1, twitterAnalysis.uniqueAccounts / 50) : 0;

    const composite = this.computeComposite({
      mentionDelta: delta,
      engagementVelocity,
      uniqueAccounts,
      sentiment,
      narrativeAlignment,
      influencerCascade
    });

    return {
      mentionDelta: delta,
      engagementVelocity,
      uniqueAccounts,
      sentiment,
      narrativeAlignment,
      influencerCascade,
      compositeScore: composite
    };
  }
}

module.exports = { SocialMomentumScorer };
