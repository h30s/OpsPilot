import { LlmAgent, BaseTool, InvocationContext } from '@iqai/adk';
import axios from 'axios';

export class TriageAgent extends LlmAgent {
  private githubToken: string;
  private githubOwner: string;
  private githubRepo: string;
  private memoryStore: any[] = []; // Simple in-memory store

  constructor() {
    super({
      name: 'TriageAgent',
      model: 'gemini-2.0-flash',
      description: 'Analyzes alerts, determines root cause, and proposes solutions',
      tools: [
        {
          name: 'analyze_metrics',
          description: 'Analyze metrics related to the alert',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              timeRange: { type: 'string' }
            },
            required: ['query']
          },
          execute: async (params: any) => this.analyzeMetrics(params.query, params.timeRange)
        } as any,
        {
          name: 'check_recent_changes',
          description: 'Check recent code changes that might be related',
          parameters: {
            type: 'object',
            properties: {
              since: { type: 'string' },
              path: { type: 'string' }
            }
          },
          execute: async (params: any) => this.checkRecentChanges(params.since, params.path)
        } as any,
        {
          name: 'search_runbooks',
          description: 'Search for relevant runbooks',
          parameters: {
            type: 'object',
            properties: {
              keywords: { type: 'array', items: { type: 'string' } }
            },
            required: ['keywords']
          },
          execute: async (params: any) => this.searchRunbooks(params.keywords)
        } as any,
        {
          name: 'generate_hypothesis',
          description: 'Generate root cause hypothesis',
          parameters: {
            type: 'object',
            properties: {
              alert: { type: 'object' },
              context: { type: 'object' }
            },
            required: ['alert']
          },
          execute: async (params: any) => this.generateHypothesis(params.alert, params.context)
        } as any
      ]
    });

    this.githubToken = process.env.GITHUB_TOKEN || '';
    this.githubOwner = process.env.GITHUB_REPO_OWNER || 'demo-owner';
    this.githubRepo = process.env.GITHUB_REPO_NAME || 'demo-repo';
  }

  async triageAlert(alert: any) {
    const alertSummary = alert.summary || alert.annotations?.summary || alert.labels?.alertname || 'Unknown Alert';
    console.log(`[TriageAgent] Triaging alert: ${alertSummary}`);

    // Analyze metrics
    const metrics = await this.analyzeMetrics(
      alert.labels?.alertname || 'up',
      '1h'
    );

    // Check recent changes
    const changes = await this.checkRecentChanges(
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    );

    // Search for relevant runbooks
    const keywords = [
      alert.labels?.alertname,
      alert.labels?.service,
      alert.labels?.component
    ].filter(Boolean);
    
    const runbooks = await this.searchRunbooks(keywords);

    // Generate hypothesis
    const hypothesis = await this.generateHypothesis(alert, {
      metrics,
      changes,
      runbooks
    });

    // Store in memory for future reference
    this.memoryStore.push({
      type: 'triage',
      alertId: alert.id,
      timestamp: new Date().toISOString(),
      hypothesis,
      runbooks,
      changes
    });

    const alertId = alert.id || alert.fingerprint || alert.alertId || alert.labels?.fingerprint || '';
    const summary = alert.summary || alert.annotations?.summary || alert.labels?.alertname || 'Unknown Alert';
    const severity = alert.severity || alert.labels?.severity || 'warning';

    return {
      alertId,
      summary,
      severity,
      hypothesis,
      suggestedActions: this.generateSuggestedActions(hypothesis, runbooks),
      runbooks,
      recentChanges: changes,
      metrics
    };
  }

  private async analyzeMetrics(query: string, timeRange: string = '1h') {
    try {
      const prometheusUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';
      const response = await axios.get(`${prometheusUrl}/api/v1/query_range`, {
        params: {
          query,
          start: new Date(Date.now() - 3600000).toISOString(),
          end: new Date().toISOString(),
          step: '60s'
        }
      });

      return {
        query,
        timeRange,
        results: response.data.data.result || [],
        status: 'success'
      };
    } catch (error) {
      console.error('[TriageAgent] Metrics analysis failed:', error);
      return {
        query,
        timeRange,
        results: [],
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async checkRecentChanges(since?: string, path?: string) {
    try {
      const url = `https://api.github.com/repos/${this.githubOwner}/${this.githubRepo}/commits`;
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${this.githubToken}`,
          Accept: 'application/vnd.github.v3+json'
        },
        params: {
          since,
          path,
          per_page: 10
        }
      });

      return response.data.map((commit: any) => ({
        sha: commit.sha,
        message: commit.commit.message,
        author: commit.commit.author.name,
        date: commit.commit.author.date,
        url: commit.html_url
      }));
    } catch (error) {
      console.error('[TriageAgent] Failed to fetch recent changes:', error);
      return [];
    }
  }

  private async searchRunbooks(keywords: string[]) {
    // In production, this would search a database or MCP server
    // For now, return mock runbooks
    const mockRunbooks = [
      {
        id: 'rb-001',
        title: 'High Memory Usage Mitigation',
        keywords: ['memory', 'oom', 'resource'],
        steps: [
          'Identify memory-intensive processes',
          'Check for memory leaks in recent deployments',
          'Consider scaling horizontally',
          'Implement memory limits if not present'
        ]
      },
      {
        id: 'rb-002',
        title: 'Service Unavailable Response',
        keywords: ['service', 'unavailable', '503', 'down'],
        steps: [
          'Check service health endpoints',
          'Verify dependencies are accessible',
          'Review recent configuration changes',
          'Consider rolling back recent deployments'
        ]
      },
      {
        id: 'rb-003',
        title: 'Database Connection Pool Exhaustion',
        keywords: ['database', 'connection', 'pool', 'timeout'],
        steps: [
          'Check current connection pool metrics',
          'Identify long-running queries',
          'Increase pool size if needed',
          'Implement connection pooling best practices'
        ]
      }
    ];

    return mockRunbooks.filter(runbook =>
      runbook.keywords.some(keyword =>
        keywords.some(k => k && k.toLowerCase().includes(keyword))
      )
    );
  }

  private async generateHypothesis(alert: any, context: any) {
    const { changes, metrics, runbooks } = context;
    
    let hypothesis = {
      primaryCause: 'Unknown',
      confidence: 0,
      evidence: [] as string[],
      suggestedFix: ''
    };

    // Analyze based on alert type
    if (alert.labels?.alertname?.includes('Memory')) {
      hypothesis.primaryCause = 'Memory exhaustion or leak';
      hypothesis.confidence = 0.8;
      hypothesis.evidence.push('Alert name contains "Memory"');
      hypothesis.suggestedFix = 'Restart affected service or scale horizontally';
    } else if (alert.labels?.alertname?.includes('CPU')) {
      hypothesis.primaryCause = 'High CPU utilization';
      hypothesis.confidence = 0.75;
      hypothesis.evidence.push('Alert name contains "CPU"');
      hypothesis.suggestedFix = 'Optimize CPU-intensive operations or scale up';
    } else if (alert.severity === 'critical') {
      hypothesis.primaryCause = 'Service outage or critical failure';
      hypothesis.confidence = 0.7;
      hypothesis.evidence.push('Alert severity is critical');
      hypothesis.suggestedFix = 'Immediate investigation and potential rollback';
    }

    // Check if recent changes correlate
    if (changes && changes.length > 0) {
      const recentChange = changes[0];
      hypothesis.evidence.push(`Recent commit: "${recentChange.message}" by ${recentChange.author}`);
      hypothesis.confidence = Math.min(hypothesis.confidence + 0.1, 1.0);
    }

    // Check if runbook exists
    if (runbooks && runbooks.length > 0) {
      hypothesis.evidence.push(`Found ${runbooks.length} relevant runbook(s)`);
      hypothesis.suggestedFix = runbooks[0].steps[0];
      hypothesis.confidence = Math.min(hypothesis.confidence + 0.1, 1.0);
    }

    return hypothesis;
  }

  private generateSuggestedActions(hypothesis: any, runbooks: any[]) {
    const actions = [];

    // Always suggest creating a ticket
    actions.push({
      type: 'create_ticket',
      description: 'Create Jira ticket for tracking',
      automated: true
    });

    // Suggest runbook steps if available
    if (runbooks.length > 0) {
      actions.push({
        type: 'follow_runbook',
        description: `Follow runbook: ${runbooks[0].title}`,
        runbookId: runbooks[0].id,
        automated: false
      });
    }

    // Suggest fixes based on hypothesis
    if (hypothesis.confidence > 0.7) {
      actions.push({
        type: 'apply_fix',
        description: hypothesis.suggestedFix,
        automated: hypothesis.confidence > 0.8
      });
    }

    // Suggest escalation if confidence is low
    if (hypothesis.confidence < 0.5) {
      actions.push({
        type: 'escalate',
        description: 'Escalate to on-call engineer',
        automated: true
      });
    }

    return actions;
  }
}