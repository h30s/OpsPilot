import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

export class PrometheusMCPServer {
  private server: Server;
  private prometheusUrl: string;

  constructor() {
    this.prometheusUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';

    this.server = new Server(
      {
        name: 'prometheus-mcp',
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
          name: 'prom_query',
          description: 'Execute a Prometheus query',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'PromQL query',
              },
              time: {
                type: 'string',
                description: 'Evaluation time (ISO 8601)',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'prom_query_range',
          description: 'Execute a Prometheus range query',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'PromQL query',
              },
              start: {
                type: 'string',
                description: 'Start time (ISO 8601)',
              },
              end: {
                type: 'string',
                description: 'End time (ISO 8601)',
              },
              step: {
                type: 'string',
                description: 'Query resolution step width',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'prom_get_alerts',
          description: 'Get active alerts from Prometheus',
          inputSchema: {
            type: 'object',
            properties: {
              state: {
                type: 'string',
                enum: ['firing', 'pending', 'inactive'],
                description: 'Alert state filter',
              },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'prom_query':
          return await this.query(args);
        case 'prom_query_range':
          return await this.queryRange(args);
        case 'prom_get_alerts':
          return await this.getAlerts(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private async query(args: any) {
    try {
      const response = await axios.get(`${this.prometheusUrl}/api/v1/query`, {
        params: {
          query: args.query,
          time: args.time,
        },
      });

      const result = response.data.data;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing query: ${error.message}`,
          },
        ],
      };
    }
  }

  private async queryRange(args: any) {
    try {
      const now = new Date();
      const response = await axios.get(`${this.prometheusUrl}/api/v1/query_range`, {
        params: {
          query: args.query,
          start: args.start || new Date(now.getTime() - 3600000).toISOString(),
          end: args.end || now.toISOString(),
          step: args.step || '60s',
        },
      });

      const result = response.data.data;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing range query: ${error.message}`,
          },
        ],
      };
    }
  }

  private async getAlerts(args: any) {
    try {
      const response = await axios.get(`${this.prometheusUrl}/api/v1/alerts`);
      
      let alerts = response.data.data.alerts || [];
      
      // Filter by state if provided
      if (args.state) {
        alerts = alerts.filter((alert: any) => alert.state === args.state);
      }

      const formattedAlerts = alerts.map((alert: any) => ({
        labels: alert.labels,
        annotations: alert.annotations,
        state: alert.state,
        activeAt: alert.activeAt,
        value: alert.value,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(formattedAlerts, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching alerts: ${error.message}`,
          },
        ],
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[Prometheus MCP] Server running');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new PrometheusMCPServer();
  server.run().catch(console.error);
}
