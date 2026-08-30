import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const envFile = fs.readFileSync(".env", "utf-8");
const env = {};
envFile.split("\n").forEach((line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
});
const supabase = createClient(
  env.VITE_SUPABASE_URL || "https://wbbatgbvizhghtkvuguf.supabase.co",
  env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_WiczJQTx4afGJ02WAiUIUw_8YlWjkSP",
);
async function run() {
  const { data } = await supabase
    .from("products")
    .select("slug")
    .eq("id", "e8fde692-578b-4c61-af9a-c372eeb03308")
    .single();
  console.log("SLUG_CREATED:", data.slug);
}
run();
