// A stand-in for 0G Private Computer's OpenAI-compatible router, for the e2e suite only.
// It answers from the context it is sent (citing the first decision id, quoting the worst stress
// loss), returns x_0g_trace.request_id like the real router, and fails when asked "FAIL".
import { createServer, type Server } from "node:http";

let server: Server | null = null;
let n = 0;

export function startFake0G(port = 8788): Promise<void> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const msgs = JSON.parse(body || "{}").messages || [];
        const user = String(msgs[msgs.length - 1]?.content || msgs[1]?.content || "");
        if (/Question: FAIL/.test(user) || req.headers.authorization !== "Bearer test-key-not-a-real-0g-key") {
          res.writeHead(500, { "content-type": "application/json" }); res.end('{"error":"provider unavailable"}'); return;
        }
        const ctx = JSON.parse((msgs[1]?.content || "").split("Context (JSON):\n")[1] || "{}");
        const dec = (ctx.current_opportunities || []).find((o: any) => o.verdict === "REJECT");
        const brief = /risk brief/.test(msgs[1]?.content || "");
        const content = brief
          ? `Worst stress loss now $${ctx.last_24h?.worst_stress_loss_now}. Declined: ${dec?.decision_id}.`
          : `Your book's worst stress loss is $${ctx.worst_stress_loss}. ${dec?.decision_id} was rejected: ${dec?.reason}`;
        n += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `chatcmpl-${n}`, object: "chat.completion", model: "0gm-1.0-35b-a3b",
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
          x_0g_trace: { request_id: `0g-e2e-${n}`, provider: "0x0000000000000000000000000000000000000000" } }));
      });
    });
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

export function stopFake0G() { server?.close(); }
