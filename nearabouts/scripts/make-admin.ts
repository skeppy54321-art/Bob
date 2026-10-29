/** Usage: npm run make-admin -- <username>   (grants admin rights to an existing account) */
import { db } from '../src/server/db.ts';
const name = process.argv[2];
if (!name) { console.error('Usage: npm run make-admin -- <username>'); process.exit(1); }
const r = db.prepare('UPDATE users SET is_admin=1 WHERE username=? AND is_guest=0').run(name);
console.log(r.changes ? `${name} is now an admin.` : `No registered account called "${name}".`);
