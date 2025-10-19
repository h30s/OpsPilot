import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

export class GitHubMCPServer {
  private server: Server;
  private githubToken: string;
  private owner: string;
  private repo: string;

  constructor() {
    this.githubToken = process.env.GITHUB_TOKEN || '';
    this.owner = process.env.GITHUB_REPO_OWNER || 'demo-owner';
    this.repo = process.env.GITHUB_REPO_NAME || 'demo-repo';

    this.server = new Server(
      {
        name: 'github-mcp',
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
          name: 'github_get_commits',
          description: 'Get recent commits from a GitHub repository',
          inputSchema: {
            type: 'object',
            properties: {
              since: {
                type: 'string',
                description: 'ISO 8601 date string',
              },
              path: {
                type: 'string',
                description: 'File path to filter commits',
              },
            },
          },
        },
        {
          name: 'github_create_pr',
          description: 'Create a pull request on GitHub',
          inputSchema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'PR title',
              },
              body: {
                type: 'string',
                description: 'PR description',
              },
              head: {
                type: 'string',
                description: 'Branch to merge from',
              },
              base: {
                type: 'string',
                description: 'Branch to merge into',
              },
            },
            required: ['title', 'body', 'head', 'base'],
          },
        },
        {
          name: 'github_get_issues',
          description: 'Get issues from a GitHub repository',
          inputSchema: {
            type: 'object',
            properties: {
              state: {
                type: 'string',
                enum: ['open', 'closed', 'all'],
                description: 'Issue state filter',
              },
              labels: {
                type: 'string',
                description: 'Comma-separated list of labels',
              },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'github_get_commits':
          return await this.getCommits(args);
        case 'github_create_pr':
          return await this.createPullRequest(args);
        case 'github_get_issues':
          return await this.getIssues(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private async getCommits(args: any) {
    try {
      const url = `https://api.github.com/repos/${this.owner}/${this.repo}/commits`;
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${this.githubToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
        params: {
          since: args.since,
          path: args.path,
          per_page: 20,
        },
      });

      const commits = response.data.map((commit: any) => ({
        sha: commit.sha,
        message: commit.commit.message,
        author: commit.commit.author.name,
        date: commit.commit.author.date,
        url: commit.html_url,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(commits, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching commits: ${error.message}`,
          },
        ],
      };
    }
  }

  private async createPullRequest(args: any) {
    try {
      const url = `https://api.github.com/repos/${this.owner}/${this.repo}/pulls`;
      const response = await axios.post(
        url,
        {
          title: args.title,
          body: args.body,
          head: args.head,
          base: args.base,
        },
        {
          headers: {
            Authorization: `Bearer ${this.githubToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              url: response.data.html_url,
              number: response.data.number,
              state: response.data.state,
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error creating PR: ${error.message}`,
          },
        ],
      };
    }
  }

  private async getIssues(args: any) {
    try {
      const url = `https://api.github.com/repos/${this.owner}/${this.repo}/issues`;
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${this.githubToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
        params: {
          state: args.state || 'open',
          labels: args.labels,
          per_page: 20,
        },
      });

      const issues = response.data.map((issue: any) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        author: issue.user.login,
        created_at: issue.created_at,
        url: issue.html_url,
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
            text: `Error fetching issues: ${error.message}`,
          },
        ],
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[GitHub MCP] Server running');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new GitHubMCPServer();
  server.run().catch(console.error);
}
