// ============================================================================
// EDGE FUNCTION: send-whatsapp-reminder
// ============================================================================
// Sends a WhatsApp message to the STUDENT'S mobile number right after a
// successful booking, listing every subject + teacher + day/time booked.
//
// Uses Meta's official WhatsApp Cloud API (business.facebook.com / Meta for
// Developers) — no third-party vendor required, and it has a free tier.
//
// IMPORTANT WHATSAPP LIMITATION (read before wiring this up):
// WhatsApp does NOT allow businesses to send free-form text to a number that
// has never messaged them first. The very first message to any number (like
// this booking confirmation) MUST use a pre-approved "message template".
// You create and submit that template once in the Meta dashboard; approval
// usually takes minutes to a few hours. See the setup steps in README.md.
//
// This function sends ONE approved template message per booking, filling in
// {{1}} = student name, {{2}} = reservation code, {{3}} = a single text
// block listing every subject/teacher/day/time (WhatsApp templates only
// support simple numbered placeholders, not loops/tables).
//
// Deploy with:
//   supabase functions deploy send-whatsapp-reminder
//   supabase secrets set WHATSAPP_TOKEN=EAAxxxxxxxxxxxxx
//   supabase secrets set WHATSAPP_PHONE_NUMBER_ID=1234567890
//   supabase secrets set WHATSAPP_TEMPLATE_NAME=reservation_confirmation
// ============================================================================

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const WHATSAPP_TEMPLATE_NAME = Deno.env.get("WHATSAPP_TEMPLATE_NAME") ?? "reservation_confirmation";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DAY_NAMES_AR = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function formatTimeAr(t: string): string {
  const [hStr, m] = t.split(":");
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? "م" : "ص";
  h = h % 12 || 12;
  return `${h}:${m} ${period}`;
}

// Normalizes an Egyptian local number (01XXXXXXXXX) to WhatsApp's required
// international format with no leading zero or plus sign, e.g. 201012345678.
function toWhatsAppNumber(localMobile: string): string {
  const digitsOnly = localMobile.replace(/\D/g, "");
  if (digitsOnly.startsWith("0")) return "20" + digitsOnly.slice(1);
  return digitsOnly;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const payload = await req.json();

    if (!payload?.student?.mobile || !payload?.items) {
      return new Response(JSON.stringify({ error: "Invalid payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
      console.warn("WhatsApp credentials not set — skipping WhatsApp reminder.");
      return new Response(JSON.stringify({ sent: false, reason: "WhatsApp not configured" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lessonsText = payload.items
      .map((item: any) => `${item.subject_name} - ${item.teacher_name} - ${DAY_NAMES_AR[item.day_of_week]} ${formatTimeAr(item.start_time)}`)
      .join(" | ");

    const toNumber = toWhatsAppNumber(payload.student.mobile);

    const waRes = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toNumber,
        type: "template",
        template: {
          name: WHATSAPP_TEMPLATE_NAME,
          language: { code: "ar" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: payload.student.full_name },
                { type: "text", text: payload.reservation_code },
                { type: "text", text: lessonsText },
              ],
            },
          ],
        },
      }),
    });

    const waResult = await waRes.json();

    if (!waRes.ok) {
      console.error("WhatsApp API error:", waResult);
      // Never fail the booking because of a messaging problem.
      return new Response(JSON.stringify({ sent: false, error: waResult }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ sent: true, id: waResult.messages?.[0]?.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-whatsapp-reminder error:", err);
    return new Response(JSON.stringify({ sent: false, error: String(err) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
