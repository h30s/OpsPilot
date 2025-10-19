import { DatabaseService } from './database.js';
import { v4 as uuidv4 } from 'uuid';

export class IncidentManager {
  constructor(private database: DatabaseService) {}

  async createIncident(alert: any) {
    const incidentId = `inc-${uuidv4()}`;
    
    const incident = {
      id: incidentId,
      alert_id: alert.id || alert.fingerprint,
      summary: alert.summary || alert.labels?.alertname || 'Unknown Alert',
      description: alert.description || '',
      severity: alert.severity || alert.labels?.severity || 'warning',
      status: 'open',
      labels: alert.labels || {},
      annotations: alert.annotations || {}
    };

    // Create incident in database
    const dbIncident = await this.database.createIncident(incident);
    
    // Add timeline event
    await this.database.addTimelineEvent(incidentId, 'incident_created', {
      alert,
      source: 'prometheus'
    });

    // Add memory relation
    await this.database.addMemoryRelation({
      entity_type: 'incident',
      entity_id: incidentId,
      related_type: 'alert',
      related_id: alert.id || alert.fingerprint,
      relationship: 'triggered_by',
      metadata: { timestamp: new Date().toISOString() }
    });

    console.log(`[IncidentManager] Created incident: ${incidentId}`);
    return dbIncident;
  }

  async updateIncident(id: string, updates: any) {
    const incident = await this.database.updateIncident(id, updates);
    
    // Add timeline event for significant updates
    if (updates.status) {
      await this.database.addTimelineEvent(id, `status_changed_to_${updates.status}`, {
        previousStatus: incident.status,
        newStatus: updates.status,
        timestamp: new Date().toISOString()
      });
    }

    if (updates.triageResult) {
      await this.database.addTimelineEvent(id, 'triaged', {
        hypothesis: updates.triageResult.hypothesis,
        suggestedActions: updates.triageResult.suggestedActions
      });
    }

    if (updates.fixResult) {
      await this.database.addTimelineEvent(id, 'fix_applied', {
        pullRequest: updates.fixResult.pullRequest,
        appliedFixes: updates.fixResult.appliedFixes,
        success: updates.fixResult.success
      });
    }

    return incident;
  }

  async getIncident(id: string) {
    const incident = await this.database.getIncident(id);
    if (incident) {
      // Parse JSON fields
      incident.labels = typeof incident.labels === 'string' ? JSON.parse(incident.labels) : incident.labels;
      incident.annotations = typeof incident.annotations === 'string' ? JSON.parse(incident.annotations) : incident.annotations;
      incident.triage_result = typeof incident.triage_result === 'string' ? JSON.parse(incident.triage_result) : incident.triage_result;
      incident.fix_result = typeof incident.fix_result === 'string' ? JSON.parse(incident.fix_result) : incident.fix_result;
      
      // Ensure both naming conventions are available without overwriting existing values
      if (incident.triage_result === undefined && incident.triageResult !== undefined) {
        incident.triage_result = incident.triageResult;
      }
      if (incident.fix_result === undefined && incident.fixResult !== undefined) {
        incident.fix_result = incident.fixResult;
      }
      
      incident.triageResult = incident.triage_result ?? incident.triageResult;
      incident.fixResult = incident.fix_result ?? incident.fixResult;
    }
    return incident;
  }

  async getIncidents(filters?: any) {
    const incidents = await this.database.getIncidents(filters);
    return incidents.map(incident => {
      // Parse JSON fields
      incident.labels = typeof incident.labels === 'string' ? JSON.parse(incident.labels) : incident.labels;
      incident.annotations = typeof incident.annotations === 'string' ? JSON.parse(incident.annotations) : incident.annotations;
      incident.triage_result = typeof incident.triage_result === 'string' ? JSON.parse(incident.triage_result) : incident.triage_result;
      incident.fix_result = typeof incident.fix_result === 'string' ? JSON.parse(incident.fix_result) : incident.fix_result;
      
      if (incident.triage_result === undefined && incident.triageResult !== undefined) {
        incident.triage_result = incident.triageResult;
      }
      if (incident.fix_result === undefined && incident.fixResult !== undefined) {
        incident.fix_result = incident.fixResult;
      }
      
      incident.triageResult = incident.triage_result ?? incident.triageResult;
      incident.fixResult = incident.fix_result ?? incident.fixResult;
      
      return incident;
    });
  }

