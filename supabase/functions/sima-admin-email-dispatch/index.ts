import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY=Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM=Deno.env.get("SIMA_EMAIL_FROM") ?? "";
const DISPATCH_SECRET=Deno.env.get("SIMA_EMAIL_DISPATCH_SECRET") ?? "";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{"content-type":"application/json"}
});
function equal(a:string,b:string){
  if(!a||a.length!==b.length)return false;
  let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);
  return d===0;
}
async function rpc(name:string,payload:Record<string,unknown>){
  const response=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{
    method:"POST",
    headers:{apikey:SERVICE_ROLE_KEY,authorization:`Bearer ${SERVICE_ROLE_KEY}`,"content-type":"application/json"},
    body:JSON.stringify(payload)
  });
  if(!response.ok)throw new Error(`${name} failed: ${response.status} ${(await response.text()).slice(0,300)}`);
  return response.status===204?null:await response.json();
}
Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  if(!equal(req.headers.get("x-sima-email-dispatch-secret")??"",DISPATCH_SECRET))return json({error:"Unauthorized"},401);
  if(!SUPABASE_URL||!SERVICE_ROLE_KEY||!RESEND_API_KEY||!EMAIL_FROM||!DISPATCH_SECRET)
    return json({error:"Email dispatcher secrets are incomplete"},503);
  let jobs:any[];
  try{jobs=await rpc("sima_admin_email_claim",{p_limit:20}) as any[];}
  catch(e){return json({error:String(e)},502);}
  let sent=0,failed=0;
  for(const job of jobs??[]){
    try{
      const response=await fetch("https://api.resend.com/emails",{
        method:"POST",
        headers:{authorization:`Bearer ${RESEND_API_KEY}`,"content-type":"application/json"},
        body:JSON.stringify({
          from:EMAIL_FROM,
          to:[job.recipient_email],
          subject:job.subject,
          text:job.body
        })
      });
      const result=await response.json();
      if(!response.ok)throw new Error(`Resend ${response.status}: ${JSON.stringify(result).slice(0,350)}`);
      await rpc("sima_admin_email_finish",{p_id:job.id,p_success:true,p_error:null});
      sent++;
    }catch(e){
      failed++;
      try{await rpc("sima_admin_email_finish",{p_id:job.id,p_success:false,p_error:String(e)});}catch(_){}
    }
  }
  return json({claimed:(jobs??[]).length,sent,failed});
});
