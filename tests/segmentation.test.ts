import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  loadSource,
  pngUrl,
  cutoutFromMask,
} from "../api/_lib/studio/images.js";
import {
  segmentWatch,
  validateSegmentationGuidance,
  type SegmentationGuidance,
} from "../api/_lib/studio/segmentation.js";

const width = 300,
  height = 240;
const point = (x: number, y: number) => ({ x: x / width, y: y / height });
const rectangle = (x: number, y: number, w: number, h: number) => [
  point(x, y),
  point(x + w, y),
  point(x + w, y + h),
  point(x, y + h),
];
function guidance(): SegmentationGuidance {
  return {
    outline: rectangle(165, 65, 92, 112),
    holes: [rectangle(193, 139, 20, 20)],
    foregroundPoints: [point(180, 90)],
    backgroundPoints: [point(155, 55)],
  };
}
async function fixture() {
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const object = x >= 168 && x < 254 && y >= 68 && y < 174;
      const hole = x >= 193 && x < 213 && y >= 139 && y < 159;
      const whiteDial = x >= 185 && x < 235 && y >= 86 && y < 125;
      // The dial has exactly the same colors as the background. It must survive
      // because the source-coordinate interior is protected, unlike color keying.
      rgb[i] = object && !hole && !whiteDial ? 145 + (x % 17) : 235 + (x % 5);
      rgb[i + 1] =
        object && !hole && !whiteDial ? 45 + (y % 11) : 235 + (y % 5);
      rgb[i + 2] = object && !hole && !whiteDial ? 38 + ((x + y) % 13) : 239;
    }
  const png = await sharp(rgb, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
  return { rgb, source: await loadSource({ dataUrl: pngUrl(png) }) };
}

test("source-coordinate isolation refines edges, retains white dial, and cuts specified holes", async () => {
  const { source } = await fixture();
  const result = await segmentWatch(source, guidance());
  assert.equal((await sharp(result.mask).metadata()).channels, 1);
  const { data, info } = await sharp(result.mask)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, width);
  assert.equal(info.height, height);
  assert.equal(info.channels, 1);
  const alpha = (x: number, y: number) => data[y * width + x];
  assert.equal(
    alpha(205, 105),
    255,
    "white dial remains opaque even when it matches background",
  );
  assert.equal(alpha(202, 148), 0, "bracelet opening is transparent");
  assert.equal(alpha(181, 148), 255, "material beside opening remains opaque");
  assert.equal(
    alpha(165, 110),
    0,
    "uncertain outline band is refined to the photographed edge",
  );
  assert.equal(alpha(169, 110), 255);
  assert.equal(alpha(150, 120), 0, "watch is not moved to image center");
  assert.equal(alpha(40, 40), 0);
  assert.equal(result.diagnostics.method, "source-coordinate-grabcut");
  assert.ok(result.diagnostics.sourceBounds.left > 100);
  assert.ok(
    result.diagnostics.foregroundFraction > 0.1 &&
      result.diagnostics.foregroundFraction < 0.2,
  );
});

test("isolated watch copies every retained original RGB sample, and repeated segmentation is deterministic", async () => {
  const { source, rgb } = await fixture();
  const result = await segmentWatch(source, guidance());
  assert.deepEqual((await segmentWatch(source, guidance())).mask, result.mask);
  const cutout = await cutoutFromMask(source, result.mask);
  const raw = await sharp(cutout.buffer).raw().toBuffer();
  let checked = 0;
  for (let y = 0; y < cutout.box.height; y++)
    for (let x = 0; x < cutout.box.width; x++) {
      const i = (y * cutout.box.width + x) * 4;
      if (!raw[i + 3]) continue;
      const original = ((y + cutout.box.top) * width + x + cutout.box.left) * 3;
      assert.deepEqual(
        raw.subarray(i, i + 3),
        rgb.subarray(original, original + 3),
      );
      checked++;
    }
  assert.ok(
    checked > 8000,
    "check the actual retained watch, not an empty cutout",
  );
});

test("explicit background seed can remove an interior support without recoloring watch", async () => {
  const { source } = await fixture();
  const g = guidance();
  g.holes = [];
  g.backgroundPoints.push(point(202, 148));
  const { mask } = await segmentWatch(source, g);
  const data = await sharp(mask).greyscale().raw().toBuffer();
  assert.equal(data[148 * width + 202], 0);
  assert.equal(data[105 * width + 205], 255);
});

