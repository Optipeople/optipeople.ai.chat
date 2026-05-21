import { redirect } from "next/navigation";

export default function AdminMcpPage() {
  // MCP lives under each account's settings hub now. Send the admin
  // to the account picker — for account admins, the picker auto-bounces
  // into their own account.
  redirect("/admin/accounts");
}
