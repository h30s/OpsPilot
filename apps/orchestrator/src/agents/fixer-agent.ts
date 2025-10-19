import { LlmAgent, BaseTool, InvocationContext } from '@iqai/adk';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export class FixerAgent extends LlmAgent {
  private githubToken: string;
  private githubOwner: string;
  private githubRepo: string;
  private workDir: string;

  constructor() {
    super({
      name: 'FixerAgent',
      model: 'gemini-2.0-flash',
      description: 'Implements fixes, creates PRs, and verifies resolutions',
      tools: [
        {
          name: 'generate_patch',
          description: 'Generate a code patch for the issue',
          parameters: {
            type: 'object',
            properties: {
              issue: { type: 'object' },
              suggestedFix: { type: 'string' }
            },
            required: ['issue', 'suggestedFix']
          },
          execute: async (params: any) => this.generatePatch(params.issue, params.suggestedFix)
        } as any,
        {
          name: 'create_pull_request',
          description: 'Create a GitHub pull request',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              body: { type: 'string' },
              branch: { type: 'string' },
              files: { type: 'array' }
            },
            required: ['title', 'body', 'branch', 'files']
          },
          execute: async (params: any) => this.createPullRequest(params)
        } as any,
        {
          name: 'apply_config_change',
          description: 'Apply configuration changes',
          parameters: {
            type: 'object',
            properties: {
              service: { type: 'string' },
              config: { type: 'object' }
            },
            required: ['service', 'config']
          },
          execute: async (params: any) => this.applyConfigChange(params.service, params.config)
        } as any,
        {
          name: 'rollback_deployment',
          description: 'Rollback to a previous deployment',
          parameters: {
            type: 'object',
            properties: {
              service: { type: 'string' },
              version: { type: 'string' }
            },
            required: ['service']
          },
          execute: async (params: any) => this.rollbackDeployment(params.service, params.version)
        } as any,
        {
          name: 'verify_fix',
          description: 'Verify if the fix resolved the issue',
          parameters: {
            type: 'object',
            properties: {
              alertId: { type: 'string' },
              metrics: { type: 'array' }
            },
            required: ['alertId']
          },
          execute: async (params: any) => this.verifyFix(params.alertId, params.metrics)
        } as any
      ]
    });

    this.githubToken = process.env.GITHUB_TOKEN || '';
    this.githubOwner = process.env.GITHUB_REPO_OWNER || 'demo-owner';
    this.githubRepo = process.env.GITHUB_REPO_NAME || 'demo-repo';
    this.workDir = process.env.WORK_DIR || '/tmp/opspilot';
  }

  async applyFix(triageResult: any, approvedActions: string[]) {
    console.log(`[FixerAgent] Applying fixes for alert: ${triageResult.alertId}`);
    
    const results = {
      alertId: triageResult.alertId,
      appliedFixes: [] as any[],
      pullRequest: null as any,
      success: false,
      verificationStatus: 'pending'
    };

    try {
      // Filter approved actions
      const actionsToApply = triageResult.suggestedActions.filter((action: any) =>
        approvedActions.includes(action.type)
      );

      for (const action of actionsToApply) {
        console.log(`[FixerAgent] Applying action: ${action.type}`);

        switch (action.type) {
          case 'apply_fix': {
            const patch = await this.generatePatch(triageResult, action.description);
            if (patch.files && patch.files.length > 0) {
              const pr = await this.createPullRequest({
                title: `[AutoFix] ${triageResult.summary}`,
                body: this.generatePRBody(triageResult, patch),
                branch: `autofix/${triageResult.alertId}-${Date.now()}`,
                files: patch.files
              });
              results.pullRequest = pr;
              results.appliedFixes.push({
                type: 'pull_request',
                url: pr.url,
                status: 'created'
              });
            }
            break;
          }
          case 'rollback': {
            const rollbackResult = await this.rollbackDeployment(
              triageResult.labels?.service || 'unknown'
            );
            results.appliedFixes.push({
              type: 'rollback',
              service: rollbackResult.service,
              version: rollbackResult.version,
              status: rollbackResult.status
            });
            break;
          }
          case 'restart_service': {
            const restartResult = await this.restartService(
              triageResult.labels?.service || 'unknown'
            );
            results.appliedFixes.push({
              type: 'restart',
              service: restartResult.service,
              status: restartResult.status
            });
            break;
          }
          case 'scale_service': {
            const scaleResult = await this.scaleService(
              triageResult.labels?.service || 'unknown',
              2 // Scale factor
            );
            results.appliedFixes.push({
              type: 'scale',
              service: scaleResult.service,
              replicas: scaleResult.replicas,
              status: scaleResult.status
            });
            break;
          }
          case 'create_ticket': {
            const ticketResult = await this.createJiraTicket(triageResult);
            results.appliedFixes.push({
              type: 'jira_ticket',
              ticket: ticketResult.key,
              url: ticketResult.url,
              status: ticketResult.status
            });
            break;
          }
        }
      }

      // Verify the fix
      if (results.appliedFixes.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30s
        const verification = await this.verifyFix(triageResult.alertId);
        results.verificationStatus = verification.status;
        results.success = verification.status === 'resolved';
      }

    } catch (error) {
      console.error('[FixerAgent] Error applying fixes:', error);
      results.success = false;
    }

    return results;
  }

  private async generatePatch(issue: any, suggestedFix: string) {
    // Simplified patch generation - in production, use AI to generate actual code
    const patch = {
      issue: issue.summary,
      suggestedFix,
      files: [] as any[]
    };

    // Example: Generate a simple config update
    if (suggestedFix.toLowerCase().includes('memory')) {
      patch.files.push({
        path: 'k8s/deployment.yaml',
        content: this.generateMemoryPatch(),
        action: 'update'
      });
    } else if (suggestedFix.toLowerCase().includes('scale')) {
      patch.files.push({
        path: 'k8s/deployment.yaml',
        content: this.generateScalePatch(),
        action: 'update'
      });
    } else if (suggestedFix.toLowerCase().includes('timeout')) {
      patch.files.push({
        path: 'config/app.yaml',
        content: this.generateTimeoutPatch(),
        action: 'update'
      });
    }

    return patch;
  }

  private generateMemoryPatch() {
    return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
spec:
  template:
    spec:
      containers:
      - name: app
        resources:
          limits:
            memory: "2Gi"
          requests:
            memory: "1Gi"`;
  }

  private generateScalePatch() {
    return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: app`;
  }

  private generateTimeoutPatch() {
    return `server:
  timeout: 60
database:
  connectionTimeout: 30
  queryTimeout: 10
http:
  client:
    timeout: 30`;
  }

  private async createPullRequest(params: any) {
    try {
      // Create a new branch
      const branchResponse = await axios.post(
        `https://api.github.com/repos/${this.githubOwner}/${this.githubRepo}/git/refs`,
        {
          ref: `refs/heads/${params.branch}`,
          sha: await this.getDefaultBranchSHA()
        },
        {
          headers: {
            Authorization: `Bearer ${this.githubToken}`,
            Accept: 'application/vnd.github.v3+json'
          }
        }
      );

      // Create or update files
      for (const file of params.files) {
        await this.createOrUpdateFile(params.branch, file);
      }

      // Create pull request
      const baseBranch = await this.getDefaultBranchName();
      const prResponse = await axios.post(
        `https://api.github.com/repos/${this.githubOwner}/${this.githubRepo}/pulls`,
        {
          title: params.title,
          body: params.body,
          head: params.branch,
          base: baseBranch
        },
        {
          headers: {
            Authorization: `Bearer ${this.githubToken}`,
            Accept: 'application/vnd.github.v3+json'
          }
        }
      );

      return {
        url: prResponse.data.html_url,
        number: prResponse.data.number,
        state: prResponse.data.state,
        branch: params.branch
      };
    } catch (error) {
      console.error('[FixerAgent] Failed to create pull request:', error);
      throw error;
    }
  }

  private async getDefaultBranchName() {
    const response = await axios.get(
      `https://api.github.com/repos/${this.githubOwner}/${this.githubRepo}`,
      {
        headers: {
          Authorization: `Bearer ${this.githubToken}`,
          Accept: 'application/vnd.github.v3+json'
        }
      }
    );
    return response.data.default_branch || 'main';
  }

  private async getDefaultBranchSHA() {
    const base = await this.getDefaultBranchName();
    const response = await axios.get(
      `https://api.github.com/repos/${this.githubOwner}/${this.githubRepo}/git/refs/heads/${base}`,
      {
        headers: {
          Authorization: `Bearer ${this.githubToken}`,
          Accept: 'application/vnd.github.v3+json'
        }
      }
    );
    return response.data.object.sha;
  }

  private async createOrUpdateFile(branch: string, file: any) {
    const content = Buffer.from(file.content).toString('base64');
    
    try {
      // Get current file (if exists) to get SHA
      const currentFile = await axios.get(
        `https://api.github.com/repos/${this.githubOwner}/${this.githubRepo}/contents/${file.path}`,
        {
          headers: {
            Authorization: `Bearer ${this.githubToken}`,
            Accept: 'application/vnd.github.v3+json'
          },
          params: { ref: branch }
        }
      ).catch(() => null);

      await axios.put(
        `https://api.github.com/repos/${this.githubOwner}/${this.githubRepo}/contents/${file.path}`,
        {
          message: `[AutoFix] Update ${file.path}`,
          content,
          branch,
          ...(currentFile?.data?.sha && { sha: currentFile.data.sha })
        },
        {
          headers: {
            Authorization: `Bearer ${this.githubToken}`,
            Accept: 'application/vnd.github.v3+json'
          }
        }
      );
    } catch (error) {
      console.error(`[FixerAgent] Failed to update file ${file.path}:`, error);
    }
  }

  private async applyConfigChange(service: string, config: any) {
    console.log(`[FixerAgent] Applying config change to ${service}`);
    // In production, this would update actual configuration
    return {
      service,
      config,
      status: 'applied',
      timestamp: new Date().toISOString()
    };
  }

  private async rollbackDeployment(service: string, version?: string) {
    console.log(`[FixerAgent] Rolling back ${service} to ${version || 'previous version'}`);
    // In production, this would trigger actual rollback
    return {
      service,
      version: version || 'previous',
      status: 'rolled_back',
      timestamp: new Date().toISOString()
    };
  }

  private async restartService(service: string) {
    console.log(`[FixerAgent] Restarting service: ${service}`);
    // In production, this would restart the actual service
    return {
      service,
      status: 'restarted',
      timestamp: new Date().toISOString()
    };
  }

  private async scaleService(service: string, factor: number) {
    console.log(`[FixerAgent] Scaling service ${service} by factor ${factor}`);
    // In production, this would scale the actual service
    return {
      service,
      replicas: factor * 2, // Example scaling
      status: 'scaled',
      timestamp: new Date().toISOString()
    };
  }

  private async createJiraTicket(triageResult: any) {
    console.log(`[FixerAgent] Creating Jira ticket for alert: ${triageResult.alertId}`);
    
    const jiraDomain = process.env.JIRA_DOMAIN;
    const jiraEmail = process.env.JIRA_EMAIL;
    const jiraApiToken = process.env.JIRA_API_TOKEN;
    const projectKey = process.env.JIRA_PROJECT_KEY || 'OPS';

    if (!jiraDomain || !jiraEmail || !jiraApiToken) {
      console.warn('[FixerAgent] Jira credentials not configured');
      return {
        status: 'skipped',
        key: 'N/A',
        url: 'N/A',
        message: 'Jira credentials not configured'
      };
    }

    try {
      const auth = Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64');
      const url = `https://${jiraDomain}/rest/api/2/issue`;

      const description = `Alert: ${triageResult.summary}\n\n` +
        `Root Cause: ${triageResult.hypothesis?.primaryCause}\n` +
        `Confidence: ${(triageResult.hypothesis?.confidence * 100).toFixed(0)}%\n\n` +
        `Evidence:\n${triageResult.hypothesis?.evidence?.map((e: string) => `- ${e}`).join('\n') || 'None'}\n\n` +
        `Alert ID: ${triageResult.alertId}`;

      const response = await axios.post(
        url,
        {
          fields: {
            project: { key: projectKey },
            summary: `[OpsPilot] ${triageResult.summary}`,
            description,
            issuetype: { name: 'Task' },
            priority: { name: triageResult.severity === 'critical' ? 'Highest' : 'High' },
          },
        },
        {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log(`[FixerAgent] Jira ticket created: ${response.data.key}`);
      return {
        status: 'created',
        key: response.data.key,
        url: `https://${jiraDomain}/browse/${response.data.key}`,
      };
    } catch (error: any) {
      console.error('[FixerAgent] Failed to create Jira ticket:', error.response?.data || error.message);
      return {
        status: 'failed',
        key: 'N/A',
        url: 'N/A',
        error: error.response?.data?.errors || error.message
      };
    }
  }

  private async verifyFix(alertId: string, metrics?: any[]) {
    console.log(`[FixerAgent] Verifying fix for alert: ${alertId}`);
    
    // Check if alert is still firing
    const prometheusUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';
    try {
      const response = await axios.get(`${prometheusUrl}/api/v1/alerts`);
      const alerts = response.data.data.alerts || [];
      
      const stillFiring = alerts.some((alert: any) => {
        const idMatch = alert.fingerprint === alertId 
          || `${alert.labels?.alertname}-${alert.startsAt}` === alertId 
          || `${alert.labels?.alertname}-${alert.activeAt}` === alertId;
        return idMatch && alert.state === 'firing';
      });

      return {
        alertId,
        status: stillFiring ? 'still_firing' : 'resolved',
        timestamp: new Date().toISOString(),
        metrics
      };
    } catch (error) {
      console.error('[FixerAgent] Verification failed:', error);
      return {
        alertId,
        status: 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private generatePRBody(triageResult: any, patch: any) {
    return `## 🚨 Automated Fix for Alert

**Alert:** ${triageResult.summary}
**Severity:** ${triageResult.severity}
**Alert ID:** ${triageResult.alertId}

### 📊 Root Cause Analysis
**Hypothesis:** ${triageResult.hypothesis.primaryCause}
**Confidence:** ${(triageResult.hypothesis.confidence * 100).toFixed(0)}%

### 📝 Evidence
${triageResult.hypothesis.evidence.map((e: string) => `- ${e}`).join('\n')}

### 🔧 Changes Made
${patch.files.map((f: any) => `- Updated \`${f.path}\`: ${f.action}`).join('\n')}

### 📚 Related Runbooks
${triageResult.runbooks.map((r: any) => `- [${r.title}](runbook/${r.id})`).join('\n')}

### ✅ Checklist
- [ ] Changes have been tested locally
- [ ] No breaking changes introduced
- [ ] Monitoring confirms resolution
- [ ] Runbook updated if needed

---
*This PR was automatically generated by OpsPilot*`;
  }
}