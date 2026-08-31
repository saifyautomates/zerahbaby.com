import fs from "fs";
const data = JSON.parse(fs.readFileSync("db_audit.json", "utf8"));
const perms = data[0].table_permissions.find((p) => p.table_name === "product_variants");
console.log(JSON.stringify(perms, null, 2));
