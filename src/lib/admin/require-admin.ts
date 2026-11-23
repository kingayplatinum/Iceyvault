import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function requireAdmin() {
  const auth = await createClient();
  const { data: { user }, error } = await auth.auth.getUser();
  if (error || !user) {
    return { response: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  }
  const service = createServiceClient();
  const { data: role, error: roleError } = await service
    .from("user_roles").select("role").eq("user_id", user.id)
    .in("role", ["admin", "super_admin"]).maybeSingle();
  if (roleError || !role) {
    return { response: NextResponse.json({ error: "Administrator access required." }, { status: 403 }) };
  }
  return { user, service };
}
