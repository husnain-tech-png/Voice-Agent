// tunnel.js — Automatic Self-Healing Tunnel & Telnyx Webhook Synchronizer
import localtunnel from 'localtunnel';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getEnv() {
  const envPath = path.join(__dirname, '.env');
  const env = {};
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        env[key] = val;
      }
    }
  }
  return env;
}

async function updateTelnyxWebhook(publicUrl, env) {
  const apiKey = env.TELNYX_API_KEY;
  const appId = env.TELNYX_TEXML_APP_ID;
  if (!apiKey || !appId) return;

  try {
    const webhookUrl = `${publicUrl}/telnyx/incoming`;
    const res = await fetch(`https://api.telnyx.com/v2/texml_applications/${appId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        voice_url: webhookUrl,
        voice_fallback_url: webhookUrl
      })
    });
    if (res.ok) {
      console.log(`[TELNYX CLOUD SYNC] ✅ TeXML webhook updated in cloud to: ${webhookUrl}`);
    } else {
      const err = await res.json().catch(() => ({}));
      console.warn(`[TELNYX CLOUD SYNC] Warning updating TeXML webhook:`, err);
    }
  } catch (err) {
    console.warn(`[TELNYX CLOUD SYNC] Network error:`, err.message);
  }
}

export async function startAutoTunnel(port = 3000) {
  let isReconnecting = false;

  async function connect() {
    try {
      console.log(`[AUTO-TUNNEL] Requesting public tunnel on port ${port}...`);
      const tunnel = await localtunnel({ port });
      const env = getEnv();
      console.log(`[AUTO-TUNNEL] ✅ Live Public Tunnel: ${tunnel.url}`);

      // Update .env with current PUBLIC_URL
      try {
        const envPath = path.join(__dirname, '.env');
        if (fs.existsSync(envPath)) {
          let envContent = fs.readFileSync(envPath, 'utf-8');
          if (envContent.includes('PUBLIC_URL=')) {
            envContent = envContent.replace(/PUBLIC_URL=.*/, `PUBLIC_URL=${tunnel.url}`);
          } else {
            envContent += `\nPUBLIC_URL=${tunnel.url}\n`;
          }
          fs.writeFileSync(envPath, envContent, 'utf-8');
        }
      } catch (e) {}

      // Update Telnyx TeXML Application in cloud automatically
      await updateTelnyxWebhook(tunnel.url, env);

      tunnel.on('close', () => {
        console.warn(`[AUTO-TUNNEL] Tunnel closed. Reconnecting in 3s...`);
        if (!isReconnecting) {
          isReconnecting = true;
          setTimeout(() => {
            isReconnecting = false;
            connect();
          }, 3000);
        }
      });

      tunnel.on('error', (err) => {
        console.warn(`[AUTO-TUNNEL] Error:`, err.message);
        tunnel.close();
      });

      return tunnel;
    } catch (err) {
      console.warn(`[AUTO-TUNNEL] Connection failed: ${err.message}. Retrying in 5s...`);
      if (!isReconnecting) {
        isReconnecting = true;
        setTimeout(() => {
          isReconnecting = false;
          connect();
        }, 5000);
      }
    }
  }

  return connect();
}

if (process.argv[1] && process.argv[1].endsWith('tunnel.js')) {
  startAutoTunnel(3000);
}
