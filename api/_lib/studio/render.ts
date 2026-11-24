import sharp from "sharp";
import { join } from "node:path";
import {
  studioPresets,
  outputDimensions,
  type StudioRecipe,
} from "../../../lib/virtual-studio.js";
import { cutoutFromMask, digest, type LoadedSource } from "./images.js";

export async function compositeWatch(
  source: LoadedSource,
  mask: Buffer,
  r: StudioRecipe,
) {
  const { width, height } = outputDimensions(r);
  const selected = studioPresets.find((p) => p.id === r.preset)!;
  const asset = join(process.cwd(), "public", "studio", selected.image);
  let background = sharp(asset)
    .resize(width, height, { fit: "cover", position: "centre" })
    .removeAlpha();
  if (r.backgroundBlur > 0.2) background = background.blur(r.backgroundBlur);
  const bg = await background.raw().toBuffer();
  const angle = (r.lightAngle * Math.PI) / 180,
    exposure = 2 ** r.backgroundExposure;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const directional =
        (x / width - 0.5) * Math.cos(angle) +
        (y / height - 0.5) * Math.sin(angle);
      const light = exposure * (1 + directional * r.lightFalloff);
      const i = (y * width + x) * 3;
      bg[i] = Math.min(255, Math.max(0, bg[i] * light * (1 + r.warmth)));
      bg[i + 1] = Math.min(255, Math.max(0, bg[i + 1] * light));
      bg[i + 2] = Math.min(
        255,
        Math.max(0, bg[i + 2] * light * (1 - r.warmth)),
      );
    }
  const cutout = await cutoutFromMask(source, mask);
  let watch = sharp(cutout.buffer);
  if (r.edgeFeather > 0.05) {
    const m = await sharp(cutout.buffer)
      .extractChannel(3)
      .blur(Math.max(0.3, r.edgeFeather))
      .png()
      .toBuffer();
    const rgb = await sharp(cutout.buffer).removeAlpha().png().toBuffer();
    watch = sharp(rgb).joinChannel(
      await sharp(m).removeAlpha().greyscale().raw().toBuffer(),
      {
        raw: {
          width: cutout.box.width,
          height: cutout.box.height,
          channels: 1,
        },
      },
    );
  }
  const maxSide = Math.round(Math.min(width, height) * r.scale);
  // Uniform scale + in-plane rotation only. No perspective warp, relighting, retouching or generative watch pixels.
  const layer = await watch
    .resize({
      width: maxSide,
      height: maxSide,
      fit: "inside",
      withoutEnlargement: true,
    })
    .rotate(r.rotation, { background: "#00000000" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = layer.info.width,
    h = layer.info.height;
  const left = Math.round(width * r.x - w / 2),
    top = Math.round(height * r.y - h / 2);
  if (left < 0 || top < 0 || left + w > width || top + h > height)
    throw new Error("WATCH_OUTSIDE_FRAME");
  const shadowAlpha = Buffer.alloc(width * height),
    contactAlpha = Buffer.alloc(width * height);
  const rad = (r.shadowAngle * Math.PI) / 180,
    anchor = h * r.contactY,
    length = r.shadowLength * (width / 1200);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = layer.data[(y * w + x) * 4 + 3];
      if (!a) continue;
      const elevation = Math.max(0, anchor - y) / Math.max(1, h);
      const sx = Math.round(left + x + elevation * length * Math.cos(rad));
      const sy = Math.round(
        top +
          anchor +
          (y - anchor) * r.shadowFlatten +
          elevation * length * Math.sin(rad),
      );
      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        const i = sy * width + sx;
        shadowAlpha[i] = Math.max(
          shadowAlpha[i],
          Math.round(a * r.shadowOpacity),
        );
      }
      // The local contact band is separate from the longer projected silhouette shadow.
      if (Math.abs(y - anchor) < h * 0.1) {
        const cx = left + x,
          cy = Math.round(top + anchor + (y - anchor) * 0.15);
        if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
          const i = cy * width + cx;
          contactAlpha[i] = Math.max(
            contactAlpha[i],
            Math.round(a * r.contactStrength),
          );
        }
      }
    }
  async function shadowLayer(alpha: Buffer, blur: number) {
    const blurred = await sharp(alpha, { raw: { width, height, channels: 1 } })
      .blur(Math.max(0.3, blur))
      .greyscale()
      .raw()
      .toBuffer();
    const rgba = Buffer.alloc(width * height * 4);
    for (let i = 0; i < blurred.length; i++) {
      rgba[i * 4] = 25;
      rgba[i * 4 + 1] = 18;
      rgba[i * 4 + 2] = 11;
      rgba[i * 4 + 3] = blurred[i];
    }
    return rgba;
  }
  const cast = await shadowLayer(
    shadowAlpha,
    (r.shadowSoftness * width) / 1200,
  );
  const contact = await shadowLayer(contactAlpha, (2 * width) / 1200);
  const png = await sharp(bg, { raw: { width, height, channels: 3 } })
    .composite([
      { input: cast, raw: { width, height, channels: 4 } },
      { input: contact, raw: { width, height, channels: 4 } },
      {
        input: layer.data,
        raw: { width: w, height: h, channels: 4 },
        left,
        top,
      },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
  return {
    png,
    manifest: {
      version: 1,
      sourceSha256: source.sha256,
      maskSha256: digest(mask),
      recipe: r,
      width,
      height,
      watchBox: { left, top, width: w, height: h },
      operations: [
        "source colour-profile normalization",
        "alpha masking",
        "uniform scaling",
        "in-plane rotation",
        "background-only light and focus adjustments",
        "separate silhouette and contact shadows",
      ],
      productGenerated: false,
      productRetouched: false,
      reviewRequired: true,
      outputSha256: digest(png),
      renderMode: "fixed-studio-plate",
    },
  };
}
