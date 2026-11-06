import { revertChain, stopEngine } from "./stack";

export default async function globalTeardown() {
  await stopEngine().catch(() => {});
  await revertChain(); // leave the demo chain as the suite found it
}
