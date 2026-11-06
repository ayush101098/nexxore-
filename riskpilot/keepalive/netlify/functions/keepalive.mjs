// Every 10 minutes: ping the agent's health (keeps a free Render/Koyeb instance awake) and log it.
// AGENT_URL is set in Netlify's environment, default the Render service.
export default async () => {
  const agent = (process.env.AGENT_URL || "https://riskpilot-agent.onrender.com").replace(/\/$/, "");
  const t = Date.now();
  try {
    const r = await fetch(`${agent}/v1/health`, { signal: AbortSignal.timeout(25_000) });
    const h = await r.json().catch(() => ({}));
    console.log(JSON.stringify({ agent, http: r.status, status: h.status, block: h.dependencies?.chain?.block,
      chain_up: h.dependencies?.chain?.up, arc_up: h.dependencies?.arc?.up, ms: Date.now() - t }));
  } catch (e) {
    console.log(JSON.stringify({ agent, error: String(e), ms: Date.now() - t }));
  }
  return new Response("ok");
};

export const config = { schedule: "*/10 * * * *" };
