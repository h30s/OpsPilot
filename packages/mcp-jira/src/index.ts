import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

export class JiraMCPServer {
  private server: Server;
  private jiraDomain: string;
  private jiraEmail: string;
  private jiraApiToken: string;
  private projectKey: string;

  constructor() {
    this.jiraDomain = process.env.JIRA_DOMAIN || '';
    this.jiraEmail = process.env.JIRA_EMAIL || '';
    this.jiraApiToken = process.env.JIRA_API_TOKEN || '';
    this.projectKey = process.env.JIRA_PROJECT_KEY || 'OPS';

    this.server = new Server(
      {
        name: 'jira-mcp',
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
          name: 'jira_create_issue',
          description: 'Create a new Jira issue',
          inputSchema: {
            type: 'object',
            properties: {
              summary: {
                type: 'string',
                description: 'Issue summary',
              },
              description: {
                type: 'string',
                description: 'Issue description',
              },
              issueType: {
                type: 'string',
                description: 'Issue type (Bug, Task, Story)',
              },
              priority: {
                type: 'string',
                description: 'Priority (Highest, High, Medium, Low, Lowest)',
              },
            },
            required: ['summary', 'description'],
          },
        },
        {
          name: 'jira_update_issue',
          description: 'Update an existing Jira issue',
          inputSchema: {
            type: 'object',
            properties: {
              issueKey: {
                type: 'string',
                description: 'Issue key (e.g., OPS-123)',
              },
              status: {
                type: 'string',
                description: 'New status',
              },
              comment: {
                type: 'string',
                description: 'Comment to add',
              },
            },
            required: ['issueKey'],
          },
        },
        {
          name: 'jira_search_issues',
          description: 'Search for Jira issues',
          inputSchema: {
            type: 'object',
            properties: {
              jql: {
                type: 'string',
                description: 'JQL query',
              },
              maxResults: {
                type: 'number',
                description: 'Maximum results',
              },
            },
            required: ['jql'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'jira_create_issue':
          return await this.createIssue(args);
        case 'jira_update_issue':
          return await this.updateIssue(args);
        case 'jira_search_issues':
          return await this.searchIssues(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private async createIssue(args: any) {
    try {
      const url = `https://${this.jiraDomain}/rest/api/2/issue`;
      const auth = Buffer.from(`${this.jiraEmail}:${this.jiraApiToken}`).toString('base64');
      
      const response = await axios.post(
        url,
        {
          fields: {
            project: { key: this.projectKey },
            summary: args.summary,
            description: args.description,
            issuetype: { name: args.issueType || 'Task' },
            priority: { name: args.priority || 'Medium' },
          },
        },
        {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              key: response.data.key,
              url: `https://${this.jiraDomain}/browse/${response.data.key}`,
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error creating Jira issue: ${error.message}`,
          },
        ],
      };
    }
  }

  private async updateIssue(args: any) {
    try {
      const auth = Buffer.from(`${this.jiraEmail}:${this.jiraApiToken}`).toString('base64');
      
      // Add comment if provided
      if (args.comment) {
        const commentUrl = `https://${this.jiraDomain}/rest/api/2/issue/${args.issueKey}/comment`;
        await axios.post(
          commentUrl,
          { body: args.comment },
          {
            headers: {
              Authorization: `Basic ${auth}`,
              'Content-Type': 'application/json',
            },
          }
        );
      }

      // Update status if provided
      if (args.status) {
        const transitionUrl = `https://${this.jiraDomain}/rest/api/2/issue/${args.issueKey}/transitions`;
        const transitionsResponse = await axios.get(transitionUrl, {
          headers: { Authorization: `Basic ${auth}` },
        });

        const transition = transitionsResponse.data.transitions.find(
          (t: any) => t.name.toLowerCase() === args.status.toLowerCase()
        );

        if (transition) {
          await axios.post(
            transitionUrl,
            { transition: { id: transition.id } },
            {
              headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/json',
              },
            }
          );
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `Issue ${args.issueKey} updated successfully`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error updating Jira issue: ${error.message}`,
          },
        ],
      };
    }
  }

  private async searchIssues(args: any) {
    try {
      const url = `https://${this.jiraDomain}/rest/api/2/search`;
      const auth = Buffer.from(`${this.jiraEmail}:${this.jiraApiToken}`).toString('base64');
      
      const response = await axios.get(url, {
        headers: {
          Authorization: `Basic ${auth}`,
        },
        params: {
          jql: args.jql,
          maxResults: args.maxResults || 10,
        },
      });

      const issues = response.data.issues.map((issue: any) => ({
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        priority: issue.fields.priority?.name,
        assignee: issue.fields.assignee?.displayName,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(issues, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error searching Jira issues: ${error.message}`,
          },
        ],
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[Jira MCP] Server running');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new JiraMCPServer();
  server.run().catch(console.error);
}
