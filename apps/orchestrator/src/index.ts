import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });
import { createServer } from 'node:http';
import { EventEmitter } from 'events';
import { Runner, InMemorySessionService } from '@iqai/adk';
import { WatcherAgent } from './agents/watcher-agent.js';
import { TriageAgent } from './agents/triage-agent.js';
import { FixerAgent } from './agents/fixer-agent.js';
import { IncidentManager } from './services/incident-manager.js';
import { DiscordNotifier } from './services/discord-notifier.js';
import { DatabaseService } from './services/database.js';
import { 
  validateEnvironment, 
  printValidationReport, 
  orchestratorEnvConfig 
} from './utils/env-validator.js';

const PORT = Number(process.env.PORT || 4000);

// Validate environment configuration
console.log('OpsPilot Orchestrator starting...');
try {
  const validationResult = validateEnvironment(orchestratorEnvConfig);
  printValidationReport(orchestratorEnvConfig, validationResult, 'Orchestrator');
} catch (error) {
  console.error('\n❌ Startup failed due to environment configuration issues\n');
  process.exit(1);
}

// Initialize services
const alertEmitter = new EventEmitter();
const sessionService = new InMemorySessionService();
const database = new DatabaseService();
const incidentManager = new IncidentManager(database);
const discordNotifier = new DiscordNotifier();

// Initialize agents
const watcherAgent = new WatcherAgent(alertEmitter);
const triageAgent = new TriageAgent();
const fixerAgent = new FixerAgent();

// Runner will be initialized in start function
let runner: Runner;
let session: any;

// Handle alerts
alertEmitter.on('alert', async (alert: any) => {
  try {
    console.log(`[Orchestrator] Processing alert: ${alert?.annotations?.summary || alert?.summary || 'Unknown'}`);
    
    // Ensure alert has required fields
    if (!alert) {
      console.error('[Orchestrator] Received null/undefined alert');
      return;
    }
    
    // Create incident
    const incident = await incidentManager.createIncident(alert);
    
    // Notify Discord
    await discordNotifier.sendAlert(incident);
    
    // Triage the alert
    const triageResult = await triageAgent.triageAlert(alert);
    
    // Update incident with triage results
    await incidentManager.updateIncident(incident.id, {
      triageResult,
      status: 'triaged'
    });
    
    // Send triage results to Discord
    await discordNotifier.sendTriageResult(incident.id, triageResult);
    
    // If auto-fix is enabled and confidence is high
    if (triageResult.hypothesis.confidence > 0.8) {
      const autoActions = triageResult.suggestedActions
        .filter((a: any) => a.automated)
        .map((a: any) => a.type);
      
      if (autoActions.length > 0) {
        console.log(`[Orchestrator] Auto-fixes available but disabled (GitHub permissions needed)`);
        console.log(`[Orchestrator] Suggested actions: ${autoActions.join(', ')}`);
        // Commenting out auto-fix to avoid GitHub permission errors
        // const fixResult = await fixerAgent.applyFix(triageResult, autoActions);
        // 
        // await incidentManager.updateIncident(incident.id, {
        //   fixResult,
        //   status: fixResult.success ? 'resolved' : 'failed'
        // });
        // 
        // await discordNotifier.sendFixResult(incident.id, fixResult);
      }
    }
  } catch (error) {
    console.error('[Orchestrator] Error processing alert:', error);
  }
});

// API endpoints
const server = createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  
  if (req.url === '/webhook/prometheus' && req.method === 'POST') {
    // Handle Prometheus webhook
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        for (const alert of data.alerts || []) {
          alertEmitter.emit('alert', alert);
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'received' }));
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }
  
  if (req.url?.startsWith('/api/incidents') && req.method === 'GET') {
    // Check if requesting a specific incident
    const match = req.url.match(/\/api\/incidents\/([^/]+)/);
    if (match && match[1]) {
      // Get specific incident
      const incidentId = match[1];
      const incident = await incidentManager.getIncident(incidentId);
      if (incident) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(incident));
      } else {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Incident not found' }));
      }
    } else {
      // Get all incidents
      const incidents = await incidentManager.getIncidents();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(incidents));
    }
    return;
  }
  
  if (req.url?.startsWith('/api/approve/') && req.method === 'POST') {
    // Approve actions
    const incidentId = req.url.split('/').pop();
    if (incidentId) {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const { actions } = JSON.parse(body);
          const incident = await incidentManager.getIncident(incidentId);
          
          if (!incident) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'Incident not found' }));
            return;
          }

          // Apply real fixes (creates PR and Jira ticket when configured)
          const fixResult = await fixerAgent.applyFix(
            incident.triageResult || incident.triage_result,
            actions
          );

          // Extract Jira ticket info from appliedFixes if present
          const jiraFix = fixResult.appliedFixes?.find((fix: any) => fix.type === 'jira_ticket');
          if (jiraFix) {
            fixResult.jiraTicket = {
              key: jiraFix.ticket,
              url: jiraFix.url,
              status: jiraFix.status
            };
          }

          await incidentManager.updateIncident(incidentId, {
            fixResult,
            status: fixResult.success ? 'resolved' : 'failed'
          });

          // Notify Discord with results (PR link, ticket, etc.)
          await discordNotifier.sendFixResult(incidentId, fixResult);

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(fixResult));
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request' }));
        }
      });
    }
    return;
  }
  
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

// Start services
async function start() {
  try {
    // Initialize database
    await database.connect();
    
    // Initialize session and runner
    session = await sessionService.createSession(
      'opspilot',
      'system',
      {},
      'orchestrator-session'
    );
    
    runner = new Runner({
      appName: 'opspilot',
      agent: triageAgent,
      sessionService
    });
    
    // Initialize agents
    await watcherAgent.initialize();
    
    // Start runner (no explicit start needed)
    console.log('[Orchestrator] Ready to process alerts');
    
    // Start HTTP server
    server.listen(PORT, () => {
      console.log(`[orchestrator] listening on http://localhost:${PORT}`);
      console.log('[orchestrator] Webhook URL: http://localhost:' + PORT + '/webhook/prometheus');
    });
  } catch (error) {
    console.error('[Orchestrator] Failed to start:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Orchestrator] Shutting down...');
  await watcherAgent.stop();
  // No orchestrator.stop() needed with Runner
  await database.disconnect();
  server.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n[Orchestrator] Received SIGINT, shutting down gracefully...');
  await watcherAgent.stop();
  await database.disconnect();
  server.close();
  process.exit(0);
});

start();
