import { onCLS, onINP, onFCP, onLCP, onTTFB, type Metric } from "web-vitals";

export function initPerformanceMetrics() {
  if (typeof window === "undefined") return;
  const sendMetric = (name: string, value: number) => {
    console.log(`[Web Vitals] ${name}: ${value}`);
    // TODO: integrate with analytics if needed
  };
  onCLS((metric: Metric) => sendMetric("CLS", metric.value));
  onINP((metric: Metric) => sendMetric("INP", metric.value));
  onFCP((metric: Metric) => sendMetric("FCP", metric.value));
  onLCP((metric: Metric) => sendMetric("LCP", metric.value));
  onTTFB((metric: Metric) => sendMetric("TTFB", metric.value));
}
