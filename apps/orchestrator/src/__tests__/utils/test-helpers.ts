/**
 * Test Helper Utilities
 * Common functions for testing OpsPilot components
 */

import type { PrometheusAlert, Incident, TriageResult } from '../../types/index.js';

export function createMockAlert(overrides?: Partial<PrometheusAlert>): PrometheusAlert {
  return {
    fingerprint: `test-${Date.now()}`,
    labels: {
      alertname: 'TestAlert',
      severity: 'warning',
      service: 'test-service',
      instance: 'test-instance',
    },
    annotations: {
      summary: 'Test alert summary',
      description: 'Test alert description',
    },
    startsAt: new Date().toISOString(),
    status: 'firing',
    ...overrides,
  };
}

export function createMockIncident(overrides?: Partial<Incident>): Incident {
  return {
    id: `inc-${Date.now()}`,
    fingerprint: `test-${Date.now()}`,
    summary: 'Test incident',
    severity: 'warning',
    status: 'new',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockTriageResult(overrides?: Partial<TriageResult>): TriageResult {
  return {
    alertId: `alert-${Date.now()}`,
    summary: 'Test triage result',
    severity: 'warning',
    hypothesis: {
      primaryCause: 'Test cause',
      confidence: 0.8,
      evidence: ['Test evidence 1', 'Test evidence 2'],
      suggestedFix: 'Test fix',
    },
    suggestedActions: [
      {
        type: 'test_action',
        description: 'Test action',
        automated: true,
      },
    ],
    runbooks: [],
    ...overrides,
  };
}

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error('Timeout waiting for condition');
}

export class MockDatabase {
  private incidents: Map<string, Incident> = new Map();
  private timeline: any[] = [];

  async createIncident(data: any): Promise<Incident> {
    const incident = { ...data, created_at: new Date().toISOString() };
    this.incidents.set(data.id, incident);
    return incident;
  }

  async getIncident(id: string): Promise<Incident | undefined> {
    return this.incidents.get(id);
  }

  async updateIncident(id: string, updates: any): Promise<Incident | null> {
    const incident = this.incidents.get(id);
    if (!incident) return null;
    const updated = { ...incident, ...updates, updated_at: new Date().toISOString() };
    this.incidents.set(id, updated);
    return updated;
  }

  async addTimelineEvent(incidentId: string, eventType: string, eventData: any): Promise<void> {
    this.timeline.push({
      incident_id: incidentId,
      event_type: eventType,
      event_data: eventData,
      created_at: new Date().toISOString(),
    });
  }

  clear(): void {
    this.incidents.clear();
    this.timeline = [];
  }
}
