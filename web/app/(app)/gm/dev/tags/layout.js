import AppHeader from "@/app/components/AppHeader";
import DevSubNav from "@/app/(app)/gm/dev/DevSubNav";

// The header, drawn here rather than inside the page because TagCatalogView is
// a client component and cannot render a server one. DevSubNav rides along in
// the actions slot, exactly where it sat when the page drew its own header.
export default function TagCatalogLayout({ children }) {
  return (
    <>
      <AppHeader title="Tag Catalog" actions={<DevSubNav current="tags" />} />
      {children}
    </>
  );
}
