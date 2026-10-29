import worker from "../../worker.js";

export async function onRequest(context) {
  const url = new URL(context.request.url);

  // If D1 Database is bound directly to Cloudflare Pages, run worker logic directly in-process
  if (context.env && context.env.DB) {
    return worker.fetch(context.request, context.env);
  }

  // Nếu là API AI chat và chưa bind DB ở Pages, chuyển cho functions/api/ai/chat.js xử lý
  if (url.pathname === "/api/ai/chat") {
    return context.next();
  }

  // Fallback proxy sang Worker API độc lập nếu Pages chưa bind D1 trực tiếp
  const baseWorkerUrl = (context.env && context.env.WORKER_API_URL) || "https://schedule-manager-api.sdivn01.workers.dev";
  const targetUrl = `${baseWorkerUrl.replace(/\/$/, "")}${url.pathname}${url.search}`;

  const forwardHeaders = new Headers(context.request.headers);
  forwardHeaders.set("X-Forwarded-Host", url.hostname);
  forwardHeaders.delete("host");

  const newRequest = new Request(targetUrl, {
    method: context.request.method,
    headers: forwardHeaders,
    body: ["GET", "HEAD"].includes(context.request.method.toUpperCase()) ? undefined : context.request.body
  });

  return fetch(newRequest);
}
