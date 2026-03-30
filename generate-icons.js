// Run this once: node generate-icons.js
// Generates PWA icons for the app

import { writeFileSync } from "fs";

function generateSVG(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="#0d0d0f"/>
  <text x="50%" y="52%" dominant-baseline="central" text-anchor="middle"
        font-family="Georgia, serif" font-size="${size * 0.45}" font-weight="bold" fill="#f59e0b">✦</text>
</svg>`;
}

// Write SVG icons (browsers handle SVG fine for most cases)
writeFileSync("public/icon-192.svg", generateSVG(192));
writeFileSync("public/icon-512.svg", generateSVG(512));

console.log("✦ Icons generated in public/");
console.log("  For production PNG icons, use https://realfavicongenerator.net");
