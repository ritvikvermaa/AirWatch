/* global process */

const DATA_GOV_RESOURCE_URL = "https://api.data.gov.in/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69";

function sendJson(res, status, payload, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  Object.entries(extraHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  res.end(JSON.stringify(payload));
}

function getQuery(req) {
  const url = new URL(req.url || "/", "http://localhost");
  return url.searchParams;
}

export async function handleCpcbRecords(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { status: "error", message: "Method not allowed" });
    return;
  }

  const apiKey = process.env.DATA_GOV_API_KEY || process.env.VITE_DATA_GOV_API_KEY;

  if (!apiKey) {
    sendJson(res, 500, {
      status: "error",
      message: "DATA_GOV_API_KEY is not configured on the server",
    });
    return;
  }

  const sourceParams = getQuery(req);
  const limit = sourceParams.get("limit") || "1000";
  const offset = sourceParams.get("offset") || "0";

  const params = new URLSearchParams({
    "api-key": apiKey,
    format: "json",
    limit,
    offset,
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const upstream = await fetch(`${DATA_GOV_RESOURCE_URL}?${params.toString()}`, {
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      const text = await upstream.text();
      const contentType = upstream.headers.get("content-type") || "";

      if (!upstream.ok) {
        sendJson(res, upstream.status, {
          status: "error",
          message: `data.gov.in API failed: ${upstream.status}`,
          details: contentType.includes("application/json") ? safeParseJson(text) : text.slice(0, 500),
        });
        return;
      }

      if (!contentType.includes("application/json")) {
        sendJson(res, 502, {
          status: "error",
          message: "data.gov.in returned a non-JSON response",
          details: text.slice(0, 500),
        });
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
      res.end(text);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    sendJson(res, 502, {
      status: "error",
      message: "Could not reach data.gov.in API",
      details: error?.message || String(error),
    });
  }
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
}

export default handleCpcbRecords;