  async getTimeline(incidentId: string) {
    const timeline = await this.database.getTimeline(incidentId);
    return timeline.map(event => {
      event.event_data = typeof event.event_data === 'string' ? JSON.parse(event.event_data) : event.event_data;
      return event;
    });
  }

  async getRelatedIncidents(incidentId: string) {
    const relations = await this.database.getRelations('incident', incidentId);
    const relatedIds = relations
      .filter(r => r.related_type === 'incident')
      .map(r => r.related_id);
    
    if (relatedIds.length === 0) return [];
    
    const incidents = await Promise.all(
      relatedIds.map(id => this.getIncident(id))
    );
    
    return incidents.filter(Boolean);
  }

  async linkIncidents(incidentId1: string, incidentId2: string, relationship: string) {
    await this.database.addMemoryRelation({
      entity_type: 'incident',
      entity_id: incidentId1,
      related_type: 'incident',
      related_id: incidentId2,
      relationship,
      metadata: { timestamp: new Date().toISOString() }
    });
  }

  async getSimilarIncidents(incident: any, limit: number = 5) {
    // In production, use vector similarity search with pgvector
    // For now, return incidents with similar severity
    const similarIncidents = await this.database.getIncidents({
      severity: incident.severity
    });

    return similarIncidents
      .filter(i => i.id !== incident.id)
      .slice(0, limit);
  }

  async resolveIncident(id: string, resolution: any) {
    const updates = {
      status: 'resolved',
      resolution: JSON.stringify(resolution)
    };

    const incident = await this.updateIncident(id, updates);

    // Add timeline event
    await this.database.addTimelineEvent(id, 'resolved', {
      resolution,
      timestamp: new Date().toISOString()
    });

    return incident;
  }

  async generateReport(incidentId: string) {
    const incident = await this.getIncident(incidentId);
    const timeline = await this.getTimeline(incidentId);
    const relatedIncidents = await this.getRelatedIncidents(incidentId);

    return {
      incident,
      timeline,
      relatedIncidents,
      summary: this.generateSummary(incident, timeline),
      metrics: {
        timeToDetect: this.calculateTimeToDetect(incident, timeline),
        timeToTriage: this.calculateTimeToTriage(incident, timeline),
        timeToResolve: this.calculateTimeToResolve(incident, timeline)
      }
    };
  }

  private generateSummary(incident: any, timeline: any[]) {
    const events = timeline.map(e => `- ${new Date(e.created_at).toISOString()}: ${e.event_type}`).join('\n');
    
    return `
## Incident Report: ${incident.id}

**Summary:** ${incident.summary}
**Severity:** ${incident.severity}
**Status:** ${incident.status}
**Created:** ${new Date(incident.created_at).toISOString()}
**Updated:** ${new Date(incident.updated_at).toISOString()}

### Timeline
${events}

### Root Cause
${incident.triage_result?.hypothesis?.primaryCause || 'Unknown'}

### Resolution
${incident.fix_result?.success ? 'Successfully resolved' : 'Pending resolution'}
${incident.fix_result?.pullRequest?.url ? `PR: ${incident.fix_result.pullRequest.url}` : ''}
    `.trim();
  }

  private calculateTimeToDetect(incident: any, timeline: any[]): number {
    const createdEvent = timeline.find(e => e.event_type === 'incident_created');
    if (!createdEvent) return 0;
    
    const createdTime = new Date(createdEvent.created_at).getTime();
    const alertTime = new Date(incident.created_at).getTime();
    
    return Math.abs(createdTime - alertTime) / 1000; // seconds
  }

  private calculateTimeToTriage(incident: any, timeline: any[]): number {
    const createdEvent = timeline.find(e => e.event_type === 'incident_created');
    const triageEvent = timeline.find(e => e.event_type === 'triaged');
    
    if (!createdEvent || !triageEvent) return 0;
    
    const createdTime = new Date(createdEvent.created_at).getTime();
    const triageTime = new Date(triageEvent.created_at).getTime();
    
    return (triageTime - createdTime) / 1000; // seconds
  }

  private calculateTimeToResolve(incident: any, timeline: any[]): number {
    const createdEvent = timeline.find(e => e.event_type === 'incident_created');
    const resolvedEvent = timeline.find(e => e.event_type === 'resolved');
    
    if (!createdEvent || !resolvedEvent) return 0;
    
    const createdTime = new Date(createdEvent.created_at).getTime();
    const resolvedTime = new Date(resolvedEvent.created_at).getTime();
    
    return (resolvedTime - createdTime) / 1000; // seconds
  }
}