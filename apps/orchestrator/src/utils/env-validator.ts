/**
 * Environment Variable Validator
 * Validates and provides helpful error messages for missing configuration
 */

export interface EnvConfig {
  required: string[];
  optional: string[];
  descriptions: Record<string, string>;
}

export const orchestratorEnvConfig: EnvConfig = {
  // For demo mode we don't require external services; DB/Redis are optional
  required: [],
  optional: [
    'PORT',
    'NODE_ENV',
    'DATABASE_URL',
    'REDIS_URL',
    'GITHUB_TOKEN',
    'GITHUB_REPO_OWNER',
    'GITHUB_REPO_NAME',
    'JIRA_DOMAIN',
    'JIRA_EMAIL',
    'JIRA_API_TOKEN',
    'JIRA_PROJECT_KEY',
    'PAGERDUTY_TOKEN',
    'PAGERDUTY_SERVICE_ID',
    'PROMETHEUS_URL',
    'DISCORD_WEBHOOK_URL',
    'DISCORD_ALERT_CHANNEL_ID',
    'GOOGLE_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'ATP_API_URL',
    'ATP_TOKEN',
    'WORK_DIR',
  ],
  descriptions: {
    DATABASE_URL: 'PostgreSQL connection string (optional in demo mode)',
    REDIS_URL: 'Redis connection string (optional in demo mode)',
    PORT: 'HTTP server port (default: 4000)',
    NODE_ENV: 'Environment mode: development | production | test',
    GITHUB_TOKEN: 'GitHub Personal Access Token for PR automation',
    GITHUB_REPO_OWNER: 'GitHub repository owner/organization name',
    GITHUB_REPO_NAME: 'GitHub repository name',
    JIRA_DOMAIN: 'Jira domain (e.g., yourcompany.atlassian.net)',
    JIRA_EMAIL: 'Jira account email',
    JIRA_API_TOKEN: 'Jira API token',
    JIRA_PROJECT_KEY: 'Default Jira project key (e.g., OPS)',
    PAGERDUTY_TOKEN: 'PagerDuty API token',
    PAGERDUTY_SERVICE_ID: 'PagerDuty service ID',
    PROMETHEUS_URL: 'Prometheus server URL (default: http://localhost:9090)',
    DISCORD_WEBHOOK_URL: 'Discord webhook URL for notifications',
    DISCORD_ALERT_CHANNEL_ID: 'Discord channel ID for alerts',
    GOOGLE_API_KEY: 'Google AI API key for Gemini models',
    OPENAI_API_KEY: 'OpenAI API key',
    ANTHROPIC_API_KEY: 'Anthropic API key for Claude',
    ATP_API_URL: 'IQ AI ATP API URL',
    ATP_TOKEN: 'IQ AI ATP authentication token',
    WORK_DIR: 'Working directory for temporary files',
  },
};

export interface ValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
  configured: string[];
}

export function validateEnvironment(config: EnvConfig): ValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  const configured: string[] = [];

  // Check required variables
  for (const key of config.required) {
    if (!process.env[key] || process.env[key]?.trim() === '') {
      missing.push(key);
    } else {
      configured.push(key);
    }
  }

  // Check optional but recommended variables
  const recommendedOptional = [
    'GITHUB_TOKEN',
    'PROMETHEUS_URL',
    'GOOGLE_API_KEY',
  ];

  for (const key of recommendedOptional) {
    if (!process.env[key] || process.env[key]?.trim() === '') {
      warnings.push(key);
    } else {
      configured.push(key);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
    configured,
  };
}

export function printValidationReport(
  config: EnvConfig,
  result: ValidationResult,
  serviceName: string = 'OpsPilot'
): void {
  console.log(`\n🔍 ${serviceName} Environment Configuration\n`);

  if (result.valid) {
    console.log('✅ All required environment variables are configured\n');
  } else {
    console.error('❌ Missing required environment variables:\n');
    for (const key of result.missing) {
      console.error(`  • ${key}`);
      console.error(`    ${config.descriptions[key] || 'No description available'}`);
      console.error('');
    }
  }

  if (result.warnings.length > 0) {
    console.warn('⚠️  Recommended environment variables not configured:\n');
    for (const key of result.warnings) {
      console.warn(`  • ${key}`);
      console.warn(`    ${config.descriptions[key] || 'No description available'}`);
      console.warn('');
    }
    console.warn('  Note: These are optional but recommended for full functionality\n');
  }

  if (result.configured.length > 0 && (result.missing.length > 0 || result.warnings.length > 0)) {
    console.log(`✓ Configured: ${result.configured.length} variables`);
  }

  if (!result.valid) {
    console.error('❌ Environment validation failed. Please set the required variables.');
    console.error('   See apps/orchestrator/.env.example for reference\n');
    throw new Error('Environment validation failed');
  }

  console.log('');
}

export function getEnvWithDefault(key: string, defaultValue: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    return defaultValue;
  }
  return value;
}

export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}
