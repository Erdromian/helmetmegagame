// The app's icon set: Lucide (https://lucide.dev), re-exported under the
// names the rest of the app already imports, so a call site never has to know
// which library is underneath. Every icon renders on Lucide's 24×24 grid with
// round caps and joins, in currentColor, at the 1.6 stroke the hand-drawn set
// used — thinner than Lucide's default 2, which reads heavy at the 15px the
// .icon-btn frame and the 20px the nav rail draw these at.
//
// Sizing is the caller's job, same as before: `width`/`height` props for a
// one-off (IconButton passes 15), CSS on `svg` for a family (.rail-item).
//
// Six glyphs have no Lucide equivalent and stay hand-drawn at the bottom of
// the file, redrawn to Lucide's conventions so they sit in the same weight.

import {
  User,
  Users,
  ScrollText,
  ShieldCheck,
  Scale,
  MessageSquare,
  CodeXml,
  FileText,
  CircleHelp,
  Star,
  ShoppingBag,
  Archive,
  Map as MapGlyph,
  LogOut,
  Castle,
  Eye,
  Pencil,
  Volume2,
  VolumeX,
  Ellipsis,
  Skull,
  RotateCcw,
  SkipForward,
  HeartCrack,
  Bandage,
  Soup,
  RefreshCw,
  Trash2,
  Hammer,
  Hexagon,
  ArrowLeftRight,
  Hand,
  Link,
  KeyRound,
  Bird,
  ChevronDown,
  Pin,
  Send,
  Pickaxe,
  Flame,
  Feather,
  Book,
  Package,
  DoorOpen,
  Bell,
  BellOff,
  Camera,
  Search,
  X,
} from "lucide-react";

const STROKE = 1.6;

// Wraps a Lucide component so the house stroke is the default and any prop a
// call site passes (width, height, className, aria-*) still wins.
function lucide(Glyph, name) {
  function Icon(props) {
    return <Glyph strokeWidth={STROKE} {...props} />;
  }
  Icon.displayName = name;
  return Icon;
}

// ── Nav rail (NavRail.js) ────────────────────────────────────────────────────

export const CharacterIcon = lucide(User, "CharacterIcon");
export const PlayersIcon = lucide(Users, "PlayersIcon");
export const AuditIcon = lucide(ScrollText, "AuditIcon");
export const FactionIcon = lucide(ShieldCheck, "FactionIcon");
export const ScaleIcon = lucide(Scale, "ScaleIcon");
export const MessageIcon = lucide(MessageSquare, "MessageIcon");
export const DevIcon = lucide(CodeXml, "DevIcon");
export const DocumentsIcon = lucide(FileText, "DocumentsIcon");
// The Handbook rail tab.
export const HelpIcon = lucide(CircleHelp, "HelpIcon");
export const NotesIcon = lucide(Star, "NotesIcon");
// The Store is where Tag Points get spent, so it reads as commerce rather
// than another list.
export const StoreIcon = lucide(ShoppingBag, "StoreIcon");
// A lidded box of records, not another sheet of paper — the Archive is the
// game's kept history, and needs to read as a different kind of thing from
// Documents (reference prose) sitting next to it on the rail.
export const ArchiveIcon = lucide(Archive, "ArchiveIcon");
export const MapIcon = lucide(MapGlyph, "MapIcon");
export const SignOutIcon = lucide(LogOut, "SignOutIcon");
// The Dev-panel jump — a keep: the panel is where a GM rebuilds someone from
// the foundations up.
export const KeepIcon = lucide(Castle, "KeepIcon");
export const EyeIcon = lucide(Eye, "EyeIcon");
export const EditIcon = lucide(Pencil, "EditIcon");
// The mobile bottom bar's "More" affordance — see NavRail.js's MOBILE_PRIMARY.
export const MoreIcon = lucide(Ellipsis, "MoreIcon");
// The Hall's row action bar: pointing an instant camera at what somebody said,
// the web twin of the 📸 reaction.
export const CameraIcon = lucide(Camera, "CameraIcon");
// The Hall's feed header: searching what was said, over the archive's trigram
// index (/api/feed/search).
export const SearchIcon = lucide(Search, "SearchIcon");

