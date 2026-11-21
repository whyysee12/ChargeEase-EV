// Vercel Serverless Entry Point for /api/* routes
const url = require('url');
require('../backend/db');
const { handleApiRequest } = require('../backend/api');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-auth-token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || '/api/health';
  return handleApiRequest(req, res, pathname, parsedUrl.query || {});
};
