const http = require('http');
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '../playwright-report/index.html');
if (!fs.existsSync(file)) { console.error('No current report. Run npm test first.'); process.exit(1); }
const server = http.createServer((_request, response) => {
  fs.readFile(file, (error, data) => {
    response.writeHead(error ? 404 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
    response.end(error ? 'Report unavailable' : data);
  });
});
server.on('error', () => { console.error('Could not start the local report server.'); process.exitCode = 1; });
server.listen(0, '127.0.0.1', () => console.log(`Report: http://127.0.0.1:${server.address().port} (Ctrl+C to stop)`));