// Showing somebody out of a conversation or a private room
// (web/app/(app)/play/MembersStrip.js). A dismissal, not a deletion:
// TrashIcon says the person is being thrown away, which is the wrong
// sentence for "they may not come in here any more".
export const CloseIcon = lucide(X, "CloseIcon");
// The Play page: a doorway you speak through. A plain speech bubble would have
// read as MessageIcon at rail size, which is the GM's inbox.
export const PlayIcon = lucide(DoorOpen, "PlayIcon");
// The Hall's mention chime, at the foot of the places column. Two glyphs
// rather than one so the state reads at a glance; aria-pressed carries it for
// everyone else.
export const BellIcon = lucide(Bell, "BellIcon");
export const BellOffIcon = lucide(BellOff, "BellOffIcon");

// GM inbox chime mute toggle (NavRail.js). One name, two glyphs.
export function SpeakerIcon({ muted, ...props }) {
  const Glyph = muted ? VolumeX : Volume2;
  return <Glyph strokeWidth={STROKE} {...props} />;
}

// ── Dev Character Panel action bar (docs/systemdocs/DEV-PANEL.md) ──────────
// One icon per microaction, at 15px inside .icon-btn.

export const SkullIcon = lucide(Skull, "SkullIcon");
// Restore turn — a counter-clockwise arrow, the universal "give it back".
export const RestoreIcon = lucide(RotateCcw, "RestoreIcon");
// Spend turn — skip to the end, the mirror of RestoreIcon.
export const SkipIcon = lucide(SkipForward, "SkipIcon");
// Inflict wound.
export const WoundIcon = lucide(HeartCrack, "WoundIcon");
// Heal all.
export const BandageIcon = lucide(Bandage, "BandageIcon");
// Feed — a bowl, not cutlery: cutlery at 15px is two indistinct strokes.
export const MealIcon = lucide(Soup, "MealIcon");
// Re-push this character's Discord state.
export const SyncIcon = lucide(RefreshCw, "SyncIcon");
export const TrashIcon = lucide(Trash2, "TrashIcon");
// Craft — the recipe door on the action grid (actionRegistry.js).
export const HammerIcon = lucide(Hammer, "HammerIcon");
// Refund unspent tag points — the ⬡ of the point economy, hollow so it never
// reads as the filled ⬢ Resources glyph.
export const PointsIcon = lucide(Hexagon, "PointsIcon");

// Transfer Resources — the filled ⬢ of the Resources glyph, so it reads as
// the currency next to PointsIcon's hollow ⬡.
export function ResourcesIcon(props) {
  return <Hexagon strokeWidth={STROKE} fill="currentColor" {...props} />;
}

// ── The player Actions grid (ActionGrid.js) ─────────────────────────────────

// Transfer Tag — a thing passed one way or the other.
export const HandOffIcon = lucide(ArrowLeftRight, "HandOffIcon");
// Loot — an open hand.
export const LootIcon = lucide(Hand, "LootIcon");
// Bind — a chain link.
export const ShackleIcon = lucide(Link, "ShackleIcon");
// Free — the key that opens it.
export const KeyIcon = lucide(KeyRound, "KeyIcon");
// A bird in flight, for the Bird's letter.
export const BirdIcon = lucide(Bird, "BirdIcon");
// The Select trigger's open/close glyph.
export const ChevronDownIcon = lucide(ChevronDown, "ChevronDownIcon");
// The Journal's "pin to top" toggle. Deliberately not a star: that page
// already uses ★ for a starred message, and the Starred tab's [★] means
// "unstar/delete" — a star meaning "pinned" on one tab and "delete" on the
// other would overload the same glyph two ways on one page.
export const PinIcon = lucide(Pin, "PinIcon");
export const SendIcon = lucide(Send, "SendIcon");
// Extract — a pick going into the ground. Distinct from the Hammer used by
// Craft, which a plain axe would not have been.
export const ExtractIcon = lucide(Pickaxe, "ExtractIcon");
// Torture — the brazier. Distinct from the broken heart Harm and Crucify
// share, so the three cruelties do not read as one button.
export const TortureIcon = lucide(Flame, "TortureIcon");
// A quill — the Write action. See docs/systemdocs/PAPERWORK.md.
export const QuillIcon = lucide(Feather, "QuillIcon");
// A bound volume — the Bind a Book action, and the books on the Keep's
// shelves.
export const BookIcon = lucide(Book, "BookIcon");
// Package — a banded crate.
export const CrateIcon = lucide(Package, "CrateIcon");

