import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { url, method, headers, body } = await req.json();

    if (!url) {
      return NextResponse.json({ error: "Missing target URL" }, { status: 400 });
    }

    // Filter out Host and other browser-injected headers that shouldn't be forwarded
    const forwardedHeaders: Record<string, string> = {};
    Object.entries(headers || {}).forEach(([k, v]) => {
      const lower = k.toLowerCase();
      if (!["host", "connection", "content-length", "origin", "referer"].includes(lower)) {
        forwardedHeaders[k] = v as string;
      }
    });

    const fetchOptions: RequestInit = {
      method: method || "GET",
      headers: forwardedHeaders,
    };

    if (body !== undefined && method !== "GET" && method !== "HEAD") {
      fetchOptions.body = body;
    }

    const targetResponse = await fetch(url, fetchOptions);
    const responseText = await targetResponse.text();

    // Collect response headers, highlighting x-latch ones
    const responseHeaders: Record<string, string> = {};
    targetResponse.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    // Return the response details to the client
    return NextResponse.json({
      status: targetResponse.status,
      statusText: targetResponse.statusText,
      headers: responseHeaders,
      body: responseText,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Proxy request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
