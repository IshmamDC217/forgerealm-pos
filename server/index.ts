import 'dotenv/config';
import { app } from './app';

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`ForgeRealm POS server running on port ${PORT}`);
});
