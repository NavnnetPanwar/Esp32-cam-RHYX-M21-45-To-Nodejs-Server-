
import express from "express";
import fileUpload from "express-fileupload";
import fs from "fs";

const app = express();
const PORT = 5000;
const MAX_FRAME_SIZE = 10 * 1024 * 1024;

app.use(
  fileUpload({
    limits: { fileSize: MAX_FRAME_SIZE },
    abortOnLimit: true,
    responseOnLimit: "Frame too large"
  })
);

// Latest camera frame stored in memory
let latestFrame = null;
let lastFrameTime = null;

// Connected browser viewers
const viewers = new Set();

// Broadcast a frame to every connected browser
function broadcastFrame(frame) {
  const header = Buffer.from(
    `--frame\r\n` +
    `Content-Type: image/jpeg\r\n` +
    `Content-Length: ${frame.length}\r\n\r\n`
  );

  const packet = Buffer.concat([
    header,
    frame,
    Buffer.from("\r\n")
  ]);

  for (const viewer of viewers) {
    if (!viewer.destroyed && !viewer.writableEnded) {
      viewer.write(packet);
    }
  }
}

// Browser live viewer
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>ESP32-CAM Live Feed</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          background: #111827;
          color: white;
          font-family: Arial, sans-serif;
          text-align: center;
          padding: 20px;
        }
        img {
          width: 100%;
          max-width: 900px;
          background: black;
          border-radius: 10px;
        }
        #status { color: #22c55e; }
      </style>
    </head>
    <body>
      <h2>ESP32-CAM Live Feed</h2>
      <p id="status">Waiting for camera...</p>
      <img src="/stream" alt="Live camera feed">

      <script>
        async function updateStatus() {
          try {
            const response = await fetch("/health");
            const data = await response.json();

            document.getElementById("status").textContent =
              data.cameraConnected
                ? "Camera connected"
                : "Waiting for camera...";
          } catch {
            document.getElementById("status").textContent =
              "Server unavailable";
          }
        }

        updateStatus();
        setInterval(updateStatus, 2000);
      </script>
    </body>
    </html>
  `);
});

// Camera uploads a JPEG frame here
app.post("/frame", (req, res) => {
  const image = req.files?.image;

  if (!image) {
    return res.status(400).send("Missing image field");
  }

  if (image.mimetype !== "image/jpeg") {
    return res.status(400).send("JPEG images only");
  }

  if (!image.data || image.data.length === 0) {
    return res.status(400).send("Empty frame");
  }

  // Replace previous frame
  latestFrame = image.data;
  lastFrameTime = Date.now();

  // Send frame to all browser viewers
  broadcastFrame(latestFrame);

  res.status(200).send("Frame received");
});

// Continuous MJPEG stream
app.get("/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=frame",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });

  viewers.add(res);

  // Immediately send latest frame to new viewer
  if (latestFrame) {
    const header = Buffer.from(
      `--frame\r\n` +
      `Content-Type: image/jpeg\r\n` +
      `Content-Length: ${latestFrame.length}\r\n\r\n`
    );

    res.write(Buffer.concat([
      header,
      latestFrame,
      Buffer.from("\r\n")
    ]));
  }

  req.on("close", () => {
    viewers.delete(res);
  });
});

// Server and camera health
app.get("/health", (req, res) => {
  const cameraConnected =
    lastFrameTime !== null &&
    Date.now() - lastFrameTime < 5000;

  res.json({
    status: "running",
    cameraConnected,
    lastFrameTime,
    viewers: viewers.size
  });
});

// Existing image upload functionality retained
app.post("/upload", (req, res) => {
  const image = req.files?.image;

  if (!image) {
    return res.status(400).send("No image submitted");
  }

  if (!/^image\//.test(image.mimetype)) {
    return res.status(400).send("Invalid image type");
  }

  fs.mkdirSync("./images", { recursive: true });

  const filename = `${Date.now()}_${image.name}`;

  image.mv(`./images/${filename}`, (err) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Upload failed");
    }

    console.log("Image saved:", filename);
    res.status(200).send("Image uploaded successfully");
  });
});

// Start server on all network interfaces
app.listen(PORT, "0.0.0.0", () => {
  console.log(`ESP32-CAM server running on port ${PORT}`);
  console.log(`Local viewer: http://localhost:${PORT}`);
});
