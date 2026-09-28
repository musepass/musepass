/**
 * Minimal Prometheus text-format metrics.
 *
 * The task document requires knowing within five minutes when the gateway is
 * unhealthy, which needs numbers, not a log stream. Counters and a duration
 * summary are enough to alert on error rate and latency.
 */
export interface Metrics {
  observe(name: string, labels: Record<string, string>, durationMs: number, ok: boolean): void;
  render(): string;
}

interface Series {
  labels: string;
  count: number;
  errors: number;
  durationMs: number;
}

function labelString(labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : 1));
  if (entries.length === 0) return '';
  return `{${entries.map(([key, value]) => `${key}="${value}"`).join(',')}}`;
}

export function createMetrics(): Metrics {
  const series = new Map<string, Series>();

  return {
    observe(name, labels, durationMs, ok) {
      const key = `${name}${labelString(labels)}`;
      const entry = series.get(key) ?? { labels: labelString(labels), count: 0, errors: 0, durationMs: 0 };
      entry.count += 1;
      entry.durationMs += durationMs;
      if (!ok) entry.errors += 1;
      series.set(key, entry);
    },

    render() {
      const lines: string[] = [];
      const sorted = [...series.values()].sort((a, b) => (a.labels < b.labels ? -1 : 1));
      lines.push(
        '# HELP musename_gateway_requests_total Requests handled by the gateway.',
        '# TYPE musename_gateway_requests_total counter',
        ...sorted.map((entry) => `musename_gateway_requests_total${entry.labels} ${entry.count}`),
        '# HELP musename_gateway_request_errors_total Requests that failed.',
        '# TYPE musename_gateway_request_errors_total counter',
        ...sorted.map(
          (entry) => `musename_gateway_request_errors_total${entry.labels} ${entry.errors}`,
        ),
        '# HELP musename_gateway_request_duration_ms_sum Total time spent, in milliseconds.',
        '# TYPE musename_gateway_request_duration_ms_sum counter',
        ...sorted.map(
          (entry) => `musename_gateway_request_duration_ms_sum${entry.labels} ${entry.durationMs}`,
        ),
      );
      return `${lines.join('\n')}\n`;
    },
  };
}
