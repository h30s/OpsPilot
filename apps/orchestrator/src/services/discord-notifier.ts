import axios from 'axios';

export class DiscordNotifier {
  private webhookUrl: string;
  private apiUrl: string;
  private token: string;
  private alertChannelId: string;

  constructor() {
    this.webhookUrl = process.env.DISCORD_WEBHOOK_URL || '';
    this.apiUrl = 'https://discord.com/api/v10';
    this.token = process.env.DISCORD_BOT_TOKEN || '';
    this.alertChannelId = process.env.DISCORD_ALERT_CHANNEL_ID || '';
  }

  async sendAlert(incident: any) {
    const embed = {
      title: `🚨 Alert: ${incident?.summary || 'Unknown Alert'}`,
      description: incident?.description || 'No description provided',
      color: this.getSeverityColor(incident?.severity || 'warning'),
      fields: [
        { name: 'Incident ID', value: incident?.id || 'N/A', inline: true },
        { name: 'Severity', value: (incident?.severity || 'warning').toUpperCase(), inline: true },
        { name: 'Status', value: incident?.status || 'new', inline: true },
        { name: 'Alert ID', value: incident?.alert_id || incident?.alertData?.fingerprint || 'N/A', inline: false }
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'OpsPilot Alert System' }
    } as any;

    if (incident.labels && Object.keys(incident.labels).length > 0) {
      (embed.fields as any[]).push({
        name: 'Labels',
        value: Object.entries(incident.labels)
          .map(([k, v]) => `\`${k}: ${v}\``)
          .join(', '),
        inline: false
      });
    }

    try {
      if (this.token && this.alertChannelId) {
        await this.sendMessage(this.alertChannelId, '', [embed]);
      } else if (this.webhookUrl) {
        await axios.post(this.webhookUrl, { embeds: [embed] });
      } else {
        console.log('[DiscordNotifier] No Discord channel or webhook configured');
        console.log('[DiscordNotifier] Alert would have been sent:', {
          title: embed.title,
          severity: incident?.severity,
          id: incident?.id
        });
      }
    } catch (error) {
      console.error('[DiscordNotifier] Failed to send alert:', error);
    }
  }

  async sendTriageResult(incidentId: string, triageResult: any) {
    const embed = {
      title: `🔍 Triage Complete: ${triageResult.summary}`,
      description: `**Root Cause Hypothesis:** ${triageResult.hypothesis.primaryCause}\n` +
                   `**Confidence:** ${(triageResult.hypothesis.confidence * 100).toFixed(0)}%`,
      color: 0x3498db, // Blue
      fields: [
        { name: 'Incident ID', value: incidentId, inline: true },
        { name: 'Alert ID', value: triageResult.alertId, inline: true }
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'OpsPilot Triage System' }
    } as any;

    // Add evidence
    if (triageResult.hypothesis.evidence.length > 0) {
      (embed.fields as any[]).push({
        name: 'Evidence',
        value: triageResult.hypothesis.evidence
          .slice(0, 3)
          .map((e: string) => `• ${e}`)
          .join('\n'),
        inline: false
      });
    }

    // Add suggested actions
    if (triageResult.suggestedActions.length > 0) {
      const actionList = triageResult.suggestedActions
        .slice(0, 5)
        .map((a: any) => `• **${a.type}**: ${a.description} ${a.automated ? '🤖' : '👤'}`)
        .join('\n');
      
      (embed.fields as any[]).push({
        name: 'Suggested Actions',
        value: actionList,
        inline: false
      });
    }

    // Add runbooks
    if (triageResult.runbooks && triageResult.runbooks.length > 0) {
      (embed.fields as any[]).push({
        name: 'Relevant Runbooks',
        value: triageResult.runbooks
          .map((r: any) => `• ${r.title}`)
          .join('\n'),
        inline: false
      });
    }

    // Add buttons for approval
    const components = [{
      type: 1,
      components: [
        {
          type: 2,
          style: 3, // Success (green)
          label: 'Approve & Fix',
          custom_id: `approve_fix_${incidentId}`,
          emoji: { name: '✅' }
        },
        {
          type: 2,
          style: 1, // Primary (blue)
          label: 'Create Ticket',
          custom_id: `create_ticket_${incidentId}`,
          emoji: { name: '🎫' }
        },
        {
          type: 2,
          style: 2, // Secondary (gray)
          label: 'View Details',
          custom_id: `view_details_${incidentId}`,
          emoji: { name: '📊' }
        },
        {
          type: 2,
          style: 4, // Danger (red)
          label: 'Escalate',
          custom_id: `escalate_${incidentId}`,
          emoji: { name: '🚨' }
        }
      ]
    }];

    try {
      if (this.token && this.alertChannelId) {
        await this.sendMessage(this.alertChannelId, '', [embed], components);
      } else if (this.webhookUrl) {
        await axios.post(this.webhookUrl, { embeds: [embed], components });
      } else {
        console.log('[DiscordNotifier] No Discord channel or webhook configured, skipping notification');
      }
    } catch (error) {
      console.error('[DiscordNotifier] Failed to send triage result:', error);
    }
  }

