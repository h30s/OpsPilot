/**
 * Unit Tests for IncidentManager
 * 
 * To run: npm test (after installing jest and ts-jest)
 * Note: This file requires @types/jest to be installed for type checking
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { IncidentManager } from '../../services/incident-manager.js';
import { MockDatabase, createMockAlert } from '../utils/test-helpers.js';

describe('IncidentManager', () => {
  let incidentManager: IncidentManager;
  let mockDb: MockDatabase;

  beforeEach(() => {
    mockDb = new MockDatabase();
    incidentManager = new IncidentManager(mockDb as any);
  });

  afterEach(() => {
    mockDb.clear();
  });

  describe('createIncident', () => {
    it('should create an incident from an alert', async () => {
      const alert = createMockAlert({
        labels: { alertname: 'HighMemoryUsage', severity: 'critical' },
        annotations: { summary: 'Memory usage at 95%' },
      });

      const incident = await incidentManager.createIncident(alert);

      expect(incident).toBeDefined();
      expect(incident.id).toMatch(/^inc-/);
      expect(incident.summary).toBe('Memory usage at 95%');
      expect(incident.severity).toBe('critical');
      expect(incident.status).toBe('open');
    });

    it('should handle missing alert data gracefully', async () => {
      const alert = {
        id: 'test-alert',
        fingerprint: 'test-fp',
      };

      const incident = await incidentManager.createIncident(alert);

      expect(incident).toBeDefined();
      expect(incident.summary).toBe('Unknown Alert');
      expect(incident.severity).toBe('warning');
    });
  });

  describe('updateIncident', () => {
    it('should update an existing incident', async () => {
      const alert = createMockAlert();
      const incident = await incidentManager.createIncident(alert);

      const updated = await incidentManager.updateIncident(incident.id, {
        status: 'triaged',
        triageResult: { hypothesis: { primaryCause: 'Memory leak', confidence: 0.9 } },
      });

      expect(updated).toBeDefined();
      expect(updated?.status).toBe('triaged');
      expect(updated?.triage_result).toBeDefined();
    });

    it('should return null for non-existent incident', async () => {
      const updated = await incidentManager.updateIncident('non-existent', { status: 'resolved' });

      expect(updated).toBeNull();
    });
  });

  describe('getIncident', () => {
    it('should retrieve an incident by ID', async () => {
      const alert = createMockAlert();
      const created = await incidentManager.createIncident(alert);

      const retrieved = await incidentManager.getIncident(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    it('should return undefined for non-existent incident', async () => {
      const retrieved = await incidentManager.getIncident('non-existent');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('getIncidents', () => {
    it('should retrieve all incidents', async () => {
      await incidentManager.createIncident(createMockAlert());
      await incidentManager.createIncident(createMockAlert());

      const incidents = await incidentManager.getIncidents();

      expect(incidents).toHaveLength(2);
    });

    it('should filter incidents by status', async () => {
      const incident1 = await incidentManager.createIncident(createMockAlert());
      await incidentManager.createIncident(createMockAlert());
      await incidentManager.updateIncident(incident1.id, { status: 'resolved' });

      const resolved = await incidentManager.getIncidents({ status: 'resolved' });

      expect(resolved).toHaveLength(1);
      expect(resolved[0].status).toBe('resolved');
    });
  });
});

// Note: To run these tests, you need to install jest and ts-jest:
// npm install --save-dev jest ts-jest @types/jest
// Then add to package.json scripts: "test": "jest"
