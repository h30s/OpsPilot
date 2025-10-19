import { EventEmitter } from 'events';
import axios from 'axios';

export interface Alert {
  fingerprint: string;
  labels: {
    alertname: string;
    severity: string;
    service?: string;
    instance?: string;
    [key: string]: string | undefined;
  };
  annotations: {
    summary: string;
    description?: string;
    [key: string]: string | undefined;
  };
  startsAt: string;
  endsAt?: string;
  status?: 'firing' | 'resolved';
}

export class WatcherAgent {
  private alertEmitter: EventEmitter;
  private pollInterval: NodeJS.Timeout | null = null;
  private processedAlerts = new Set<string>();

  constructor(alertEmitter: EventEmitter) {
    this.alertEmitter = alertEmitter;
  }

  async initialize() {
    console.log('[WatcherAgent] Initialized and watching for alerts');
    
    // Start polling if Prometheus URL is configured
    const prometheusUrl = process.env.PROMETHEUS_URL;
    if (prometheusUrl && prometheusUrl.trim() !== '') {
      console.log(`[WatcherAgent] Starting Prometheus polling at ${prometheusUrl}`);
      this.startPolling(prometheusUrl);
    } else {
      console.log('[WatcherAgent] No Prometheus URL configured, using webhook mode only');
    }
  }

  private startPolling(prometheusUrl: string) {
    // Poll Prometheus alerts API every 30 seconds
    this.pollInterval = setInterval(async () => {
      try {
        const response = await axios.get(`${prometheusUrl}/api/v1/alerts`);
        const alerts = response.data?.data?.alerts || [];
        
        for (const alert of alerts) {
          if (alert.state === 'firing') {
            const fingerprint = this.generateFingerprint(alert);
            
            if (!this.processedAlerts.has(fingerprint)) {
              this.processedAlerts.add(fingerprint);
              
              const normalizedAlert: Alert = {
                fingerprint,
                labels: alert.labels,
                annotations: alert.annotations,
                startsAt: alert.activeAt,
                status: 'firing'
              };
              
              console.log(`[WatcherAgent] New alert detected: ${alert.labels.alertname}`);
              this.alertEmitter.emit('alert', normalizedAlert);
            }
          }
        }
      } catch (error) {
        console.error('[WatcherAgent] Error polling Prometheus:', error);
      }
    }, 30000); // Poll every 30 seconds
  }

  private generateFingerprint(alert: any): string {
    const key = `${alert.labels.alertname}-${alert.labels.instance || 'unknown'}-${alert.activeAt}`;
    return Buffer.from(key).toString('base64');
  }

  async stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log('[WatcherAgent] Stopped');
  }

  // Method to manually inject an alert (for testing/webhooks)
  injectAlert(alert: Alert) {
    if (!this.processedAlerts.has(alert.fingerprint)) {
      this.processedAlerts.add(alert.fingerprint);
      console.log(`[WatcherAgent] Alert injected: ${alert.labels.alertname}`);
      this.alertEmitter.emit('alert', alert);
    }
  }
}
