import 'dotenv/config';
import { app } from './app';
import { startPoller } from './sumup/poller';

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`ForgeRealm POS server running on port ${PORT}`);
  startPoller();
});
