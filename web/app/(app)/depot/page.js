import { redirect } from "next/navigation";

// The Depot's counter page is gone (Depot Overhaul.docx): ordering is the Merchant's Terminal, a
// fixture you stand at in Chat's place panel, and the infoterminal is a fixture too. This stub
// exists so a bookmark or old link pointing at /depot still lands somewhere instead of 404ing.
export default function DepotRedirect() {
  redirect("/chat");
}
