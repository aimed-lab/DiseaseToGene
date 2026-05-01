import type { Handler } from "@netlify/functions";

export const handler: Handler = async (event) => {
  try {
    const params = new URLSearchParams(
      event.queryStringParameters as Record<string, string> || {}
    );
    const url = `https://www.ncbi.nlm.nih.gov/research/pubtator3-api/search/?${params.toString()}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "pharmatlas-app/1.0",
        "Accept": "application/json"
      }
    });

    if (!res.ok) {
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: "PubTator search failed" })
      };
    }

    const data = await res.json();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    };
  } catch (error: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
