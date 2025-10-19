import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

export class PagerDutyMCPServer {
  private server: Server;
  private pdToken: string;
  private serviceId: string;

  constructor() {
    this.pdToken = process.env.PAGERDUTY_TOKEN || '';
    this.serviceId = process.env.PAGERDUTY_SERVICE_ID || '';

    this.server = new Server(
      {
        name: 'pagerduty-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'pd_create_incident',
          description: 'Create a PagerDuty incident',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              urgency: { 
                type: 'string',
                enum: ['high', 'low'],
              },
            },
            required: ['title'],
          },
        },
        {
          name: 'pd_get_incidents',
          description: 'Get PagerDuty incidents',
          inputSchema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['triggered', 'acknowledged', 'resolved'],
              },
              limit: { type: 'number' },
            },
          },
        },
        {
          name: 'pd_acknowledge_incident',
          description: 'Acknowledge a PagerDuty incident',
          inputSchema: {
            type: 'object',
            properties: {
              incidentId: { type: 'string' },
            },
            required: ['incidentId'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'pd_create_incident':
          return await this.createIncident(args);
        case 'pd_get_incidents':
          return await this.getIncidents(args);
        case 'pd_acknowledge_incident':
          return await this.acknowledgeIncident(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private async createIncident(args: any) {
    try {
      const response = await axios.post(
        'https://api.pagerduty.com/incidents',
        {
          incident: {
            type: 'incident',
            title: args.title,
            service: {
              id: this.serviceId,
              type: 'service_reference',
            },
            body: {
              type: 'incident_body',
              details: args.description || args.title,
            },
            urgency: args.urgency || 'high',
          },
        },
        {
          headers: {
            Authorization: `Token token=${this.pdToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/vnd.pagerduty+json;version=2',
            From: 'opspilot@example.com',
          },
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id: response.data.incident.id,
              title: response.data.incident.title,
              status: response.data.incident.status,
              url: response.data.incident.html_url,
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error creating incident: ${error.message}`,
          },
        ],
      };
    }
  }

  private async getIncidents(args: any) {
    try {
      const response = await axios.get('https://api.pagerduty.com/incidents', {
        headers: {
          Authorization: `Token token=${this.pdToken}`,
          Accept: 'application/vnd.pagerduty+json;version=2',
        },
        params: {
          service_ids: [this.serviceId],
          statuses: args.status ? [args.status] : undefined,
          limit: args.limit || 10,
        },
      });

      const incidents = response.data.incidents.map((incident: any) => ({
        id: incident.id,
        title: incident.title,
        status: incident.status,
        created_at: incident.created_at,
        urgency: incident.urgency,
        url: incident.html_url,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(incidents, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching incidents: ${error.message}`,
          },
        ],
      };
    }
  }

  private async acknowledgeIncident(args: any) {
    try {
      const response = await axios.put(
        `https://api.pagerduty.com/incidents/${args.incidentId}`,
        {
          incident: {
            type: 'incident',
            status: 'acknowledged',
          },
        },
        {
          headers: {
            Authorization: `Token token=${this.pdToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/vnd.pagerduty+json;version=2',
            From: 'opspilot@example.com',
          },
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: `Incident ${args.incidentId} acknowledged`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error acknowledging incident: ${error.message}`,
          },
        ],
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[PagerDuty MCP] Server running');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new PagerDutyMCPServer();
  server.run().catch(console.error);
}