test("edge cleanup removes attached filaments outside guidance but preserves thin details inside it", async () => {
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const body = x >= 168 && x < 254 && y >= 68 && y < 174;
      const crownDetail = x >= 208 && x < 210 && y >= 60 && y < 68;
      const backgroundLetter = x >= 254 && x < 261 && y === 130;
      const i = (y * width + x) * 3;
      rgb[i] = body || crownDetail || backgroundLetter ? 140 : 240;
      rgb[i + 1] = body || crownDetail || backgroundLetter ? 55 : 240;
      rgb[i + 2] = body || crownDetail || backgroundLetter ? 35 : 240;
    }
  const png = await sharp(rgb, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
  const source = await loadSource({ dataUrl: pngUrl(png) });
  const result = await segmentWatch(source, {
    outline: [
      point(168, 68),
      point(208, 68),
      point(208, 60),
      point(210, 60),
      point(210, 68),
      point(254, 68),
      point(254, 174),
      point(168, 174),
    ],
    holes: [],
    foregroundPoints: [point(190, 90)],
    backgroundPoints: [],
  });
  const data = await sharp(result.mask).greyscale().raw().toBuffer();
  assert.equal(
    data[130 * width + 256],
    0,
    "thin attached background filament is removed",
  );
  assert.ok(
    data[63 * width + 208] > 240,
    "thin detail within supplied watch silhouette is preserved",
  );
  assert.ok(result.diagnostics.removedEdgePixels > 0);
});

test("invalid, crossed, contradictory, and unbounded guidance fails visibly", async () => {
  for (const value of [
    null,
    {},
    { ...guidance(), outline: [point(10, 10)] },
    {
      ...guidance(),
      outline: [{ x: NaN, y: 0.2 }, point(20, 30), point(40, 60)],
    },
    {
      ...guidance(),
      outline: [{ x: 1.1, y: 0.2 }, point(20, 30), point(40, 60)],
    },
    {
      ...guidance(),
      outline: [point(10, 10), point(80, 90), point(10, 90), point(80, 10)],
    },
    { ...guidance(), holes: [rectangle(20, 20, 20, 20)] },
    { ...guidance(), backgroundPoints: [point(180, 90)] },
    {
      ...guidance(),
      foregroundPoints: Array.from({ length: 129 }, () => point(180, 90)),
    },
  ])
    assert.throws(
      () => validateSegmentationGuidance(value),
      /INVALID_SEGMENTATION_GUIDANCE/,
    );
  const { source } = await fixture();
  await assert.rejects(
    segmentWatch(source, {
      ...guidance(),
      outline: rectangle(2, 2, 1, 1),
      holes: [],
      foregroundPoints: [],
      backgroundPoints: [],
    }),
    /MASK_NEEDS_REVIEW/,
  );
});

test("processing downsample restores full source dimensions and offset", async () => {
  const bigWidth = 1600,
    bigHeight = 1400;
  const image = await sharp({
    create: {
      width: bigWidth,
      height: bigHeight,
      channels: 3,
      background: { r: 240, g: 240, b: 240 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 1000,
            height: 1160,
            channels: 3,
            background: { r: 120, g: 60, b: 35 },
          },
        })
          .png()
          .toBuffer(),
        left: 450,
        top: 150,
      },
    ])
    .png()
    .toBuffer();
  const source = await loadSource({ dataUrl: pngUrl(image) });
  const result = await segmentWatch(source, {
    outline: [
      { x: 448 / bigWidth, y: 148 / bigHeight },
      { x: 1452 / bigWidth, y: 148 / bigHeight },
      { x: 1452 / bigWidth, y: 1312 / bigHeight },
      { x: 448 / bigWidth, y: 1312 / bigHeight },
    ],
    holes: [],
    foregroundPoints: [],
    backgroundPoints: [],
  });
  assert.equal(
    Math.max(
      result.diagnostics.processingWidth,
      result.diagnostics.processingHeight,
    ),
    1200,
  );
  const { data, info } = await sharp(result.mask)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, bigWidth);
  assert.equal(info.height, bigHeight);
  assert.equal(data[700 * bigWidth + 470], 255);
  assert.equal(data[700 * bigWidth + 430], 0);
  assert.equal(data[1320 * bigWidth + 900], 0);
});
