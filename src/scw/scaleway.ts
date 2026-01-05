// src/scaleway.ts
import dotenv from "dotenv";
const SCW_API = "https://api.scaleway.com";

dotenv.config();

export async function listServers(token: string): Promise<Response> {
  const res = await fetch(
    `${SCW_API}/instance/v1/zones/${process.env["SCW_REGION"]}/servers`,
    {
      headers: {
        "X-Auth-Token": token,
        "Content-Type": "application/json",
      },
    },
  );

  if (!res.ok) {
    throw new Error(`Scaleway API error: ${res.status}`);
  }

  const data = await res.json();
  return data.servers;
}
