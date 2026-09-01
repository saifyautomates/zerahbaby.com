const fs = require("fs");
const path = require("path");

function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith(".tsx") || fullPath.endsWith(".ts")) {
      let content = fs.readFileSync(fullPath, "utf8");
      if (content.includes("<img ")) {
        const newContent = content.replace(
          /<img(?!\s+[^>]*\bloading=["']lazy["'])/g,
          '<img loading="lazy" decoding="async"',
        );
        if (newContent !== content) {
          fs.writeFileSync(fullPath, newContent, "utf8");
          console.log(`Updated ${fullPath}`);
        }
      }
    }
  }
}

processDir(path.join(__dirname, "src"));
