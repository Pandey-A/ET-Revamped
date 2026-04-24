const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const http = require('http');

const app = express();

const BACKEND = 'http://localhost:8000';   
const FRONTEND = 'http://localhost:8080/user/';  
const ADMIN_FRONTEND = 'http://localhost:8081/admin/';
const PORT = 5050;                         


const apiProxy = createProxyMiddleware({
  target: BACKEND,
  changeOrigin: true,
  ws: true,
  timeout: 120000,               //60s timeout (or more)
  proxyTimeout: 120000,
  pathRewrite: { '^/api': '' },
  selfHandleResponse: false,     // Important for streaming
  onProxyReq: (proxyReq, req, res) => {
    if (!req.body || !Object.keys(req.body).length) return;

    const bodyData = JSON.stringify(req.body);
    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
    proxyReq.write(bodyData);
  },
  onProxyRes(proxyRes, req, res) {
    if ( req.url.includes("/chat/stream/") || req.url.includes("/message/stream") || req.url.includes("/chat/analyze_action")) {
      res.setHeader("Transfer-Encoding", "chunked");
      proxyRes.pipe(res); // Forward chunks as-is
    }
  },
onError(err, req, res) {
  console.error(`[Proxy Error] ${req.url} -> ${err.message}`);
  res.writeHead(503, { 'Content-Type': 'text/plain' });
  res.end('Proxy error');
},
  logLevel: 'debug',
});
app.use('/api', apiProxy);

const adminProxy =   createProxyMiddleware({
    target: ADMIN_FRONTEND,
    changeOrigin: true,
  })
app.use( '/admin', adminProxy );


const frontendProxy = createProxyMiddleware({
  target: FRONTEND,
  changeOrigin: true,
});
app.use('/user', frontendProxy);


const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
  console.log(`[Proxy] WS upgrade: ${req.url}`);
  if (req.url.startsWith('/api/ws')) {
    apiProxy.upgrade(req, socket, head);
} 
});

app.get('/ping', (_, res) => {
  res.send('Proxy is live');
});


server.listen(PORT, () => {
  console.log(`Proxy running at http://localhost:${PORT}`);
});
