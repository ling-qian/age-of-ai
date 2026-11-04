import { DurableObject } from "cloudflare:workers";

interface Env {
  GAME_CONTAINER: DurableObjectNamespace<GameContainer>;
}

const CONTAINER_PORT = 8080;
const HEALTH_PATH = "/healthz";
const STARTUP_TIMEOUT_MS = 120_000;
const RETRY_INTERVAL_MS = 500;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // One globally named Durable Object keeps every player on the same
    // authoritative in-memory lobby/game process for this Alpha.
    const game = env.GAME_CONTAINER.getByName("age-of-ai-global");
    return game.fetch(request);
  },
};

export class GameContainer extends DurableObject<Env> {
  private starting: Promise<void> | undefined;

  async fetch(request: Request): Promise<Response> {
    this.starting ??= this.startAndWaitForHealth().finally(() => {
      this.starting = undefined;
    });
    await this.starting;

    // Preserve the original path, query string, method, headers and WebSocket
    // upgrade. The Container TCP Fetcher handles the HTTP/WS proxy.
    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "container";
    const forwarded = new Request(url, request);
    forwarded.headers.delete("host");
    return this.ctx.container.getTcpPort(CONTAINER_PORT).fetch(forwarded);
  }

  private async startAndWaitForHealth(): Promise<void> {
    const container = this.ctx.container;
    if (!container.running) {
      container.start({ image: container.images.base });
    }

    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        const healthUrl = new URL(`http://container:${CONTAINER_PORT}${HEALTH_PATH}`);
        const response = await container.getTcpPort(CONTAINER_PORT).fetch(
          new Request(healthUrl, { method: "GET" }),
        );
        if (response.ok) {
          // Open WebSockets keep the DO active. Once all traffic has gone
          // quiet, allow the container to stop and reduce idle compute.
          await container.setInactivityTimeout(10 * 60 * 1000);
          return;
        }
        lastError = new Error(`Health check returned HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
    }

    throw new Error("Age of AI container did not become healthy within 120 seconds", {
      cause: lastError,
    });
  }
}
