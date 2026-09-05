/* eslint-disable */
// 应用图标生成：assets/icon.svg → 多尺寸 PNG → assets/icon.ico（electron-builder 用）。
// 运行：node scripts/generate-icon.cjs（依赖 devDependencies: @resvg/resvg-js、png-to-ico）
const fs = require("node:fs");
const path = require("node:path");
const { Resvg } = require("@resvg/resvg-js");
const pngToIco = require("png-to-ico").default;

const ROOT = path.join(__dirname, "..");
const SVG_PATH = path.join(ROOT, "assets", "icon.svg");
const ICO_PATH = path.join(ROOT, "assets", "icon.ico");
const PNG_PATH = path.join(ROOT, "assets", "icon.png");
// Windows ICO 标准尺寸集（256 为放大图必备）。
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const svg = fs.readFileSync(SVG_PATH, "utf8");
const pngs = SIZES.map((size) => {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size } });
  return { size, buffer: resvg.render().asPng() };
});

pngToIco(pngs.map((entry) => entry.buffer))
  .then((icoBuffer) => {
    fs.writeFileSync(ICO_PATH, icoBuffer);
    fs.writeFileSync(PNG_PATH, pngs[pngs.length - 1].buffer);
    console.log(`OK: ${ICO_PATH} (${icoBuffer.length} bytes, ${SIZES.length} sizes) + ${PNG_PATH}`);
  })
  .catch((error) => {
    console.error("FAILED:", error);
    process.exit(1);
  });
