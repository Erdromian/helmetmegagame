// Shrink an uploaded picture in the BROWSER, before it is posted.
//
// Why this exists: the server stores a 256x256 webp (AVATAR_SIZE in
// app/(app)/character/actions.js) and almost every surface draws the avatar at
// 20px, so a 12MB phone photo is 99% waste on the wire. It also used to be
// worse than waste -- Next kills a Server Action body over its bodySizeLimit
// before the action runs, and that rejection never reaches useActionState, so
// the player watched Save do nothing. Shrinking first means the body is a few
// tens of KB and no limit is ever in play.
//
// NEVER import @lifeweb/db from here, directly or indirectly. This is pulled
// into AvatarField, a "use client" component, and one require of the barrel
// drags PrismaClient into the browser bundle and kills the route with a
// node:fs error carrying no digest. Same rule as lib/constants.js.
import { MAX_AVATAR_UPLOAD_EDGE, SHRINK_SKIP_BELOW_BYTES } from "./constants";

const WEBP_QUALITY = 0.9;

// Every failure returns null rather than throwing, and null means "post the
// original". So a browser that cannot do any of this behaves exactly as it did
// before the module existed: the original goes up and the server's own size
// check is still the gate.
function bail(bitmap) {
  bitmap?.close?.();
  return null;
}

/**
 * @param {File} file the picture the player picked
 * @returns {Promise<File|null>} a smaller webp, or null to post the original
 */
export async function shrinkImage(file) {
  if (!file || typeof createImageBitmap !== "function") return null;

  let bitmap;
  try {
    // imageOrientation is the point of using createImageBitmap over an
    // <img> + object URL: it BAKES EXIF ROTATION INTO THE PIXELS. A phone
    // held sideways writes upright pixels plus an orientation tag, and the
    // webp encode below drops the tag -- so without this a portrait photo is
    // stored on its side with nothing downstream able to correct it. The
    // server calls sharp's .rotate() for the same reason on the fallback path.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Anything the browser cannot decode -- most often an iPhone .HEIC, which
    // Chrome will not read and our prebuilt sharp cannot either. The original
    // goes up and sharp gets its turn; if it also fails, the action answers
    // with "That image couldn't be read."
    return null;
  }

  const { width, height } = bitmap;
  if (!width || !height) return bail(bitmap);

  const longest = Math.max(width, height);
  // Nothing to gain: already small enough in both bytes and pixels. Skipping
  // keeps a perfectly good small PNG byte-identical instead of round-tripping
  // it through a lossy encoder for no reason.
  if (longest <= MAX_AVATAR_UPLOAD_EDGE && file.size <= SHRINK_SKIP_BELOW_BYTES) {
    return bail(bitmap);
  }

  const scale = Math.min(1, MAX_AVATAR_UPLOAD_EDGE / longest);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  try {
    let blob;
    if (typeof OffscreenCanvas === "function") {
      const canvas = new OffscreenCanvas(w, h);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
      blob = await canvas.convertToBlob({ type: "image/webp", quality: WEBP_QUALITY });
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
      blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/webp", WEBP_QUALITY)
      );
    }
    // toBlob hands back null on an encode failure. A browser with no webp
    // encoder quietly gives PNG instead, which is fine -- sharp reads both, so
    // whatever type came back is what we name the file.
    if (!blob || !blob.size) return bail(bitmap);
    if (blob.size >= file.size) return bail(bitmap);

    const ext = blob.type === "image/webp" ? "webp" : "png";
    const stem = file.name.replace(/\.[^.]+$/, "") || "picture";
    return new File([blob], `${stem}.${ext}`, { type: blob.type });
  } catch {
    return bail(bitmap);
  } finally {
    // A decoded 50MP bitmap is ~200MB of memory; do not wait for the GC.
    bitmap.close?.();
  }
}
