import { Pool } from 'pg';

export class DatabaseService {
  private pool: Pool | null = null;
  private inMemoryStorage = {
    incidents: new Map<string, any>(),
    runbooks: new Map<string, any>(),
    timeline: [] as any[],
    relations: [] as any[]
  };

  async connect() {
    // Skip if no database URL provided
    if (!process.env.DATABASE_URL) {
      console.log('[Database] No DATABASE_URL configured, using in-memory storage');
      return;
    }
    
    if (this.pool) return;
    
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Test connection
    try {
      await this.pool.query('SELECT NOW()');
      console.log('[Database] Connected to PostgreSQL');
      
      // Initialize tables
      await this.initializeTables();
    } catch (error) {
      console.error('[Database] Connection failed:', error);
      console.log('[Database] Falling back to in-memory storage');
      this.pool = null; // Reset pool to use in-memory
    }
  }

  async disconnect() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      console.log('[Database] Disconnected from PostgreSQL');
    }
  }

  private async initializeTables() {
    if (!this.pool) throw new Error('Database not connected');

    const queries = [
      `CREATE TABLE IF NOT EXISTS incidents (
        id VARCHAR(255) PRIMARY KEY,
        alert_id VARCHAR(255),
        summary TEXT,
        description TEXT,
        severity VARCHAR(50),
        status VARCHAR(50),
        labels JSONB,
        annotations JSONB,
        triage_result JSONB,
        fix_result JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS runbooks (
        id VARCHAR(255) PRIMARY KEY,
        title VARCHAR(255),
        keywords TEXT[],
        steps JSONB,
        version INT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS incident_timeline (
        id SERIAL PRIMARY KEY,
        incident_id VARCHAR(255) REFERENCES incidents(id),
        event_type VARCHAR(100),
        event_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS memory_graph (
        id SERIAL PRIMARY KEY,
        entity_type VARCHAR(100),
        entity_id VARCHAR(255),
        related_type VARCHAR(100),
        related_id VARCHAR(255),
        relationship VARCHAR(100),
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Create indexes
      `CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status)`,
      `CREATE INDEX IF NOT EXISTS idx_incidents_created ON incidents(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_timeline_incident ON incident_timeline(incident_id)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_entity ON memory_graph(entity_type, entity_id)`
    ];

    for (const query of queries) {
      try {
        await this.pool.query(query);
      } catch (error) {
        console.error('[Database] Failed to create table:', error);
      }
    }

    console.log('[Database] Tables initialized');
  }

  async query(text: string, params?: any[]) {
    if (!this.pool) {
      // Return empty result for in-memory mode
      return { rows: [], rowCount: 0 };
    }
    return this.pool.query(text, params);
  }

  async transaction(callback: (client: any) => Promise<any>) {
    if (!this.pool) throw new Error('Database not connected');
    
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Incident methods
  async createIncident(data: any) {
    if (!this.pool) {
      // In-memory storage
      const incident = {
        ...data,
        status: data.status || 'open',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      this.inMemoryStorage.incidents.set(data.id, incident);
      return incident;
    }
    
    const query = `
      INSERT INTO incidents (id, alert_id, summary, description, severity, status, labels, annotations)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    
    const result = await this.query(query, [
      data.id,
      data.alert_id,
      data.summary,
      data.description,
      data.severity,
      data.status || 'open',
      JSON.stringify(data.labels || {}),
      JSON.stringify(data.annotations || {})
    ]);
    
    return result.rows[0];
  }

  async updateIncident(id: string, updates: any) {
    // Normalize keys to match DB schema and drop unsupported columns
    const normalized: Record<string, any> = { ...updates };
    if ('triageResult' in normalized && !('triage_result' in normalized)) {
      normalized.triage_result = normalized.triageResult;
      delete normalized.triageResult;
    }
    if ('fixResult' in normalized && !('fix_result' in normalized)) {
      normalized.fix_result = normalized.fixResult;
      delete normalized.fixResult;
    }
    // Columns that actually exist in the incidents table
    const allowed = new Set([
      'alert_id','summary','description','severity','status',
      'labels','annotations','triage_result','fix_result'
    ]);

    if (!this.pool) {
      // In-memory storage: keep both camelCase and snake_case for compatibility
      const incident = this.inMemoryStorage.incidents.get(id);
      if (!incident) return null;
      
      const toAssign: Record<string, any> = { ...normalized };
      // Mirror snake_case back to camelCase for in-memory objects
      if ('triage_result' in toAssign) {
        toAssign.triageResult = toAssign.triage_result;
      }
      if ('fix_result' in toAssign) {
        toAssign.fixResult = toAssign.fix_result;
      }

      Object.assign(incident, toAssign, {
        updated_at: new Date().toISOString()
      });

      return incident;
    }

    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(normalized).forEach(([key, value]) => {
      if (key !== 'id' && allowed.has(key)) {
        fields.push(`${key} = $${paramIndex}`);
        values.push(typeof value === 'object' ? JSON.stringify(value) : value);
        paramIndex++;
      }
    });

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const query = `
      UPDATE incidents 
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.query(query, values);
    return result.rows[0];
  }

  async getIncident(id: string) {
    if (!this.pool) {
      // In-memory storage
      return this.inMemoryStorage.incidents.get(id);
    }
    
    const query = 'SELECT * FROM incidents WHERE id = $1';
    const result = await this.query(query, [id]);
    return result.rows[0];
  }

  async getIncidents(filters: any = {}) {
    if (!this.pool) {
      // In-memory storage
      let incidents = Array.from(this.inMemoryStorage.incidents.values());
      
      if (filters.status) {
        incidents = incidents.filter(i => i.status === filters.status);
      }
      
      if (filters.severity) {
        incidents = incidents.filter(i => i.severity === filters.severity);
      }
      
      return incidents.sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }
    
    let query = 'SELECT * FROM incidents WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (filters.status) {
      query += ` AND status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }

    if (filters.severity) {
      query += ` AND severity = $${paramIndex}`;
      params.push(filters.severity);
      paramIndex++;
    }

    query += ' ORDER BY created_at DESC LIMIT 100';

    const result = await this.query(query, params);
    return result.rows;
  }

  // Runbook methods
  async createRunbook(data: any) {
    const query = `
      INSERT INTO runbooks (id, title, keywords, steps)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    
    const result = await this.query(query, [
      data.id,
      data.title,
      data.keywords,
      JSON.stringify(data.steps)
    ]);
    
    return result.rows[0];
  }

  async searchRunbooks(keywords: string[]) {
    const query = `
      SELECT * FROM runbooks 
      WHERE keywords && $1
      ORDER BY updated_at DESC
      LIMIT 10
    `;
    
    const result = await this.query(query, [keywords]);
    return result.rows;
  }

  // Timeline methods
  async addTimelineEvent(incidentId: string, eventType: string, eventData: any) {
    if (!this.pool) {
      // In-memory storage
      const event = {
        id: this.inMemoryStorage.timeline.length + 1,
        incident_id: incidentId,
        event_type: eventType,
        event_data: eventData,
        created_at: new Date().toISOString()
      };
      this.inMemoryStorage.timeline.push(event);
      return event;
    }
    
    const query = `
      INSERT INTO incident_timeline (incident_id, event_type, event_data)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    
    const result = await this.query(query, [
      incidentId,
      eventType,
      JSON.stringify(eventData)
    ]);
    
    return result.rows[0];
  }

  async getTimeline(incidentId: string) {
    if (!this.pool) {
      // In-memory storage
      return this.inMemoryStorage.timeline
        .filter(e => e.incident_id === incidentId)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }
    
    const query = `
      SELECT * FROM incident_timeline 
      WHERE incident_id = $1
      ORDER BY created_at ASC
    `;
    
    const result = await this.query(query, [incidentId]);
    return result.rows;
  }

  // Memory graph methods
  async addMemoryRelation(data: any) {
    if (!this.pool) {
      // In-memory storage
      const relation = {
        id: this.inMemoryStorage.relations.length + 1,
        ...data,
        created_at: new Date().toISOString()
      };
      this.inMemoryStorage.relations.push(relation);
      return relation;
    }
    
    const query = `
      INSERT INTO memory_graph (entity_type, entity_id, related_type, related_id, relationship, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    const result = await this.query(query, [
      data.entity_type,
      data.entity_id,
      data.related_type,
      data.related_id,
      data.relationship,
      JSON.stringify(data.metadata || {})
    ]);
    
    return result.rows[0];
  }

  async getRelations(entityType: string, entityId: string) {
    if (!this.pool) {
      // In-memory storage
      return this.inMemoryStorage.relations.filter(
        r => (r.entity_type === entityType && r.entity_id === entityId) ||
             (r.related_type === entityType && r.related_id === entityId)
      ).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    
    const query = `
      SELECT * FROM memory_graph 
      WHERE (entity_type = $1 AND entity_id = $2)
         OR (related_type = $1 AND related_id = $2)
      ORDER BY created_at DESC
    `;
    
    const result = await this.query(query, [entityType, entityId]);
    return result.rows;
  }
}