import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v23.0";
const VERIFY_TOKEN = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const ACCESS_TOKEN = Deno.env.get("META_WHATSAPP_ACCESS_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("META_PHONE_NUMBER_ID") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPPORT_MARKER = "SIMA_SUPPORT_REQUEST";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function verifySignature(raw: string, signature: string | null): Promise<boolean> {
  if (!APP_SECRET || !signature?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const expected = "sha256=" + [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i=0;i<expected.length;i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

async function sendText(to: string, body: string) {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) throw new Error("WhatsApp API credentials are not configured");
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`, {
    method:"POST",
    headers:{ authorization:`Bearer ${ACCESS_TOKEN}`, "content-type":"application/json" },
    body:JSON.stringify({ messaging_product:"whatsapp", recipient_type:"individual", to,
      type:"text", text:{ preview_url:false, body } }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Meta send failed (${response.status}): ${JSON.stringify(data).slice(0,500)}`);
}

async function handleInbound(payload: any) {
  for (const entry of payload?.entry ?? []) for (const change of entry?.changes ?? []) {
    for (const message of change?.value?.messages ?? []) {
      const messageId=String(message?.id ?? ""), from=String(message?.from ?? "");
      const body=String(message?.text?.body ?? "");
      if (!messageId || !from || !body.includes(SUPPORT_MARKER)) continue;

      // Insert-once deduplication: only the request that creates this row may send a reply.
      const inserted=await fetch(`${SUPABASE_URL}/rest/v1/sima_whatsapp_inbound`, {
        method:"POST",
        headers:{ apikey:SERVICE_ROLE_KEY, authorization:`Bearer ${SERVICE_ROLE_KEY}`,
          "content-type":"application/json", prefer:"return=representation" },
        body:JSON.stringify({ message_id:messageId, sender:from }),
      });
      if (inserted.status===409) continue;
      if (!inserted.ok) throw new Error("Could not register inbound message");
      const created=await inserted.json();
      if (!Array.isArray(created) || created.length!==1) continue;

      try {
        await sendText(from,"مرحباً بك في سِمة 🇸🇩\nوصلتنا رسالتك عبر موقع سِمة. كيف يمكننا مساعدتك؟");
        await fetch(`${SUPABASE_URL}/rest/v1/sima_whatsapp_inbound?message_id=eq.${encodeURIComponent(messageId)}`, {
          method:"PATCH",
          headers:{ apikey:SERVICE_ROLE_KEY, authorization:`Bearer ${SERVICE_ROLE_KEY}`, "content-type":"application/json" },
          body:JSON.stringify({ auto_replied:true }),
        });
      } catch (error) {
        // Keep auto_replied=false for operational review; do not auto-retry a customer reply blindly.
        console.error("SIMA auto-reply failed:",error);
      }
    }
  }
}

Deno.serve(async (req:Request) => {
  if (req.method==="GET") {
    const url=new URL(req.url), mode=url.searchParams.get("hub.mode"),
      token=url.searchParams.get("hub.verify_token"), challenge=url.searchParams.get("hub.challenge");
    if (mode==="subscribe" && token && token===VERIFY_TOKEN && challenge)
      return new Response(challenge,{status:200});
    return json({error:"Webhook verification failed"},403);
  }
  if (req.method!=="POST") return json({error:"Method not allowed"},405);
  const raw=await req.text();
  if (!await verifySignature(raw,req.headers.get("x-hub-signature-256"))) return json({error:"Invalid signature"},401);
  let payload:any;
  try { payload=JSON.parse(raw); } catch { return json({error:"Invalid JSON"},400); }
  try {
    if (payload?.object!=="whatsapp_business_account") return json({received:false},404);
    await handleInbound(payload);
    return json({received:true});
  } catch (error) {
    console.error("SIMA WhatsApp webhook error:",error);
    return json({error:"Webhook processing failed"},500);
  }
});
