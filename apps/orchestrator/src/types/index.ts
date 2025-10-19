/**
 * Shared Type Definitions for OpsPilot Orchestrator
 */

// Alert Types
export interface PrometheusAlert {
  fingerprint: string;
  labels: {
    alertname: string;
    severity: string;
    service?: string;
    instance?: string;
    [key: string]: string | undefined;
  };
  annotations: {
    summary: string;
    description?: string;
    [key: string]: string | undefined;
  };
  startsAt: string;
  endsAt?: string;
  status?: 'firing' | 'resolved';
}

export interface PrometheusWebhookPayload {
  alerts: PrometheusAlert[];
  version?: string;
  groupKey?: string;
  status?: string;
}

// Incident Types
export type IncidentStatus = 'new' | 'triaged' | 'in_progress' | 'resolved' | 'failed' | 'acknowledged';
export type IncidentSeverity = 'critical' | 'warning' | 'info';

export interface Incident {
  id: string;
  fingerprint: string;
  summary: string;
  description?: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  triageResult?: TriageResult;
  fixResult?: FixResult;
  created_at?: string;
  updated_at?: string;
  resolved_at?: string;
}

// Triage Types
export interface Hypothesis {
  primaryCause: string;
  confidence: number;
  evidence: string[];
  suggestedFix: string;
}

export interface SuggestedAction {
  type: string;
  description: string;
  automated: boolean;
  runbookId?: string;
}

export interface Runbook {
  id: string;
  title: string;
  keywords: string[];
  steps: string[] | RunbookStep[];
}

export interface RunbookStep {
  order: number;
  action: string;
  description: string;
  automated: boolean;
}

export interface TriageResult {
  alertId: string;
  summary: string;
  severity: IncidentSeverity;
  hypothesis: Hypothesis;
  suggestedActions: SuggestedAction[];
  runbooks: Runbook[];
  recentChanges?: GitCommit[];
  metrics?: MetricsResult;
}

// Fix Types
export interface PullRequest {
  url: string;
  number: number;
  state: string;
  branch: string;
}

export interface AppliedFix {
  type: string;
  status: string;
  url?: string;
  service?: string;
  version?: string;
  replicas?: number;
}

export interface FixResult {
  alertId: string;
  success: boolean;
  message?: string;
  appliedFixes: AppliedFix[];
  pullRequest?: PullRequest;
  verificationStatus: 'pending' | 'resolved' | 'still_firing' | 'unknown';
}

// Git Types
export interface GitCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

// Metrics Types
export interface MetricsResult {
  query: string;
  timeRange: string;
  results: any[];
  status: 'success' | 'error';
  error?: string;
}

// Database Types
export interface TimelineEvent {
  id: number;
  incident_id: string;
  event_type: string;
  event_data: any;
  created_at: string;
}

export interface MemoryRelation {
  id: number;
  entity_type: string;
  entity_id: string;
  related_type: string;
  related_id: string;
  relationship: string;
  metadata: any;
  created_at: string;
}

// API Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'down';
  services: {
    database: boolean;
    redis: boolean;
    agents: boolean;
  };
  uptime: number;
  version: string;
}

// Approval Types
export interface ApprovalRequest {
  incidentId: string;
  actions: string[];
  requestedBy: string;
  timestamp: string;
}

// Notification Types
export interface DiscordNotification {
  title: string;
  description: string;
  color: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  timestamp?: string;
}

// Configuration Types
export interface OrchestratorConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  redisUrl: string;
  prometheusUrl: string;
  github?: {
    token: string;
    owner: string;
    repo: string;
  };
  jira?: {
    domain: string;
    email: string;
    apiToken: string;
    projectKey: string;
  };
  pagerduty?: {
    token: string;
    serviceId: string;
  };
  discord?: {
    webhookUrl: string;
    channelId: string;
  };
}
