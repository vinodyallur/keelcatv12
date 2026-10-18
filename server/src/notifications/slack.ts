// Slack notifications via an Incoming Webhook URL (stored as a secret).
// Disabled by default; enabled from Settings.

import { getConfig, getSlackWebhook } from "../config/store.js";

export function slackConfigured(): boolean {
  return Boolean(getConfig().settings.slack.enabled && getSlackWebhook());
}

export async function sendSlack(text: string, blocks?: unknown[]): Promise<void> {
  const url = getSlackWebhook();
  if (!url) throw new Error("No Slack webhook URL configured.");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(blocks ? { text, blocks } : { text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack webhook failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

export async function testSlack(): Promise<{ ok: true }> {
  await sendSlack(":wave: KeelCat test message — your Slack webhook is working.");
  return { ok: true };
}
