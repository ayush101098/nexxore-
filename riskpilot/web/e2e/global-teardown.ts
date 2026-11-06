import { revertChain, stopEngine } from "./stack";

export default async function globalTeardown() {
  if (!process.env.E2E_EXTERNAL) await stopEngine().catch(() => {});
  await revertChain(); // leave the demo chain as the suite found it
}
