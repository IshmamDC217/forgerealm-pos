import serverless from 'serverless-http';
import { app } from '../../server/app';

// Netlify invokes the function with event.path prefixed by
// `/.netlify/functions/api`. basePath strips that so Express sees the raw
// `/api/...` path it was mounted on.
export const handler = serverless(app, {
  basePath: '/.netlify/functions/api',
});
