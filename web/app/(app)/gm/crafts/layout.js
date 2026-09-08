import AppHeader from "@/app/components/AppHeader";

// The shared header, drawn here rather than inside the page so it does not
// matter whether the page is a server or a client component — several of
// these bodies are client views, and a client component cannot render a
// server one. See components/AppHeader.js.
export default function CraftsLayout({ children }) {
  return (
    <>
      <AppHeader title="Crafts" />
      {children}
    </>
  );
}
