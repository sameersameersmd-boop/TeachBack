const http = require("http");

const data = JSON.stringify({
  text: `
Computer Vision is a field of artificial intelligence that enables
computers to understand and analyze images and videos.
It is used in applications such as face detection, object recognition,
medical image analysis, and autonomous systems.
  `,
  topic: "Computer Vision",
  language: "English"
});

const options = {
  hostname: "localhost",
  port: 5000,
  path: "/explain",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  let body = "";

  res.on("data", chunk => {
    body += chunk;
  });

  res.on("end", () => {
    console.log("\nSTATUS:", res.statusCode);
    console.log("\nRESPONSE:\n");
    console.log(body);
  });
});

req.on("error", (error) => {
  console.error("ERROR:", error.message);
});

req.write(data);
req.end();