  async sendFixResult(incidentId: string, fixResult: any) {
    const embed = {
      title: fixResult.success ? '✅ Fix Applied Successfully' : '❌ Fix Failed',
      description: `Incident: ${incidentId}`,
      color: fixResult.success ? 0x2ecc71 : 0xe74c3c,
      fields: [
        { 
          name: 'Verification Status', 
          value: fixResult.verificationStatus, 
          inline: true 
        }
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'OpsPilot Fixer System' }
    } as any;

    // Add PR info
    if (fixResult.pullRequest) {
      (embed.fields as any[]).push({
        name: 'Pull Request',
        value: `[PR #${fixResult.pullRequest.number}](${fixResult.pullRequest.url})`,
        inline: false
      });
    }

    // Add applied fixes
    if (fixResult.appliedFixes.length > 0) {
      const fixList = fixResult.appliedFixes
        .map((f: any) => `• **${f.type}**: ${f.status}`)
        .join('\n');
      
      (embed.fields as any[]).push({
        name: 'Applied Fixes',
        value: fixList,
        inline: false
      });
    }

    try {
      if (this.token && this.alertChannelId) {
        await this.sendMessage(this.alertChannelId, '', [embed]);
      } else if (this.webhookUrl) {
        await axios.post(this.webhookUrl, { embeds: [embed] });
      } else {
        console.log('[DiscordNotifier] No Discord channel or webhook configured, skipping notification');
      }
    } catch (error) {
      console.error('[DiscordNotifier] Failed to send fix result:', error);
    }
  }

  async createThread(channelId: string, name: string, message: string) {
    if (!this.token) {
      console.log('[DiscordNotifier] No bot token configured');
      return null;
    }

    try {
      // Create thread
      const threadResponse = await axios.post(
        `${this.apiUrl}/channels/${channelId}/threads`,
        {
          name,
          auto_archive_duration: 1440, // 24 hours
          type: 11 // Public thread
        },
        {
          headers: {
            Authorization: `Bot ${this.token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const threadId = threadResponse.data.id;

      // Send initial message
      await axios.post(
        `${this.apiUrl}/channels/${threadId}/messages`,
        { content: message },
        {
          headers: {
            Authorization: `Bot ${this.token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return threadId;
    } catch (error) {
      console.error('[DiscordNotifier] Failed to create thread:', error);
      return null;
    }
  }

  async sendMessage(channelId: string, content: string, embeds?: any[], components?: any[]) {
    if (!this.token) {
      console.log('[DiscordNotifier] No bot token configured');
      return;
    }

    try {
      await axios.post(
        `${this.apiUrl}/channels/${channelId}/messages`,
        { content, embeds, components },
        {
          headers: {
            Authorization: `Bot ${this.token}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      console.error('[DiscordNotifier] Failed to send message:', error);
    }
  }

  private getSeverityColor(severity: string): number {
    switch (severity.toLowerCase()) {
      case 'critical':
        return 0xe74c3c; // Red
      case 'warning':
        return 0xf39c12; // Orange
      case 'info':
        return 0x3498db; // Blue
      default:
        return 0x95a5a6; // Gray
    }
  }

  async sendIncidentReport(channelId: string, report: any) {
    const embed = {
      title: `📊 Incident Report: ${report.incident.id}`,
      description: report.summary,
      color: 0x2ecc71,
      fields: [
        { 
          name: 'Time to Detect', 
          value: `${report.metrics.timeToDetect}s`, 
          inline: true 
        },
        { 
          name: 'Time to Triage', 
          value: `${report.metrics.timeToTriage}s`, 
          inline: true 
        },
        { 
          name: 'Time to Resolve', 
          value: `${report.metrics.timeToResolve}s`, 
          inline: true 
        }
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'OpsPilot Report System' }
    };

    if (report.relatedIncidents.length > 0) {
      embed.fields.push({
        name: 'Related Incidents',
        value: report.relatedIncidents
          .slice(0, 3)
          .map((i: any) => `• ${i.id}: ${i.summary}`)
          .join('\n'),
        inline: false
      });
    }

    await this.sendMessage(channelId, '', [embed]);
  }
}