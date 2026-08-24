const fetch = require('node-fetch');

(async () => {
  try {
    const res = await fetch("http://localhost:54321/functions/v1/shiprocket-api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create_shipment", orderId: "123" })
    });
    const data = await res.json();
    console.log("Status:", res.status);
    console.log("Response:", data);
  } catch(e) {
    console.log("Error:", e);
  }
})();
