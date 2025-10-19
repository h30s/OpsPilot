-- OpsPilot Database Schema
-- Run this script to initialize the database

-- Create database if not exists (run as superuser)
-- CREATE DATABASE opspilot;

-- Connect to opspilot database
-- \c opspilot;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop existing tables if needed (for development)
DROP TABLE IF EXISTS incident_history CASCADE;
DROP TABLE IF EXISTS incidents CASCADE;
DROP TABLE IF EXISTS runbooks CASCADE;
DROP TABLE IF EXISTS runbook_versions CASCADE;

-- Incidents table
CREATE TABLE incidents (
    id VARCHAR(50) PRIMARY KEY,
    fingerprint VARCHAR(255) UNIQUE NOT NULL,
    summary TEXT NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('new', 'triaged', 'in_progress', 'resolved', 'failed')),
    alert_data JSONB NOT NULL,
    triage_result JSONB,
    fix_result JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE
);

-- Runbooks table
CREATE TABLE runbooks (
    id VARCHAR(50) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    keywords TEXT[] NOT NULL,
    steps JSONB NOT NULL,
    version INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_by VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Runbook versions table (for tracking changes)
CREATE TABLE runbook_versions (
    id SERIAL PRIMARY KEY,
    runbook_id VARCHAR(50) REFERENCES runbooks(id),
    version INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    keywords TEXT[] NOT NULL,
    steps JSONB NOT NULL,
    change_notes TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Incident history table
CREATE TABLE incident_history (
    id SERIAL PRIMARY KEY,
    incident_id VARCHAR(50) REFERENCES incidents(id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL,
    details JSONB,
    created_by VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_incidents_status ON incidents(status);
CREATE INDEX idx_incidents_severity ON incidents(severity);
CREATE INDEX idx_incidents_created_at ON incidents(created_at DESC);
CREATE INDEX idx_incidents_fingerprint ON incidents(fingerprint);
CREATE INDEX idx_incidents_alert_data ON incidents USING GIN(alert_data);

CREATE INDEX idx_runbooks_keywords ON runbooks USING GIN(keywords);
CREATE INDEX idx_runbooks_is_active ON runbooks(is_active);

CREATE INDEX idx_incident_history_incident_id ON incident_history(incident_id);
CREATE INDEX idx_incident_history_created_at ON incident_history(created_at DESC);

-- Create update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_incidents_updated_at BEFORE UPDATE ON incidents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_runbooks_updated_at BEFORE UPDATE ON runbooks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default runbooks
INSERT INTO runbooks (id, title, keywords, steps, created_by) VALUES
(
    'RB-001',
    'High Memory Usage Mitigation',
    ARRAY['memory', 'oom', 'heap', 'HighMemoryUsage', 'ram', 'leak'],
    '[
        {"order": 1, "action": "identify_process", "description": "Identify memory-intensive processes using top or htop", "automated": false},
        {"order": 2, "action": "check_logs", "description": "Check application logs for memory errors or OOM kills", "automated": true},
        {"order": 3, "action": "heap_dump", "description": "Generate heap dump if Java application", "automated": false},
        {"order": 4, "action": "restart_service", "description": "Restart the affected service to clear memory", "automated": true},
        {"order": 5, "action": "scale", "description": "Scale horizontally if memory issue persists", "automated": true},
        {"order": 6, "action": "monitor", "description": "Monitor memory usage for 15 minutes", "automated": true}
    ]'::jsonb,
    'system'
),
(
    'RB-002',
    'High CPU Resolution',
    ARRAY['cpu', 'performance', 'load', 'HighCPU', 'processor', 'usage'],
    '[
        {"order": 1, "action": "profile", "description": "Generate CPU profile or flame graph", "automated": true},
        {"order": 2, "action": "identify_hotspot", "description": "Identify CPU hotspots and bottlenecks", "automated": false},
        {"order": 3, "action": "check_queries", "description": "Check for slow database queries", "automated": true},
        {"order": 4, "action": "scale", "description": "Scale horizontally to distribute load", "automated": true},
        {"order": 5, "action": "optimize", "description": "Apply code optimizations if identified", "automated": false},
        {"order": 6, "action": "cache", "description": "Implement caching for expensive operations", "automated": false}
    ]'::jsonb,
    'system'
),
(
    'RB-003',
    'Service Unavailable Recovery',
    ARRAY['unavailable', 'down', '503', 'service', 'outage', 'offline'],
    '[
        {"order": 1, "action": "healthcheck", "description": "Check all health endpoints", "automated": true},
        {"order": 2, "action": "dependencies", "description": "Verify all dependency services are up", "automated": true},
        {"order": 3, "action": "logs", "description": "Check error logs for root cause", "automated": true},
        {"order": 4, "action": "restart", "description": "Restart the affected service", "automated": true},
        {"order": 5, "action": "rollback", "description": "Rollback if recent deployment detected", "automated": false},
        {"order": 6, "action": "failover", "description": "Activate failover if available", "automated": false}
    ]'::jsonb,
    'system'
),
(
    'RB-004',
    'Database Connection Pool Exhaustion',
    ARRAY['database', 'connection', 'pool', 'timeout', 'postgresql', 'mysql'],
    '[
        {"order": 1, "action": "check_connections", "description": "Check current connection pool metrics", "automated": true},
        {"order": 2, "action": "identify_queries", "description": "Identify long-running queries", "automated": true},
        {"order": 3, "action": "kill_queries", "description": "Kill problematic long-running queries", "automated": false},
        {"order": 4, "action": "increase_pool", "description": "Temporarily increase connection pool size", "automated": true},
        {"order": 5, "action": "restart_app", "description": "Restart application to reset connections", "automated": false},
        {"order": 6, "action": "optimize", "description": "Optimize connection pooling configuration", "automated": false}
    ]'::jsonb,
    'system'
),
(
    'RB-005',
    'Disk Space Alert',
    ARRAY['disk', 'space', 'storage', 'full', 'capacity'],
    '[
        {"order": 1, "action": "identify_usage", "description": "Identify directories consuming most space", "automated": true},
        {"order": 2, "action": "clean_logs", "description": "Clean up old log files", "automated": true},
        {"order": 3, "action": "clean_temp", "description": "Clear temporary files and caches", "automated": true},
        {"order": 4, "action": "archive", "description": "Archive old data to cold storage", "automated": false},
        {"order": 5, "action": "expand", "description": "Expand disk volume if cloud environment", "automated": false},
        {"order": 6, "action": "alert", "description": "Alert team if manual intervention needed", "automated": true}
    ]'::jsonb,
    'system'
);

-- Create view for incident statistics
CREATE OR REPLACE VIEW incident_stats AS
SELECT 
    COUNT(*) as total_incidents,
    COUNT(CASE WHEN status = 'new' THEN 1 END) as new_incidents,
    COUNT(CASE WHEN status = 'triaged' THEN 1 END) as triaged_incidents,
    COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_incidents,
    COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_incidents,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_incidents,
    COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_incidents,
    COUNT(CASE WHEN severity = 'warning' THEN 1 END) as warning_incidents,
    COUNT(CASE WHEN severity = 'info' THEN 1 END) as info_incidents,
    AVG(CASE 
        WHEN resolved_at IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (resolved_at - created_at))/60 
        ELSE NULL 
    END) as avg_resolution_time_minutes
FROM incidents
WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '30 days';

-- Grant permissions (adjust as needed)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO opspilot_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO opspilot_user;