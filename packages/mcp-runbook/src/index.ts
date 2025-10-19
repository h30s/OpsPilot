import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';

interface Runbook {
  id: string;
  title: string;
  keywords: string[];
  description: string;
  steps: string[];
  created_at: string;
  updated_at: string;
  version: number;
}

export class RunbookMCPServer {
  private server: Server;
  private runbooksPath: string;
  private runbooks: Map<string, Runbook> = new Map();

  constructor() {
    this.runbooksPath = process.env.RUNBOOKS_PATH || './runbooks';

    this.server = new Server(
      {
        name: 'runbook-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
    this.loadRunbooks();
  }

  private async loadRunbooks() {
    try {
      await fs.mkdir(this.runbooksPath, { recursive: true });
      const files = await fs.readdir(this.runbooksPath);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(this.runbooksPath, file), 'utf-8');
          const runbook = JSON.parse(content);
          this.runbooks.set(runbook.id, runbook);
        }
      }
    } catch (error) {
      console.error('Failed to load runbooks:', error);
    }
  }

  private async saveRunbook(runbook: Runbook) {
    const filePath = path.join(this.runbooksPath, `${runbook.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(runbook, null, 2));
    this.runbooks.set(runbook.id, runbook);
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'runbook_search',
          description: 'Search for runbooks by keywords',
          inputSchema: {
            type: 'object',
            properties: {
              keywords: {
                type: 'array',
                items: { type: 'string' },
                description: 'Keywords to search for',
              },
            },
            required: ['keywords'],
          },
        },
        {
          name: 'runbook_create',
          description: 'Create a new runbook',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              keywords: {
                type: 'array',
                items: { type: 'string' },
              },
              steps: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['title', 'keywords', 'steps'],
          },
        },
        {
          name: 'runbook_update',
          description: 'Update an existing runbook',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              keywords: {
                type: 'array',
                items: { type: 'string' },
              },
              steps: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['id'],
          },
        },
      ],
    }));

    // List available runbooks as resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: Array.from(this.runbooks.values()).map(runbook => ({
        uri: `runbook:///${runbook.id}`,
        name: runbook.title,
        description: runbook.description,
        mimeType: 'application/json',
      })),
    }));

    // Read a specific runbook resource
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const runbookId = request.params.uri.replace('runbook:///', '');
      const runbook = this.runbooks.get(runbookId);
      
      if (!runbook) {
        throw new Error(`Runbook ${runbookId} not found`);
      }

      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: 'application/json',
            text: JSON.stringify(runbook, null, 2),
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'runbook_search':
          return await this.searchRunbooks(args);
        case 'runbook_create':
          return await this.createRunbook(args);
        case 'runbook_update':
          return await this.updateRunbook(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private async searchRunbooks(args: any) {
    const { keywords } = args;
    const results = Array.from(this.runbooks.values()).filter(runbook =>
      runbook.keywords.some(keyword =>
        keywords.some((k: string) => k.toLowerCase().includes(keyword.toLowerCase()))
      )
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  }

  private async createRunbook(args: any) {
    const runbook: Runbook = {
      id: `rb-${Date.now()}`,
      title: args.title,
      description: args.description || '',
      keywords: args.keywords,
      steps: args.steps,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };

    await this.saveRunbook(runbook);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            id: runbook.id,
            message: 'Runbook created successfully',
          }, null, 2),
        },
      ],
    };
  }

  private async updateRunbook(args: any) {
    const existing = this.runbooks.get(args.id);
    
    if (!existing) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: Runbook ${args.id} not found`,
          },
        ],
      };
    }

    const updated: Runbook = {
      ...existing,
      title: args.title || existing.title,
      description: args.description || existing.description,
      keywords: args.keywords || existing.keywords,
      steps: args.steps || existing.steps,
      updated_at: new Date().toISOString(),
      version: existing.version + 1,
    };

    await this.saveRunbook(updated);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            id: updated.id,
            message: 'Runbook updated successfully',
            version: updated.version,
          }, null, 2),
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[Runbook MCP] Server running');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new RunbookMCPServer();
  server.run().catch(console.error);
}
