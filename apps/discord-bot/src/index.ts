import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  Interaction,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import axios from 'axios';

const token = process.env.DISCORD_BOT_TOKEN;
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:4000';

if (!token) {
  console.warn('[discord-bot] DISCORD_BOT_TOKEN not configured - Discord bot disabled');
  console.warn('[discord-bot] The orchestrator will still work via API/webhook');
  console.warn('[discord-bot] Configure DISCORD_BOT_TOKEN in .env to enable Discord integration');
  // Keep process alive but don't connect to Discord
  setInterval(() => {}, 1000 * 60 * 60); // Keep alive
  // Exit early without creating client
} else {

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds
  ] 
});

client.once(Events.ClientReady, (c) => {
  console.log(`[discord-bot] Logged in as ${c.user.tag}`);
  console.log(`[discord-bot] Connected to orchestrator at ${ORCHESTRATOR_URL}`);
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  try {
    // Handle slash commands
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'ping') {
        await interaction.reply({ content: 'Pong! OpsPilot is operational 🟢', flags: 64 }); // Ephemeral
      } else if (interaction.commandName === 'simulate') {
        const type = interaction.options.getString('type');
        let alert: any = {};
        
        switch(type) {
          case 'memory':
            alert = {
              labels: {
                alertname: 'HighMemoryUsage',
                severity: 'warning',
                service: 'api-server',
                instance: 'api-01'
              },
              annotations: {
                summary: 'High memory usage on api-01',
                description: 'Memory usage is at 85%'
              },
              startsAt: new Date().toISOString(),
              fingerprint: `demo-memory-${Date.now()}`
            };
            break;
          case 'cpu':
            alert = {
              labels: {
                alertname: 'HighCPUUsage',
                severity: 'critical',
                service: 'worker-service',
                instance: 'worker-02'
              },
              annotations: {
                summary: 'High CPU usage on worker-02',
                description: 'CPU usage is at 95%'
              },
              startsAt: new Date().toISOString(),
              fingerprint: `demo-cpu-${Date.now()}`
            };
            break;
          case 'service':
            alert = {
              labels: {
                alertname: 'ServiceDown',
                severity: 'critical',
                service: 'payment-gateway',
                instance: 'payment-01'
              },
              annotations: {
                summary: 'Payment gateway is down',
                description: 'Service is not responding to health checks'
              },
              startsAt: new Date().toISOString(),
              fingerprint: `demo-service-${Date.now()}`
            };
            break;
          case 'disk':
            alert = {
              labels: {
                alertname: 'DiskSpaceLow',
                severity: 'warning',
                service: 'database',
                instance: 'db-01'
              },
              annotations: {
                summary: 'Low disk space on db-01',
                description: 'Only 10% disk space remaining'
              },
              startsAt: new Date().toISOString(),
              fingerprint: `demo-disk-${Date.now()}`
            };
            break;
        }
        
        try {
          await axios.post(`${ORCHESTRATOR_URL}/webhook/prometheus`, {
            alerts: [alert]
          });
          await interaction.reply({ 
            content: `📤 Simulated ${type} alert sent to OpsPilot!`, 
            flags: 64 // Ephemeral
          });
        } catch (error) {
          await interaction.reply({ 
            content: `Failed to send simulated ${type} alert. Make sure the orchestrator is running.`, 
            flags: 64 // Ephemeral
          });
        }
      } else if (interaction.commandName === 'incidents') {
        const status = interaction.options.getString('status') || 'all';
        await interaction.deferReply({ flags: 64 }); // Ephemeral
        
        try {
          const response = await axios.get(`${ORCHESTRATOR_URL}/api/incidents`);
          let incidents = response.data;
          
          if (status !== 'all') {
            incidents = incidents.filter((inc: any) => inc.status === status);
          }
          
          incidents = incidents.slice(0, 5);
          
          if (incidents.length === 0) {
            await interaction.editReply(`No ${status === 'all' ? '' : status} incidents found.`);
            return;
          }
          
          const embed = new EmbedBuilder()
            .setTitle(`Recent Incidents ${status !== 'all' ? `(${status})` : ''}`)
            .setColor(0x3498db)
            .setTimestamp();
          
          incidents.forEach((incident: any) => {
            embed.addFields({
              name: `${incident.id}`,
              value: `**${incident.summary}**\nSeverity: ${incident.severity}\nStatus: ${incident.status}`,
              inline: false
            });
          });
          
          await interaction.editReply({ embeds: [embed] });
        } catch (error) {
          await interaction.editReply('Failed to fetch incidents. Make sure the orchestrator is running.');
        }
      } else if (interaction.commandName === 'stats') {
        await interaction.deferReply({ flags: 64 }); // Ephemeral
        
        try {
          const response = await axios.get(`${ORCHESTRATOR_URL}/api/incidents`);
          const incidents = response.data;
          
          const stats = {
            total: incidents.length,
            open: incidents.filter((i: any) => i.status === 'open').length,
            triaged: incidents.filter((i: any) => i.status === 'triaged').length,
            resolved: incidents.filter((i: any) => i.status === 'resolved').length,
            failed: incidents.filter((i: any) => i.status === 'failed').length
          };
          
          const embed = new EmbedBuilder()
            .setTitle('OpsPilot Statistics')
            .setColor(0x00ff00)
            .addFields(
              { name: 'Total Incidents', value: stats.total.toString(), inline: true },
              { name: 'Open', value: stats.open.toString(), inline: true },
              { name: 'Triaged', value: stats.triaged.toString(), inline: true },
              { name: 'Resolved', value: stats.resolved.toString(), inline: true },
              { name: 'Failed', value: stats.failed.toString(), inline: true }
            )
            .setFooter({ text: 'OpsPilot v0.1.0' })
            .setTimestamp();
          
          await interaction.editReply({ embeds: [embed] });
        } catch (error) {
          await interaction.editReply('Failed to fetch statistics.');
        }
      } else if (interaction.commandName === 'runbook') {
        const keyword = interaction.options.getString('keyword');
        await interaction.reply({ 
          content: `🔍 Searching for runbooks matching "${keyword}"...\n*(Runbook search not yet implemented)*`, 
          flags: 64 // Ephemeral
        });
      } else if (interaction.commandName === 'opspilot') {
        const embed = new EmbedBuilder()
          .setTitle('OpsPilot Status')
          .setDescription('Your AI On-Call Team is monitoring the system')
          .setColor(0x00ff00)
          .addFields(
            { name: 'Orchestrator', value: '🟢 Online', inline: true },
            { name: 'Agents', value: '3 Active', inline: true },
            { name: 'Last Alert', value: 'None', inline: true }
          )
          .setFooter({ text: 'OpsPilot v0.1.0' })
          .setTimestamp();
        
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId('simulate_alert')
            .setLabel('Simulate Alert')
            .setEmoji('🔔')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('view_incidents')
            .setLabel('View Incidents')
            .setEmoji('📊')
            .setStyle(ButtonStyle.Secondary)
        );
        
        await interaction.reply({ embeds: [embed], components: [row] });
      }
    } 
    // Handle button interactions
    else if (interaction.isButton()) {
      const customId = interaction.customId;
      
      if (customId === 'simulate_alert') {
        // Simulate an alert
        const alert = {
          labels: {
            alertname: 'HighMemoryUsage',
            severity: 'warning',
            service: 'api-server',
            instance: 'api-01'
          },
          annotations: {
            summary: 'High memory usage on api-01',
            description: 'Memory usage is at 85%'
          },
          startsAt: new Date().toISOString(),
          fingerprint: `demo-${Date.now()}`
        };
        
        try {
          await axios.post(`${ORCHESTRATOR_URL}/webhook/prometheus`, {
            alerts: [alert]
          });
          await interaction.reply({ 
            content: '📤 Demo alert sent to OpsPilot!', 
            flags: 64 // Ephemeral
          });
        } catch (error) {
          await interaction.reply({ 
            content: 'Failed to send demo alert.', 
            flags: 64 // Ephemeral
          });
        }
      } else if (customId === 'view_incidents') {
        await interaction.deferReply({ flags: 64 }); // Ephemeral
        
        try {
          const response = await axios.get(`${ORCHESTRATOR_URL}/api/incidents`);
          const incidents = response.data.slice(0, 5);
          
          if (incidents.length === 0) {
            await interaction.editReply('No incidents found.');
            return;
          }
          
          const embed = new EmbedBuilder()
            .setTitle('Recent Incidents')
            .setColor(0x3498db)
            .setTimestamp();
          
          incidents.forEach((incident: any) => {
            embed.addFields({
              name: `${incident.id}`,
              value: `**${incident.summary}**\nSeverity: ${incident.severity}\nStatus: ${incident.status}`,
              inline: false
            });
          });
          
          await interaction.editReply({ embeds: [embed] });
        } catch (error) {
          await interaction.editReply('Failed to fetch incidents.');
        }
      } else if (customId.startsWith('approve_fix_')) {
        const incidentId = customId.replace('approve_fix_', '');
        await interaction.deferReply({ flags: 64 }); // Ephemeral
        
        try {
          const response = await axios.post(`${ORCHESTRATOR_URL}/api/approve/${incidentId}`, {
            actions: ['apply_fix', 'create_ticket']
          });
          
          const result = response.data;
          let message = `✅ Actions approved for incident ${incidentId}\n`;
          
          if (result.message) {
            message += `\n${result.message}`;
          }
          
          await interaction.editReply({
            content: message
          });
        } catch (error) {
          await interaction.editReply({
            content: 'Failed to apply fix. Check orchestrator logs.'
          });
        }
      } else if (customId.startsWith('view_details_')) {
        const incidentId = customId.replace('view_details_', '');
        await interaction.deferReply({ flags: 64 }); // Ephemeral
        
        try {
          const response = await axios.get(`${ORCHESTRATOR_URL}/api/incidents/${incidentId}`);
          const incident = response.data;
          
          const embed = new EmbedBuilder()
            .setTitle(`📋 Incident Details: ${incident.id}`)
            .setDescription(incident.summary || 'No summary available')
            .setColor(incident.severity === 'critical' ? 0xe74c3c : incident.severity === 'warning' ? 0xf39c12 : 0x3498db)
            .addFields(
              { name: 'Status', value: incident.status || 'Unknown', inline: true },
              { name: 'Severity', value: incident.severity || 'Unknown', inline: true },
              { name: 'Created', value: new Date(incident.created_at).toLocaleString(), inline: false }
            );
          
          if (incident.triage_result) {
            embed.addFields({
              name: 'Root Cause',
              value: incident.triage_result.hypothesis?.primaryCause || 'Unknown',
              inline: false
            });
            
            if (incident.triage_result.hypothesis?.confidence) {
              embed.addFields({
                name: 'Confidence',
                value: `${(incident.triage_result.hypothesis.confidence * 100).toFixed(0)}%`,
                inline: true
              });
            }
          }
          
          if (incident.fix_result) {
            const fixStatus = incident.fix_result.success ? '✅ Applied' : '❌ Failed';
            embed.addFields({
              name: 'Fix Status',
              value: fixStatus,
              inline: true
            });
            
            if (incident.fix_result.pullRequest?.url) {
              embed.addFields({
                name: 'Pull Request',
                value: `[View PR](${incident.fix_result.pullRequest.url})`,
                inline: false
              });
            }
          }
          
          await interaction.editReply({ embeds: [embed] });
        } catch (error) {
          console.error('Failed to fetch incident details:', error);
          await interaction.editReply('Failed to fetch incident details. The incident may not exist.');
        }
      } else if (customId.startsWith('create_ticket_')) {
        const incidentId = customId.replace('create_ticket_', '');
        await interaction.deferReply({ flags: 64 }); // Ephemeral
        
        try {
          // Call orchestrator to create Jira ticket only
          const response = await axios.post(`${ORCHESTRATOR_URL}/api/approve/${incidentId}`, {
            actions: ['create_ticket']
          });
          
          const result = response.data;
          let message = `🎫 Jira ticket created for incident ${incidentId}\n`;
          
          if (result.jiraTicket) {
            message += `\n📋 **Ticket**: [${result.jiraTicket.key}](${result.jiraTicket.url})`;
            message += `\n📊 **Status**: ${result.jiraTicket.status}`;
          } else if (result.message) {
            message += `\n${result.message}`;
          }
          
          await interaction.editReply({
            content: message
          });
        } catch (error) {
          console.error('Failed to create ticket:', error);
          await interaction.editReply({
            content: 'Failed to create Jira ticket. Check orchestrator logs for details.'
          });
        }
      } else if (customId.startsWith('escalate_')) {
        const incidentId = customId.replace('escalate_', '');
        await interaction.reply({
          content: `🚨 Escalating incident ${incidentId} to on-call engineer...`,
          flags: 64 // Ephemeral
        });
      } else if (customId === 'approve_pr' || customId === 'cancel_pr') {
        // Legacy handlers
        if (customId === 'approve_pr') {
          await interaction.update({
            content: 'Approved. Creating PR...\nPR: https://github.com/example/pull/1',
            components: [],
          });
        } else {
          await interaction.update({ content: 'Cancelled.', components: [] });
        }
      }
    }
  } catch (err) {
    console.error('Interaction error', err);
    if (interaction.isRepliable()) {
      try { 
        await interaction.reply({ 
          content: 'Something went wrong.', 
          flags: 64 // Ephemeral
        }); 
      } catch {}
    }
  }
});

  client.login(token);
} // Close else block from token check

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[discord-bot] Received SIGINT, shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[discord-bot] Received SIGTERM, shutting down gracefully...');
  client.destroy();
  process.exit(0);
});
