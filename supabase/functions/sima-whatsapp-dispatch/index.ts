import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GRAPH_VERSION=Deno.env.get("META_GRAPH_VERSION") ?? "v23.0";
const ACCESS_TOKEN=Deno.env.get("META_WHATSAPP_ACCESS_TOKEN") ?? "";
const PHONE_NUMBER_ID=Deno.env.get("META_PHONE_NUMBER_ID") ?? "";
const SUPABASE_URL=Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DISPATCH_SECRET=Deno.env.get("SIMA_DISPATCH_SECRET") ?? "";
const RECIPIENTS=(Deno.env.get("SIMA_ADMIN_WHATSAPP_RECIPIENTS") ?? "")
  .split(",").map(v=>v.trim()).filter(Boolean);

function equal(a:string,b:string) {
  if(!a || a.length!==b.length) return false;
  let diff=0; for(let i=0;i<a.length;i++) diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{"content-type":"application/json"}
});

async function sendText(to:string,body:string) {
  const response=await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`,{
    method:"POST",
    headers:{authorization:`Bearer ${ACCESS_TOKEN}`,"content-type":"application/json"},
    body:JSON.stringify({messaging_product:"whatsapp",recipient_type:"individual",to,
      type:"text",text:{preview_url:false,body}})
  });
  const data=await response.json();
  if(!response.ok) throw new Error(`Meta API error ${response.status}: ${JSON.stringify(data).slice(0,400)}`);
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST") return json({error:"Method not allowed"},405);
  if(!equal(req.headers.get("x-sima-dispatch-secret") ?? "",DISPATCH_SECRET))
    return json({error:"Unauthorized"},401);
  if(!DISPATCH_SECRET || !ACCESS_TOKEN || !PHONE_NUMBER_ID || !SERVICE_ROLE_KEY || !RECIPIENTS.length)
    return json({error:"WhatsApp dispatcher secrets are incomplete"},503);

  const claim=await fetch(`${SUPABASE_URL}/rest/v1/rpc/sima_whatsapp_claim_outbox`,{
    method:"POST",
    headers:{apikey:SERVICE_ROLE_KEY,authorization:`Bearer ${SERVICE_ROLE_KEY}`,"content-type":"application/json"},
    body:JSON.stringify({p_limit:20})
  });
  if(!claim.ok) return json({error:"Could not claim queued notifications"},502);
  const jobs=await claim.json();
  let sent=0,failed=0;
  for(const job of jobs){
    try{
      if(job.event_type!=="listing_submitted") throw new Error("Unsupported event");
      const p=job.payload ?? {};
      const msg=`📣 إعلان جديد بانتظار المراجعة في سِمة\nالعنوان: ${p.title ?? "—"}\nرقم الإعلان: ${p.listing_id}\nيرجى فتح لوحة الإدارة للمراجعة.`;
      for(const recipient of RECIPIENTS) await sendText(recipient,msg);
      sent++;
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/sima_whatsapp_finish_outbox`,{
        method:"POST",
        headers:{apikey:SERVICE_ROLE_KEY,authorization:`Bearer ${SERVICE_ROLE_KEY}`,"content-type":"application/json"},
        body:JSON.stringify({p_id:job.id,p_success:true,p_error:null})
      });
    }catch(error){
      failed++;
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/sima_whatsapp_finish_outbox`,{
        method:"POST",
        headers:{apikey:SERVICE_ROLE_KEY,authorization:`Bearer ${SERVICE_ROLE_KEY}`,"content-type":"application/json"},
        body:JSON.stringify({p_id:job.id,p_success:false,p_error:String(error)})
      });
    }
  }
  return json({claimed:jobs.length,sent,failed});
});
