(globalThis as any).localStorage = { getItem:()=>null, setItem:()=>{}, removeItem:()=>{} };

import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL!;
const anon = process.env.VITE_SUPABASE_ANON_KEY!;
const session = JSON.parse(process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON!);

const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });

const clientMod: any = await import("../src/integrations/supabase/client.ts");
Object.defineProperty(clientMod, "supabase", { value: client, writable: true, configurable: true });

const { reprocessBenchmark } = await import("../src/lib/benchmark-reprocess.ts");
const r = await reprocessBenchmark("fe76a28e-9b16-4205-b86d-6b890750f993");
console.log(JSON.stringify(r, null, 2));
