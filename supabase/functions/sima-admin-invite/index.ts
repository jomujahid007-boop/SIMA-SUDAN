import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const allowedOrigin = "https://jomujahid007-boop.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const origin = req.headers.get("origin");
  if (origin && origin !== allowedOrigin) return json({ error: "Origin not allowed" }, 403);

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token || token === authorization) return json({ error: "يلزم تسجيل الدخول بحساب المدير الرئيسي." }, 401);

    const url = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const publishableKeysRaw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
    const publishableKeys = publishableKeysRaw ? JSON.parse(publishableKeysRaw) : {};
    const publicKey = publishableKeys.default ?? Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !serviceRoleKey || !publicKey) {
      return json({ error: "إعدادات خدمة الإدارة غير مكتملة." }, 500);
    }

    const caller = createClient(url, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    const { data: authData, error: authError } = await caller.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "جلسة الدخول غير صالحة." }, 401);

    const { data: isOwner, error: ownerError } = await caller.rpc("sima_is_owner");
    if (ownerError || isOwner !== true) return json({ error: "هذه العملية متاحة للمدير الرئيسي فقط." }, 403);

    const body = await req.json();
    const email = String(body?.email ?? "").trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "أدخل بريداً إلكترونياً صحيحاً." }, 400);
    }
    if (email === String(authData.user.email ?? "").toLowerCase()) {
      return json({ error: "هذا هو بريد المدير الرئيسي بالفعل." }, 400);
    }

    const admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersError) throw usersError;

    let user = usersData.users.find((item) => String(item.email ?? "").toLowerCase() === email);
    let invited = false;
    if (!user) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: "https://jomujahid007-boop.github.io/SIMA-SUDAN/admin.html",
      });
      if (error) throw error;
      user = data.user ?? undefined;
      invited = true;
    } else if (!user.email_confirmed_at) {
      return json({ error: "هذا البريد لديه حساب غير مؤكّد. أكّد البريد أولاً، ثم أعد إضافته كمشرف." }, 409);
    }

    if (!user?.id) return json({ error: "تعذر إنشاء حساب المشرف أو العثور عليه." }, 500);

    const { error: grantError } = await caller.rpc("owner_add_supervisor", {
      p_user_id: user.id,
      p_email: email,
    });
    if (grantError) {
      if (invited) await admin.auth.admin.deleteUser(user.id);
      throw grantError;
    }

    return json({
      ok: true,
      invited,
      message: invited
        ? "تم إرسال دعوة إلى البريد. بعد فتحها وتعيين كلمة المرور يستطيع المشرف الدخول."
        : "تم تفعيل هذا الحساب كمشرف. يمكنه الدخول بكلمة مروره الحالية.",
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "تعذر إضافة المشرف." }, 400);
  }
});