// ── Hand-drawn: no Lucide equivalent ────────────────────────────────────────
// Same 24×24 grid, currentColor, round caps and joins, 1.6 stroke, so they
// sit at the same weight as the Lucide glyphs around them.

function Glyph({ children, ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

// The Tower — a drop of blood with a flame's shoulders.
export function LifewebIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M12 3.5c3.2 4 5.5 7.3 5.5 10.3a5.5 5.5 0 1 1-11 0c0-3 2.3-6.3 5.5-10.3z" />
      <path d="M9.7 15.5c0 1.4 1 2.3 2.3 2.3" />
    </Glyph>
  );
}

// Revive. An ankh rather than a plain cross: the cross reads as "add" next to
// the heal icon, and this button is specifically "bring them back".
export function AnkhIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M12 2.5c-2 0-3.5 1.6-3.5 3.7 0 1.8 1.2 3.2 2.3 4.3.5.5.7.9.7 1.5v9.5" />
      <path d="M12 2.5c2 0 3.5 1.6 3.5 3.7 0 1.8-1.2 3.2-2.3 4.3-.5.5-.7.9-.7 1.5" />
      <path d="M7 13.5h10" />
    </Glyph>
  );
}

// Butcher — a cleaver: a broad rectangular blade with a short handle off its
// heel. Squared-off and blade-heavy so it doesn't read as the hammer at 16px.
export function CleaverIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M4 4.5h11v9.5H4z" />
      <path d="M15 6.5h3.5M18.5 6.5V19" />
    </Glyph>
  );
}

// Engrave — the same headstone as Bury, but standing free of the ground and
// carrying lettering. The two sit side by side in the action grid, so what
// separates them has to be visible at 16px: no ground line, three rules.
export function HeadstoneIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M6.5 21V8.5a5.5 5.5 0 0 1 11 0V21" />
      <path d="M9.5 11h5M9.5 14h5M9.5 17h3" />
    </Glyph>
  );
}

// Bury — a headstone in the ground. The rounded top and the ground line read
// as a grave at 16px, where a cross alone would read as a plus sign.
export function GraveIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M7 20V9a5 5 0 0 1 10 0v11" />
      <path d="M12 8v6M9.5 10.5h5" />
      <path d="M3.5 20h17" />
    </Glyph>
  );
}

// A folded letter closed with a blob of wax — the Seal action.
export function SealIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M3.5 6.5h17v12h-17z" />
      <path d="M3.5 6.5L12 13l8.5-6.5" />
      <circle cx="12" cy="15.5" r="2.75" />
    </Glyph>
  );
}

// A hood pulled up over a bare face — the conceal toggle (PROXYING.md §5). The
// cowl's peak and the shoulders are what read at 16px; there is deliberately
// nothing inside it, because that is the whole point of the thing.
export function HoodIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M12 3c-3.6 0-6 3.1-6 7 0 2.4 1 4.4 2.5 5.5" />
      <path d="M12 3c3.6 0 6 3.1 6 7 0 2.4-1 4.4-2.5 5.5" />
      <path d="M8.5 15.5 5 17.5V21h14v-3.5l-3.5-2" />
    </Glyph>
  );
}
