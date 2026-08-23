const fs = require("fs");
const readline = require("readline");
const path =
  "C:\\Users\\jackx\\.gemini\\antigravity-ide\\brain\\e6fc36b4-4ab3-4bc4-813d-fc41589f0c65\\.system_generated\\logs\\transcript_full.jsonl";
const fileStream = fs.createReadStream(path);
const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

let foundBase64 = null;
rl.on("line", (line) => {
  if (line.includes('"image_url":')) {
    const match = line.match(/"url":"data:image\/[^;]+;base64,([^"]+)"/);
    if (match) {
      foundBase64 = match[1];
    }
  }
});
rl.on("close", () => {
  if (foundBase64) {
    fs.writeFileSync(
      "d:/final products/zerah baby/src/assets/zerah-logo.png",
      Buffer.from(foundBase64, "base64"),
    );
    console.log("SUCCESS: Extracted base64 image and saved to zerah-logo.png");
  } else {
    console.log("FAILED: No base64 image found in transcript.");
  }
});
