
export const serverRunningTemplate = (req, res) => {
  res.status(200).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Server Running</title>
      <style>
        body {
          margin: 0;
          height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0f172a;
          color: #e5e7eb;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        }
        .box {
          text-align: center;
        }
        h1 {
          font-size: 2.2rem;
          margin-bottom: 8px;
          color: #22c55e;
        }
        p {
          opacity: 0.8;
          font-size: 1rem;
        }
        .dot {
          animation: blink 1.5s infinite;
        }
        @keyframes blink {
          0% { opacity: 0.2; }
          50% { opacity: 1; }
          100% { opacity: 0.2; }
        }
      </style>
    </head>
    <body>
      <div class="box">
        <h1>🚀 Server is Running<span class="dot">...</span></h1>
        <p>Backend is live and ready to accept requests</p>
      </div>
    </body>
    </html>
  `);
};
