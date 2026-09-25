import { redirect } from "next/navigation";

// Notes became Memories (docs/systemdocs/MEMORIES.md): the Journal is its Notes
// section and Starred is Highlights. This stub exists so a bookmark or an old
// link pointing at /notes still lands somewhere instead of 404ing.
export default function NotesRedirect() {
  redirect("/memories");
}
