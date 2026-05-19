import type { Config } from '@netlify/functions';
import { pollOnce } from '../../server/sumup/poller';

// Netlify Scheduled Function — replaces the in-process setInterval poller
// for production. Serverless invocations can't keep a long-running timer
// alive, so we cron the poll instead.
//
// Requires SUMUP_TOKEN and DATABASE_URL in the Netlify site env.
// pollOnce() silently no-ops if SUMUP_TOKEN is unset.
const LOOKBACK_MS = 10 * 60 * 1000; // 10 min — generous overlap, dedup handles repeats

export default async (): Promise<Response> => {
  try {
    await pollOnce(new Date(Date.now() - LOOKBACK_MS));
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('[sumup-scheduled] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};

export const config: Config = {
  // Every minute. Netlify's minimum cron resolution.
  schedule: '* * * * *',
};
